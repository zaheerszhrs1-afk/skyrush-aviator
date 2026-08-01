import * as crypto from "node:crypto";
import mongoose from "mongoose";
import { calculatePayout } from "./accounting.js";
import { DemoBetModel, UserModel } from "./models.js";
import { fromMinor, toMinor } from "./money.js";
import type { BetSlot, PublicBet, RoundPhase } from "./types.js";

const BOT_COUNT = 75;
const DEFAULT_DEMO_BALANCE = 100_000;

interface DemoSettings {
  minBet: number;
  maxBet: number;
  maxCashoutMultiplier: number;
  commissionPercent: number;
}

interface RuntimeDemoBet extends PublicBet {
  userId?: string;
  targetCashout?: number;
}

export class DemoEngine {
  private readonly activeBets = new Map<string, Partial<Record<BetSlot, RuntimeDemoBet>>>();
  private publicBets: RuntimeDemoBet[] = [];
  private roundId = "";

  get startingBalance(): number {
    const configured = Number(process.env.DEMO_STARTING_BALANCE ?? DEFAULT_DEMO_BALANCE);
    return Number.isFinite(configured) && configured > 0 ? Number(configured.toFixed(2)) : DEFAULT_DEMO_BALANCE;
  }

  async initialize(): Promise<void> {
    await this.recoverInterruptedBets();
  }

  async prepareRound(roundId: string, settings: DemoSettings): Promise<void> {
    this.roundId = roundId;
    this.activeBets.clear();
    this.publicBets = this.createBots(roundId, settings);
  }

  getOnlineCount(connectedUsers: number): number {
    return BOT_COUNT + Math.max(0, connectedUsers);
  }

  getPublicBets(): PublicBet[] {
    return [...this.publicBets]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 160);
  }

  getActiveBets(userId: string): Partial<Record<BetSlot, PublicBet>> {
    return this.activeBets.get(userId) ?? {};
  }

  hasActiveBet(userId: string): boolean {
    const bets = this.activeBets.get(userId);
    return Boolean(bets?.left || bets?.right);
  }

  async getBalance(userId: string): Promise<number> {
    const user = await UserModel.findById(userId).select("demoBalanceMinor").lean();
    return fromMinor((user as any)?.demoBalanceMinor ?? toMinor(this.startingBalance));
  }

  async resetBalance(userId: string): Promise<number> {
    if (this.hasActiveBet(userId) || await DemoBetModel.exists({ userId, status: "ACTIVE" })) {
      throw new Error("Cash out or finish active demo bets before resetting the demo balance.");
    }
    const demoBalanceMinor = toMinor(this.startingBalance);
    const user = await UserModel.findOneAndUpdate(
      { _id: userId, role: "USER", status: "ACTIVE" },
      { $set: { demoBalanceMinor } },
      { new: true }
    ).select("demoBalanceMinor");
    if (!user) throw new Error("Demo balance can only be reset for an active user account.");
    return fromMinor((user as any).demoBalanceMinor);
  }

  async placeBet(input: {
    userId: string;
    slot: BetSlot;
    amount: number;
    phase: RoundPhase;
    settings: DemoSettings;
  }): Promise<{ ok: boolean; message: string }> {
    if (input.phase !== "WAITING") return { ok: false, message: "Demo betting is closed for this round." };
    if (!Number.isFinite(input.amount)) return { ok: false, message: "Invalid demo bet amount." };

    const amountMinor = toMinor(input.amount);
    if (amountMinor < toMinor(input.settings.minBet)) {
      return { ok: false, message: `Minimum demo bet is ${input.settings.minBet.toFixed(2)} PKR.` };
    }
    if (amountMinor > toMinor(input.settings.maxBet)) {
      return { ok: false, message: `Maximum demo bet is ${input.settings.maxBet.toFixed(2)} PKR.` };
    }
    if (this.activeBets.get(input.userId)?.[input.slot]) {
      return { ok: false, message: `A ${input.slot} demo bet is already active.` };
    }

    const user = await UserModel.findById(input.userId).select("name").lean();
    if (!user) return { ok: false, message: "User account not found." };

    const bet: RuntimeDemoBet = {
      id: crypto.randomUUID(),
      player: this.maskName(String(user.name)),
      amount: fromMinor(amountMinor),
      slot: input.slot,
      status: "ACTIVE",
      isDemo: true,
      guaranteedMaxMultiplier: input.settings.maxCashoutMultiplier,
      userId: input.userId
    };

    try {
      await mongoose.connection.transaction(async (session) => {
        const updatedUser = await UserModel.findOneAndUpdate(
          {
            _id: input.userId,
            role: "USER",
            status: "ACTIVE",
            demoBalanceMinor: { $gte: amountMinor }
          },
          { $inc: { demoBalanceMinor: -amountMinor } },
          { new: true, session }
        );
        if (!updatedUser) throw new Error("Insufficient demo balance.");

        await DemoBetModel.create(
          [{
            betId: bet.id,
            roundId: this.roundId,
            userId: input.userId,
            player: bet.player,
            slot: input.slot,
            amountMinor,
            amount: fromMinor(amountMinor),
            status: "ACTIVE"
          }],
          { session, ordered: true }
        );
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to place demo bet." };
    }

    const userBets = this.activeBets.get(input.userId) ?? {};
    userBets[input.slot] = bet;
    this.activeBets.set(input.userId, userBets);
    this.publicBets.push(bet);
    return { ok: true, message: "Demo bet placed successfully." };
  }

  async cashOut(input: {
    userId: string;
    slot: BetSlot;
    phase: RoundPhase;
    multiplier: number;
    settings: DemoSettings;
  }): Promise<{ ok: boolean; message: string }> {
    const bet = this.activeBets.get(input.userId)?.[input.slot];
    if (!bet) return { ok: false, message: "No active demo bet found." };
    if (input.phase !== "RUNNING") return { ok: false, message: "Demo cash-out is available while the plane is flying." };
    if (bet.status !== "ACTIVE") return { ok: false, message: "Demo bet has already been settled." };

    const lockedMultiplier = Math.min(
      input.settings.maxCashoutMultiplier,
      Math.max(1, Number(input.multiplier.toFixed(2)))
    );
    const payout = calculatePayout(toMinor(bet.amount), lockedMultiplier, input.settings.commissionPercent);

    try {
      await mongoose.connection.transaction(async (session) => {
        const updatedBet = await DemoBetModel.findOneAndUpdate(
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
        if (!updatedBet) throw new Error("Demo bet has already been settled.");

        const user = await UserModel.findOneAndUpdate(
          { _id: input.userId, role: "USER", status: "ACTIVE" },
          { $inc: { demoBalanceMinor: payout.payoutMinor } },
          { new: true, session }
        );
        if (!user) throw new Error("Demo user account is unavailable.");
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Unable to cash out demo bet." };
    }

    bet.status = "CASHED_OUT";
    bet.cashoutMultiplier = lockedMultiplier;
    bet.payout = fromMinor(payout.payoutMinor);
    const userBets = this.activeBets.get(input.userId);
    if (userBets) {
      delete userBets[input.slot];
      this.activeBets.set(input.userId, userBets);
    }
    return { ok: true, message: `Demo cash-out at ${lockedMultiplier.toFixed(2)}x.` };
  }

  onTick(phase: RoundPhase, multiplier: number): void {
    if (phase !== "RUNNING") return;
    for (const bet of this.publicBets) {
      if (!bet.isDemoBot || bet.status !== "ACTIVE" || !bet.targetCashout) continue;
      if (multiplier < bet.targetCashout) continue;
      bet.status = "CASHED_OUT";
      bet.cashoutMultiplier = bet.targetCashout;
      bet.payout = Number((bet.amount * bet.targetCashout).toFixed(2));
    }
  }

  async settleLosses(roundId: string): Promise<Set<string>> {
    const affectedUsers = new Set<string>();
    const active = await DemoBetModel.find({ roundId, status: "ACTIVE" }).select("userId betId").lean();
    if (active.length > 0) {
      await DemoBetModel.updateMany(
        { roundId, status: "ACTIVE" },
        { $set: { status: "LOST", settledAt: new Date() } }
      );
    }
    for (const item of active) affectedUsers.add(String(item.userId));

    for (const bet of this.publicBets) {
      if (bet.status === "ACTIVE") bet.status = "LOST";
    }
    for (const userId of affectedUsers) this.activeBets.delete(userId);
    return affectedUsers;
  }

  private createBots(roundId: string, settings: DemoSettings): RuntimeDemoBet[] {
    const bots: RuntimeDemoBet[] = [];
    for (let index = 0; index < BOT_COUNT; index += 1) {
      const randomA = this.seeded(roundId, index, "amount");
      const randomB = this.seeded(roundId, index, "target");
      const randomC = this.seeded(roundId, index, "slot");
      const amount = Math.max(
        settings.minBet,
        Math.min(settings.maxBet, Math.round((16 + randomA * 4_984) / 16) * 16)
      );
      const maxTarget = Math.max(1.1, Math.min(settings.maxCashoutMultiplier, 8));
      const targetCashout = Number((1.05 + randomB * (maxTarget - 1.05)).toFixed(2));
      bots.push({
        id: `demo-bot-${roundId}-${index + 1}`,
        player: `DemoBot ${String(index + 1).padStart(2, "0")}`,
        amount,
        slot: randomC > 0.5 ? "right" : "left",
        status: "ACTIVE",
        isDemo: true,
        isDemoBot: true,
        targetCashout
      });
    }
    return bots;
  }

  private async recoverInterruptedBets(): Promise<void> {
    const interrupted = await DemoBetModel.find({ status: "ACTIVE" }).lean();
    for (const bet of interrupted) {
      const amountMinor = Number((bet as any).amountMinor ?? 0);
      await mongoose.connection.transaction(async (session) => {
        const updated = await DemoBetModel.findOneAndUpdate(
          { _id: bet._id, status: "ACTIVE" },
          { $set: { status: "REFUNDED", settledAt: new Date() } },
          { new: true, session }
        );
        if (!updated) return;
        await UserModel.updateOne(
          { _id: bet.userId },
          { $inc: { demoBalanceMinor: amountMinor } },
          { session }
        );
      });
    }
  }

  private seeded(roundId: string, index: number, label: string): number {
    const hash = crypto.createHash("sha256").update(`${roundId}:${index}:${label}`).digest();
    return hash.readUInt32BE(0) / 0xffffffff;
  }

  private maskName(name: string): string {
    const clean = name.trim();
    if (clean.length <= 2) return `${clean.slice(0, 1) || "u"}***`;
    return `${clean.slice(0, 1)}***${clean.slice(-1)}`;
  }
}
