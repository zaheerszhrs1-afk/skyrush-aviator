import * as crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { GameEngine } from "./game-engine.js";
import type { BetSlot } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : true;

const app = express();
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "skyrush-game-server", timestamp: new Date().toISOString() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
  transports: ["websocket", "polling"]
});

const engine = new GameEngine(io);
const recentChat: Array<{ id: string; player: string; message: string; createdAt: number }> = [
  { id: "1", player: "M***R", message: "Hi, how are you", createdAt: Date.now() - 40_000 },
  { id: "2", player: "K***i", message: "Good luck everyone ✈️", createdAt: Date.now() - 20_000 }
];

io.on("connection", (socket) => {
  socket.emit("round:state", engine.getSnapshot());
  socket.emit("wallet:state", engine.connect(socket.id));
  socket.emit("chat:history", recentChat);

  socket.on("bet:place", (payload: { slot?: BetSlot; amount?: number }, acknowledge?: (result: unknown) => void) => {
    const slot = payload?.slot === "right" ? "right" : "left";
    const amount = Number(payload?.amount);
    acknowledge?.(engine.placeBet(socket.id, slot, amount));
  });

  socket.on("bet:cashout", (payload: { slot?: BetSlot }, acknowledge?: (result: unknown) => void) => {
    const slot = payload?.slot === "right" ? "right" : "left";
    acknowledge?.(engine.cashOut(socket.id, slot));
  });

  socket.on("chat:send", (payload: { message?: string }) => {
    const message = String(payload?.message ?? "").trim().slice(0, 160);
    if (!message) return;
    const item = {
      id: crypto.randomUUID(),
      player: `${socket.id.slice(0, 1).toLowerCase()}***${socket.id.slice(-1).toLowerCase()}`,
      message,
      createdAt: Date.now()
    };
    recentChat.push(item);
    if (recentChat.length > 80) recentChat.shift();
    io.emit("chat:new", item);
  });

  socket.on("disconnect", () => engine.disconnect(socket.id));
});

const webDist = path.resolve(__dirname, "../../web/dist");
app.use(express.static(webDist));
app.get("/*splat", (_request, response) => response.sendFile(path.join(webDist, "index.html")));

server.listen(port, "0.0.0.0", () => {
  console.log(`SkyRush server running on http://0.0.0.0:${port}`);
});

const shutdown = () => {
  engine.stop();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
