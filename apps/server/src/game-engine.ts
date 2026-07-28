import * as crypto from "node:crypto";
import type { Server } from "socket.io";
import type { BetSlot, PublicBet, RoundPhase, RoundSnapshot, WalletSnapshot } from "./types.js";

type WalletState = {
  balance: number;
  activeBets: Partial<Record<BetSlot, PublicBet>>;
};

const WAITING_MS = 8_000;
const CRASHED_MS = 3_000;
const TICK_MS = 100;
const HOUSE_EDGE = 0.01;
const MAX_CRASH = 100;
const STARTING_BALANCE = 172_915.78;

const names = [
  "d***1", "d***8", "m***4", "s***9", "b***6", "c***f",
  "n***b", "q***q", "5***0", "r***7", "a***2", "k***i"
];

export class GameEngine {
  private io: Server;
  private phase: RoundPhase = "WAITING";
  private roundId = crypto.randomUUID();
  private serverSeed = crypto.randomBytes(32).toString("hex");
  private commit = this.hash(this.serverSeed);
  private crashPoint = 2;
  private multiplier = 1;
  private startedAt: number | null = null;
  private phaseEndsAt: number | null = Date.now() + WAITING_MS;
  private history: number[] = [3.94, 5.33, 3.44, 1.42, 1.44, 1.11, 38.48, 2.83, 4.46, 1.3, 1.5, 1.83, 1.16, 1.02, 22.36];
  private bets: PublicBet[] = [];
  private wallets = new Map<string, WalletState>();
  private timer: NodeJS.Timeout;

  constructor(io: Server) {
    this.io = io;
    this.prepareRound();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  connect(socketId: string): WalletSnapshot {
    if (!this.wallets.has(socketId)) {
      this.wallets.set(socketId, { balance: STARTING_BALANCE, activeBets: {} });
    }
    return this.getWallet(socketId);
  }

  disconnect(socketId: string): void {
    this.wallets.delete(socketId);
  }

  getSnapshot(): RoundSnapshot {
    return {
      roundId: this.roundId,
      phase: this.phase,
      multiplier: this.multiplier,
      phaseEndsAt: this.phaseEndsAt,
      startedAt: this.startedAt,
      crashPoint: this.phase === "CRASHED" ? this.crashPoint : undefined,
      commit: this.commit,
      history: this.history,
      bets: [...this.bets].sort((a, b) => b.amount - a.amount).slice(0, 120),
      online: this.io.sockets.sockets.size
    };
  }

  getWallet(socketId: string): WalletSnapshot {
    const wallet = this.wallets.get(socketId) ?? { balance: STARTING_BALANCE, activeBets: {} };
    return {
      balance: Number(wallet.balance.toFixed(2)),
      activeBets: wallet.activeBets
    };
  }

  placeBet(socketId: string, slot: BetSlot, amountInput: number): { ok: boolean; message: string } {
    const amount = Number(amountInput.toFixed(2));
    const wallet = this.wallets.get(socketId);

    if (!wallet) return { ok: false, message: "Wallet not initialized." };
    if (this.phase !== "WAITING") return { ok: false, message: "Betting is closed for this round." };
    if (!Number.isFinite(amount) || amount < 16) return { ok: false, message: "Minimum bet is 16 PKR." };
    if (amount > wallet.balance) return { ok: false, message: "Insufficient balance." };
    if (wallet.activeBets[slot]) return { ok: false, message: `A ${slot} bet is already active.` };

    const bet: PublicBet = {
      id: crypto.randomUUID(),
      player: this.maskSocket(socketId),
      amount,
      slot,
      status: "ACTIVE"
    };

    wallet.balance -= amount;
    wallet.activeBets[slot] = bet;
    this.bets.push(bet);
    this.emitState();
    this.emitWallet(socketId);
    return { ok: true, message: "Bet placed." };
  }

  cashOut(socketId: string, slot: BetSlot): { ok: boolean; message: string } {
    const wallet = this.wallets.get(socketId);
    const bet = wallet?.activeBets[slot];

    if (!wallet || !bet) return { ok: false, message: "No active bet found." };
    if (this.phase !== "RUNNING") return { ok: false, message: "Cash-out is available while the plane is flying." };
    if (bet.status !== "ACTIVE") return { ok: false, message: "Bet has already been settled." };

    const lockedMultiplier = Math.max(1, Number(this.multiplier.toFixed(2)));
    const payout = Number((bet.amount * lockedMultiplier).toFixed(2));
    bet.status = "CASHED_OUT";
    bet.cashoutMultiplier = lockedMultiplier;
    bet.payout = payout;
    wallet.balance += payout;
    delete wallet.activeBets[slot];

    this.emitState();
    this.emitWallet(socketId);
    return { ok: true, message: `Cashed out at ${lockedMultiplier.toFixed(2)}x.` };
  }

  private tick(): void {
    const now = Date.now();

    if (this.phase === "WAITING" && this.phaseEndsAt && now >= this.phaseEndsAt) {
      this.phase = "RUNNING";
      this.startedAt = now;
      this.phaseEndsAt = null;
      this.multiplier = 1;
      this.io.emit("round:started", { roundId: this.roundId });
    }

    if (this.phase === "RUNNING" && this.startedAt) {
      const elapsed = now - this.startedAt;
      this.multiplier = Number(Math.exp(elapsed * 0.00006).toFixed(2));

      if (this.multiplier >= this.crashPoint) {
        this.multiplier = this.crashPoint;
        this.phase = "CRASHED";
        this.phaseEndsAt = now + CRASHED_MS;
        this.settleLosses();
        this.history = [this.crashPoint, ...this.history].slice(0, 30);
        this.io.emit("round:revealed", {
          roundId: this.roundId,
          crashPoint: this.crashPoint,
          serverSeed: this.serverSeed,
          commit: this.commit
        });
      }
    }

    if (this.phase === "CRASHED" && this.phaseEndsAt && now >= this.phaseEndsAt) {
      this.prepareRound();
    }

    this.emitState();
  }

  private prepareRound(): void {
    this.phase = "WAITING";
    this.roundId = crypto.randomUUID();
    this.serverSeed = crypto.randomBytes(32).toString("hex");
    this.commit = this.hash(this.serverSeed);
    this.crashPoint = this.calculateCrashPoint(this.serverSeed, this.roundId);
    this.multiplier = 1;
    this.startedAt = null;
    this.phaseEndsAt = Date.now() + WAITING_MS;
    this.bets = this.createBotBets();

    for (const wallet of this.wallets.values()) {
      wallet.activeBets = {};
    }
  }

  private settleLosses(): void {
    for (const bet of this.bets) {
      if (bet.status === "ACTIVE") bet.status = "LOST";
    }
    for (const [socketId, wallet] of this.wallets.entries()) {
      wallet.activeBets = {};
      this.emitWallet(socketId);
    }
  }

  private calculateCrashPoint(seed: string, roundId: string): number {
    const digest = crypto.createHmac("sha256", seed).update(roundId).digest("hex");
    const integer = Number.parseInt(digest.slice(0, 13), 16);
    const max = 16 ** 13;
    const random = integer / max;
    const raw = (1 - HOUSE_EDGE) / Math.max(0.000001, 1 - random);
    return Math.min(MAX_CRASH, Math.max(1, Math.floor(raw * 100) / 100));
  }

  private createBotBets(): PublicBet[] {
    return Array.from({ length: 38 }, (_, index) => {
      const amountOptions = [16, 64, 160, 320, 1600, 12_836.13, 14_148.45, 16_000.05];
      const amount = amountOptions[Math.floor(Math.random() * amountOptions.length)] ?? 16;
      return {
        id: crypto.randomUUID(),
        player: names[index % names.length] ?? "p***r",
        amount,
        slot: index % 2 === 0 ? "left" : "right",
        status: "ACTIVE",
        isBot: true
      };
    });
  }

  private emitState(): void {
    this.io.emit("round:state", this.getSnapshot());
  }

  private emitWallet(socketId: string): void {
    this.io.to(socketId).emit("wallet:state", this.getWallet(socketId));
  }

  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private maskSocket(socketId: string): string {
    const clean = socketId.replace(/[^a-zA-Z0-9]/g, "");
    return `${clean.slice(0, 1).toLowerCase() || "u"}***${clean.slice(-1).toLowerCase() || "r"}`;
  }
}
