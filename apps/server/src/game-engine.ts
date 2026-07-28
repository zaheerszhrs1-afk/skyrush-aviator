import * as crypto from "node:crypto";
import mongoose from "mongoose";
import type { Server } from "socket.io";
import { getWalletSnapshot } from "./finance.js";
import {
  GameBetModel,
  GameRoundModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WalletTransactionModel
} from "./models.js";
import type { BetSlot, PublicBet, RoundPhase, RoundSnapshot, WalletSnapshot } from "./types.js";

const WAITING_MS = 8_000;
const CRASHED_MS = 3_000;
const TICK_MS = 100;
const MAX_CRASH = 1000;

const money = (value: number): number => Number(value.toFixed(2));

interface RuntimeSettings {
  houseEdgePercent: number;
  commissionPercent: number;
  reservePercent: number;
  minBet: number;
  maxBet: number;
  maxCashoutMultiplier: number;
}

const defaultSettings: RuntimeSettings = {
  houseEdgePercent: 1,
  commissionPercent: 10,
  reservePercent: 30,
  minBet: 16,
  maxBet: 100_000,
  maxCashoutMultiplier: 100
};

export class GameEngine {
  private readonly io: Server;
  private phase: RoundPhase = "WAITING";
  private roundId = crypto.randomUUID();
  private serverSeed = crypto.randomBytes(32).toString("hex");
  private commit = this.hash(this.serverSeed);
  private crashPoint = 2;
  private multiplier = 1;
  private startedAt: number | null = null;
  private phaseEndsAt: number | null = Date.now() + WAITING_MS;
  private history: number[] = [];
  private bets: PublicBet[] = [];
  private activeBets = new Map<string, Partial<Record<BetSlot, PublicBet>>>();
  private socketUsers = new Map<string, string>();
  private settings: RuntimeSettings = defaultSettings;
  private cachedLossPool = 0;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(io: Server) {
    this.io = io;
  }

  async initialize(): Promise<void> {
    await this.recoverInterruptedBets();
    const recentRounds = await GameRoundModel.find({ phase: "CRASHED" })
      .sort({ crashedAt: -1 })
      .limit(30)
      .select("crashPoint")
      .lean();
    this.history = recentRounds.map((round) => Number(round.crashPoint));
    const state = await PlatformStateModel.findOne({ key: "global" }).lean();
    this.cachedLossPool = money(Math.max(0, Number((state as any)?.lossPool ?? 0)));
    await this.prepareRound();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async connect(socketId: string, userId: string): Promise<WalletSnapshot> {
    this.socketUsers.set(socketId, userId);
    return this.getWallet(userId);
  }

  disconnect(socketId: string): void {
    this.socketUsers.delete(socketId);
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
      online: this.socketUsers.size,
      houseEdgePercent: this.settings.houseEdgePercent,
      lossPool: this.cachedLossPool,
      commissionPercent: this.settings.commissionPercent
    };
  }

  async getWallet(userId: string): Promise<WalletSnapshot> {
    const wallet = await getWalletSnapshot(userId);
    return {
      ...wallet,
      activeBets: this.activeBets.get(userId) ?? {}
    };
  }

  async placeBet(userId: string, slot: BetSlot, amountInput: number): Promise<{ ok: boolean; message: string }> {
    const amount = money(Number(amountInput));
    if (this.phase !== "WAITING") return { ok: false, message: "Betting is closed for this round." };
    if (!Number.isFinite(amount) || amount < this.settings.minBet) {
      return { ok: false, message: `Minimum bet is ${this.settings.minBet.toFixed(2)} PKR.` };
    }
    if (amount > this.settings.maxBet) {
      return { ok: false, message: `Maximum bet is ${this.settings.maxBet.toFixed(2)} PKR.` };
    }
    if (this.activeBets.get(userId)?.[slot]) return { ok: false, message: `A ${slot} bet is already active.` };

    const riskCheck = await this.checkRiskCapacity(amount);
    if (!riskCheck.ok) return riskCheck;

    const user = await UserModel.findById(userId).select("name").lean();
    if (!user) return { ok: false, message: "User account not found." };

    const bet: PublicBet = {
      id: crypto.randomUUID(),
      player: this.maskName(String(user.name)),
      amount,
      slot,
      status: "ACTIVE"
    };

    try {
      await mongoose.connection.transaction(async (session) => {
        const updatedUser = await UserModel.findOneAndUpdate(
          { _id: userId, status: "ACTIVE", balance: { $gte: amount } },
          { $inc: { balance: -amount } },
          { new: true, session }
        );
        if (!updatedUser) throw new Error("Insufficient balance.");

        await GameBetModel.create(
          [{
            betId: bet.id,
            roundId: this.roundId,
            userId,
            player: bet.player,
            slot,
            amount,
            status: "ACTIVE"
          }],
          { session }
        );

        await PlatformStateModel.updateOne(
          { key: "global" },
          { $inc: { gameProfit: amount } },
          { session, upsert: true }
        );
        await GameRoundModel.updateOne({ roundId: this.roundId }, { $inc: { totalStake: amount } }, { session });
        await WalletTransactionModel.create(
          [{
            userId,
            type: "BET_DEBIT",
            amount: -amount,
            balanceAfter: money(updatedUser.balance),
            lockedBalanceAfter: money(updatedUser.lockedBalance),
            referenceType: "BET",
            referenceId: bet.id,
            description: `Bet placed for round ${this.roundId}`,
            metadata: { roundId: this.roundId, slot }
          }],
          { session }
        );
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to place bet." };
    }

    const userBets = this.activeBets.get(userId) ?? {};
    userBets[slot] = bet;
    this.activeBets.set(userId, userBets);
    this.bets.push(bet);
    this.emitState();
    await this.emitWalletForUser(userId);
    return { ok: true, message: "Bet placed." };
  }

  async cashOut(userId: string, slot: BetSlot): Promise<{ ok: boolean; message: string }> {
    const bet = this.activeBets.get(userId)?.[slot];
    if (!bet) return { ok: false, message: "No active bet found." };
    if (this.phase !== "RUNNING") return { ok: false, message: "Cash-out is available while the plane is flying." };
    if (bet.status !== "ACTIVE") return { ok: false, message: "Bet has already been settled." };

    const lockedMultiplier = Math.min(
      this.settings.maxCashoutMultiplier,
      Math.max(1, Number(this.multiplier.toFixed(2)))
    );
    const grossPayout = money(bet.amount * lockedMultiplier);
    const profit = money(grossPayout - bet.amount);
    const commission = money(profit * (this.settings.commissionPercent / 100));
    const payout = money(grossPayout - commission);

    // Liquidity check: Loss Pool must cover the profit portion paid to winner
    const state = await PlatformStateModel.findOne({ key: "global" }).lean();
    const lossPool = money(Math.max(0, Number(state?.lossPool ?? 0)));
    if (profit > 0 && lossPool < profit) {
      return { ok: false, message: "Insufficient pool liquidity to pay this win. Try cashing out earlier." };
    }

    try {
      await mongoose.connection.transaction(async (session) => {
        const dbBet = await GameBetModel.findOneAndUpdate(
          { betId: bet.id, status: "ACTIVE" },
          { $set: { status: "CASHED_OUT", cashoutMultiplier: lockedMultiplier, payout, settledAt: new Date() } },
          { new: true, session }
        );
        if (!dbBet) throw new Error("Bet has already been settled.");

        const updatedUser = await UserModel.findByIdAndUpdate(
          userId,
          { $inc: { balance: payout } },
          { new: true, session }
        );
        if (!updatedUser) throw new Error("User account not found.");

        // Deduct profit from Loss Pool; stake was already removed on bet placement
        await PlatformStateModel.updateOne(
          { key: "global" },
          { $inc: { lossPool: -profit, totalCommissionEarned: commission, gameProfit: -payout } },
          { session, upsert: true }
        );
        await GameRoundModel.updateOne({ roundId: this.roundId }, { $inc: { totalPayout: payout } }, { session });
        await WalletTransactionModel.create(
          [{
            userId,
            type: "CASHOUT_CREDIT",
            amount: payout,
            balanceAfter: money(updatedUser.balance),
            lockedBalanceAfter: money(updatedUser.lockedBalance),
            referenceType: "BET",
            referenceId: bet.id,
            description: `Cashed out at ${lockedMultiplier.toFixed(2)}x (commission ${commission.toFixed(2)} PKR)`,
            metadata: { roundId: this.roundId, slot, multiplier: lockedMultiplier, commission }
          }],
          { session }
        );
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to cash out." };
    }

    bet.status = "CASHED_OUT";
    bet.cashoutMultiplier = lockedMultiplier;
    bet.payout = payout;
    this.cachedLossPool = money(Math.max(0, this.cachedLossPool - profit));
    const userBets = this.activeBets.get(userId);
    if (userBets) {
      delete userBets[slot];
      this.activeBets.set(userId, userBets);
    }

    this.emitState();
    await this.emitWalletForUser(userId);
    return { ok: true, message: `Cashed out at ${lockedMultiplier.toFixed(2)}x.` };
  }

  async emitWalletForUser(userId: string): Promise<void> {
    const wallet = await this.getWallet(userId);
    for (const [socketId, connectedUserId] of this.socketUsers.entries()) {
      if (connectedUserId === userId) this.io.to(socketId).emit("wallet:state", wallet);
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();

      if (this.phase === "WAITING" && this.phaseEndsAt && now >= this.phaseEndsAt) {
        this.phase = "RUNNING";
        this.startedAt = now;
        this.phaseEndsAt = null;
        this.multiplier = 1;
        await GameRoundModel.updateOne(
          { roundId: this.roundId },
          { $set: { phase: "RUNNING", startedAt: new Date(now) } }
        );
        this.io.emit("round:started", { roundId: this.roundId });
      }

      if (this.phase === "RUNNING" && this.startedAt) {
        const elapsed = now - this.startedAt;
        this.multiplier = Number(Math.exp(elapsed * 0.00006).toFixed(2));

        if (this.multiplier >= this.crashPoint) {
          this.multiplier = this.crashPoint;
          this.phase = "CRASHED";
          this.phaseEndsAt = now + CRASHED_MS;
          await this.settleLosses();
          this.history = [this.multiplier, ...this.history].slice(0, 30);
          await GameRoundModel.updateOne(
            { roundId: this.roundId },
            { $set: { phase: "CRASHED", crashPoint: this.multiplier, crashedAt: new Date(now) } }
          );
          this.io.emit("round:revealed", {
            roundId: this.roundId,
            crashPoint: this.multiplier,
            serverSeed: this.serverSeed,
            commit: this.commit
          });
        }
      }

      if (this.phase === "CRASHED" && this.phaseEndsAt && now >= this.phaseEndsAt) {
        await this.prepareRound();
      }

      this.emitState();
    } catch (error) {
      console.error("Game tick failed:", error);
    } finally {
      this.ticking = false;
    }
  }

  private async prepareRound(): Promise<void> {
    this.settings = await this.loadSettings();
    this.phase = "WAITING";
    this.roundId = crypto.randomUUID();
    this.serverSeed = crypto.randomBytes(32).toString("hex");
    this.commit = this.hash(this.serverSeed);
    this.crashPoint = Math.min(
      this.settings.maxCashoutMultiplier,
      this.calculateCrashPoint(this.serverSeed, this.roundId, this.settings.houseEdgePercent)
    );
    this.multiplier = 1;
    this.startedAt = null;
    this.phaseEndsAt = Date.now() + WAITING_MS;
    this.bets = [];
    this.activeBets.clear();

    await GameRoundModel.create({
      roundId: this.roundId,
      commit: this.commit,
      serverSeed: this.serverSeed,
      crashPoint: this.crashPoint,
      phase: "WAITING",
      houseEdgePercent: this.settings.houseEdgePercent,
      totalStake: 0,
      totalPayout: 0
    });
  }

  private async settleLosses(): Promise<void> {
    const losingBets = this.bets.filter((b) => b.status === "ACTIVE");
    const totalLost = money(losingBets.reduce((sum, b) => sum + b.amount, 0));

    await GameBetModel.updateMany(
      { roundId: this.roundId, status: "ACTIVE" },
      { $set: { status: "LOST", settledAt: new Date() } }
    );
    for (const bet of losingBets) bet.status = "LOST";

    if (totalLost > 0) {
      await PlatformStateModel.updateOne(
        { key: "global" },
        { $inc: { lossPool: totalLost } },
        { upsert: true }
      );
      this.cachedLossPool = money(this.cachedLossPool + totalLost);
    }

    const affectedUsers = [...this.activeBets.keys()];
    this.activeBets.clear();
    for (const userId of affectedUsers) await this.emitWalletForUser(userId);
  }

  private async recoverInterruptedBets(): Promise<void> {
    const interrupted = await GameBetModel.find({ status: "ACTIVE" }).lean();
    for (const bet of interrupted) {
      await mongoose.connection.transaction(async (session) => {
        const updatedBet = await GameBetModel.findOneAndUpdate(
          { _id: bet._id, status: "ACTIVE" },
          { $set: { status: "REFUNDED", settledAt: new Date() } },
          { new: true, session }
        );
        if (!updatedBet) return;
        const user = await UserModel.findByIdAndUpdate(
          bet.userId,
          { $inc: { balance: bet.amount } },
          { new: true, session }
        );
        if (!user) return;
        await PlatformStateModel.updateOne(
          { key: "global" },
          { $inc: { gameProfit: -bet.amount } },
          { session, upsert: true }
        );
        await WalletTransactionModel.create(
          [{
            userId: bet.userId,
            type: "BET_REFUND",
            amount: bet.amount,
            balanceAfter: money(user.balance),
            lockedBalanceAfter: money(user.lockedBalance),
            referenceType: "BET",
            referenceId: bet.betId,
            description: "Bet refunded after interrupted server round"
          }],
          { session }
        );
      });
    }
  }

  private async checkRiskCapacity(amount: number): Promise<{ ok: boolean; message: string }> {
    // P2P model: bets are always accepted during WAITING phase.
    // Winning payouts are gated at cash-out time by Loss Pool liquidity.
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: "Invalid bet amount." };
    }
    return { ok: true, message: "Bet accepted." };
  }

  private async loadSettings(): Promise<RuntimeSettings> {
    const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
    return {
      houseEdgePercent: Number(settings?.houseEdgePercent ?? defaultSettings.houseEdgePercent),
      commissionPercent: Number((settings as any)?.commissionPercent ?? defaultSettings.commissionPercent),
      reservePercent: Number(settings?.reservePercent ?? defaultSettings.reservePercent),
      minBet: Number(settings?.minBet ?? defaultSettings.minBet),
      maxBet: Number(settings?.maxBet ?? defaultSettings.maxBet),
      maxCashoutMultiplier: Number(settings?.maxCashoutMultiplier ?? defaultSettings.maxCashoutMultiplier)
    };
  }

  private calculateCrashPoint(seed: string, roundId: string, houseEdgePercent: number): number {
    const digest = crypto.createHmac("sha256", seed).update(roundId).digest("hex");
    const integer = Number.parseInt(digest.slice(0, 13), 16);
    const max = 16 ** 13;
    const random = integer / max;
    const edge = Math.min(0.2, Math.max(0, houseEdgePercent / 100));
    const raw = (1 - edge) / Math.max(0.000001, 1 - random);
    return Math.min(MAX_CRASH, Math.max(1, Math.floor(raw * 100) / 100));
  }

  private emitState(): void {
    this.io.emit("round:state", this.getSnapshot());
  }

  private hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private maskName(name: string): string {
    const clean = name.trim();
    if (clean.length <= 2) return `${clean.slice(0, 1) || "u"}***`;
    return `${clean.slice(0, 1)}***${clean.slice(-1)}`;
  }
}
