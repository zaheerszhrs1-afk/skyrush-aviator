import path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { OAuth2Client } from "google-auth-library";
import { GameEngine } from "./game-engine.js";
import { registerPlatformFeatures } from "./platform-features.js";
import { reconcile } from "./accounting.js";
import { fromMinor, toMinor } from "./money.js";
import type { BetSlot } from "./types.js";
import { bootstrapAdmin, createAuthSession, destroyAuthSession, hashPassword, isValidPhone, normalizePhone, optionalAuth, publicUser, requireAdmin, requireAuth, resolveAuthUserFromCookie, verifyPassword, type AuthenticatedRequest } from "./auth.js";
import { connectDatabase, disconnectDatabase } from "./database.js";
import { createDepositRequest, createNowPaymentsDepositRequest, createWithdrawalRequest, reviewDeposit, reviewWithdrawal, settleNowPaymentsDeposit } from "./finance.js";
import { createNowPayment, nowPaymentsPublicConfig, verifyNowPaymentsIpn } from "./nowpayments.js";
import { uploadPaymentReceipt } from "./cloudinary.js";
import { normalizePaymentMethods } from "./payment-methods.js";
import { createReferralCode, getAdminReferralDashboard, getReferralDashboard } from "./referral.js";
import {
  adminBonusSummary,
  claimLevelUpBonus,
  claimMonthlyBonus,
  fundBonusWallet,
  getBonusDashboard,
  normalizeReferralCommissionRates,
  normalizeReferralInvitationRules,
  normalizeMonthlyBonusRules,
  normalizeVipLevels
} from "./bonus.js";
import {
  AuthSessionModel,
  ChatMessageModel,
  DepositRequestModel,
  GameBetModel,
  GameRoundModel,
  PlatformAuditModel,
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
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
const googleClient = new OAuth2Client(googleClientId || undefined);

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
app.use(express.json({ limit: "8mb" }));
app.use(optionalAuth);

app.get("/health", asyncRoute(async (_request, response) => {
  response.json({ ok: true, service: "b9t9-game-server", database: "connected", timestamp: new Date().toISOString() });
}));

app.post("/api/auth/register", asyncRoute(async (request, response) => {
  const name = cleanText(request.body?.name, 80);
  const email = cleanText(request.body?.email, 160).toLowerCase();
  const phone = normalizePhone(request.body?.phone);
  const referralCode = cleanText(request.body?.referralCode, 24).toUpperCase();
  const password = String(request.body?.password ?? "");
  if (name.length < 2) {
    response.status(400).json({ ok: false, message: "Name must contain at least 2 characters." });
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    response.status(400).json({ ok: false, message: "Enter a valid email address." });
    return;
  }
  if (!isValidPhone(phone)) {
    response.status(400).json({ ok: false, message: "Enter a valid phone number with country code." });
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
  if (await UserModel.exists({ phone })) {
    response.status(409).json({ ok: false, message: "An account already exists with this phone number." });
    return;
  }
  const referrer = referralCode ? await UserModel.findOne({ referralCode, role: "USER", status: "ACTIVE" }).select("_id").lean() : null;
  if (referralCode && !referrer) {
    response.status(400).json({ ok: false, message: "This referral link is no longer valid." });
    return;
  }

  const user = await UserModel.create({
    name,
    email,
    phone,
    referralCode: await createReferralCode(),
    ...(referrer ? { referredBy: referrer._id } : {}),
    passwordHash: await hashPassword(password),
    authProvider: "PASSWORD",
    role: "USER",
    status: "ACTIVE",
    balanceMinor: 0,
    withdrawalLockedMinor: 0,
    bettingLockedMinor: 0,
    pendingRewardsMinor: 0,
    wagerRequirementMinor: 0,
    wagerTargetMinor: 0,
    wagerCompletedMinor: 0,
    wagerTrackingVersion: 2,
    balance: 0,
    lockedBalance: 0
  });
  await createAuthSession(String(user._id), request, response);
  response.status(201).json({ ok: true, user: publicUser(user) });
}));

app.post("/api/auth/google", asyncRoute(async (request, response) => {
  if (!googleClientId) {
    response.status(503).json({ ok: false, message: "Google sign-in is not configured." });
    return;
  }
  const credential = cleanText(request.body?.credential, 10_000);
  if (!credential) {
    response.status(400).json({ ok: false, message: "Google credential is required." });
    return;
  }

  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
  const payload = ticket.getPayload();
  const email = payload?.email?.trim().toLowerCase() ?? "";
  const googleSub = payload?.sub?.trim() ?? "";
  if (!googleSub || !email || payload?.email_verified !== true) {
    response.status(401).json({ ok: false, message: "Google did not provide a verified user email." });
    return;
  }

  let user = await UserModel.findOne({ $or: [{ googleSub }, { email }] }).select("+googleSub");
  if (user && ["ADMIN", "SUB_ADMIN"].includes(String(user.role))) {
    response.status(403).json({ ok: false, message: "Administrators must use the separate admin login." });
    return;
  }
  if (user && user.googleSub && String(user.googleSub) !== googleSub) {
    response.status(409).json({ ok: false, message: "This email is already linked to another Google identity." });
    return;
  }

  if (!user) {
    const referralCode = cleanText(request.body?.referralCode, 24).toUpperCase();
    const referrer = referralCode ? await UserModel.findOne({ referralCode, role: "USER", status: "ACTIVE" }).select("_id").lean() : null;
    if (referralCode && !referrer) {
      response.status(400).json({ ok: false, message: "This referral link is no longer valid." });
      return;
    }
    user = await UserModel.create({
      name: cleanText(payload?.name || email.split("@")[0], 80),
      email,
      referralCode: await createReferralCode(),
      ...(referrer ? { referredBy: referrer._id } : {}),
      googleSub,
      avatarUrl: cleanText(payload?.picture, 500),
      authProvider: "GOOGLE",
      role: "USER",
      status: "ACTIVE",
      balanceMinor: 0,
      withdrawalLockedMinor: 0,
      bettingLockedMinor: 0,
      pendingRewardsMinor: 0,
      wagerRequirementMinor: 0,
      wagerTargetMinor: 0,
      wagerCompletedMinor: 0,
      wagerTrackingVersion: 2,
      balance: 0,
      lockedBalance: 0,
      lastLoginAt: new Date()
    });
  } else {
    if (user.status !== "ACTIVE") {
      response.status(403).json({ ok: false, message: "This account is suspended." });
      return;
    }
    user.googleSub = googleSub;
    user.avatarUrl = cleanText(payload?.picture, 500);
    user.authProvider = user.authProvider === "PASSWORD" ? "HYBRID" : "GOOGLE";
    user.lastLoginAt = new Date();
    await user.save();
  }

  await createAuthSession(String(user._id), request, response);
  response.json({ ok: true, user: publicUser(user) });
}));

app.post("/api/auth/login", asyncRoute(async (request, response) => {
  const identifier = cleanText(request.body?.identifier ?? request.body?.email, 160);
  const email = identifier.toLowerCase();
  const phone = normalizePhone(identifier);
  const password = String(request.body?.password ?? "");
  const identifiers = identifier.includes("@") ? [{ email }] : phone ? [{ phone }] : [{ email }];
  const user = await UserModel.findOne({ $or: identifiers }).select("+passwordHash");
  if (!user || !(await verifyPassword(password, String(user.passwordHash)))) {
    response.status(401).json({ ok: false, message: "Invalid email/phone or password." });
    return;
  }
  if (["ADMIN", "SUB_ADMIN"].includes(String(user.role))) {
    response.status(403).json({ ok: false, message: "Administrator accounts must use the separate admin login." });
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
  transports: ["websocket"],
  perMessageDeflate: false,
  pingInterval: 10_000,
  pingTimeout: 5_000,
  maxHttpBufferSize: 100_000
});

const engine = new GameEngine(io);
await engine.initialize();
const stopPlatformFeatures = registerPlatformFeatures(app, io, engine);

app.get("/api/wallet", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  response.json({ ok: true, wallet: await engine.getWallet(request.authUser!.id) });
}));

app.get("/api/rounds/:roundId/proof", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const roundId = cleanText(request.params.roundId, 100);
  const round = await GameRoundModel.findOne({ roundId, phase: "CRASHED" })
    .select("+serverSeed roundId commit crashPoint naturalCrashPoint maxCashoutMultiplier liquidityLimited crashedAt createdAt houseEdgePercent")
    .lean();

  if (!round) {
    response.status(404).json({ ok: false, message: "Completed round was not found." });
    return;
  }

  const serverSeed = String(round.serverSeed ?? "");
  if (!serverSeed) {
    response.status(409).json({ ok: false, message: "The proof for this round is unavailable." });
    return;
  }

  const calculatedCommit = crypto.createHash("sha256").update(serverSeed).digest("hex");
  const combinedHash = crypto.createHmac("sha256", serverSeed).update(roundId).digest("hex");
  const resultHex = combinedHash.slice(0, 13);
  const resultInteger = Number.parseInt(resultHex, 16);
  const random = resultInteger / (16 ** 13);
  const edge = Math.min(0.2, Math.max(0, Number(round.houseEdgePercent ?? 1) / 100));
  const rawResult = (1 - edge) / Math.max(0.000001, 1 - random);
  const configuredMax = Math.min(1000, Math.max(1, Number(round.maxCashoutMultiplier ?? 1000)));
  const calculatedResult = Math.min(configuredMax, Math.max(1, Math.floor(rawResult * 100) / 100));
  const result = Number(round.crashPoint);
  const naturalResult = Number(round.naturalCrashPoint ?? calculatedResult);
  const liquidityLimited = round.liquidityLimited === true;
  const same = (left: number, right: number) => Math.abs(left - right) < 0.001;
  const commitVerified = calculatedCommit === String(round.commit);
  const resultVerified = same(calculatedResult, naturalResult)
    && (same(result, naturalResult) || (liquidityLimited && same(result, 1)));
  const hasCompleteRuleMetadata = Number.isFinite(Number(round.naturalCrashPoint))
    && Number.isFinite(Number(round.maxCashoutMultiplier));
  const verificationStatus = !commitVerified
    ? "FAILED"
    : (resultVerified && (hasCompleteRuleMetadata || same(result, calculatedResult)))
      ? "VERIFIED"
      : "PARTIAL";
  const verified = verificationStatus === "VERIFIED";

  response.json({
    ok: true,
    proof: {
      roundId,
      result,
      crashedAt: new Date(round.crashedAt ?? round.createdAt ?? Date.now()).getTime(),
      serverSeed,
      clientSeed: roundId,
      commit: String(round.commit),
      calculatedCommit,
      combinedHash,
      resultHex,
      resultDecimal: String(resultInteger),
      calculatedResult,
      naturalResult,
      liquidityLimited,
      verified,
      verificationStatus
    }
  });
}));

app.get("/api/payment-methods", requireAuth, asyncRoute(async (_request, response) => {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).select("paymentMethods").lean();
  response.json({ ok: true, methods: normalizePaymentMethods((settings as any)?.paymentMethods) });
}));

app.get("/api/finance/settings", requireAuth, asyncRoute(async (_request, response) => {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  response.json({
    ok: true,
    settings: {
      minDeposit: Number((settings as any)?.minDeposit ?? 100),
      minWithdrawal: Number((settings as any)?.minWithdrawal ?? 500),
      wageringRequirementPercent: Number((settings as any)?.wageringRequirementPercent ?? 30),
      depositsEnabled: (settings as any)?.depositsEnabled !== false,
      withdrawalsEnabled: (settings as any)?.withdrawalsEnabled !== false
    }
  });
}));

app.get("/api/wallet/transactions", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const page = Math.max(1, Number(request.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 30)));
  const transactions = await WalletTransactionModel.find({ userId: request.authUser!.id })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  response.json({
    ok: true,
    transactions: transactions.map((item: any) => ({
      ...item,
      amount: Number.isSafeInteger(Number(item.amountMinor)) ? fromMinor(item.amountMinor) : Number(item.amount ?? 0),
      balanceAfter: Number.isSafeInteger(Number(item.balanceAfterMinor))
        ? fromMinor(item.balanceAfterMinor)
        : Number(item.balanceAfter ?? 0),
      lockedBalanceAfter: Number.isSafeInteger(Number(item.withdrawalLockedAfterMinor))
        ? fromMinor(item.withdrawalLockedAfterMinor)
        : Number(item.lockedBalanceAfter ?? 0),
      bettingLockedAfter: fromMinor(item.bettingLockedAfterMinor ?? 0),
      pendingRewardsAfter: fromMinor(item.pendingRewardsAfterMinor ?? 0)
    }))
  });
}));

app.post("/api/deposits", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const deposit = await createDepositRequest({
    userId: request.authUser!.id,
    amount: numberInput(request.body?.amount),
    method: cleanText(request.body?.method, 80),
    reference: cleanText(request.body?.reference, 160),
    receiptUrl: cleanText(request.body?.receiptUrl, 1000),
    note: cleanText(request.body?.note, 500)
  });
  response.status(201).json({ ok: true, deposit });
}));

app.post("/api/uploads/payment-receipt", requireAuth, asyncRoute(async (request, response) => {
  const fileDataUrl = cleanText(request.body?.fileDataUrl, 7_000_000);
  const receipt = await uploadPaymentReceipt(fileDataUrl);
  response.status(201).json({ ok: true, receiptUrl: receipt.secureUrl, publicId: receipt.publicId });
}));

app.get("/api/payments/nowpayments/config", requireAuth, asyncRoute(async (_request, response) => {
  response.json({ ok: true, ...nowPaymentsPublicConfig() });
}));

app.post("/api/payments/nowpayments", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  if (!nowPaymentsPublicConfig().enabled) throw new Error("NOWPayments is not configured.");
  const deposit = await createNowPaymentsDepositRequest({
    userId: request.authUser!.id,
    amount: numberInput(request.body?.amount)
  });

  try {
    const payment = await createNowPayment({
      orderId: String(deposit._id),
      amountPkr: Number(deposit.amount),
      payCurrency: cleanText(request.body?.payCurrency, 40).toLowerCase(),
      description: `B9T9 wallet deposit ${deposit._id}`
    });
    const expiresAt = payment.expiresAt && Number.isFinite(Date.parse(payment.expiresAt))
      ? new Date(payment.expiresAt)
      : undefined;
    await DepositRequestModel.findByIdAndUpdate(deposit._id, { $set: {
      reference: `NOWPAYMENTS:${payment.paymentId}`,
      gatewayPaymentId: payment.paymentId,
      gatewayStatus: payment.status,
      gatewayPriceAmount: payment.priceAmount,
      gatewayPriceCurrency: payment.priceCurrency,
      gatewayPayAmount: payment.payAmount,
      gatewayPayCurrency: payment.payCurrency,
      gatewayPayAddress: payment.payAddress,
      gatewayPayinExtraId: payment.payinExtraId,
      gatewayNetwork: payment.network,
      gatewayExpiresAt: expiresAt,
      gatewayPayload: payment.raw
    } });
    response.status(201).json({
      ok: true,
      payment: {
        depositId: String(deposit._id),
        paymentId: payment.paymentId,
        status: payment.status,
        payAmount: payment.payAmount,
        payCurrency: payment.payCurrency,
        payAddress: payment.payAddress,
        payinExtraId: payment.payinExtraId,
        network: payment.network,
        expiresAt: payment.expiresAt
      }
    });
  } catch (error) {
    await DepositRequestModel.updateOne(
      { _id: deposit._id, status: "PENDING" },
      { $set: { status: "REJECTED", gatewayStatus: "creation_failed", reviewNote: error instanceof Error ? error.message.slice(0, 500) : "NOWPayments request failed." } }
    );
    throw error;
  }
}));

app.post("/api/payments/nowpayments/ipn", asyncRoute(async (request, response) => {
  const signature = cleanText(request.get("x-nowpayments-sig"), 256);
  if (!verifyNowPaymentsIpn(request.body, signature)) {
    response.status(401).json({ ok: false, message: "Invalid NOWPayments signature." });
    return;
  }

  const paymentId = cleanText(request.body?.payment_id, 160);
  const orderId = cleanText(request.body?.order_id, 100);
  const gatewayStatus = cleanText(request.body?.payment_status, 40).toLowerCase();
  if (!paymentId || !mongoose.Types.ObjectId.isValid(orderId) || !gatewayStatus) {
    response.status(400).json({ ok: false, message: "Incomplete NOWPayments callback." });
    return;
  }

  const deposit = await DepositRequestModel.findOne({
    _id: orderId,
    gatewayProvider: "NOWPAYMENTS",
    gatewayPaymentId: paymentId
  }).select("userId status gatewayPriceAmount gatewayPriceCurrency");
  if (!deposit) {
    response.status(404).json({ ok: false, message: "NOWPayments deposit not found." });
    return;
  }

  const callbackPriceAmount = Number(request.body?.price_amount);
  const callbackPriceCurrency = cleanText(request.body?.price_currency, 20).toLowerCase();
  if (gatewayStatus === "finished" && (
    !Number.isFinite(callbackPriceAmount)
    || Math.abs(callbackPriceAmount - Number((deposit as any).gatewayPriceAmount)) > 0.01
    || callbackPriceCurrency !== String((deposit as any).gatewayPriceCurrency ?? "").toLowerCase()
  )) {
    response.status(409).json({ ok: false, message: "NOWPayments amount does not match the deposit." });
    return;
  }

  await DepositRequestModel.updateOne(
    { _id: deposit._id },
    { $set: { gatewayStatus, gatewayPayload: request.body } }
  );

  if (gatewayStatus === "finished") {
    const result = await settleNowPaymentsDeposit(String(deposit._id));
    await engine.emitWalletForUser(result.userId);
  } else if (["failed", "expired"].includes(gatewayStatus)) {
    await DepositRequestModel.updateOne(
      { _id: deposit._id, status: "PENDING" },
      { $set: { status: "REJECTED", reviewedAt: new Date(), reviewNote: `NOWPayments status: ${gatewayStatus}` } }
    );
  }

  response.json({ ok: true });
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

app.get("/api/bonuses", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  response.json(await getBonusDashboard(request.authUser!.id));
}));

app.get("/api/referrals", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  response.json(await getReferralDashboard(request.authUser!.id));
}));

app.post("/api/bonuses/level-up/claim", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const result = await claimLevelUpBonus(request.authUser!.id);
  await engine.emitWalletForUser(request.authUser!.id);
  response.json({ ok: true, ...result, dashboard: await getBonusDashboard(request.authUser!.id) });
}));

app.post("/api/bonuses/monthly/claim", requireAuth, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const result = await claimMonthlyBonus(request.authUser!.id);
  await engine.emitWalletForUser(request.authUser!.id);
  response.json({ ok: true, ...result, dashboard: await getBonusDashboard(request.authUser!.id) });
}));

app.get("/api/admin/header-stats", requireAdmin, asyncRoute(async (_request, response) => {
  const state = await PlatformStateModel.findOne({ key: "global" }).lean();
  const completedDeposits = fromMinor((state as any)?.totalApprovedDepositsMinor ?? 0);
  const completedWithdrawals = fromMinor((state as any)?.totalCompletedWithdrawalsMinor ?? 0);
  response.json({
    ok: true,
    stats: {
      adminRemaining: completedDeposits - completedWithdrawals,
      completedDeposits,
      completedWithdrawals
    }
  });
}));

app.get("/api/admin/summary", requireAdmin, asyncRoute(async (_request, response) => {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    users,
    depositsPending,
    withdrawalsPending,
    settings,
    state,
    activeBets,
    recentRounds,
    userTotalsResult,
    dailyRevenueResult,
    monthlyRevenueResult
  ] = await Promise.all([
    UserModel.countDocuments({ role: "USER" }),
    DepositRequestModel.countDocuments({ status: "PENDING" }),
    WithdrawalRequestModel.countDocuments({ status: { $in: ["PENDING", "PROCESSING"] } }),
    PlatformSettingsModel.findOne({ key: "global" }).lean(),
    PlatformStateModel.findOne({ key: "global" }).lean(),
    GameBetModel.countDocuments({ status: "ACTIVE" }),
    GameRoundModel.find({ phase: "CRASHED" })
      .sort({ crashedAt: -1 })
      .limit(10)
      .select("roundId crashPoint totalStake totalPayout totalStakeMinor totalPayoutMinor totalCommissionMinor totalLossesMinor crashedAt")
      .lean(),
    UserModel.aggregate([
      { $match: { role: "USER" } },
      {
        $group: {
          _id: null,
          availableMinor: { $sum: { $ifNull: ["$balanceMinor", 0] } },
          withdrawalLockedMinor: { $sum: { $ifNull: ["$withdrawalLockedMinor", 0] } },
          bettingLockedMinor: { $sum: { $ifNull: ["$bettingLockedMinor", 0] } },
          pendingRewardsMinor: { $sum: { $ifNull: ["$pendingRewardsMinor", 0] } },
          wagerRequirementMinor: { $sum: { $ifNull: ["$wagerRequirementMinor", 0] } }
        }
      }
    ]),
    PlatformAuditModel.aggregate([
      { $match: { type: "COMMISSION_CREDIT" as const, createdAt: { $gte: dayStart } } },
      { $group: { _id: null, amountMinor: { $sum: "$commissionWalletDeltaMinor" } } }
    ]),
    PlatformAuditModel.aggregate([
      { $match: { type: "COMMISSION_CREDIT" as const, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, amountMinor: { $sum: "$commissionWalletDeltaMinor" } } }
    ])
  ]);

  const stateAny = state as any;
  const settingsAny = settings as any;
  const userTotals = userTotalsResult[0] ?? {
    availableMinor: 0,
    withdrawalLockedMinor: 0,
    bettingLockedMinor: 0,
    pendingRewardsMinor: 0,
    wagerRequirementMinor: 0
  };
  const accounting = reconcile({
    totalApprovedDepositsMinor: Number(stateAny?.totalApprovedDepositsMinor ?? 0),
    availableUserBalanceMinor: Number(userTotals.availableMinor ?? 0),
    withdrawalLockedMinor: Number(userTotals.withdrawalLockedMinor ?? 0),
    activeBetEscrowMinor: Number(stateAny?.activeBetEscrowMinor ?? 0),
    pendingRewardsMinor: Number(userTotals.pendingRewardsMinor ?? 0),
    lossPoolMinor: Number(stateAny?.lossPoolMinor ?? 0),
    commissionWalletMinor: Number(stateAny?.commissionWalletMinor ?? 0),
    bonusWalletMinor: Number(stateAny?.bonusWalletMinor ?? 0),
    totalBonusFundingMinor: Number(stateAny?.totalBonusFundingMinor ?? 0),
    totalCompletedWithdrawalsMinor: Number(stateAny?.totalCompletedWithdrawalsMinor ?? 0)
  });
  const betEscrowMirrorDifferenceMinor =
    Number(stateAny?.activeBetEscrowMinor ?? 0) - Number(userTotals.bettingLockedMinor ?? 0);
  const protectedPoolMinor = Math.floor(
    Number(stateAny?.lossPoolMinor ?? 0) * (Number(settingsAny?.reservePercent ?? 0) / 100)
  );
  const availableRewardLiquidityMinor = Math.max(
    0,
    Number(stateAny?.lossPoolMinor ?? 0) -
      protectedPoolMinor -
      Number(stateAny?.reservedRewardLiquidityMinor ?? 0)
  );

  response.json({
    ok: true,
    summary: {
      users,
      depositsPending,
      withdrawalsPending,
      activeBets,
      totalUserBalances: fromMinor(userTotals.availableMinor),
      withdrawalLockedFunds: fromMinor(userTotals.withdrawalLockedMinor),
      activeBetEscrow: fromMinor(stateAny?.activeBetEscrowMinor),
      reservedRewardLiquidity: fromMinor(stateAny?.reservedRewardLiquidityMinor),
      availableRewardLiquidity: fromMinor(availableRewardLiquidityMinor),
      lossPool: fromMinor(stateAny?.lossPoolMinor),
      pendingRewards: fromMinor(userTotals.pendingRewardsMinor),
      totalWagerRequirement: fromMinor(userTotals.wagerRequirementMinor),
      commissionWallet: fromMinor(stateAny?.commissionWalletMinor),
      bonusWallet: fromMinor(stateAny?.bonusWalletMinor),
      totalBonusFunding: fromMinor(stateAny?.totalBonusFundingMinor),
      totalBonusesPaid: fromMinor(stateAny?.totalBonusesPaidMinor),
      totalCommissionEarned: fromMinor(stateAny?.totalCommissionEarnedMinor),
      totalRewardsPaid: fromMinor(stateAny?.totalRewardsPaidMinor),
      totalBetVolume: fromMinor(stateAny?.totalBetVolumeMinor),
      totalLosses: fromMinor(stateAny?.totalLossesMinor),
      totalApprovedDeposits: fromMinor(stateAny?.totalApprovedDepositsMinor),
      totalCompletedWithdrawals: fromMinor(stateAny?.totalCompletedWithdrawalsMinor),
      lockedFunds: fromMinor(
        Number(userTotals.withdrawalLockedMinor ?? 0) + Number(stateAny?.activeBetEscrowMinor ?? 0)
      ),
      dailyRevenue: fromMinor(dailyRevenueResult[0]?.amountMinor ?? 0),
      monthlyRevenue: fromMinor(monthlyRevenueResult[0]?.amountMinor ?? 0),
      reconciliation: {
        totalInflows: fromMinor(Number(stateAny?.totalApprovedDepositsMinor ?? 0) + Number(stateAny?.totalBonusFundingMinor ?? 0)),
        accountedFunds: fromMinor(accounting.accountedMinor),
        difference: fromMinor(accounting.differenceMinor),
        betEscrowMirrorDifference: fromMinor(betEscrowMirrorDifferenceMinor),
        balanced: accounting.balanced && betEscrowMirrorDifferenceMinor === 0
      },
      recentRounds: recentRounds.map((round: any) => ({
        ...round,
        totalStake: Number.isSafeInteger(Number(round.totalStakeMinor))
          ? fromMinor(round.totalStakeMinor)
          : Number(round.totalStake ?? 0),
        totalPayout: Number.isSafeInteger(Number(round.totalPayoutMinor))
          ? fromMinor(round.totalPayoutMinor)
          : Number(round.totalPayout ?? 0),
        totalCommission: fromMinor(round.totalCommissionMinor ?? 0),
        totalLosses: fromMinor(round.totalLossesMinor ?? 0)
      }))
    }
  });
}));

app.get("/api/admin/bets/daily", requireAdmin, asyncRoute(async (request, response) => {
  const requestedDays = Number(request.query.days ?? 30);
  const days = Number.isFinite(requestedDays)
    ? Math.min(365, Math.max(1, Math.floor(requestedDays)))
    : 30;
  const karachiOffsetMs = 5 * 60 * 60 * 1000;
  const karachiNow = new Date(Date.now() + karachiOffsetMs);
  const start = new Date(
    Date.UTC(
      karachiNow.getUTCFullYear(),
      karachiNow.getUTCMonth(),
      karachiNow.getUTCDate() - (days - 1)
    ) - karachiOffsetMs
  );

  const daily = await GameBetModel.aggregate([
    {
      $match: {
        createdAt: { $gte: start },
        status: { $ne: "REFUNDED" }
      }
    },
    {
      $project: {
        day: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Karachi" }
        },
        amountMinor: { $ifNull: ["$amountMinor", 0] },
        payoutMinor: { $ifNull: ["$payoutMinor", 0] },
        commissionMinor: { $ifNull: ["$commissionMinor", 0] },
        isWon: { $cond: [{ $eq: ["$status", "CASHED_OUT"] }, 1, 0] },
        isLost: { $cond: [{ $eq: ["$status", "LOST"] }, 1, 0] },
        isOpen: { $cond: [{ $in: ["$status", ["QUEUED", "ACTIVE"]] }, 1, 0] },
        playerLossMinor: {
          $cond: [{ $eq: ["$status", "LOST"] }, { $ifNull: ["$amountMinor", 0] }, 0]
        },
        playerProfitMinor: {
          $cond: [
            { $eq: ["$status", "CASHED_OUT"] },
            {
              $max: [
                0,
                {
                  $subtract: [
                    { $ifNull: ["$payoutMinor", 0] },
                    { $ifNull: ["$amountMinor", 0] }
                  ]
                }
              ]
            },
            0
          ]
        }
      }
    },
    {
      $group: {
        _id: "$day",
        bets: { $sum: 1 },
        wonBets: { $sum: "$isWon" },
        lostBets: { $sum: "$isLost" },
        openBets: { $sum: "$isOpen" },
        betVolumeMinor: { $sum: "$amountMinor" },
        payoutMinor: { $sum: "$payoutMinor" },
        playerLossMinor: { $sum: "$playerLossMinor" },
        playerProfitMinor: { $sum: "$playerProfitMinor" },
        commissionMinor: { $sum: "$commissionMinor" }
      }
    },
    { $sort: { _id: -1 } }
  ]);

  type DailyBetRow = {
    date: string;
    bets: number;
    wonBets: number;
    lostBets: number;
    openBets: number;
    betVolume: number;
    payout: number;
    playerLoss: number;
    playerProfit: number;
    commission: number;
    netResult: number;
  };

  const rows: DailyBetRow[] = daily.map((item: any): DailyBetRow => {
    const playerLossMinor = Number(item.playerLossMinor ?? 0);
    const playerProfitMinor = Number(item.playerProfitMinor ?? 0);
    return {
      date: String(item._id),
      bets: Number(item.bets ?? 0),
      wonBets: Number(item.wonBets ?? 0),
      lostBets: Number(item.lostBets ?? 0),
      openBets: Number(item.openBets ?? 0),
      betVolume: fromMinor(item.betVolumeMinor ?? 0),
      payout: fromMinor(item.payoutMinor ?? 0),
      playerLoss: fromMinor(playerLossMinor),
      playerProfit: fromMinor(playerProfitMinor),
      commission: fromMinor(item.commissionMinor ?? 0),
      netResult: fromMinor(playerLossMinor - playerProfitMinor)
    };
  });

  const rowsByDate = new Map<string, DailyBetRow>(rows.map((row) => [row.date, row]));
  const completeRows: DailyBetRow[] = Array.from({ length: days }, (_, index): DailyBetRow => {
    const date = new Date(Date.UTC(
      karachiNow.getUTCFullYear(),
      karachiNow.getUTCMonth(),
      karachiNow.getUTCDate() - index
    ));
    const key = date.toISOString().slice(0, 10);
    return rowsByDate.get(key) ?? {
      date: key,
      bets: 0,
      wonBets: 0,
      lostBets: 0,
      openBets: 0,
      betVolume: 0,
      payout: 0,
      playerLoss: 0,
      playerProfit: 0,
      commission: 0,
      netResult: 0
    };
  });

  const totals = completeRows.reduce(
    (result, row) => ({
      bets: result.bets + row.bets,
      wonBets: result.wonBets + row.wonBets,
      lostBets: result.lostBets + row.lostBets,
      openBets: result.openBets + row.openBets,
      betVolume: result.betVolume + row.betVolume,
      payout: result.payout + row.payout,
      playerLoss: result.playerLoss + row.playerLoss,
      playerProfit: result.playerProfit + row.playerProfit,
      commission: result.commission + row.commission,
      netResult: result.netResult + row.netResult
    }),
    { bets: 0, wonBets: 0, lostBets: 0, openBets: 0, betVolume: 0, payout: 0, playerLoss: 0, playerProfit: 0, commission: 0, netResult: 0 }
  );

  response.json({ ok: true, days, timezone: "Asia/Karachi", totals, rows: completeRows });
}));

app.get("/api/admin/users", requireAdmin, asyncRoute(async (request, response) => {
  const search = cleanText(request.query.search, 100);
  const filter = search
    ? { $or: [{ email: { $regex: search, $options: "i" } }, { name: { $regex: search, $options: "i" } }] }
    : {};
  const karachiOffsetMs = 5 * 60 * 60 * 1000;
  const karachiToday = new Date(Date.now() + karachiOffsetMs);
  karachiToday.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(karachiToday.getTime() - karachiOffsetMs);
  const [users, dailyActiveUsers] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
    UserModel.countDocuments({
      role: "USER",
      $or: [
        { lastActiveAt: { $gte: todayStart } },
        { lastActiveAt: { $exists: false }, lastLoginAt: { $gte: todayStart } }
      ]
    })
  ]);
  response.json({ ok: true, users: users.map(publicUser), dailyActiveUsers, activeTimezone: "Asia/Karachi" });
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

app.get("/api/admin/transactions", requireAdmin, asyncRoute(async (request, response) => {
  const limit = Math.min(500, Math.max(1, Number(request.query.limit ?? 300)));
  const items = await WalletTransactionModel.find({})
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  response.json({
    ok: true,
    transactions: items.map((item: any) => ({
      ...item,
      amount: Number.isSafeInteger(Number(item.amountMinor)) ? fromMinor(item.amountMinor) : Number(item.amount ?? 0),
      balanceAfter: Number.isSafeInteger(Number(item.balanceAfterMinor))
        ? fromMinor(item.balanceAfterMinor)
        : Number(item.balanceAfter ?? 0),
      lockedBalanceAfter: Number.isSafeInteger(Number(item.withdrawalLockedAfterMinor))
        ? fromMinor(item.withdrawalLockedAfterMinor)
        : Number(item.lockedBalanceAfter ?? 0),
      bettingLockedAfter: fromMinor(item.bettingLockedAfterMinor ?? 0),
      pendingRewardsAfter: fromMinor(item.pendingRewardsAfterMinor ?? 0)
    }))
  });
}));

app.get("/api/admin/audit", requireAdmin, asyncRoute(async (request, response) => {
  const limit = Math.min(500, Math.max(1, Number(request.query.limit ?? 200)));
  const items = await PlatformAuditModel.find({})
    .populate("userId", "name email")
    .populate("adminId", "name email")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  response.json({
    ok: true,
    audit: items.map((item: any) => ({
      ...item,
      activeBetEscrowDelta: fromMinor(item.activeBetEscrowDeltaMinor),
      reservedLiquidityDelta: fromMinor(item.reservedLiquidityDeltaMinor),
      lossPoolDelta: fromMinor(item.lossPoolDeltaMinor),
      commissionWalletDelta: fromMinor(item.commissionWalletDeltaMinor),
      bonusWalletDelta: fromMinor(item.bonusWalletDeltaMinor),
      activeBetEscrowAfter: fromMinor(item.activeBetEscrowAfterMinor),
      reservedLiquidityAfter: fromMinor(item.reservedLiquidityAfterMinor),
      lossPoolAfter: fromMinor(item.lossPoolAfterMinor),
      commissionWalletAfter: fromMinor(item.commissionWalletAfterMinor),
      bonusWalletAfter: fromMinor(item.bonusWalletAfterMinor)
    }))
  });
}));

app.get("/api/admin/referrals", requireAdmin, asyncRoute(async (_request, response) => {
  response.json({ ok: true, ...(await getAdminReferralDashboard()) });
}));

app.patch("/api/admin/referrals/settings", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const referralInvitationRules = normalizeReferralInvitationRules(request.body?.referralInvitationRules);
  const referralCommissionRates = normalizeReferralCommissionRates(request.body?.referralCommissionRates);
  const referralMinDeposit = Math.max(1, Number.isFinite(numberInput(request.body?.referralMinDeposit)) ? numberInput(request.body?.referralMinDeposit) : 300);
  const referralDepositPercent = Math.min(100, Math.max(0, Number.isFinite(numberInput(request.body?.referralDepositPercent)) ? numberInput(request.body?.referralDepositPercent) : 5));
  await PlatformSettingsModel.findOneAndUpdate(
    { key: "global" },
    { $set: {
      referralEnabled: request.body?.referralEnabled !== false,
      referralMinDeposit,
      referralDepositPercent,
      referralInvitationRules,
      referralCommissionRates,
      updatedBy: request.authUser!.id
    } },
    { new: true, upsert: true }
  );
  response.json({ ok: true, ...(await getAdminReferralDashboard()) });
}));

app.get("/api/admin/bonuses", requireAdmin, asyncRoute(async (_request, response) => {
  response.json({ ok: true, ...(await adminBonusSummary()) });
}));

app.patch("/api/admin/bonuses/settings", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const vipLevels = normalizeVipLevels(request.body?.vipLevels);
  const monthlyBonusRules = normalizeMonthlyBonusRules(request.body?.monthlyBonusRules);
  const monthlyClaimStartDay = Math.min(28, Math.max(1, Math.floor(numberInput(request.body?.monthlyClaimStartDay))));
  const monthlyClaimWindowHours = Math.min(744, Math.max(1, Math.floor(numberInput(request.body?.monthlyClaimWindowHours))));
  if (![monthlyClaimStartDay, monthlyClaimWindowHours].every(Number.isFinite)) {
    response.status(400).json({ ok: false, message: "Bonus schedule values must be valid numbers." });
    return;
  }
  await PlatformSettingsModel.findOneAndUpdate(
    { key: "global" },
    { $set: {
      vipEnabled: request.body?.vipEnabled !== false,
      vipLevelBonusEnabled: request.body?.vipLevelBonusEnabled !== false,
      vipMonthlyBonusEnabled: request.body?.vipMonthlyBonusEnabled !== false,
      vipWithdrawalLimitsEnabled: request.body?.vipWithdrawalLimitsEnabled !== false,
      vipTimezone: cleanText(request.body?.vipTimezone || "Asia/Karachi", 80),
      monthlyClaimStartDay,
      monthlyClaimWindowHours,
      monthlyClaimForceOpen: request.body?.monthlyClaimForceOpen === true,
      vipLevels,
      monthlyBonusRules,
      updatedBy: request.authUser!.id
    } },
    { new: true, upsert: true }
  );
  const state = await PlatformStateModel.findOne({ key: "global" }).lean();
  await PlatformAuditModel.create({
    eventKey: `bonus-settings:${crypto.randomUUID()}`,
    type: "SETTINGS_UPDATED" as const,
    adminId: new mongoose.Types.ObjectId(request.authUser!.id),
    activeBetEscrowAfterMinor: Number((state as any)?.activeBetEscrowMinor ?? 0),
    reservedLiquidityAfterMinor: Number((state as any)?.reservedRewardLiquidityMinor ?? 0),
    lossPoolAfterMinor: Number((state as any)?.lossPoolMinor ?? 0),
    commissionWalletAfterMinor: Number((state as any)?.commissionWalletMinor ?? 0),
    bonusWalletAfterMinor: Number((state as any)?.bonusWalletMinor ?? 0),
    description: "Updated VIP levels, bonuses, claim schedule and withdrawal limits",
    metadata: { vipLevels, monthlyBonusRules, monthlyClaimStartDay, monthlyClaimWindowHours }
  });
  response.json({ ok: true, ...(await adminBonusSummary()) });
}));

app.post("/api/admin/bonuses/fund", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const result = await fundBonusWallet(request.authUser!.id, numberInput(request.body?.amount));
  response.json({ ok: true, ...result });
}));

app.get("/api/admin/payment-methods", requireAdmin, asyncRoute(async (_request, response) => {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).select("paymentMethods").lean();
  response.json({ ok: true, methods: normalizePaymentMethods((settings as any)?.paymentMethods) });
}));

app.patch("/api/admin/payment-methods", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const methods = normalizePaymentMethods(request.body?.methods);
  await PlatformSettingsModel.findOneAndUpdate(
    { key: "global" },
    { $set: { paymentMethods: methods, updatedBy: request.authUser!.id } },
    { new: true, upsert: true }
  );
  response.json({ ok: true, methods });
}));

app.post("/api/admin/payment-methods/upload", requireAdmin, asyncRoute(async (request, response) => {
  const fileDataUrl = cleanText(request.body?.fileDataUrl, 7_000_000);
  const image = await uploadPaymentReceipt(fileDataUrl);
  response.status(201).json({ ok: true, imageUrl: image.secureUrl, publicId: image.publicId });
}));

app.get("/api/admin/settings", requireAdmin, asyncRoute(async (_request, response) => {
  const [settings, state] = await Promise.all([
    PlatformSettingsModel.findOne({ key: "global" }).lean(),
    PlatformStateModel.findOne({ key: "global" }).lean()
  ]);
  response.json({
    ok: true,
    settings,
    state: {
      lossPool: fromMinor((state as any)?.lossPoolMinor),
      activeBetEscrow: fromMinor((state as any)?.activeBetEscrowMinor),
      reservedRewardLiquidity: fromMinor((state as any)?.reservedRewardLiquidityMinor),
      commissionWallet: fromMinor((state as any)?.commissionWalletMinor),
      bonusWallet: fromMinor((state as any)?.bonusWalletMinor)
    }
  });
}));

app.patch("/api/admin/settings", requireAdmin, asyncRoute(async (request: AuthenticatedRequest, response) => {
  const houseEdgePercent = Math.min(20, Math.max(0, numberInput(request.body?.houseEdgePercent)));
  const commissionPercent = Math.min(50, Math.max(0, numberInput(request.body?.commissionPercent)));
  const reservePercent = Math.min(95, Math.max(0, numberInput(request.body?.reservePercent)));
  const minBet = Math.max(1, numberInput(request.body?.minBet));
  const minDeposit = Math.max(1, numberInput(request.body?.minDeposit));
  const minWithdrawal = Math.max(1, numberInput(request.body?.minWithdrawal));
  const wageringRequirementPercent = Math.min(100, Math.max(0, numberInput(request.body?.wageringRequirementPercent)));
  const maxBet = Math.max(minBet, numberInput(request.body?.maxBet));
  const maxCashoutMultiplier = Math.min(1000, Math.max(1.01, numberInput(request.body?.maxCashoutMultiplier)));
  if (![
    houseEdgePercent,
    commissionPercent,
    reservePercent,
    minBet,
    minDeposit,
    minWithdrawal,
    wageringRequirementPercent,
    maxBet,
    maxCashoutMultiplier
  ].every(Number.isFinite)) {
    response.status(400).json({ ok: false, message: "All numeric settings must be valid numbers." });
    return;
  }

  const settings = await PlatformSettingsModel.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        houseEdgePercent,
        commissionPercent,
        reservePercent,
        minBet,
        minDeposit,
        minWithdrawal,
        wageringRequirementPercent,
        maxBet,
        maxCashoutMultiplier,
        depositsEnabled: request.body?.depositsEnabled !== false,
        withdrawalsEnabled: request.body?.withdrawalsEnabled !== false,
        updatedBy: request.authUser!.id
      }
    },
    { new: true, upsert: true }
  ).lean();

  const state = await PlatformStateModel.findOne({ key: "global" }).lean();
  await PlatformAuditModel.create({
    eventKey: `settings:${crypto.randomUUID()}`,
    type: "SETTINGS_UPDATED" as const,
    adminId: new mongoose.Types.ObjectId(request.authUser!.id),
    activeBetEscrowAfterMinor: Number((state as any)?.activeBetEscrowMinor ?? 0),
    reservedLiquidityAfterMinor: Number((state as any)?.reservedRewardLiquidityMinor ?? 0),
    lossPoolAfterMinor: Number((state as any)?.lossPoolMinor ?? 0),
    commissionWalletAfterMinor: Number((state as any)?.commissionWalletMinor ?? 0),
    bonusWalletAfterMinor: Number((state as any)?.bonusWalletMinor ?? 0),
    description: "Updated global game, finance, wagering, liquidity and commission settings",
    metadata: {
      houseEdgePercent,
      commissionPercent,
      reservePercent,
      minBet,
      minDeposit,
      minWithdrawal,
      wageringRequirementPercent,
      maxBet,
      maxCashoutMultiplier,
      depositsEnabled: request.body?.depositsEnabled !== false,
      withdrawalsEnabled: request.body?.withdrawalsEnabled !== false
    }
  });

  response.json({ ok: true, settings, message: "Settings saved. Deposit wagering percentage applies when each deposit is approved." });
}));

io.use(async (socket, next) => {
  try {
    const user = await resolveAuthUserFromCookie(socket.handshake.headers.cookie);
    socket.data.user = user;
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error("Authentication failed."));
  }
});

io.on("connection", async (socket) => {
  const authUser = socket.data.user as { id: string; name: string } | undefined;
  if (authUser) {
    void UserModel.updateOne({ _id: authUser.id, role: "USER" }, { $set: { lastActiveAt: new Date() } })
      .catch((error) => console.error("Unable to update user activity.", error));
    socket.emit("wallet:state", await engine.connect(socket.id, authUser.id));
  } else {
    engine.connectPublic(socket.id);
  }
  socket.emit("round:state", engine.getSnapshot());

  const recentChat = await ChatMessageModel.find({}).sort({ createdAt: -1 }).limit(80).lean();
  socket.emit("chat:history", recentChat.reverse().map((item) => ({
    id: String(item._id),
    player: item.player,
    message: item.message,
    createdAt: new Date(item.createdAt as Date).getTime()
  })));

  if (!authUser) {
    socket.on("disconnect", () => engine.disconnect(socket.id));
    return;
  }

  socket.on("bet:place", async (payload: { slot?: BetSlot; amount?: number }, acknowledge?: (result: unknown) => void) => {
    const slot = payload?.slot === "right" ? "right" : "left";
    acknowledge?.(await engine.placeBet(authUser.id, slot, Number(payload?.amount), authUser.name));
  });

  socket.on("bet:cancel", async (payload: { slot?: BetSlot }, acknowledge?: (result: unknown) => void) => {
    const slot = payload?.slot === "right" ? "right" : "left";
    acknowledge?.(await engine.cancelQueuedBet(authUser.id, slot));
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
  console.log(`B9T9 server running on http://0.0.0.0:${port}`);
});

const shutdown = async () => {
  stopPlatformFeatures();
  engine.stop();
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
