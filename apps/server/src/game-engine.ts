import * as crypto from "node:crypto";
import mongoose from "mongoose";
import type { Server } from "socket.io";
import { calculateMaximumLiability, calculatePayout } from "./accounting.js";
import { getWalletSnapshot } from "./finance.js";
import { DemoEngine } from "./demo-engine.js";
import { BotEngine } from "./bot-engine.js";
import {
  GameBetModel,
  GameRoundModel,
  PlatformAuditModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WalletTransactionModel,
  type TransactionType
} from "./models.js";
import { fromMinor, minorFromDocument, toMinor } from "./money.js";
import type { AccountMode, BetSlot, PublicBet, RoundPhase, RoundSnapshot, WalletSnapshot } from "./types.js";

const WAITING_MS = 8_000;
const CRASHED_MS = 3_000;
const TICK_MS = 100;
const MAX_CRASH = 1000;

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
  reservePercent: 0,
  minBet: 16,
  maxBet: 100_000,
  maxCashoutMultiplier: 10
};

type WalletTransactionInputDocument = {
  userId: mongoose.Types.ObjectId;
  type: TransactionType;
  amountMinor: number;
  availableDeltaMinor: number;
  withdrawalLockedDeltaMinor: number;
  bettingLockedDeltaMinor: number;
  pendingRewardsDeltaMinor: number;
  balanceAfterMinor: number;
  withdrawalLockedAfterMinor: number;
  bettingLockedAfterMinor: number;
  pendingRewardsAfterMinor: number;
  amount: number;
  balanceAfter: number;
  lockedBalanceAfter: number;
  referenceType: string;
  referenceId: string;
  description: string;
  metadata: Record<string, unknown>;
};

function toObjectId(value: unknown): mongoose.Types.ObjectId {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const stringValue = String(value);
  if (!mongoose.Types.ObjectId.isValid(stringValue)) {
    throw new Error(`Invalid MongoDB ObjectId: ${stringValue}`);
  }
  return new mongoose.Types.ObjectId(stringValue);
}

function walletTransaction(input: {
  userId: unknown;
  type: TransactionType;
  amountMinor: number;
  availableDeltaMinor?: number;
  withdrawalLockedDeltaMinor?: number;
  bettingLockedDeltaMinor?: number;
  user: any;
  referenceId: string;
  description: string;
  metadata?: Record<string, unknown>;
}): WalletTransactionInputDocument {
  const userId = toObjectId(input.userId);
  const balanceMinor = minorFromDocument(input.user, "balanceMinor", "balance");
  const withdrawalLockedMinor = minorFromDocument(input.user, "withdrawalLockedMinor", "lockedBalance");
  const bettingLockedMinor = Number(input.user?.bettingLockedMinor ?? 0);
  const pendingRewardsMinor = Number(input.user?.pendingRewardsMinor ?? 0);
  return {
    userId,
    type: input.type,
    amountMinor: input.amountMinor,
    availableDeltaMinor: input.availableDeltaMinor ?? 0,
    withdrawalLockedDeltaMinor: input.withdrawalLockedDeltaMinor ?? 0,
    bettingLockedDeltaMinor: input.bettingLockedDeltaMinor ?? 0,
    pendingRewardsDeltaMinor: 0,
    balanceAfterMinor: balanceMinor,
    withdrawalLockedAfterMinor: withdrawalLockedMinor,
    bettingLockedAfterMinor: bettingLockedMinor,
    pendingRewardsAfterMinor: pendingRewardsMinor,
    amount: fromMinor(input.amountMinor),
    balanceAfter: fromMinor(balanceMinor),
    lockedBalanceAfter: fromMinor(withdrawalLockedMinor),
    referenceType: "BET",
    referenceId: input.referenceId,
    description: input.description,
    metadata: input.metadata ?? {}
  };
}

export class GameEngine {
  private readonly io: Server;
  private readonly demo = new DemoEngine();
  private readonly bots = new BotEngine();
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
  private cachedLossPoolMinor = 0;
  private cachedActiveBetEscrowMinor = 0;
  private cachedReservedLiquidityMinor = 0;
  private roundSettled = false;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(io: Server) {
    this.io = io;
  }

  async initialize(): Promise<void> {
    await this.recoverInterruptedBets();
    await this.demo.initialize();
    const recentRounds = await GameRoundModel.find({ phase: "CRASHED" })
      .sort({ crashedAt: -1 })
      .limit(30)
      .select("crashPoint")
      .lean();
    this.history = recentRounds.map((round) => Number(round.crashPoint));
    await this.refreshAccountingCache();
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
    const protectedPoolMinor = Math.floor(this.cachedLossPoolMinor * (this.settings.reservePercent / 100));
    const availableRewardLiquidityMinor = Math.max(
      0,
      this.cachedLossPoolMinor - protectedPoolMinor - this.cachedReservedLiquidityMinor
    );
    return {
      roundId: this.roundId,
      phase: this.phase,
      multiplier: this.multiplier,
      phaseEndsAt: this.phaseEndsAt,
      startedAt: this.startedAt,
      crashPoint: this.phase === "CRASHED" ? this.crashPoint : undefined,
      commit: this.commit,
      history: this.history,
      bets: [...this.bets, ...this.bots.getPublicBets()].sort((a, b) => b.amount - a.amount).slice(0, 120),
      demoBets: this.demo.getPublicBets(),
      online: this.socketUsers.size,
      automatedOnline: this.bots.getAutomatedParticipantCount(),
      demoOnline: this.demo.getOnlineCount(this.socketUsers.size),
      houseEdgePercent: this.settings.houseEdgePercent,
      lossPool: fromMinor(this.cachedLossPoolMinor),
      commissionPercent: this.settings.commissionPercent,
      activeBetEscrow: fromMinor(this.cachedActiveBetEscrowMinor),
      reservedRewardLiquidity: fromMinor(this.cachedReservedLiquidityMinor),
      availableRewardLiquidity: fromMinor(availableRewardLiquidityMinor)
    };
  }

  async getWallet(userId: string): Promise<WalletSnapshot> {
    const wallet = await getWalletSnapshot(userId);
    return {
      ...wallet,
      activeBets: this.activeBets.get(userId) ?? {},
      demoBalance: await this.demo.getBalance(userId),
      demoActiveBets: this.demo.getActiveBets(userId)
    };
  }

  async placeBet(userId: string, slot: BetSlot, amountInput: number, mode: AccountMode = "REAL"): Promise<{ ok: boolean; message: string }> {
    if (mode === "DEMO") {
      const result = await this.demo.placeBet({
        userId,
        slot,
        amount: amountInput,
        phase: this.phase,
        settings: this.settings
      });
      if (result.ok) {
        this.emitState();
        await this.emitWalletForUser(userId);
      }
      return result;
    }
    if (this.phase !== "WAITING") return { ok: false, message: "Betting is closed for this round." };
    if (!Number.isFinite(amountInput)) return { ok: false, message: "Invalid bet amount." };

    const amountMinor = toMinor(amountInput);
    const minBetMinor = toMinor(this.settings.minBet);
    const maxBetMinor = toMinor(this.settings.maxBet);
    if (amountMinor < minBetMinor) {
      return { ok: false, message: `Minimum bet is ${this.settings.minBet.toFixed(2)} PKR.` };
    }
    if (amountMinor > maxBetMinor) {
      return { ok: false, message: `Maximum bet is ${this.settings.maxBet.toFixed(2)} PKR.` };
    }
    if (this.activeBets.get(userId)?.[slot]) return { ok: false, message: `A ${slot} bet is already active.` };

    const user = await UserModel.findById(userId).select("name").lean();
    if (!user) return { ok: false, message: "User account not found." };

    const reservedLiabilityMinor = calculateMaximumLiability(amountMinor, this.settings.maxCashoutMultiplier);
    const bet: PublicBet = {
      id: crypto.randomUUID(),
      player: this.maskName(String(user.name)),
      amount: fromMinor(amountMinor),
      slot,
      status: "ACTIVE",
      guaranteedMaxMultiplier: this.settings.maxCashoutMultiplier
    };

    try {
      let stateAfter: any;
      await mongoose.connection.transaction(async (session) => {
        const allocatableFactor = Math.max(0, 1 - this.settings.reservePercent / 100);
        stateAfter = await PlatformStateModel.findOneAndUpdate(
          {
            key: "global",
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $floor: { $multiply: [{ $ifNull: ["$lossPoolMinor", 0] }, allocatableFactor] } },
                    { $ifNull: ["$reservedRewardLiquidityMinor", 0] }
                  ]
                },
                reservedLiabilityMinor
              ]
            }
          },
          {
            $inc: {
              activeBetEscrowMinor: amountMinor,
              reservedRewardLiquidityMinor: reservedLiabilityMinor,
              totalBetVolumeMinor: amountMinor
            }
          },
          { new: true, session }
        );
        if (!stateAfter) {
          throw new Error(
            `Insufficient peer liquidity to guarantee payouts up to ${this.settings.maxCashoutMultiplier.toFixed(2)}x.`
          );
        }

        const updatedUser = await UserModel.findOneAndUpdate(
          { _id: userId, status: "ACTIVE", balanceMinor: { $gte: amountMinor } },
          {
            $inc: {
              balanceMinor: -amountMinor,
              bettingLockedMinor: amountMinor,
              balance: -fromMinor(amountMinor)
            }
          },
          { new: true, session }
        );
        if (!updatedUser) throw new Error("Insufficient available balance.");

        await GameBetModel.create(
          [{
            betId: bet.id,
            roundId: this.roundId,
            userId,
            player: bet.player,
            slot,
            amountMinor,
            reservedLiabilityMinor,
            amount: fromMinor(amountMinor),
            status: "ACTIVE"
          }],
          { session }
        );

        await GameRoundModel.updateOne(
          { roundId: this.roundId },
          {
            $inc: {
              totalStakeMinor: amountMinor,
              totalStake: fromMinor(amountMinor)
            }
          },
          { session }
        );

        await WalletTransactionModel.create(
          [walletTransaction({
            userId,
            type: "BET_ESCROW_LOCK" as const,
            amountMinor: -amountMinor,
            availableDeltaMinor: -amountMinor,
            bettingLockedDeltaMinor: amountMinor,
            user: updatedUser,
            referenceId: bet.id,
            description: `Bet stake locked in escrow for round ${this.roundId}`,
            metadata: {
              roundId: this.roundId,
              slot,
              reservedLiabilityMinor,
              guaranteedMaxMultiplier: this.settings.maxCashoutMultiplier
            }
          })],
          { session }
        );

        await PlatformAuditModel.create(
          [{
            eventKey: `bet-lock:${bet.id}`,
            type: "BET_ESCROW_LOCK" as const,
            userId: new mongoose.Types.ObjectId(userId),
            roundId: this.roundId,
            betId: bet.id,
            activeBetEscrowDeltaMinor: amountMinor,
            reservedLiquidityDeltaMinor: reservedLiabilityMinor,
            activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
            reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
            lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
            commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
            description: `Locked ${fromMinor(amountMinor).toFixed(2)} PKR stake and reserved ${fromMinor(reservedLiabilityMinor).toFixed(2)} PKR winner liquidity`
          }],
          { session }
        );
      });

      this.updateAccountingCache(stateAfter);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to place bet." };
    }

    const userBets = this.activeBets.get(userId) ?? {};
    userBets[slot] = bet;
    this.activeBets.set(userId, userBets);
    this.bets.push(bet);
    this.emitState();
    await this.emitWalletForUser(userId);
    return { ok: true, message: "Bet placed with payout liquidity reserved." };
  }

  async cashOut(userId: string, slot: BetSlot, mode: AccountMode = "REAL"): Promise<{ ok: boolean; message: string }> {
    if (mode === "DEMO") {
      const result = await this.demo.cashOut({
        userId,
        slot,
        phase: this.phase,
        multiplier: this.multiplier,
        settings: this.settings
      });
      if (result.ok) {
        this.emitState();
        await this.emitWalletForUser(userId);
      }
      return result;
    }
    const bet = this.activeBets.get(userId)?.[slot];
    if (!bet) return { ok: false, message: "No active bet found." };
    if (this.phase !== "RUNNING") return { ok: false, message: "Cash-out is available while the plane is flying." };
    if (bet.status !== "ACTIVE") return { ok: false, message: "Bet has already been settled." };

    const lockedMultiplier = Math.min(
      this.settings.maxCashoutMultiplier,
      Math.max(1, Number(this.multiplier.toFixed(2)))
    );
    const amountMinor = toMinor(bet.amount);
    const payout = calculatePayout(amountMinor, lockedMultiplier, this.settings.commissionPercent);

    try {
      let stateAfter: any;
      await mongoose.connection.transaction(async (session) => {
        const dbBet = await GameBetModel.findOneAndUpdate(
          { betId: bet.id, status: "ACTIVE" },
          {
            $set: {
              status: "CASHED_OUT",
              cashoutMultiplier: lockedMultiplier,
              payoutMinor: payout.payoutMinor,
              commissionMinor: payout.commissionMinor,
              payout: fromMinor(payout.payoutMinor),
              settledAt: new Date()
            }
          },
          { new: true, session }
        );
        if (!dbBet) throw new Error("Bet has already been settled.");

        const reservedLiabilityMinor = Number((dbBet as any).reservedLiabilityMinor ?? 0);
        stateAfter = await PlatformStateModel.findOneAndUpdate(
          {
            key: "global",
            activeBetEscrowMinor: { $gte: amountMinor },
            reservedRewardLiquidityMinor: { $gte: reservedLiabilityMinor },
            lossPoolMinor: { $gte: payout.grossProfitMinor }
          },
          {
            $inc: {
              activeBetEscrowMinor: -amountMinor,
              reservedRewardLiquidityMinor: -reservedLiabilityMinor,
              lossPoolMinor: -payout.grossProfitMinor,
              commissionWalletMinor: payout.commissionMinor,
              totalCommissionEarnedMinor: payout.commissionMinor,
              totalRewardsPaidMinor: payout.payoutMinor
            }
          },
          { new: true, session }
        );
        if (!stateAfter) {
          throw new Error("Reserved liquidity settlement failed. No wallet was changed; contact support.");
        }

        const updatedUser = await UserModel.findOneAndUpdate(
          { _id: userId, bettingLockedMinor: { $gte: amountMinor } },
          {
            $inc: {
              balanceMinor: payout.payoutMinor,
              bettingLockedMinor: -amountMinor,
              balance: fromMinor(payout.payoutMinor)
            }
          },
          { new: true, session }
        );
        if (!updatedUser) throw new Error("Bet escrow is inconsistent for this user.");

        await GameRoundModel.updateOne(
          { roundId: this.roundId },
          {
            $inc: {
              totalPayoutMinor: payout.payoutMinor,
              totalCommissionMinor: payout.commissionMinor,
              totalPayout: fromMinor(payout.payoutMinor)
            }
          },
          { session }
        );

        await WalletTransactionModel.create(
          [walletTransaction({
            userId,
            type: "CASHOUT_CREDIT",
            amountMinor: payout.payoutMinor,
            availableDeltaMinor: payout.payoutMinor,
            bettingLockedDeltaMinor: -amountMinor,
            user: updatedUser,
            referenceId: bet.id,
            description: `Cashed out at ${lockedMultiplier.toFixed(2)}x; commission ${fromMinor(payout.commissionMinor).toFixed(2)} PKR`,
            metadata: {
              roundId: this.roundId,
              slot,
              multiplier: lockedMultiplier,
              stakeMinor: amountMinor,
              grossProfitMinor: payout.grossProfitMinor,
              netProfitMinor: payout.netProfitMinor,
              commissionMinor: payout.commissionMinor
            }
          })],
          { session }
        );

        await PlatformAuditModel.create(
          [
            {
              eventKey: `winner-paid:${bet.id}`,
              type: "WINNER_PAID" as const,
              userId: new mongoose.Types.ObjectId(userId),
              roundId: this.roundId,
              betId: bet.id,
              activeBetEscrowDeltaMinor: -amountMinor,
              reservedLiquidityDeltaMinor: -reservedLiabilityMinor,
              lossPoolDeltaMinor: -payout.grossProfitMinor,
              commissionWalletDeltaMinor: 0,
              activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
              reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
              lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
              commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
              description: `Paid winner ${fromMinor(payout.payoutMinor).toFixed(2)} PKR from bet escrow and peer loss pool`,
              metadata: { multiplier: lockedMultiplier, ...payout }
            },
            {
              eventKey: `commission:${bet.id}`,
              type: "COMMISSION_CREDIT" as const,
              userId: new mongoose.Types.ObjectId(userId),
              roundId: this.roundId,
              betId: bet.id,
              commissionWalletDeltaMinor: payout.commissionMinor,
              activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
              reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
              lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
              commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
              description: `Credited ${fromMinor(payout.commissionMinor).toFixed(2)} PKR platform commission`
            }
          ],
          { session }
        );
      });

      this.updateAccountingCache(stateAfter);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to cash out." };
    }

    bet.status = "CASHED_OUT";
    bet.cashoutMultiplier = lockedMultiplier;
    bet.payout = fromMinor(payout.payoutMinor);
    const userBets = this.activeBets.get(userId);
    if (userBets) {
      delete userBets[slot];
      this.activeBets.set(userId, userBets);
    }

    this.emitState();
    await this.emitWalletForUser(userId);
    return { ok: true, message: `Cashed out at ${lockedMultiplier.toFixed(2)}x.` };
  }

  async resetDemoBalance(userId: string): Promise<WalletSnapshot> {
    await this.demo.resetBalance(userId);
    const wallet = await this.getWallet(userId);
    await this.emitWalletForUser(userId);
    return wallet;
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
          this.phaseEndsAt = null;
          this.roundSettled = false;
        }
      }

      await this.demo.onTick(this.phase, this.multiplier);
      this.bots.onTick(this.phase, this.multiplier);

      if (this.phase === "CRASHED" && !this.roundSettled) {
        await this.settleLosses();
        this.bots.settleLosses();
        const affectedDemoUsers = await this.demo.settleLosses(this.roundId);
        for (const userId of affectedDemoUsers) await this.emitWalletForUser(userId);
        this.roundSettled = true;
        this.phaseEndsAt = Date.now() + CRASHED_MS;
        this.history = [this.multiplier, ...this.history].slice(0, 30);
        await GameRoundModel.updateOne(
          { roundId: this.roundId },
          { $set: { phase: "CRASHED", crashPoint: this.multiplier, crashedAt: new Date() } }
        );
        this.io.emit("round:revealed", {
          roundId: this.roundId,
          crashPoint: this.multiplier,
          serverSeed: this.serverSeed,
          commit: this.commit
        });
      }

      if (this.phase === "CRASHED" && this.roundSettled && this.phaseEndsAt && now >= this.phaseEndsAt) {
        await this.prepareRound();
      }

      this.emitState();
    } catch (error) {
      console.error("Game tick failed; settlement will retry without creating payouts:", error);
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
    this.roundSettled = false;

    await this.demo.prepareRound(this.roundId, this.settings);
    this.bots.prepareRound(this.roundId, this.settings);

    await GameRoundModel.create({
      roundId: this.roundId,
      commit: this.commit,
      serverSeed: this.serverSeed,
      crashPoint: this.crashPoint,
      phase: "WAITING",
      houseEdgePercent: this.settings.houseEdgePercent,
      commissionPercent: this.settings.commissionPercent,
      totalStakeMinor: 0,
      totalPayoutMinor: 0,
      totalCommissionMinor: 0,
      totalLossesMinor: 0,
      totalStake: 0,
      totalPayout: 0
    });
  }

  private async settleLosses(): Promise<void> {
    const activeDbBets = await GameBetModel.find({ roundId: this.roundId, status: "ACTIVE" }).lean();
    const affectedUsers = new Set<string>();

    for (const dbBet of activeDbBets) {
      const userId = String(dbBet.userId);
      affectedUsers.add(userId);
      await this.settleSingleLoss(dbBet);
    }

    const lostIds = new Set(activeDbBets.map((bet) => String(bet.betId)));
    for (const bet of this.bets) {
      if (lostIds.has(bet.id) && bet.status === "ACTIVE") bet.status = "LOST";
    }
    this.activeBets.clear();
    for (const userId of affectedUsers) await this.emitWalletForUser(userId);
  }

  private async settleSingleLoss(dbBetInput: any): Promise<void> {
    const amountMinor = Number.isSafeInteger(Number(dbBetInput.amountMinor))
      ? Number(dbBetInput.amountMinor)
      : toMinor(Number(dbBetInput.amount));
    const reservedLiabilityMinor = Number(dbBetInput.reservedLiabilityMinor ?? 0);
    let stateAfter: any;

    await mongoose.connection.transaction(async (session) => {
      const dbBet = await GameBetModel.findOneAndUpdate(
        { _id: dbBetInput._id, status: "ACTIVE" },
        { $set: { status: "LOST", settledAt: new Date() } },
        { new: true, session }
      );
      if (!dbBet) return;

      const updatedUser = await UserModel.findOneAndUpdate(
        { _id: dbBet.userId, bettingLockedMinor: { $gte: amountMinor } },
        { $inc: { bettingLockedMinor: -amountMinor } },
        { new: true, session }
      );
      if (!updatedUser) throw new Error(`Bet escrow mismatch for ${dbBet.betId}.`);

      stateAfter = await PlatformStateModel.findOneAndUpdate(
        {
          key: "global",
          activeBetEscrowMinor: { $gte: amountMinor },
          reservedRewardLiquidityMinor: { $gte: reservedLiabilityMinor }
        },
        {
          $inc: {
            activeBetEscrowMinor: -amountMinor,
            reservedRewardLiquidityMinor: -reservedLiabilityMinor,
            lossPoolMinor: amountMinor,
            totalLossesMinor: amountMinor
          }
        },
        { new: true, session }
      );
      if (!stateAfter) throw new Error(`Platform escrow mismatch for ${dbBet.betId}.`);

      await GameRoundModel.updateOne(
        { roundId: this.roundId },
        { $inc: { totalLossesMinor: amountMinor } },
        { session }
      );

      await WalletTransactionModel.create(
        [walletTransaction({
          userId: dbBet.userId,
          type: "BET_LOSS",
          amountMinor: 0,
          bettingLockedDeltaMinor: -amountMinor,
          user: updatedUser,
          referenceId: dbBet.betId,
          description: `Lost stake moved atomically from bet escrow to the peer loss pool`,
          metadata: { roundId: this.roundId, amountMinor }
        })],
        { session }
      );

      await PlatformAuditModel.create(
        [{
          eventKey: `bet-loss:${dbBet.betId}`,
          type: "BET_LOSS_SETTLED" as const,
          userId: dbBet.userId,
          roundId: this.roundId,
          betId: dbBet.betId,
          activeBetEscrowDeltaMinor: -amountMinor,
          reservedLiquidityDeltaMinor: -reservedLiabilityMinor,
          lossPoolDeltaMinor: amountMinor,
          activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
          reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
          lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
          commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
          description: `Moved ${fromMinor(amountMinor).toFixed(2)} PKR losing stake into the shared loss pool`
        }],
        { session }
      );
    });

    if (stateAfter) this.updateAccountingCache(stateAfter);
  }

  private async recoverInterruptedBets(): Promise<void> {
    const interrupted = await GameBetModel.find({ status: "ACTIVE" }).lean();
    for (const bet of interrupted) {
      const amountMinor = Number.isSafeInteger(Number((bet as any).amountMinor))
        ? Number((bet as any).amountMinor)
        : toMinor(Number(bet.amount));
      const reservedLiabilityMinor = Number((bet as any).reservedLiabilityMinor ?? 0);

      await mongoose.connection.transaction(async (session) => {
        const updatedBet = await GameBetModel.findOneAndUpdate(
          { _id: bet._id, status: "ACTIVE" },
          { $set: { status: "REFUNDED", settledAt: new Date() } },
          { new: true, session }
        );
        if (!updatedBet) return;

        const existingUser = await UserModel.findById(bet.userId).session(session);
        if (!existingUser) throw new Error(`Unable to refund interrupted bet ${bet.betId}: user not found.`);
        const lockedMinor = Number((existingUser as any).bettingLockedMinor ?? 0);
        const lockedReleaseMinor = Math.min(lockedMinor, amountMinor);
        const user = await UserModel.findByIdAndUpdate(
          bet.userId,
          {
            $inc: {
              balanceMinor: amountMinor,
              bettingLockedMinor: -lockedReleaseMinor,
              balance: fromMinor(amountMinor)
            }
          },
          { new: true, session }
        );
        if (!user) throw new Error(`Unable to refund interrupted bet ${bet.betId}.`);

        const currentState = await PlatformStateModel.findOne({ key: "global" }).session(session);
        if (!currentState) throw new Error("Platform accounting state is unavailable.");
        const escrowReleaseMinor = Math.min(Number((currentState as any).activeBetEscrowMinor ?? 0), amountMinor);
        const reserveReleaseMinor = Math.min(
          Number((currentState as any).reservedRewardLiquidityMinor ?? 0),
          reservedLiabilityMinor
        );
        const stateAfter = await PlatformStateModel.findOneAndUpdate(
          { key: "global" },
          {
            $inc: {
              activeBetEscrowMinor: -escrowReleaseMinor,
              reservedRewardLiquidityMinor: -reserveReleaseMinor
            }
          },
          { new: true, session }
        );
        if (!stateAfter) throw new Error("Platform accounting state is unavailable.");

        await WalletTransactionModel.create(
          [walletTransaction({
            userId: bet.userId,
            type: "BET_REFUND",
            amountMinor,
            availableDeltaMinor: amountMinor,
            bettingLockedDeltaMinor: -lockedReleaseMinor,
            user,
            referenceId: bet.betId,
            description: "Bet refunded after interrupted server round"
          })],
          { session }
        );

        await PlatformAuditModel.create(
          [{
            eventKey: `bet-refund:${bet.betId}`,
            type: "BET_REFUNDED" as const,
            userId: bet.userId,
            roundId: bet.roundId,
            betId: bet.betId,
            activeBetEscrowDeltaMinor: -escrowReleaseMinor,
            reservedLiquidityDeltaMinor: -reserveReleaseMinor,
            activeBetEscrowAfterMinor: Number((stateAfter as any).activeBetEscrowMinor),
            reservedLiquidityAfterMinor: Number((stateAfter as any).reservedRewardLiquidityMinor),
            lossPoolAfterMinor: Number((stateAfter as any).lossPoolMinor),
            commissionWalletAfterMinor: Number((stateAfter as any).commissionWalletMinor),
            description: `Refunded interrupted bet stake of ${fromMinor(amountMinor).toFixed(2)} PKR`
          }],
          { session }
        );
      });
    }
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

  private async refreshAccountingCache(): Promise<void> {
    const state = await PlatformStateModel.findOne({ key: "global" }).lean();
    this.updateAccountingCache(state);
  }

  private updateAccountingCache(state: any): void {
    this.cachedLossPoolMinor = Math.max(0, Number(state?.lossPoolMinor ?? 0));
    this.cachedActiveBetEscrowMinor = Math.max(0, Number(state?.activeBetEscrowMinor ?? 0));
    this.cachedReservedLiquidityMinor = Math.max(0, Number(state?.reservedRewardLiquidityMinor ?? 0));
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
