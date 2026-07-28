import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { GameEngine } from "./game-engine.js";
import type { BetSlot } from "./types.js";
import { bootstrapAdmin, createAuthSession, destroyAuthSession, hashPassword, optionalAuth, publicUser, requireAdmin, requireAuth, resolveAuthUserFromCookie, verifyPassword, type AuthenticatedRequest } from "./auth.js";
import { connectDatabase, disconnectDatabase } from "./database.js";
import { createDepositRequest, createWithdrawalRequest, reviewDeposit, reviewWithdrawal } from "./finance.js";
import {
  AuthSessionModel,
  ChatMessageModel,
  DepositRequestModel,
  GameBetModel,
  GameRoundModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WalletTransactionModel,
  WithdrawalRequestModel
} from "./models.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : true;

const asyncRoute = (handler: (request: any, response: Response, next: NextFunction) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);

const numberInput = (value: unknown): number => Number(value);
const cleanText = (value: unknown, max = 500): string => String(value ?? "").trim().slice(0, max);

const depositStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;
type DepositStatus = (typeof depositStatuses)[number];
const isDepositStatus = (value: string): value is DepositStatus =>
  depositStatuses.includes(value as DepositStatus);

const withdrawalStatuses = ["PENDING", "PROCESSING", "COMPLETED", "REJECTED"] as const;
type WithdrawalStatus = (typeof withdrawalStatuses)[number];
const isWithdrawalStatus = (value: string): value is WithdrawalStatus =>
  withdrawalStatuses.includes(value as WithdrawalStatus);

await connectDatabase();
await bootstrapAdmin();

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(optionalAuth);

app.get("/health", asyncRoute(async (_request, response) => {
  response.json({ ok: true, service: "skyrush-game-server", database: "connected", timestamp: new Date().toISOString() });
}));

app.post("/api/auth/register", asyncRoute(async (request, response) => {
  const name = cleanText(request.body?.name, 80);
  const email = cleanText(request.body?.email, 160).toLowerCase();
  const password = String(request.body?.password ?? "");
  if (name.length < 2) {
    response.status(400).json({ ok: false, message: "Name must contain at least 2 characters." });
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    response.status(400).json({ ok: false, message: "Enter a valid email address." });
    return;
  }
  if (password.length < 8) {
    response.status(400).json({ ok: false, message: "Password must contain at least 8 characters." });
    return;
  }
  if (await UserModel.exists({ email })) {
    response.status(409).json({ ok: false, message: "An account already exists with this email." });
    return;
  }

  const user = await UserModel.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: "USER",
    status: "ACTIVE",
    balance: 0,
    lockedBalance: 0
  });
  await createAuthSession(String(user._id), request, response);
  response.status(201).json({ ok: true, user: publicUser(user) });
}));

app.post("/api/auth/login", asyncRoute(async (request, response) => {
  const email = cleanText(request.body?.email, 160).toLowerCase();
  const password = String(request.body?.password ?? "");
  const user = await UserModel.findOne({ email }).select("+passwordHash");
  if (!user || !(await verifyPassword(password, String(user.passwordHash)))) {
    response.status(401).json({ ok: false, message: "Invalid email or password." });
    return;
  }
  if (user.status !== "ACTIVE") {
    response.status(403).json({ ok: false, message: "This account is suspended." });
    return;
  }
  user.lastLoginAt = new Date();
  await user.save();
  await createAuthSession(String(user._id), request, response);
  response.json({ ok: true, user: publicUser(user) });
}));

app.post("/api/auth/logout", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  await destroyAuthSession(request, response);
  response.json({ ok: true });
}));

app.get("/api/auth/me", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const user = await UserModel.findById(request.authUser!.id).lean();
  if (!user) {
    response.status(404).json({ ok: false, message: "User not found." });
    return;
  }
  response.json({ ok: true, user: publicUser(user) });
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
  transports: ["websocket", "polling"]
});

const engine = new GameEngine(io);
await engine.initialize();

app.get("/api/wallet", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  response.json({ ok: true, wallet: await engine.getWallet(request.authUser!.id) });
}));

app.get("/api/wallet/transactions", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const page = Math.max(1, Number(request.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 30)));
  const transactions = await WalletTransactionModel.find({ userId: request.authUser!.id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  response.json({ ok: true, transactions });
}));

app.post("/api/deposits", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const deposit = await createDepositRequest({
    userId: request.authUser!.id,
    amount: numberInput(request.body?.amount),
    method: cleanText(request.body?.method, 80),
    reference: cleanText(request.body?.reference, 160),
    note: cleanText(request.body?.note, 500)
  });
  response.status(201).json({ ok: true, deposit });
}));

app.get("/api/deposits/me", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const deposits = await DepositRequestModel.find({ userId: request.authUser!.id }).sort({ createdAt: -1 }).limit(100).lean();
  response.json({ ok: true, deposits });
}));

app.post("/api/withdrawals", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const withdrawal = await createWithdrawalRequest({
    userId: request.authUser!.id,
    amount: numberInput(request.body?.amount),
    method: cleanText(request.body?.method, 80),
    accountDetails: cleanText(request.body?.accountDetails, 500)
  });
  await engine.emitWalletForUser(request.authUser!.id);
  response.status(201).json({ ok: true, withdrawal });
}));

app.get("/api/withdrawals/me", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const withdrawals = await WithdrawalRequestModel.find({ userId: request.authUser!.id }).sort({ createdAt: -1 }).limit(100).lean();
  response.json({ ok: true, withdrawals });
}));

app.get("/api/admin/summary", requireAdmin, asyncRoute(async (_request, response) => {
  const [users, depositsPending, withdrawalsPending, settings, state, activeBets, recentRounds] = await Promise.all([
    UserModel.countDocuments({ role: "USER" }),
    DepositRequestModel.countDocuments({ status: "PENDING" }),
    WithdrawalRequestModel.countDocuments({ status: { $in: ["PENDING", "PROCESSING"] } }),
    PlatformSettingsModel.findOne({ key: "global" }).lean(),
    PlatformStateModel.findOne({ key: "global" }).lean(),
    GameBetModel.countDocuments({ status: "ACTIVE" }),
    GameRoundModel.find({ phase: "CRASHED" }).sort({ crashedAt: -1 }).limit(10).select("roundId crashPoint totalStake totalPayout crashedAt").lean()
  ]);
  const bankroll = Number(state?.houseBankroll ?? 0) + Number(state?.gameProfit ?? 0);
  const reservePercent = Number(settings?.reservePercent ?? 30);
  response.json({
    ok: true,
    summary: {
      users,
      depositsPending,
      withdrawalsPending,
      activeBets,
      houseBankroll: Number(state?.houseBankroll ?? 0),
      gameProfit: Number(state?.gameProfit ?? 0),
      effectiveBankroll: bankroll,
      requiredReserve: Math.max(0, bankroll * reservePercent / 100),
      lossPool: Number((state as any)?.lossPool ?? 0),
      totalCommissionEarned: Number((state as any)?.totalCommissionEarned ?? 0),
      totalApprovedDeposits: Number(state?.totalApprovedDeposits ?? 0),
      totalCompletedWithdrawals: Number(state?.totalCompletedWithdrawals ?? 0),
      recentRounds
    }
  });
}));

app.get("/api/admin/users", requireAdmin, asyncRoute(async (request, response) => {
  const search = cleanText(request.query.search, 100);
  const filter = search
    ? { $or: [{ email: { $regex: search, $options: "i" } }, { name: { $regex: search, $options: "i" } }] }
    : {};
  const users = await UserModel.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  response.json({ ok: true, users: users.map(publicUser) });
}));

app.patch("/api/admin/users/:id", requireAdmin, asyncRoute(async (request, response) => {
  const status = request.body?.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
  const user = await UserModel.findOneAndUpdate(
    { _id: cleanText(request.params.id, 100), role: "USER" },
    { $set: { status } },
    { new: true }
  );
  if (!user) {
    response.status(404).json({ ok: false, message: "User not found." });
    return;
  }
  if (status === "SUSPENDED") await AuthSessionModel.deleteMany({ userId: user._id });
  response.json({ ok: true, user: publicUser(user) });
}));

app.get("/api/admin/deposits", requireAdmin, asyncRoute(async (request, response) => {
  const rawStatus = cleanText(request.query.status, 30).toUpperCase();
  const filter: { status?: DepositStatus } = isDepositStatus(rawStatus) ? { status: rawStatus } : {};
  const deposits = await DepositRequestModel.find(filter)
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  response.json({ ok: true, deposits });
}));

app.patch("/api/admin/deposits/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const action = request.body?.action === "REJECT" ? "REJECT" : "APPROVE";
  const result = await reviewDeposit({
    depositId: cleanText(request.params.id, 100),
    adminId: request.authUser!.id,
    action,
    note: cleanText(request.body?.note, 500)
  });
  await engine.emitWalletForUser(result.userId);
  response.json({ ok: true });
}));

app.get("/api/admin/withdrawals", requireAdmin, asyncRoute(async (request, response) => {
  const rawStatus = cleanText(request.query.status, 30).toUpperCase();
  const filter: { status?: WithdrawalStatus } = isWithdrawalStatus(rawStatus) ? { status: rawStatus } : {};
  const withdrawals = await WithdrawalRequestModel.find(filter)
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  response.json({ ok: true, withdrawals });
}));

app.patch("/api/admin/withdrawals/:id", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const rawAction = cleanText(request.body?.action, 20);
  const action = rawAction === "REJECT" ? "REJECT" : rawAction === "PROCESS" ? "PROCESS" : "COMPLETE";
  const result = await reviewWithdrawal({
    withdrawalId: cleanText(request.params.id, 100),
    adminId: request.authUser!.id,
    action,
    note: cleanText(request.body?.note, 500)
  });
  await engine.emitWalletForUser(result.userId);
  response.json({ ok: true });
}));

app.get("/api/admin/settings", requireAdmin, asyncRoute(async (_request, response) => {
  const [settings, state] = await Promise.all([
    PlatformSettingsModel.findOne({ key: "global" }).lean(),
    PlatformStateModel.findOne({ key: "global" }).lean()
  ]);
  response.json({ ok: true, settings, state });
}));

app.patch("/api/admin/settings", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const houseEdgePercent = Math.min(20, Math.max(0, numberInput(request.body?.houseEdgePercent)));
  const commissionPercent = Math.min(50, Math.max(0, numberInput(request.body?.commissionPercent)));
  const reservePercent = Math.min(95, Math.max(0, numberInput(request.body?.reservePercent)));
  const minBet = Math.max(1, numberInput(request.body?.minBet));
  const maxBet = Math.max(minBet, numberInput(request.body?.maxBet));
  const maxCashoutMultiplier = Math.min(1000, Math.max(1.01, numberInput(request.body?.maxCashoutMultiplier)));
  const houseBankroll = Math.max(0, numberInput(request.body?.houseBankroll));
  if (![houseEdgePercent, commissionPercent, reservePercent, minBet, maxBet, maxCashoutMultiplier, houseBankroll].every(Number.isFinite)) {
    response.status(400).json({ ok: false, message: "All numeric settings must be valid numbers." });
    return;
  }

  const [settings, state] = await Promise.all([
    PlatformSettingsModel.findOneAndUpdate(
      { key: "global" },
      {
        $set: {
          houseEdgePercent,
          commissionPercent,
          reservePercent,
          minBet,
          maxBet,
          maxCashoutMultiplier,
          depositsEnabled: request.body?.depositsEnabled !== false,
          withdrawalsEnabled: request.body?.withdrawalsEnabled !== false,
          updatedBy: request.authUser!.id
        }
      },
      { new: true, upsert: true }
    ).lean(),
    PlatformStateModel.findOneAndUpdate(
      { key: "global" },
      { $set: { houseBankroll } },
      { new: true, upsert: true }
    ).lean()
  ]);
  response.json({ ok: true, settings, state, message: "Settings apply to future rounds and new bets." });
}));

io.use(async (socket, next) => {
  try {
    const user = await resolveAuthUserFromCookie(socket.handshake.headers.cookie);
    if (!user) return next(new Error("Authentication required."));
    socket.data.user = user;
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error("Authentication failed."));
  }
});

io.on("connection", async (socket) => {
  const authUser = socket.data.user as { id: string; name: string };
  socket.emit("round:state", engine.getSnapshot());
  socket.emit("wallet:state", await engine.connect(socket.id, authUser.id));

  const recentChat = await ChatMessageModel.find({}).sort({ createdAt: -1 }).limit(80).lean();
  socket.emit("chat:history", recentChat.reverse().map((item) => ({
    id: String(item._id),
    player: item.player,
    message: item.message,
    createdAt: new Date(item.createdAt as Date).getTime()
  })));

  socket.on("bet:place", async (payload: { slot?: BetSlot; amount?: number }, acknowledge?: (result: unknown) => void) => {
    const slot = payload?.slot === "right" ? "right" : "left";
    acknowledge?.(await engine.placeBet(authUser.id, slot, Number(payload?.amount)));
  });

  socket.on("bet:cashout", async (payload: { slot?: BetSlot }, acknowledge?: (result: unknown) => void) => {
    const slot = payload?.slot === "right" ? "right" : "left";
    acknowledge?.(await engine.cashOut(authUser.id, slot));
  });

  socket.on("chat:send", async (payload: { message?: string }) => {
    const message = cleanText(payload?.message, 160);
    if (!message) return;
    const player = `${authUser.name.slice(0, 1)}***${authUser.name.slice(-1)}`;
    const item = await ChatMessageModel.create({ userId: authUser.id, player, message });
    io.emit("chat:new", {
      id: String(item._id),
      player,
      message,
      createdAt: item.createdAt.getTime()
    });
  });

  socket.on("disconnect", () => engine.disconnect(socket.id));
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  response.status(400).json({ ok: false, message });
});

const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get("/*splat", (_request, response) => response.sendFile(path.join(webDist, "index.html")));

server.listen(port, "0.0.0.0", () => {
  console.log(`SkyRush server running on http://0.0.0.0:${port}`);
});

const shutdown = async () => {
  engine.stop();
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
