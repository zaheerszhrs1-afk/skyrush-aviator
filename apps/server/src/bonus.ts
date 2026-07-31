import * as crypto from "node:crypto";
import mongoose from "mongoose";
import {
  BonusClaimModel,
  DepositRequestModel,
  GameBetModel,
  PlatformAuditModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WalletTransactionModel,
  WithdrawalRequestModel
} from "./models.js";
import { fromMinor, toMinor } from "./money.js";

export interface VipLevelRule {
  level: number;
  requiredDeposit: number;
  requiredTurnover: number;
  levelUpBonus: number;
  dailyWithdrawalLimit: number;
}

export interface MonthlyBonusRule {
  requiredDeposit: number;
  requiredTurnover: number;
  bonus: number;
}

export interface VipConfig {
  vipEnabled: boolean;
  vipLevelBonusEnabled: boolean;
  vipMonthlyBonusEnabled: boolean;
  vipWithdrawalLimitsEnabled: boolean;
  vipTimezone: string;
  monthlyClaimStartDay: number;
  monthlyClaimWindowHours: number;
  monthlyClaimForceOpen: boolean;
  vipLevels: VipLevelRule[];
  monthlyBonusRules: MonthlyBonusRule[];
}

export const DEFAULT_VIP_LEVELS: VipLevelRule[] = [
  { level: 0, requiredDeposit: 0, requiredTurnover: 0, levelUpBonus: 0, dailyWithdrawalLimit: 3 },
  { level: 1, requiredDeposit: 500, requiredTurnover: 5_000, levelUpBonus: 2, dailyWithdrawalLimit: 3 },
  { level: 2, requiredDeposit: 1_000, requiredTurnover: 10_000, levelUpBonus: 5, dailyWithdrawalLimit: 3 },
  { level: 3, requiredDeposit: 10_000, requiredTurnover: 100_000, levelUpBonus: 8, dailyWithdrawalLimit: 3 },
  { level: 4, requiredDeposit: 30_000, requiredTurnover: 300_000, levelUpBonus: 18, dailyWithdrawalLimit: 4 },
  { level: 5, requiredDeposit: 100_000, requiredTurnover: 1_000_000, levelUpBonus: 58, dailyWithdrawalLimit: 5 },
  { level: 6, requiredDeposit: 300_000, requiredTurnover: 3_000_000, levelUpBonus: 88, dailyWithdrawalLimit: 6 },
  { level: 7, requiredDeposit: 1_000_000, requiredTurnover: 10_000_000, levelUpBonus: 188, dailyWithdrawalLimit: 7 },
  { level: 8, requiredDeposit: 3_000_000, requiredTurnover: 30_000_000, levelUpBonus: 388, dailyWithdrawalLimit: 8 },
  { level: 9, requiredDeposit: 10_000_000, requiredTurnover: 100_000_000, levelUpBonus: 888, dailyWithdrawalLimit: 9 },
  { level: 10, requiredDeposit: 30_000_000, requiredTurnover: 300_000_000, levelUpBonus: 1_888, dailyWithdrawalLimit: 10 },
  { level: 11, requiredDeposit: 100_000_000, requiredTurnover: 1_000_000_000, levelUpBonus: 8_888, dailyWithdrawalLimit: 15 },
  { level: 12, requiredDeposit: 300_000_000, requiredTurnover: 3_000_000_000, levelUpBonus: 18_888, dailyWithdrawalLimit: -1 }
];

export const DEFAULT_MONTHLY_BONUS_RULES: MonthlyBonusRule[] = [
  { requiredDeposit: 600, requiredTurnover: 3_000, bonus: 50 },
  { requiredDeposit: 2_000, requiredTurnover: 10_000, bonus: 100 },
  { requiredDeposit: 6_000, requiredTurnover: 30_000, bonus: 200 },
  { requiredDeposit: 10_000, requiredTurnover: 50_000, bonus: 400 },
  { requiredDeposit: 20_000, requiredTurnover: 100_000, bonus: 700 },
  { requiredDeposit: 60_000, requiredTurnover: 300_000, bonus: 1_000 },
  { requiredDeposit: 100_000, requiredTurnover: 500_000, bonus: 1_500 },
  { requiredDeposit: 200_000, requiredTurnover: 1_000_000, bonus: 2_000 },
  { requiredDeposit: 600_000, requiredTurnover: 3_000_000, bonus: 2_800 },
  { requiredDeposit: 1_000_000, requiredTurnover: 5_000_000, bonus: 4_000 },
  { requiredDeposit: 2_000_000, requiredTurnover: 10_000_000, bonus: 6_000 },
  { requiredDeposit: 6_000_000, requiredTurnover: 30_000_000, bonus: 10_000 },
  { requiredDeposit: 10_000_000, requiredTurnover: 50_000_000, bonus: 20_000 }
];

const finite = (value: unknown, fallback: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function normalizeVipLevels(value: unknown): VipLevelRule[] {
  const input = Array.isArray(value) ? value : [];
  const mapped = input.map((item: any, index) => ({
    level: Math.min(12, Math.max(0, Math.floor(finite(item?.level, index)))),
    requiredDeposit: Math.max(0, finite(item?.requiredDeposit, 0)),
    requiredTurnover: Math.max(0, finite(item?.requiredTurnover, 0)),
    levelUpBonus: Math.max(0, finite(item?.levelUpBonus, 0)),
    dailyWithdrawalLimit: Math.max(-1, Math.floor(finite(item?.dailyWithdrawalLimit, 3)))
  }));
  const byLevel = new Map(mapped.map((item) => [item.level, item]));
  const result = DEFAULT_VIP_LEVELS.map((fallback) => ({ ...(byLevel.get(fallback.level) ?? fallback) }));
  result.sort((left, right) => left.level - right.level);
  for (let index = 1; index < result.length; index += 1) {
    result[index].requiredDeposit = Math.max(result[index - 1].requiredDeposit, result[index].requiredDeposit);
    result[index].requiredTurnover = Math.max(result[index - 1].requiredTurnover, result[index].requiredTurnover);
  }
  return result;
}

export function normalizeMonthlyBonusRules(value: unknown): MonthlyBonusRule[] {
  const input = Array.isArray(value) ? value : [];
  const mapped = input.map((item: any) => ({
    requiredDeposit: Math.max(0, finite(item?.requiredDeposit, 0)),
    requiredTurnover: Math.max(0, finite(item?.requiredTurnover, 0)),
    bonus: Math.max(0, finite(item?.bonus, 0))
  })).filter((item) => item.bonus > 0);
  const result = mapped.length > 0 ? mapped : DEFAULT_MONTHLY_BONUS_RULES.map((item) => ({ ...item }));
  result.sort((left, right) => left.requiredTurnover - right.requiredTurnover || left.requiredDeposit - right.requiredDeposit);
  return result;
}

export function normalizeVipTimezone(value: unknown): string {
  const candidate = String(value || "Asia/Karachi").trim() || "Asia/Karachi";
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "Asia/Karachi";
  }
}

export function vipConfigFromSettings(settings: any): VipConfig {
  return {
    vipEnabled: settings?.vipEnabled !== false,
    vipLevelBonusEnabled: settings?.vipLevelBonusEnabled !== false,
    vipMonthlyBonusEnabled: settings?.vipMonthlyBonusEnabled !== false,
    vipWithdrawalLimitsEnabled: settings?.vipWithdrawalLimitsEnabled !== false,
    vipTimezone: normalizeVipTimezone(settings?.vipTimezone),
    monthlyClaimStartDay: Math.min(28, Math.max(1, Math.floor(finite(settings?.monthlyClaimStartDay, 1)))),
    monthlyClaimWindowHours: Math.min(744, Math.max(1, Math.floor(finite(settings?.monthlyClaimWindowHours, 48)))),
    monthlyClaimForceOpen: settings?.monthlyClaimForceOpen === true,
    vipLevels: normalizeVipLevels(settings?.vipLevels),
    monthlyBonusRules: normalizeMonthlyBonusRules(settings?.monthlyBonusRules)
  };
}

export async function getVipConfig(): Promise<VipConfig> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  return vipConfigFromSettings(settings);
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((item) => [item.type, item.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
  const guessMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const guess = new Date(guessMs);
  const rendered = zonedParts(guess, timeZone);
  const renderedAsUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
  return new Date(guessMs - (renderedAsUtc - guessMs));
}

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function monthRange(now: Date, timeZone: string, offset = 0): { key: string; start: Date; end: Date } {
  const current = zonedParts(now, timeZone);
  const target = addMonths(current.year, current.month, offset);
  const next = addMonths(target.year, target.month, 1);
  return {
    key: `${target.year}-${String(target.month).padStart(2, "0")}`,
    start: zonedTimeToUtc({ year: target.year, month: target.month, day: 1, hour: 0, minute: 0, second: 0 }, timeZone),
    end: zonedTimeToUtc({ year: next.year, month: next.month, day: 1, hour: 0, minute: 0, second: 0 }, timeZone)
  };
}

function dayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const current = zonedParts(now, timeZone);
  const start = zonedTimeToUtc({ ...current, hour: 0, minute: 0, second: 0 }, timeZone);
  const nextDate = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  const end = zonedTimeToUtc({
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
  return { start, end };
}

async function aggregateMetrics(userId: string, range?: { start: Date; end: Date }): Promise<{ depositMinor: number; turnoverMinor: number }> {
  const depositFilter: Record<string, unknown> = { userId: new mongoose.Types.ObjectId(userId), status: "APPROVED" };
  const betFilter: Record<string, unknown> = {
    userId: new mongoose.Types.ObjectId(userId),
    status: { $in: ["CASHED_OUT", "LOST"] }
  };
  if (range) {
    depositFilter.$or = [
      { reviewedAt: { $gte: range.start, $lt: range.end } },
      { reviewedAt: { $exists: false }, createdAt: { $gte: range.start, $lt: range.end } }
    ];
    betFilter.$or = [
      { settledAt: { $gte: range.start, $lt: range.end } },
      { settledAt: { $exists: false }, updatedAt: { $gte: range.start, $lt: range.end } }
    ];
  }
  const [depositResult, turnoverResult] = await Promise.all([
    DepositRequestModel.aggregate([
      { $match: depositFilter },
      { $group: { _id: null, amountMinor: { $sum: { $ifNull: ["$amountMinor", { $round: [{ $multiply: ["$amount", 100] }, 0] }] } } } }
    ]),
    GameBetModel.aggregate([
      { $match: betFilter },
      { $group: { _id: null, amountMinor: { $sum: { $ifNull: ["$amountMinor", { $round: [{ $multiply: ["$amount", 100] }, 0] }] } } } }
    ])
  ]);
  return {
    depositMinor: Number(depositResult[0]?.amountMinor ?? 0),
    turnoverMinor: Number(turnoverResult[0]?.amountMinor ?? 0)
  };
}

export function calculateVipLevel(depositMinor: number, turnoverMinor: number, levels: VipLevelRule[]): number {
  let level = 0;
  for (const rule of levels) {
    if (depositMinor >= toMinor(rule.requiredDeposit) && turnoverMinor >= toMinor(rule.requiredTurnover)) level = rule.level;
  }
  return level;
}

function highestMonthlyBonus(metrics: { depositMinor: number; turnoverMinor: number }, rules: MonthlyBonusRule[]): MonthlyBonusRule | null {
  let matched: MonthlyBonusRule | null = null;
  for (const rule of rules) {
    if (metrics.depositMinor >= toMinor(rule.requiredDeposit) && metrics.turnoverMinor >= toMinor(rule.requiredTurnover)) matched = rule;
  }
  return matched;
}

function claimWindow(now: Date, config: VipConfig): { open: boolean; start: Date; end: Date; forced: boolean } {
  const current = zonedParts(now, config.vipTimezone);
  const start = zonedTimeToUtc({
    year: current.year,
    month: current.month,
    day: config.monthlyClaimStartDay,
    hour: 0,
    minute: 0,
    second: 0
  }, config.vipTimezone);
  const end = new Date(start.getTime() + config.monthlyClaimWindowHours * 60 * 60 * 1000);
  return {
    open: config.monthlyClaimForceOpen || (now >= start && now < end),
    start,
    end,
    forced: config.monthlyClaimForceOpen
  };
}

export async function getBonusDashboard(userId: string): Promise<any> {
  const [config, state, lifetimeMetrics] = await Promise.all([
    getVipConfig(),
    PlatformStateModel.findOne({ key: "global" }).lean(),
    aggregateMetrics(userId)
  ]);
  const now = new Date();
  const currentMonth = monthRange(now, config.vipTimezone, 0);
  const previousMonth = monthRange(now, config.vipTimezone, -1);
  const [currentMetrics, previousMetrics, claims] = await Promise.all([
    aggregateMetrics(userId, currentMonth),
    aggregateMetrics(userId, previousMonth),
    BonusClaimModel.find({ userId }).select("type vipLevel periodKey amount createdAt").sort({ createdAt: -1 }).lean()
  ]);
  const vipLevel = config.vipEnabled
    ? calculateVipLevel(lifetimeMetrics.depositMinor, lifetimeMetrics.turnoverMinor, config.vipLevels)
    : 0;
  const currentRule = config.vipLevels.find((item) => item.level === vipLevel) ?? config.vipLevels[0];
  const nextRule = config.vipLevels.find((item) => item.level === vipLevel + 1) ?? null;
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        vipLevel,
        vipLifetimeDepositMinor: lifetimeMetrics.depositMinor,
        vipLifetimeValidBetMinor: lifetimeMetrics.turnoverMinor
      }
    }
  );

  const claimedLevels = new Set<number>(
    claims.filter((item: any) => item.type === "LEVEL_UP").map((item: any) => Number(item.vipLevel))
  );
  const claimableLevels = config.vipLevelBonusEnabled
    ? config.vipLevels.filter((item) => item.level > 0 && item.level <= vipLevel && item.levelUpBonus > 0 && !claimedLevels.has(item.level))
    : [];
  const monthlyRule = highestMonthlyBonus(previousMetrics, config.monthlyBonusRules);
  const projectedMonthlyRule = highestMonthlyBonus(currentMetrics, config.monthlyBonusRules);
  const monthlyClaim = claims.find((item: any) => item.type === "MONTHLY" && item.periodKey === previousMonth.key);
  const window = claimWindow(now, config);

  const today = dayRange(now, config.vipTimezone);
  const usedWithdrawals = await WithdrawalRequestModel.countDocuments({
    userId,
    createdAt: { $gte: today.start, $lt: today.end },
    status: { $in: ["PENDING", "PROCESSING", "COMPLETED"] }
  });
  const dailyLimit = config.vipWithdrawalLimitsEnabled ? currentRule.dailyWithdrawalLimit : -1;

  return {
    ok: true,
    config,
    progress: {
      vipLevel,
      lifetimeDeposit: fromMinor(lifetimeMetrics.depositMinor),
      lifetimeValidBet: fromMinor(lifetimeMetrics.turnoverMinor),
      currentRule,
      nextRule,
      depositPercent: nextRule ? Math.min(100, (lifetimeMetrics.depositMinor / Math.max(1, toMinor(nextRule.requiredDeposit))) * 100) : 100,
      turnoverPercent: nextRule ? Math.min(100, (lifetimeMetrics.turnoverMinor / Math.max(1, toMinor(nextRule.requiredTurnover))) * 100) : 100
    },
    levelUp: {
      enabled: config.vipEnabled && config.vipLevelBonusEnabled,
      claimableLevels: claimableLevels.map((item) => item.level),
      claimableAmount: claimableLevels.reduce((sum, item) => sum + item.levelUpBonus, 0),
      claimedLevels: [...claimedLevels].sort((a, b) => a - b)
    },
    monthly: {
      enabled: config.vipEnabled && config.vipMonthlyBonusEnabled,
      currentPeriodKey: currentMonth.key,
      currentDeposit: fromMinor(currentMetrics.depositMinor),
      currentValidBet: fromMinor(currentMetrics.turnoverMinor),
      projectedBonus: projectedMonthlyRule?.bonus ?? 0,
      claimPeriodKey: previousMonth.key,
      claimDeposit: fromMinor(previousMetrics.depositMinor),
      claimValidBet: fromMinor(previousMetrics.turnoverMinor),
      eligibleBonus: monthlyRule?.bonus ?? 0,
      claimed: Boolean(monthlyClaim),
      claimedAt: (monthlyClaim as any)?.createdAt ?? null,
      claimOpen: window.open,
      claimWindowStart: window.start.toISOString(),
      claimWindowEnd: window.end.toISOString(),
      claimWindowForced: window.forced
    },
    withdrawal: {
      dailyLimit,
      unlimited: dailyLimit < 0,
      usedToday: usedWithdrawals,
      remainingToday: dailyLimit < 0 ? null : Math.max(0, dailyLimit - usedWithdrawals),
      timezone: config.vipTimezone
    },
    wallet: {
      bonusBudget: fromMinor((state as any)?.bonusWalletMinor ?? 0)
    },
    recentClaims: claims.slice(0, 20).map((item: any) => ({
      id: String(item._id),
      type: item.type,
      vipLevel: Number(item.vipLevel ?? 0),
      periodKey: String(item.periodKey ?? ""),
      amount: Number(item.amount ?? fromMinor(item.amountMinor ?? 0)),
      createdAt: item.createdAt
    }))
  };
}

async function creditBonus(input: {
  userId: string;
  type: "LEVEL_UP" | "MONTHLY";
  items: Array<{ claimKey: string; amountMinor: number; vipLevel: number; periodKey: string; metadata: Record<string, unknown> }>;
  description: string;
}): Promise<number> {
  const totalMinor = input.items.reduce((sum, item) => sum + item.amountMinor, 0);
  if (totalMinor <= 0) throw new Error("No bonus is available to claim.");
  await mongoose.connection.transaction(async (session) => {
    const existing = await BonusClaimModel.find({ claimKey: { $in: input.items.map((item) => item.claimKey) } })
      .session(session)
      .select("claimKey")
      .lean();
    if (existing.length > 0) throw new Error("This bonus has already been claimed.");

    const state = await PlatformStateModel.findOneAndUpdate(
      { key: "global", bonusWalletMinor: { $gte: totalMinor } },
      { $inc: { bonusWalletMinor: -totalMinor, totalBonusesPaidMinor: totalMinor } },
      { new: true, session }
    );
    if (!state) throw new Error("Bonus wallet has insufficient funds. Please contact support.");

    const user = await UserModel.findOneAndUpdate(
      { _id: input.userId, status: "ACTIVE" },
      { $inc: { balanceMinor: totalMinor, balance: fromMinor(totalMinor) } },
      { new: true, session }
    );
    if (!user) throw new Error("User account is unavailable.");

    const claims = await BonusClaimModel.create(input.items.map((item) => ({
      claimKey: item.claimKey,
      userId: new mongoose.Types.ObjectId(input.userId),
      type: input.type,
      amountMinor: item.amountMinor,
      amount: fromMinor(item.amountMinor),
      vipLevel: item.vipLevel,
      periodKey: item.periodKey,
      metadata: item.metadata
    })), { session });

    await WalletTransactionModel.create([{
      userId: new mongoose.Types.ObjectId(input.userId),
      type: "BONUS_CREDIT",
      amountMinor: totalMinor,
      availableDeltaMinor: totalMinor,
      withdrawalLockedDeltaMinor: 0,
      bettingLockedDeltaMinor: 0,
      pendingRewardsDeltaMinor: 0,
      balanceAfterMinor: Number((user as any).balanceMinor ?? 0),
      withdrawalLockedAfterMinor: Number((user as any).withdrawalLockedMinor ?? 0),
      bettingLockedAfterMinor: Number((user as any).bettingLockedMinor ?? 0),
      pendingRewardsAfterMinor: Number((user as any).pendingRewardsMinor ?? 0),
      amount: fromMinor(totalMinor),
      balanceAfter: fromMinor(Number((user as any).balanceMinor ?? 0)),
      lockedBalanceAfter: fromMinor(Number((user as any).withdrawalLockedMinor ?? 0)),
      referenceType: "BONUS",
      referenceId: claims.map((claim) => String(claim._id)).join(","),
      description: input.description,
      metadata: { type: input.type, items: input.items }
    }], { session });

    await PlatformAuditModel.create([{
      eventKey: `bonus:${crypto.randomUUID()}`,
      type: "BONUS_PAID" as const,
      userId: new mongoose.Types.ObjectId(input.userId),
      referenceId: claims.map((claim) => String(claim._id)).join(","),
      bonusWalletDeltaMinor: -totalMinor,
      activeBetEscrowAfterMinor: Number((state as any).activeBetEscrowMinor ?? 0),
      reservedLiquidityAfterMinor: Number((state as any).reservedRewardLiquidityMinor ?? 0),
      lossPoolAfterMinor: Number((state as any).lossPoolMinor ?? 0),
      commissionWalletAfterMinor: Number((state as any).commissionWalletMinor ?? 0),
      bonusWalletAfterMinor: Number((state as any).bonusWalletMinor ?? 0),
      description: input.description,
      metadata: { type: input.type, totalMinor, items: input.items }
    }], { session });
  });
  return totalMinor;
}

export async function claimLevelUpBonus(userId: string): Promise<{ amount: number }> {
  const dashboard = await getBonusDashboard(userId);
  if (!dashboard.config.vipEnabled || !dashboard.levelUp.enabled) throw new Error("VIP level-up bonuses are disabled.");
  const claimable = dashboard.config.vipLevels.filter((item: VipLevelRule) => dashboard.levelUp.claimableLevels.includes(item.level));
  const totalMinor = await creditBonus({
    userId,
    type: "LEVEL_UP",
    items: claimable.map((item: VipLevelRule) => ({
      claimKey: `LEVEL:${userId}:${item.level}`,
      amountMinor: toMinor(item.levelUpBonus),
      vipLevel: item.level,
      periodKey: "",
      metadata: { requiredDeposit: item.requiredDeposit, requiredTurnover: item.requiredTurnover }
    })),
    description: `VIP level-up bonus claimed for ${claimable.map((item: VipLevelRule) => `VIP${item.level}`).join(", ")}`
  });
  return { amount: fromMinor(totalMinor) };
}

export async function claimMonthlyBonus(userId: string): Promise<{ amount: number; periodKey: string }> {
  const dashboard = await getBonusDashboard(userId);
  if (!dashboard.config.vipEnabled || !dashboard.monthly.enabled) throw new Error("VIP monthly bonuses are disabled.");
  if (!dashboard.monthly.claimOpen) throw new Error("The monthly bonus claim window is currently closed.");
  if (dashboard.monthly.claimed) throw new Error("The monthly bonus for this period has already been claimed.");
  if (dashboard.monthly.eligibleBonus <= 0) throw new Error("The previous month did not meet a monthly bonus tier.");
  const amountMinor = toMinor(dashboard.monthly.eligibleBonus);
  const totalMinor = await creditBonus({
    userId,
    type: "MONTHLY",
    items: [{
      claimKey: `MONTHLY:${userId}:${dashboard.monthly.claimPeriodKey}`,
      amountMinor,
      vipLevel: dashboard.progress.vipLevel,
      periodKey: dashboard.monthly.claimPeriodKey,
      metadata: {
        deposit: dashboard.monthly.claimDeposit,
        validBet: dashboard.monthly.claimValidBet
      }
    }],
    description: `VIP monthly bonus claimed for ${dashboard.monthly.claimPeriodKey}`
  });
  return { amount: fromMinor(totalMinor), periodKey: dashboard.monthly.claimPeriodKey };
}

export async function enforceVipWithdrawalLimit(userId: string): Promise<void> {
  const config = await getVipConfig();
  if (!config.vipEnabled || !config.vipWithdrawalLimitsEnabled) return;
  const metrics = await aggregateMetrics(userId);
  const level = calculateVipLevel(metrics.depositMinor, metrics.turnoverMinor, config.vipLevels);
  const rule = config.vipLevels.find((item) => item.level === level) ?? config.vipLevels[0];
  if (rule.dailyWithdrawalLimit < 0) return;
  const range = dayRange(new Date(), config.vipTimezone);
  const used = await WithdrawalRequestModel.countDocuments({
    userId,
    createdAt: { $gte: range.start, $lt: range.end },
    status: { $in: ["PENDING", "PROCESSING", "COMPLETED"] }
  });
  if (used >= rule.dailyWithdrawalLimit) {
    throw new Error(`VIP${level} allows ${rule.dailyWithdrawalLimit} withdrawal request${rule.dailyWithdrawalLimit === 1 ? "" : "s"} per day.`);
  }
}

export async function fundBonusWallet(adminId: string, amount: number): Promise<{ bonusWallet: number }> {
  const amountMinor = toMinor(amount);
  if (amountMinor <= 0) throw new Error("Enter a valid bonus budget amount.");
  const state = await PlatformStateModel.findOneAndUpdate(
    { key: "global" },
    { $inc: { bonusWalletMinor: amountMinor, totalBonusFundingMinor: amountMinor } },
    { new: true, upsert: true }
  );
  await PlatformAuditModel.create({
    eventKey: `bonus-fund:${crypto.randomUUID()}`,
    type: "BONUS_BUDGET_FUNDED" as const,
    adminId: new mongoose.Types.ObjectId(adminId),
    bonusWalletDeltaMinor: amountMinor,
    activeBetEscrowAfterMinor: Number((state as any).activeBetEscrowMinor ?? 0),
    reservedLiquidityAfterMinor: Number((state as any).reservedRewardLiquidityMinor ?? 0),
    lossPoolAfterMinor: Number((state as any).lossPoolMinor ?? 0),
    commissionWalletAfterMinor: Number((state as any).commissionWalletMinor ?? 0),
    bonusWalletAfterMinor: Number((state as any).bonusWalletMinor ?? 0),
    description: `Admin added ${fromMinor(amountMinor).toFixed(2)} PKR to the VIP bonus wallet`,
    metadata: { amountMinor }
  });
  return { bonusWallet: fromMinor(Number((state as any).bonusWalletMinor ?? 0)) };
}

export async function adminBonusSummary(): Promise<any> {
  const [settings, state, claims] = await Promise.all([
    PlatformSettingsModel.findOne({ key: "global" }).lean(),
    PlatformStateModel.findOne({ key: "global" }).lean(),
    BonusClaimModel.find({}).populate("userId", "name email").sort({ createdAt: -1 }).limit(200).lean()
  ]);
  return {
    config: vipConfigFromSettings(settings),
    budget: {
      bonusWallet: fromMinor((state as any)?.bonusWalletMinor ?? 0),
      totalFunding: fromMinor((state as any)?.totalBonusFundingMinor ?? 0),
      totalPaid: fromMinor((state as any)?.totalBonusesPaidMinor ?? 0)
    },
    claims: claims.map((item: any) => ({
      id: String(item._id),
      userId: item.userId,
      type: item.type,
      amount: Number(item.amount ?? fromMinor(item.amountMinor ?? 0)),
      vipLevel: Number(item.vipLevel ?? 0),
      periodKey: String(item.periodKey ?? ""),
      createdAt: item.createdAt
    }))
  };
}
