import * as crypto from "node:crypto";
import mongoose from "mongoose";
import type { Server } from "socket.io";
import { calculateMaximumLiability, calculatePayout } from "./accounting.js";
import { getWalletSnapshot } from "./finance.js";
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
import { processReferralBet } from "./referral.js";
import type { BetSlot, PublicBet, RoundHistoryItem, RoundPhase, RoundSnapshot, RoundTick, WalletSnapshot } from "./types.js";

const WAITING_MS = 8_000;
const CRASHED_MS = 3_000;
const TICK_MS = 50;
const SNAPSHOT_BROADCAST_MS = 750;
const MAX_CRASH = 1000;
const QUEUED_ROUND_ID = "__NEXT_ROUND__";

const isDuplicateKeyError = (error: unknown): boolean => {
  const candidate = error as { code?: number; message?: string };
  return candidate?.code === 11000 || /E11000 duplicate key/i.test(candidate?.message ?? "");
};

interface RuntimeSettings {
  houseEdgePercent: number;
  commissionPercent: number;
  reservePercent: number;
  minBet: number;
  maxBet: number;
  maxCashoutMultiplier: number;
  testModeEnabled: boolean;
  testCrashMultiplier: number;
}

const defaultSettings: RuntimeSettings = {
  houseEdgePercent: 1,
  commissionPercent: 10,
  reservePercent: 0,
  minBet: 16,
  maxBet: 100_000,
  maxCashoutMultiplier: 10,
  testModeEnabled: false,
  testCrashMultiplier: 2
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
  pendingRewardsDeltaMinor?: number;
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
    pendingRewardsDeltaMinor: input.pendingRewardsDeltaMinor ?? 0,
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

function wageringState(user: any, stakeMinor: number): {
  requirementBeforeMinor: number;
  requirementAfterMinor: number;
  targetMinor: number;
  completedBeforeMinor: number;
  completedAfterMinor: number;
  contributionMinor: number;
  pendingRewardsBeforeMinor: number;
} {
  const requirementBeforeMinor = Number.isSafeInteger(Number(user?.wagerRequirementMinor))
    ? Math.max(0, Number(user.wagerRequirementMinor))
    : 0;
  const targetMinor = Number.isSafeInteger(Number(user?.wagerTargetMinor))
    ? Math.max(requirementBeforeMinor, Number(user.wagerTargetMinor))
    : requirementBeforeMinor;
  const completedBeforeMinor = Number.isSafeInteger(Number(user?.wagerCompletedMinor))
    ? Math.min(targetMinor, Math.max(0, Number(user.wagerCompletedMinor)))
    : Math.max(0, targetMinor - requirementBeforeMinor);
  const pendingRewardsBeforeMinor = Number.isSafeInteger(Number(user?.pendingRewardsMinor))
    ? Math.max(0, Number(user.pendingRewardsMinor))
    : 0;
  const contributionMinor = Math.min(requirementBeforeMinor, Math.max(0, stakeMinor));
  const requirementAfterMinor = requirementBeforeMinor - contributionMinor;
  return {
    requirementBeforeMinor,
    requirementAfterMinor,
    targetMinor,
    completedBeforeMinor,
    completedAfterMinor: requirementAfterMinor === 0
      ? targetMinor
      : Math.min(targetMinor, completedBeforeMinor + contributionMinor),
    contributionMinor,
    pendingRewardsBeforeMinor
  };
}

export class GameEngine {
  private readonly io: Server;
  private readonly bots = new BotEngine();
  private phase: RoundPhase = "WAITING";
  private roundId = crypto.randomUUID();
  private serverSeed = crypto.randomBytes(32).toString("hex");
  private commit = this.hash(this.serverSeed);
  private crashPoint = 2;
  private multiplier = 1;
  private startedAt: number | null = null;
  private phaseEndsAt: number | null = Date.now() + WAITING_MS;
  private history: RoundHistoryItem[] = [];
  private bets: PublicBet[] = [];
  private activeBets = new Map<string, Partial<Record<BetSlot, PublicBet>>>();
  private queuedBets = new Map<string, Partial<Record<BetSlot, PublicBet>>>();
  private socketUsers = new Map<string, string>();
  private settings: RuntimeSettings = defaultSettings;
  private cachedLossPoolMinor = 0;
  private cachedActiveBetEscrowMinor = 0;
  private cachedReservedLiquidityMinor = 0;
  private roundSettled = false;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private lastSnapshotBroadcastAt = 0;
  private readonly pendingWalletRefreshes = new Set<string>();

  constructor(io: Server) {
    this.io = io;
  }

  async initialize(): Promise<void> {
    await this.recoverInterruptedBets();
    const recentRounds = await GameRoundModel.find({ phase: "CRASHED" })
      .sort({ crashedAt: -1 })
      .limit(30)
      .select("roundId crashPoint crashedAt createdAt")
      .lean();
    this.history = recentRounds.map((round) => ({
      roundId: String(round.roundId),
      crashPoint: Number(round.crashPoint),
      crashedAt: new Date(round.crashedAt ?? round.createdAt ?? Date.now()).getTime()
    }));
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

  connectPublic(socketId: string): void {
    this.socketUsers.set(socketId, "");
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
      online: this.socketUsers.size,
      automatedOnline: this.bots.getAutomatedParticipantCount(),
      houseEdgePercent: this.settings.houseEdgePercent,
      lossPool: fromMinor(this.cachedLossPoolMinor),
      commissionPercent: this.settings.commissionPercent,
      activeBetEscrow: fromMinor(this.cachedActiveBetEscrowMinor),
      reservedRewardLiquidity: fromMinor(this.cachedReservedLiquidityMinor),
      availableRewardLiquidity: fromMinor(availableRewardLiquidityMinor),
      testMode: this.settings.testModeEnabled
    };
  }

  getTick(): RoundTick {
    return {
      roundId: this.roundId,
      phase: this.phase,
      multiplier: this.multiplier,
      phaseEndsAt: this.phaseEndsAt,
      startedAt: this.startedAt,
      crashPoint: this.phase === "CRASHED" ? this.crashPoint : undefined
    };
  }

  async getWallet(userId: string): Promise<WalletSnapshot> {
    const wallet = await getWalletSnapshot(userId);
    const queuedDocuments = await GameBetModel.find({
      userId,
      roundId: QUEUED_ROUND_ID,
      status: "QUEUED"
    }).lean();
    const queuedBets: Partial<Record<BetSlot, PublicBet>> = {};
    for (const document of queuedDocuments) {
      const amountMinor = Number(document.amountMinor ?? toMinor(Number(document.amount)));
      const reservedLiabilityMinor = Number(document.reservedLiabilityMinor ?? 0);
      queuedBets[document.slot as BetSlot] = {
        id: String(document.betId),
        player: String(document.player),
        amount: fromMinor(amountMinor),
        slot: document.slot as BetSlot,
        status: "QUEUED",
        guaranteedMaxMultiplier: amountMinor > 0
          ? Number((1 + reservedLiabilityMinor / amountMinor).toFixed(2))
          : this.settings.maxCashoutMultiplier
      };
    }
    if (Object.keys(queuedBets).length > 0) this.queuedBets.set(userId, queuedBets);
    else this.queuedBets.delete(userId);

    return {
      ...wallet,
      activeBets: this.activeBets.get(userId) ?? {},
      queuedBets,
    };
  }

  async placeBet(
    userId: string,
    slot: BetSlot,
    amountInput: number,
    playerName?: string
  ): Promise<{ ok: boolean; message: string; queued?: boolean }> {
    const queueForNextRound = this.phase !== "WAITING";
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
    if (this.queuedBets.get(userId)?.[slot]) return { ok: false, message: `A ${slot} bet is already accepted for the next round.` };

    let resolvedPlayerName = playerName?.trim() ?? "";
    if (!resolvedPlayerName) {
      const user = await UserModel.findById(userId).select("name").lean();
      if (!user) return { ok: false, message: "User account not found." };
      resolvedPlayerName = String(user.name);
    }

    const reservedLiabilityMinor = calculateMaximumLiability(amountMinor, this.settings.maxCashoutMultiplier);
    let effectiveBetReserve = reservedLiabilityMinor;
    const bet: PublicBet = {
      id: crypto.randomUUID(),
      player: this.maskName(resolvedPlayerName),
      amount: fromMinor(amountMinor),
      slot,
      status: queueForNextRound ? "QUEUED" : "ACTIVE",
      guaranteedMaxMultiplier: this.settings.maxCashoutMultiplier
    };
    let userAfter: any;

    try {
      let stateAfter: any;
      await mongoose.connection.transaction(async (session) => {
        if (queueForNextRound) {
          stateAfter = await PlatformStateModel.findOneAndUpdate(
            { key: "global" },
            { $inc: { activeBetEscrowMinor: amountMinor } },
            { new: true, session }
          );
          if (!stateAfter) throw new Error("Platform accounting state is unavailable.");
        } else {
          const allocatableFactor = Math.max(0, 1 - this.settings.reservePercent / 100);
          stateAfter = await PlatformStateModel.findOneAndUpdate(
            {
              key: "global",
              $expr: {
                $gte: [
                  {
                    $subtract: [
                      { $floor: { $multiply: ["$lossPoolMinor", allocatableFactor] } },
                      "$reservedRewardLiquidityMinor"
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
            bet.guaranteedMaxMultiplier = 1.00;
            effectiveBetReserve = 0;
            stateAfter = await PlatformStateModel.findOneAndUpdate(
              { key: "global" },
              {
                $inc: {
                  activeBetEscrowMinor: amountMinor,
                  totalBetVolumeMinor: amountMinor
                }
              },
              { new: true, session }
            );
          }
          if (!stateAfter) throw new Error("Platform accounting state is unavailable.");
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
        userAfter = updatedUser;

        await GameBetModel.create(
          [{
            betId: bet.id,
            roundId: queueForNextRound ? QUEUED_ROUND_ID : this.roundId,
            userId,
            player: bet.player,
            slot,
            amountMinor,
            reservedLiabilityMinor: queueForNextRound ? reservedLiabilityMinor : effectiveBetReserve,
            amount: fromMinor(amountMinor),
            status: queueForNextRound ? "QUEUED" : "ACTIVE"
          }],
          { session, ordered: true }
        );

        if (!queueForNextRound) {
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
        }

        await WalletTransactionModel.create(
          [walletTransaction({
            userId,
            type: "BET_ESCROW_LOCK" as const,
            amountMinor: -amountMinor,
            availableDeltaMinor: -amountMinor,
            bettingLockedDeltaMinor: amountMinor,
            user: updatedUser,
            referenceId: bet.id,
            description: queueForNextRound
              ? "Bet stake locked and accepted for the next round"
              : `Bet stake locked in escrow for round ${this.roundId}`,
            metadata: {
              roundId: queueForNextRound ? QUEUED_ROUND_ID : this.roundId,
              queuedForNextRound: queueForNextRound,
              slot,
              reservedLiabilityMinor,
              guaranteedMaxMultiplier: this.settings.maxCashoutMultiplier
            }
          })],
          { session, ordered: true }
        );

        await PlatformAuditModel.create(
          [{
            eventKey: `bet-lock:${bet.id}`,
            type: "BET_ESCROW_LOCK" as const,
            userId: new mongoose.Types.ObjectId(userId),
            roundId: queueForNextRound ? QUEUED_ROUND_ID : this.roundId,
            betId: bet.id,
            activeBetEscrowDeltaMinor: amountMinor,
            reservedLiquidityDeltaMinor: queueForNextRound ? 0 : reservedLiabilityMinor,
            activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
            reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
            lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
            commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
            description: queueForNextRound
              ? `Accepted ${fromMinor(amountMinor).toFixed(2)} PKR bet for the next round; payout liquidity will be reserved when the round opens`
              : `Locked ${fromMinor(amountMinor).toFixed(2)} PKR stake and reserved ${fromMinor(reservedLiabilityMinor).toFixed(2)} PKR winner liquidity`
          }],
          { session, ordered: true }
        );
      });

      this.updateAccountingCache(stateAfter);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        this.scheduleWalletRefresh(userId);
        return {
          ok: false,
          message: queueForNextRound
            ? `A ${slot} bet is already accepted for the next round.`
            : `A ${slot} bet is already active for this round.`
        };
      }
      return { ok: false, message: error instanceof Error ? error.message : "Unable to place bet." };
    }

    if (queueForNextRound) {
      const userQueuedBets = this.queuedBets.get(userId) ?? {};
      userQueuedBets[slot] = bet;
      this.queuedBets.set(userId, userQueuedBets);
    } else {
      const userBets = this.activeBets.get(userId) ?? {};
      userBets[slot] = bet;
      this.activeBets.set(userId, userBets);
      this.bets.push(bet);
    }
    this.emitWalletPatchForUser(userId, userAfter);
    this.emitState();
    this.scheduleWalletRefresh(userId);
    return queueForNextRound
      ? { ok: true, queued: true, message: "Bet accepted for the next round. Funds are locked until it opens." }
      : { ok: true, queued: false, message: "Bet placed with payout liquidity reserved." };
  }

  async cancelQueuedBet(userId: string, slot: BetSlot): Promise<{ ok: boolean; message: string }> {
    const queuedDocument = await GameBetModel.findOne({
      userId,
      slot,
      roundId: QUEUED_ROUND_ID,
      status: "QUEUED"
    }).lean();
    if (!queuedDocument) return { ok: false, message: "No queued bet is available to cancel." };

    try {
      const refunded = await this.refundQueuedBet(queuedDocument, "Cancelled by the player before the next round");
      if (!refunded) {
        this.scheduleWalletRefresh(userId);
        return { ok: false, message: "That queued bet is already being processed." };
      }

      await this.emitWalletForUser(userId);
      this.emitState();
      this.emitToUser(userId, "bet:queue-result", {
        ok: true,
        slot,
        message: "Queued bet cancelled and funds returned to your wallet."
      });
      return { ok: true, message: "Queued bet cancelled and funds returned to your wallet." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to cancel queued bet." };
    }
  }

  async cashOut(userId: string, slot: BetSlot): Promise<{ ok: boolean; message: string }> {
    const bet = this.activeBets.get(userId)?.[slot];
    if (!bet) return { ok: false, message: "No active bet found." };
    if (this.phase !== "RUNNING") return { ok: false, message: "Cash-out is available while the plane is flying." };
    if (bet.status !== "ACTIVE") return { ok: false, message: "Bet has already been settled." };

    const lockedMultiplier = Math.min(
      bet.guaranteedMaxMultiplier ?? this.settings.maxCashoutMultiplier,
      Math.max(1, Number(this.multiplier.toFixed(2)))
    );
    const amountMinor = toMinor(bet.amount);
    const payout = calculatePayout(amountMinor, lockedMultiplier, this.settings.commissionPercent);
    let userAfter: any;

    try {
      let stateAfter: any;
      await mongoose.connection.transaction(async (session) => {
        const updatedUser = await UserModel.findOne({
          _id: userId,
          bettingLockedMinor: { $gte: amountMinor }
        }).session(session);
        if (!updatedUser) throw new Error("Bet escrow is inconsistent for this user.");

        const wager = wageringState(updatedUser, amountMinor);
        const lockedCurrentProfitMinor = wager.requirementAfterMinor > 0 ? payout.netProfitMinor : 0;
        const availablePayoutMinor = payout.payoutMinor - lockedCurrentProfitMinor;
        const releasedPendingMinor = wager.requirementAfterMinor === 0
          ? wager.pendingRewardsBeforeMinor
          : 0;
        const availableBeforeMinor = minorFromDocument(updatedUser, "balanceMinor", "balance");
        const bettingLockedBeforeMinor = Number((updatedUser as any).bettingLockedMinor ?? 0);

        const dbBet = await GameBetModel.findOneAndUpdate(
          { betId: bet.id, status: "ACTIVE" },
          {
            $set: {
              status: "CASHED_OUT",
              cashoutMultiplier: lockedMultiplier,
              payoutMinor: payout.payoutMinor,
              commissionMinor: payout.commissionMinor,
              wagerContributionMinor: wager.contributionMinor,
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

        (updatedUser as any).balanceMinor = availableBeforeMinor + availablePayoutMinor + releasedPendingMinor;
        (updatedUser as any).balance = fromMinor((updatedUser as any).balanceMinor);
        (updatedUser as any).bettingLockedMinor = bettingLockedBeforeMinor - amountMinor;
        (updatedUser as any).pendingRewardsMinor =
          wager.pendingRewardsBeforeMinor + lockedCurrentProfitMinor - releasedPendingMinor;
        (updatedUser as any).wagerRequirementMinor = wager.requirementAfterMinor;
        (updatedUser as any).wagerTargetMinor = wager.targetMinor;
        (updatedUser as any).wagerCompletedMinor = wager.completedAfterMinor;
        (updatedUser as any).wagerTrackingVersion = 2;
        await updatedUser.save({ session });
        userAfter = updatedUser;

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

        const walletEntries: WalletTransactionInputDocument[] = [walletTransaction({
          userId,
          type: "CASHOUT_CREDIT",
          amountMinor: payout.payoutMinor,
          availableDeltaMinor: availablePayoutMinor,
          bettingLockedDeltaMinor: -amountMinor,
          pendingRewardsDeltaMinor: lockedCurrentProfitMinor,
          user: updatedUser,
          referenceId: bet.id,
          description: lockedCurrentProfitMinor > 0
            ? `Cashed out at ${lockedMultiplier.toFixed(2)}x; ${fromMinor(lockedCurrentProfitMinor).toFixed(2)} PKR profit locked until wagering is completed`
            : `Cashed out at ${lockedMultiplier.toFixed(2)}x; commission ${fromMinor(payout.commissionMinor).toFixed(2)} PKR`,
          metadata: {
            roundId: this.roundId,
            slot,
            multiplier: lockedMultiplier,
            stakeMinor: amountMinor,
            grossProfitMinor: payout.grossProfitMinor,
            netProfitMinor: payout.netProfitMinor,
            commissionMinor: payout.commissionMinor,
            wagerContributionMinor: wager.contributionMinor,
            wagerRequirementBeforeMinor: wager.requirementBeforeMinor,
            wagerRequirementAfterMinor: wager.requirementAfterMinor,
            wagerTargetMinor: wager.targetMinor,
            wagerCompletedAfterMinor: wager.completedAfterMinor,
            lockedCurrentProfitMinor
          }
        })];

        if (releasedPendingMinor > 0) {
          walletEntries.push(walletTransaction({
            userId,
            type: "WAGER_REWARD_UNLOCK",
            amountMinor: releasedPendingMinor,
            availableDeltaMinor: releasedPendingMinor,
            pendingRewardsDeltaMinor: -releasedPendingMinor,
            user: updatedUser,
            referenceId: bet.id,
            description: `Wagering completed; unlocked ${fromMinor(releasedPendingMinor).toFixed(2)} PKR previous winnings`,
            metadata: { roundId: this.roundId, wagerRequirementAfterMinor: 0 }
          }));
        }

        await WalletTransactionModel.create(walletEntries, { session, ordered: true });

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
          { session, ordered: true }
        );
        await processReferralBet({ bettorId: userId, betId: bet.id, stakeMinor: amountMinor, session });
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

    this.emitWalletPatchForUser(userId, userAfter);
    this.emitState();
    this.scheduleWalletRefresh(userId);
    return { ok: true, message: `Cashed out at ${lockedMultiplier.toFixed(2)}x.` };
  }

  private scheduleWalletRefresh(userId: string): void {
    if (this.pendingWalletRefreshes.has(userId)) return;
    this.pendingWalletRefreshes.add(userId);
    void this.emitWalletForUser(userId)
      .catch((error) => {
        console.error(`[wallet-refresh] user=${userId}`, error);
      })
      .finally(() => {
        this.pendingWalletRefreshes.delete(userId);
      });
  }

  private emitWalletPatchForUser(userId: string, user: any): void {
    if (!user) return;
    const balanceMinor = minorFromDocument(user, "balanceMinor", "balance");
    const withdrawalLockedMinor = minorFromDocument(user, "withdrawalLockedMinor", "lockedBalance");
    const bettingLockedMinor = Math.max(0, Number(user?.bettingLockedMinor ?? 0));
    const pendingRewardsMinor = Math.max(0, Number(user?.pendingRewardsMinor ?? 0));
    const wagerRequirementMinor = Math.max(0, Number(user?.wagerRequirementMinor ?? 0));
    const wagerTargetMinor = Math.max(wagerRequirementMinor, Number(user?.wagerTargetMinor ?? wagerRequirementMinor));
    const wagerCompletedMinor = Math.min(
      wagerTargetMinor,
      Math.max(0, Number(user?.wagerCompletedMinor ?? wagerTargetMinor - wagerRequirementMinor))
    );
    const patch: Partial<WalletSnapshot> = {
      balance: fromMinor(balanceMinor),
      lockedBalance: fromMinor(withdrawalLockedMinor),
      bettingLockedBalance: fromMinor(bettingLockedMinor),
      pendingRewards: fromMinor(pendingRewardsMinor),
      wagerRequirementRemaining: fromMinor(wagerRequirementMinor),
      wagerRequirementTarget: fromMinor(wagerTargetMinor),
      wagerRequirementCompleted: fromMinor(wagerCompletedMinor),
      totalBalance: fromMinor(balanceMinor + withdrawalLockedMinor + bettingLockedMinor + pendingRewardsMinor),
      activeBets: this.activeBets.get(userId) ?? {},
      queuedBets: this.queuedBets.get(userId) ?? {}
    };
    for (const [socketId, connectedUserId] of this.socketUsers.entries()) {
      if (connectedUserId === userId) this.io.to(socketId).emit("wallet:patch", patch);
    }
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
      let forceSnapshot = false;
      let crashJustTriggered = false;

      if (this.phase === "WAITING" && this.phaseEndsAt && now >= this.phaseEndsAt) {
        // Use the scheduled deadline as the authoritative start timestamp. A
        // timer callback can run a few milliseconds late under load; using
        // `now` made clients wait at 0 and then receive a plane already partway
        // through its path.
        const scheduledStartAt = this.phaseEndsAt;
        this.phase = "RUNNING";
        this.startedAt = scheduledStartAt;
        this.phaseEndsAt = null;
        this.multiplier = 1;

        // Send the first running frame reliably. Normal 50 ms frames remain
        // volatile, but this phase-boundary packet must never be dropped.
        const startedTick = this.getTick();
        this.io.emit("round:started", startedTick);
        this.io.emit("round:tick", startedTick);

        // Do not send the large round snapshot in the same frame as takeoff;
        // it can briefly block rendering on mobile. The regular snapshot will
        // follow after the configured broadcast interval.
        this.lastSnapshotBroadcastAt = now;

        // Persist outside the real-time path so Atlas latency cannot delay the
        // visible start of the round.
        void GameRoundModel.updateOne(
          { roundId: this.roundId },
          { $set: { phase: "RUNNING", startedAt: new Date(scheduledStartAt) } }
        ).catch((error) => console.error(`[round-start-persist] round=${this.roundId}`, error));
      }

      if (this.phase === "RUNNING" && this.startedAt) {
        const elapsed = now - this.startedAt;
        this.multiplier = Number(Math.exp(elapsed * 0.00006).toFixed(2));

        if (this.multiplier >= this.crashPoint) {
          this.multiplier = this.crashPoint;
          this.phase = "CRASHED";
          this.phaseEndsAt = null;
          this.roundSettled = false;
          crashJustTriggered = true;
          forceSnapshot = true;
        }
      }

      if (crashJustTriggered) {
        // The crash boundary is a final result, not a disposable animation
        // frame. Send it reliably before settlement queries so every client
        // switches to the exact authoritative multiplier immediately.
        this.io.emit("round:tick", this.getTick());
      }

      this.bots.onTick(this.phase, this.multiplier);

      if (this.phase === "CRASHED" && !this.roundSettled) {
        await this.settleLosses();
        this.bots.settleLosses();
        this.roundSettled = true;
        this.phaseEndsAt = Date.now() + CRASHED_MS;
        this.history = [{
          roundId: this.roundId,
          crashPoint: this.multiplier,
          crashedAt: Date.now()
        }, ...this.history].slice(0, 30);
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
        forceSnapshot = true;
      }

      if (this.phase === "CRASHED" && this.roundSettled && this.phaseEndsAt && now >= this.phaseEndsAt) {
        await this.prepareRound();
        forceSnapshot = true;
      }

      this.emitTick();
      if (forceSnapshot || now - this.lastSnapshotBroadcastAt >= SNAPSHOT_BROADCAST_MS) {
        this.emitState();
      }
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
    const naturalCrash = Math.min(
      this.settings.maxCashoutMultiplier,
      this.calculateCrashPoint(this.serverSeed, this.roundId, this.settings.houseEdgePercent)
    );
    const allocatableFactor = Math.max(0, 1 - this.settings.reservePercent / 100);
    const availablePoolMinor = Math.max(
      0,
      Math.floor(this.cachedLossPoolMinor * allocatableFactor) - this.cachedReservedLiquidityMinor
    );
    const pendingLiabilityMinor = [...this.queuedBets.values()]
      .flatMap((slots) => Object.values(slots))
      .reduce((sum, bet) => sum + calculateMaximumLiability(toMinor(bet.amount), this.settings.maxCashoutMultiplier), 0);
    this.crashPoint = this.settings.testModeEnabled
      ? Math.min(this.settings.maxCashoutMultiplier, Math.max(1, Number(this.settings.testCrashMultiplier.toFixed(2))))
      : availablePoolMinor < pendingLiabilityMinor ? 1.00 : naturalCrash;
    this.multiplier = 1;
    this.startedAt = null;
    this.phaseEndsAt = Date.now() + WAITING_MS;
    this.bets = [];
    this.activeBets.clear();
    this.roundSettled = false;

    this.bots.prepareRound(this.roundId, this.settings);

    await GameRoundModel.create({
      roundId: this.roundId,
      commit: this.commit,
      serverSeed: this.serverSeed,
      crashPoint: this.crashPoint,
      naturalCrashPoint: naturalCrash,
      maxCashoutMultiplier: this.settings.maxCashoutMultiplier,
      liquidityLimited: this.crashPoint !== naturalCrash,
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

    await this.activateQueuedBetsForCurrentRound();
  }

  private async activateQueuedBetsForCurrentRound(): Promise<void> {
    const queuedDocuments = await GameBetModel.find({
      roundId: QUEUED_ROUND_ID,
      status: "QUEUED"
    }).sort({ createdAt: 1 }).lean();

    if (queuedDocuments.length === 0) return;

    const affectedUsers = new Set<string>();
    for (const queuedDocument of queuedDocuments) {
      const userId = String(queuedDocument.userId);
      const slot = queuedDocument.slot as BetSlot;
      const amountMinor = Number(queuedDocument.amountMinor ?? toMinor(Number(queuedDocument.amount)));
      const reservedLiabilityMinor = Number(queuedDocument.reservedLiabilityMinor ?? 0);
      let activeDocument: any;

      try {
        await mongoose.connection.transaction(async (session) => {
          const allocatableFactor = Math.max(0, 1 - this.settings.reservePercent / 100);
          const currentState = await PlatformStateModel.findOne({ key: "global" }).session(session);
          const availableMinor = Math.max(
            0,
            Math.floor(Number(currentState?.lossPoolMinor ?? 0) * allocatableFactor) -
              Number(currentState?.reservedRewardLiquidityMinor ?? 0)
          );
          const hasLiquidity = availableMinor >= reservedLiabilityMinor;
          const effectiveReserve = hasLiquidity ? reservedLiabilityMinor : 0;
          const stateAfter = await PlatformStateModel.findOneAndUpdate(
            { key: "global" },
            {
              $inc: {
                reservedRewardLiquidityMinor: effectiveReserve,
                totalBetVolumeMinor: amountMinor
              }
            },
            { new: true, session }
          );
          if (!stateAfter) throw new Error("Platform accounting state is unavailable.");

          activeDocument = await GameBetModel.findOneAndUpdate(
            { _id: queuedDocument._id, roundId: QUEUED_ROUND_ID, status: "QUEUED" },
            { $set: { roundId: this.roundId, status: "ACTIVE", reservedLiabilityMinor: effectiveReserve } },
            { new: true, session }
          );
          if (!activeDocument) throw new Error("Queued bet has already been processed.");

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

          await PlatformAuditModel.create(
            [{
              eventKey: `queued-bet-activated:${String(queuedDocument.betId)}`,
              type: "BET_ESCROW_LOCK" as const,
              userId: queuedDocument.userId,
              roundId: this.roundId,
              betId: String(queuedDocument.betId),
              reservedLiquidityDeltaMinor: reservedLiabilityMinor,
              activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
              reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
              lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
              commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
              description: `Activated queued bet and reserved ${fromMinor(reservedLiabilityMinor).toFixed(2)} PKR payout liquidity`
            }],
            { session, ordered: true }
          );
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to process queued bet.";
        await this.refundQueuedBet(queuedDocument, message);
        this.emitToUser(userId, "bet:queue-result", { ok: false, slot, message });
        affectedUsers.add(userId);
        continue;
      }

      const activatedReserve = Number(activeDocument.reservedLiabilityMinor ?? 0);
      const activeBet: PublicBet = {
        id: String(activeDocument.betId),
        player: String(activeDocument.player),
        amount: fromMinor(amountMinor),
        slot,
        status: "ACTIVE",
        guaranteedMaxMultiplier: activatedReserve > 0
          ? Number((1 + activatedReserve / Math.max(1, amountMinor)).toFixed(2))
          : 1.00
      };

      const userActiveBets = this.activeBets.get(userId) ?? {};
      userActiveBets[slot] = activeBet;
      this.activeBets.set(userId, userActiveBets);
      this.bets.push(activeBet);

      const userQueuedBets = this.queuedBets.get(userId);
      if (userQueuedBets) {
        delete userQueuedBets[slot];
        if (Object.keys(userQueuedBets).length === 0) this.queuedBets.delete(userId);
        else this.queuedBets.set(userId, userQueuedBets);
      }
      this.emitToUser(userId, "bet:queue-result", {
        ok: true,
        slot,
        message: "Queued bet is now active in the new round."
      });
      affectedUsers.add(userId);
    }

    await this.refreshAccountingCache();
    for (const userId of affectedUsers) await this.emitWalletForUser(userId);
  }

  private async refundQueuedBet(queuedDocument: any, reason: string): Promise<boolean> {
    const amountMinor = Number(queuedDocument.amountMinor ?? toMinor(Number(queuedDocument.amount)));
    let refunded = false;
    let stateAfter: any;

    await mongoose.connection.transaction(async (session) => {
      const refundedBet = await GameBetModel.findOneAndUpdate(
        { _id: queuedDocument._id, roundId: QUEUED_ROUND_ID, status: "QUEUED" },
        {
          $set: {
            status: "REFUNDED",
            roundId: `__REFUNDED_NEXT_ROUND__:${String(queuedDocument.betId)}`,
            settledAt: new Date()
          }
        },
        { new: true, session }
      );
      if (!refundedBet) return;
      refunded = true;

      const updatedUser = await UserModel.findOneAndUpdate(
        { _id: queuedDocument.userId, bettingLockedMinor: { $gte: amountMinor } },
        {
          $inc: {
            balanceMinor: amountMinor,
            bettingLockedMinor: -amountMinor,
            balance: fromMinor(amountMinor)
          }
        },
        { new: true, session }
      );
      if (!updatedUser) throw new Error("Queued bet refund failed because the wallet escrow is inconsistent.");

      stateAfter = await PlatformStateModel.findOneAndUpdate(
        { key: "global", activeBetEscrowMinor: { $gte: amountMinor } },
        { $inc: { activeBetEscrowMinor: -amountMinor } },
        { new: true, session }
      );
      if (!stateAfter) throw new Error("Queued bet refund failed because platform escrow is inconsistent.");

      await WalletTransactionModel.create(
        [walletTransaction({
          userId: queuedDocument.userId,
          type: "BET_REFUND",
          amountMinor,
          availableDeltaMinor: amountMinor,
          bettingLockedDeltaMinor: -amountMinor,
          user: updatedUser,
          referenceId: String(queuedDocument.betId),
          description: `Queued bet refunded: ${reason}`,
          metadata: { queuedForNextRound: true, reason }
        })],
        { session, ordered: true }
      );

      await PlatformAuditModel.create(
        [{
          eventKey: `queued-bet-refund:${String(queuedDocument.betId)}`,
          type: "BET_REFUNDED" as const,
          userId: queuedDocument.userId,
          roundId: QUEUED_ROUND_ID,
          betId: String(queuedDocument.betId),
          activeBetEscrowDeltaMinor: -amountMinor,
          activeBetEscrowAfterMinor: Number(stateAfter.activeBetEscrowMinor),
          reservedLiquidityAfterMinor: Number(stateAfter.reservedRewardLiquidityMinor),
          lossPoolAfterMinor: Number(stateAfter.lossPoolMinor),
          commissionWalletAfterMinor: Number(stateAfter.commissionWalletMinor),
          description: `Refunded queued bet of ${fromMinor(amountMinor).toFixed(2)} PKR: ${reason}`
        }],
        { session, ordered: true }
      );
    });

    const userId = String(queuedDocument.userId);
    const slot = queuedDocument.slot as BetSlot;
    const userQueuedBets = this.queuedBets.get(userId);
    if (userQueuedBets) {
      delete userQueuedBets[slot];
      if (Object.keys(userQueuedBets).length === 0) this.queuedBets.delete(userId);
      else this.queuedBets.set(userId, userQueuedBets);
    }
    if (stateAfter) this.updateAccountingCache(stateAfter);
    return refunded;
  }

  private emitToUser(userId: string, event: string, payload: unknown): void {
    for (const [socketId, connectedUserId] of this.socketUsers.entries()) {
      if (connectedUserId === userId) this.io.to(socketId).emit(event, payload);
    }
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
    for (const userId of affectedUsers) this.scheduleWalletRefresh(userId);
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

      const updatedUser = await UserModel.findOne({
        _id: dbBet.userId,
        bettingLockedMinor: { $gte: amountMinor }
      }).session(session);
      if (!updatedUser) throw new Error(`Bet escrow mismatch for ${dbBet.betId}.`);

      const wager = wageringState(updatedUser, amountMinor);
      const releasedPendingMinor = wager.requirementAfterMinor === 0
        ? wager.pendingRewardsBeforeMinor
        : 0;
      const availableBeforeMinor = minorFromDocument(updatedUser, "balanceMinor", "balance");
      const bettingLockedBeforeMinor = Number((updatedUser as any).bettingLockedMinor ?? 0);

      (updatedUser as any).bettingLockedMinor = bettingLockedBeforeMinor - amountMinor;
      (updatedUser as any).wagerRequirementMinor = wager.requirementAfterMinor;
      (updatedUser as any).wagerTargetMinor = wager.targetMinor;
      (updatedUser as any).wagerCompletedMinor = wager.completedAfterMinor;
      (updatedUser as any).wagerTrackingVersion = 2;
      if (releasedPendingMinor > 0) {
        (updatedUser as any).pendingRewardsMinor = 0;
        (updatedUser as any).balanceMinor = availableBeforeMinor + releasedPendingMinor;
        (updatedUser as any).balance = fromMinor((updatedUser as any).balanceMinor);
      }
      await updatedUser.save({ session });

      (dbBet as any).wagerContributionMinor = wager.contributionMinor;
      await dbBet.save({ session });

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

      const walletEntries: WalletTransactionInputDocument[] = [walletTransaction({
        userId: dbBet.userId,
        type: "BET_LOSS",
        amountMinor: 0,
        bettingLockedDeltaMinor: -amountMinor,
        user: updatedUser,
        referenceId: dbBet.betId,
        description: `Lost stake moved atomically from bet escrow to the peer loss pool`,
        metadata: {
          roundId: this.roundId,
          amountMinor,
          wagerContributionMinor: wager.contributionMinor,
          wagerRequirementBeforeMinor: wager.requirementBeforeMinor,
          wagerRequirementAfterMinor: wager.requirementAfterMinor,
          wagerTargetMinor: wager.targetMinor,
          wagerCompletedAfterMinor: wager.completedAfterMinor
        }
      })];

      if (releasedPendingMinor > 0) {
        walletEntries.push(walletTransaction({
          userId: dbBet.userId,
          type: "WAGER_REWARD_UNLOCK",
          amountMinor: releasedPendingMinor,
          availableDeltaMinor: releasedPendingMinor,
          pendingRewardsDeltaMinor: -releasedPendingMinor,
          user: updatedUser,
          referenceId: dbBet.betId,
          description: `Wagering completed; unlocked ${fromMinor(releasedPendingMinor).toFixed(2)} PKR previous winnings`,
          metadata: { roundId: this.roundId, wagerRequirementAfterMinor: 0 }
        }));
      }

      await WalletTransactionModel.create(walletEntries, { session, ordered: true });

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
        { session, ordered: true }
      );
      await processReferralBet({ bettorId: String(dbBet.userId), betId: String(dbBet.betId), stakeMinor: amountMinor, session });
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
          { session, ordered: true }
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
          { session, ordered: true }
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
      maxCashoutMultiplier: Number(settings?.maxCashoutMultiplier ?? defaultSettings.maxCashoutMultiplier),
      testModeEnabled: Boolean((settings as any)?.testModeEnabled ?? defaultSettings.testModeEnabled),
      testCrashMultiplier: Number((settings as any)?.testCrashMultiplier ?? defaultSettings.testCrashMultiplier)
    };
  }

  getAdminControlState(): { planeOverrideEnabled: boolean; overrideCrashMultiplier: number; phase: string; multiplier: number; hasActiveBets: boolean } {
    return {
      planeOverrideEnabled: this.settings.testModeEnabled,
      overrideCrashMultiplier: this.settings.testCrashMultiplier,
      phase: this.phase,
      multiplier: this.multiplier,
      hasActiveBets: this.bets.some((bet) => bet.status === "ACTIVE") || this.activeBets.size > 0 || this.queuedBets.size > 0
    };
  }

  async updateAdminControl(input: { enabled?: boolean; crashMultiplier?: number; forceCrash?: boolean }): Promise<{ ok: boolean; message: string }> {
    const inMemoryRealBets = this.bets.some((bet) => bet.status === "ACTIVE") || this.activeBets.size > 0 || this.queuedBets.size > 0;
    if (input.crashMultiplier !== undefined && (!Number.isFinite(input.crashMultiplier) || input.crashMultiplier < 1 || input.crashMultiplier > 1000)) {
      return { ok: false, message: "Crash multiplier must be between 1.00x and 1000.00x." };
    }

    if (input.enabled !== undefined) this.settings.testModeEnabled = input.enabled;
    if (input.crashMultiplier !== undefined) this.settings.testCrashMultiplier = Number(input.crashMultiplier.toFixed(2));

    await PlatformSettingsModel.findOneAndUpdate(
      { key: "global" },
      { $set: { testModeEnabled: this.settings.testModeEnabled, testCrashMultiplier: this.settings.testCrashMultiplier } },
      { upsert: true, new: true }
    );

    if (input.forceCrash) {
      if (!this.settings.testModeEnabled) return { ok: false, message: "Enable plane override before forcing a crash." };
      if (this.phase !== "RUNNING") return { ok: false, message: "The plane can only be stopped while a round is running." };
      this.crashPoint = Math.max(1, Number(this.multiplier.toFixed(2)));
      return { ok: true, message: `Plane will crash at ${this.crashPoint.toFixed(2)}x.` };
    }

    return {
      ok: true,
      message: this.settings.testModeEnabled
        ? `Plane override enabled. Next round target is ${this.settings.testCrashMultiplier.toFixed(2)}x.`
        : "Plane override disabled. Provably-fair crash outcomes restored."
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

  private emitTick(): void {
    // Volatile frames are intentionally dropped for slow clients instead of
    // building a stale multiplier queue in memory or over the network.
    this.io.volatile.emit("round:tick", this.getTick());
  }

  private emitState(): void {
    this.lastSnapshotBroadcastAt = Date.now();
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
