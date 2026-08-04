import mongoose from "mongoose";
import {
  DepositRequestModel,
  GameBetModel,
  GameRoundModel,
  PlatformAuditModel,
  PlatformSettingsModel,
  PlatformStateModel,
  FaqModel,
  UserModel,
  WithdrawalRequestModel
} from "./models.js";
import { toMinor } from "./money.js";
import { DEFAULT_MONTHLY_BONUS_RULES, DEFAULT_REFERRAL_COMMISSION_RATES, DEFAULT_REFERRAL_INVITATION_RULES, DEFAULT_VIP_LEVELS } from "./bonus.js";

const safeMinor = (value: unknown): number => {
  const amount = Number(value ?? 0);
  return toMinor(Number.isFinite(amount) ? amount : 0);
};

const DEFAULT_FAQS = [
  { question: "How do I create a B9T9 account?", answer: "Choose Register, enter your name, email, phone number and a password, then submit the form. You can use your email or phone number to sign in later.", category: "Account", sortOrder: 10 },
  { question: "How do I deposit funds?", answer: "Open Wallet & payments, choose Deposit, select an available payment method and follow the instructions shown for your account.", category: "Payments", sortOrder: 20 },
  { question: "How do I place a bet?", answer: "Choose your stake in the game panel and press Bet before the round starts. You can also use Auto mode when you want the panel to place bets for you.", category: "Game", sortOrder: 30 },
  { question: "When can I cash out or withdraw?", answer: "During a live round, press Cash Out before the plane leaves. To withdraw, open Wallet & payments and choose Withdraw after your balance and any wagering requirements allow it.", category: "Payments", sortOrder: 40 },
  { question: "How are B9T9 rounds verified?", answer: "Each round uses a provably-fair crash result. Open the round history and select a result to review its verification details.", category: "Fair play", sortOrder: 50 }
] as const;

async function seedDefaultFaqs(): Promise<void> {
  await Promise.all(DEFAULT_FAQS.map((faq) => FaqModel.updateOne(
    { question: faq.question },
    { $setOnInsert: { ...faq, enabled: true } },
    { upsert: true }
  )));
}

async function migrateMinorUnitFields(): Promise<void> {
  const users = await UserModel.find({
    $or: [
      { balanceMinor: { $exists: false } },
      { withdrawalLockedMinor: { $exists: false } },
      { bettingLockedMinor: { $exists: false } },
      { pendingRewardsMinor: { $exists: false } },
      { wagerRequirementMinor: { $exists: false } },
      { wagerTargetMinor: { $exists: false } },
      { wagerCompletedMinor: { $exists: false } },
      { wagerTrackingVersion: { $exists: false } },
      { authProvider: { $exists: false } },
      { vipLevel: { $exists: false } },
      { vipLifetimeDepositMinor: { $exists: false } },
      { vipLifetimeValidBetMinor: { $exists: false } }
    ]
  }).select("balance lockedBalance balanceMinor withdrawalLockedMinor bettingLockedMinor pendingRewardsMinor wagerRequirementMinor wagerTargetMinor wagerCompletedMinor wagerTrackingVersion authProvider role vipLevel vipLifetimeDepositMinor vipLifetimeValidBetMinor").lean();

  if (users.length > 0) {
    await UserModel.bulkWrite(users.map((user: any) => ({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: {
            balanceMinor: Number.isSafeInteger(Number(user.balanceMinor)) ? Number(user.balanceMinor) : safeMinor(user.balance),
            withdrawalLockedMinor: Number.isSafeInteger(Number(user.withdrawalLockedMinor))
              ? Number(user.withdrawalLockedMinor)
              : safeMinor(user.lockedBalance),
            bettingLockedMinor: Number.isSafeInteger(Number(user.bettingLockedMinor)) ? Number(user.bettingLockedMinor) : 0,
            pendingRewardsMinor: Number.isSafeInteger(Number(user.pendingRewardsMinor)) ? Number(user.pendingRewardsMinor) : 0,
            wagerRequirementMinor: Number.isSafeInteger(Number(user.wagerRequirementMinor)) ? Number(user.wagerRequirementMinor) : 0,
            wagerTargetMinor: Number.isSafeInteger(Number(user.wagerTargetMinor))
              ? Number(user.wagerTargetMinor)
              : (Number.isSafeInteger(Number(user.wagerRequirementMinor)) ? Number(user.wagerRequirementMinor) : 0),
            wagerCompletedMinor: Number.isSafeInteger(Number(user.wagerCompletedMinor)) ? Number(user.wagerCompletedMinor) : 0,
            wagerTrackingVersion: Number.isFinite(Number(user.wagerTrackingVersion)) ? Number(user.wagerTrackingVersion) : 0,
            authProvider: user.authProvider ?? "PASSWORD",
            vipLevel: Number.isFinite(Number(user.vipLevel)) ? Number(user.vipLevel) : 0,
            vipLifetimeDepositMinor: Number.isSafeInteger(Number(user.vipLifetimeDepositMinor)) ? Number(user.vipLifetimeDepositMinor) : 0,
            vipLifetimeValidBetMinor: Number.isSafeInteger(Number(user.vipLifetimeValidBetMinor)) ? Number(user.vipLifetimeValidBetMinor) : 0
          }
        }
      }
    })));
  }

  const deposits = await DepositRequestModel.find({ amountMinor: { $exists: false } }).select("amount").lean();
  if (deposits.length > 0) {
    await DepositRequestModel.bulkWrite(deposits.map((item: any) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { amountMinor: safeMinor(item.amount) } } }
    })));
  }

  const withdrawals = await WithdrawalRequestModel.find({ amountMinor: { $exists: false } }).select("amount").lean();
  if (withdrawals.length > 0) {
    await WithdrawalRequestModel.bulkWrite(withdrawals.map((item: any) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { amountMinor: safeMinor(item.amount) } } }
    })));
  }

  const bets = await GameBetModel.find({ amountMinor: { $exists: false } }).select("amount payout status").lean();
  if (bets.length > 0) {
    await GameBetModel.bulkWrite(bets.map((item: any) => ({
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            amountMinor: safeMinor(item.amount),
            payoutMinor: safeMinor(item.payout),
            commissionMinor: 0,
            reservedLiabilityMinor: 0
          }
        }
      }
    })));
  }

  const rounds = await GameRoundModel.find({ totalStakeMinor: { $exists: false } }).select("totalStake totalPayout").lean();
  if (rounds.length > 0) {
    await GameRoundModel.bulkWrite(rounds.map((round: any) => ({
      updateOne: {
        filter: { _id: round._id },
        update: {
          $set: {
            totalStakeMinor: safeMinor(round.totalStake),
            totalPayoutMinor: safeMinor(round.totalPayout),
            totalCommissionMinor: 0,
            totalLossesMinor: 0
          }
        }
      }
    })));
  }

  const state = await PlatformStateModel.findOne({ key: "global" }).lean();
  if (state) {
    const stateAny = state as any;
    const set: Record<string, number> = {};
    if (!Number.isSafeInteger(Number(stateAny.activeBetEscrowMinor))) set.activeBetEscrowMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.reservedRewardLiquidityMinor))) set.reservedRewardLiquidityMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.lossPoolMinor))) set.lossPoolMinor = safeMinor(stateAny.lossPool);
    if (!Number.isSafeInteger(Number(stateAny.commissionWalletMinor))) {
      set.commissionWalletMinor = safeMinor(stateAny.totalCommissionEarned);
    }
    if (!Number.isSafeInteger(Number(stateAny.totalCommissionEarnedMinor))) {
      set.totalCommissionEarnedMinor = safeMinor(stateAny.totalCommissionEarned);
    }
    if (!Number.isSafeInteger(Number(stateAny.totalApprovedDepositsMinor))) {
      set.totalApprovedDepositsMinor = safeMinor(stateAny.totalApprovedDeposits);
    }
    if (!Number.isSafeInteger(Number(stateAny.totalCompletedWithdrawalsMinor))) {
      set.totalCompletedWithdrawalsMinor = safeMinor(stateAny.totalCompletedWithdrawals);
    }
    if (!Number.isSafeInteger(Number(stateAny.totalRewardsPaidMinor))) set.totalRewardsPaidMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.totalBetVolumeMinor))) set.totalBetVolumeMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.totalLossesMinor))) set.totalLossesMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.bonusWalletMinor))) set.bonusWalletMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.totalBonusFundingMinor))) set.totalBonusFundingMinor = 0;
    if (!Number.isSafeInteger(Number(stateAny.totalBonusesPaidMinor))) set.totalBonusesPaidMinor = 0;
    if (Object.keys(set).length > 0) await PlatformStateModel.updateOne({ key: "global" }, { $set: set });
  }
}



async function migrateWagerTracking(): Promise<void> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  const defaultPercent = Math.min(100, Math.max(0, Number((settings as any)?.wageringRequirementPercent ?? 30)));
  const users = await UserModel.find({
    role: "USER",
    $or: [
      { wagerTrackingVersion: { $exists: false } },
      { wagerTrackingVersion: { $lt: 2 } }
    ]
  }).select("balance balanceMinor pendingRewardsMinor wagerRequirementMinor wagerTargetMinor wagerCompletedMinor").lean();

  for (const user of users as any[]) {
    const [deposits, bets, depositAudits] = await Promise.all([
      DepositRequestModel.find({ userId: user._id, status: "APPROVED" })
        .select("amount amountMinor reviewedAt updatedAt createdAt wageringPercentApplied wagerRequirementMinor")
        .lean(),
      GameBetModel.find({ userId: user._id, status: { $in: ["CASHED_OUT", "LOST"] } })
        .select("amount amountMinor payout payoutMinor status settledAt updatedAt createdAt")
        .lean(),
      PlatformAuditModel.find({ userId: user._id, type: "DEPOSIT_APPROVED" })
        .select("referenceId metadata")
        .lean()
    ]);

    if (deposits.length === 0) {
      const remaining = Number.isSafeInteger(Number(user.wagerRequirementMinor))
        ? Math.max(0, Number(user.wagerRequirementMinor))
        : 0;
      const target = Number.isSafeInteger(Number(user.wagerTargetMinor))
        ? Math.max(remaining, Number(user.wagerTargetMinor))
        : remaining;
      const completed = Number.isSafeInteger(Number(user.wagerCompletedMinor))
        ? Math.min(target, Math.max(0, Number(user.wagerCompletedMinor)))
        : Math.max(0, target - remaining);
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { wagerRequirementMinor: remaining, wagerTargetMinor: target, wagerCompletedMinor: completed, wagerTrackingVersion: 2 } }
      );
      continue;
    }

    type WagerEvent =
      | { kind: "DEPOSIT"; at: number; requirementMinor: number }
      | { kind: "BET"; at: number; amountMinor: number; netProfitMinor: number };
    const events: WagerEvent[] = [];
    const depositAuditById = new Map<string, any>(
      (depositAudits as any[]).map((audit) => [String(audit.referenceId ?? ""), audit])
    );

    for (const deposit of deposits as any[]) {
      const amountMinor = Number.isSafeInteger(Number(deposit.amountMinor))
        ? Math.max(0, Number(deposit.amountMinor))
        : safeMinor(deposit.amount);
      const auditMetadata = depositAuditById.get(String(deposit._id))?.metadata ?? {};
      const appliedPercent = Number.isFinite(Number(deposit.wageringPercentApplied))
        ? Math.min(100, Math.max(0, Number(deposit.wageringPercentApplied)))
        : Number.isFinite(Number(auditMetadata.wageringPercent))
          ? Math.min(100, Math.max(0, Number(auditMetadata.wageringPercent)))
          : defaultPercent;
      const requirementMinor = Number.isSafeInteger(Number(deposit.wagerRequirementMinor))
        ? Math.max(0, Number(deposit.wagerRequirementMinor))
        : Number.isSafeInteger(Number(auditMetadata.wagerRequirementMinor))
          ? Math.max(0, Number(auditMetadata.wagerRequirementMinor))
          : Math.round(amountMinor * (appliedPercent / 100));
      const at = new Date(deposit.reviewedAt ?? deposit.updatedAt ?? deposit.createdAt ?? 0).getTime();
      events.push({ kind: "DEPOSIT", at, requirementMinor });

      if (!Number.isSafeInteger(Number(deposit.wagerRequirementMinor)) || !Number.isFinite(Number(deposit.wageringPercentApplied))) {
        await DepositRequestModel.updateOne(
          { _id: deposit._id },
          { $set: { wagerRequirementMinor: requirementMinor, wageringPercentApplied: appliedPercent } }
        );
      }
    }

    for (const bet of bets as any[]) {
      const amountMinor = Number.isSafeInteger(Number(bet.amountMinor))
        ? Math.max(0, Number(bet.amountMinor))
        : safeMinor(bet.amount);
      const payoutMinor = Number.isSafeInteger(Number(bet.payoutMinor))
        ? Math.max(0, Number(bet.payoutMinor))
        : safeMinor(bet.payout);
      const at = new Date(bet.settledAt ?? bet.updatedAt ?? bet.createdAt ?? 0).getTime();
      events.push({
        kind: "BET",
        at,
        amountMinor,
        netProfitMinor: bet.status === "CASHED_OUT" ? Math.max(0, payoutMinor - amountMinor) : 0
      });
    }

    events.sort((left, right) => {
      const timestampDifference = left.at - right.at;
      if (timestampDifference !== 0) return timestampDifference;
      if (left.kind === right.kind) return 0;
      return left.kind === "DEPOSIT" ? -1 : 1;
    });

    let targetMinor = 0;
    let completedMinor = 0;
    let remainingMinor = 0;
    let pendingRewardsMinor = 0;

    for (const event of events) {
      if (event.kind === "DEPOSIT") {
        if (event.requirementMinor <= 0) continue;
        if (remainingMinor <= 0) {
          targetMinor = event.requirementMinor;
          completedMinor = 0;
          remainingMinor = event.requirementMinor;
          pendingRewardsMinor = 0;
        } else {
          targetMinor += event.requirementMinor;
          remainingMinor += event.requirementMinor;
        }
        continue;
      }

      if (remainingMinor <= 0 || event.amountMinor <= 0) continue;
      const contributionMinor = Math.min(remainingMinor, event.amountMinor);
      remainingMinor -= contributionMinor;
      completedMinor = Math.min(targetMinor, completedMinor + contributionMinor);
      if (event.netProfitMinor > 0 && remainingMinor > 0) pendingRewardsMinor += event.netProfitMinor;
      if (remainingMinor === 0) {
        completedMinor = targetMinor;
        pendingRewardsMinor = 0;
      }
    }

    const availableMinor = Number.isSafeInteger(Number(user.balanceMinor)) ? Number(user.balanceMinor) : safeMinor(user.balance);
    const currentPendingMinor = Number.isSafeInteger(Number(user.pendingRewardsMinor)) ? Math.max(0, Number(user.pendingRewardsMinor)) : 0;
    const availableAndPendingMinor = Math.max(0, availableMinor + currentPendingMinor);
    const correctedPendingMinor = Math.min(pendingRewardsMinor, availableAndPendingMinor);
    const correctedAvailableMinor = availableAndPendingMinor - correctedPendingMinor;

    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          balanceMinor: correctedAvailableMinor,
          balance: correctedAvailableMinor / 100,
          pendingRewardsMinor: correctedPendingMinor,
          wagerRequirementMinor: remainingMinor,
          wagerTargetMinor: targetMinor,
          wagerCompletedMinor: completedMinor,
          wagerTrackingVersion: 2
        }
      }
    );
  }
}

async function migrateFinanceSettings(): Promise<void> {
  await Promise.all([
    PlatformSettingsModel.updateOne(
      { key: "global", minDeposit: { $exists: false } },
      { $set: { minDeposit: 100 } }
    ),
    PlatformSettingsModel.updateOne(
      { key: "global", minWithdrawal: { $exists: false } },
      { $set: { minWithdrawal: 500 } }
    ),
    PlatformSettingsModel.updateOne(
      { key: "global", wageringRequirementPercent: { $exists: false } },
      { $set: { wageringRequirementPercent: 30 } }
    ),
    PlatformSettingsModel.updateOne(
      { key: "global", $or: [{ referralEnabled: { $exists: false } }, { referralInvitationRules: { $exists: false } }] },
      { $set: {
        referralEnabled: true,
        referralMinDeposit: 300,
        referralDepositPercent: 5,
        referralInvitationRules: DEFAULT_REFERRAL_INVITATION_RULES,
        referralCommissionRates: DEFAULT_REFERRAL_COMMISSION_RATES
      } }
    ),
    PlatformSettingsModel.updateOne(
      { key: "global", $or: [{ vipLevels: { $exists: false } }, { vipLevels: { $size: 0 } }] },
      { $set: {
        vipEnabled: true,
        vipLevelBonusEnabled: true,
        vipMonthlyBonusEnabled: true,
        vipWithdrawalLimitsEnabled: true,
        vipTimezone: "Asia/Karachi",
        monthlyClaimStartDay: 1,
        monthlyClaimWindowHours: 48,
        monthlyClaimForceOpen: false,
        referralEnabled: true,
        referralMinDeposit: 300,
        referralDepositPercent: 5,
        referralInvitationRules: DEFAULT_REFERRAL_INVITATION_RULES,
        referralCommissionRates: DEFAULT_REFERRAL_COMMISSION_RATES,
        vipLevels: DEFAULT_VIP_LEVELS,
        monthlyBonusRules: DEFAULT_MONTHLY_BONUS_RULES
      } }
    )
  ]);
}

async function releaseStaleQueuedBetKeys(): Promise<void> {
  const staleQueuedDocuments = await GameBetModel.find({
    roundId: "__NEXT_ROUND__",
    status: { $in: ["REFUNDED", "LOST", "CASHED_OUT"] }
  }).select("betId").lean();

  if (staleQueuedDocuments.length === 0) return;

  await GameBetModel.bulkWrite(
    staleQueuedDocuments.map((bet: any) => ({
      updateOne: {
        filter: { _id: bet._id, roundId: "__NEXT_ROUND__" },
        update: { $set: { roundId: `__ARCHIVED_NEXT_ROUND__:${String(bet.betId ?? bet._id)}` } }
      }
    }))
  );
}

async function migrateSettingsVersion(): Promise<void> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  if (!settings) return;
  const settingsAny = settings as any;
  if (Number(settingsAny.accountingVersion ?? 0) >= 2) return;

  const set: Record<string, number> = { accountingVersion: 2 };
  // The previous build shipped 100x/30% as defaults. Under fully reserved peer liquidity
  // those values can block nearly every bet, so only the untouched legacy defaults migrate.
  if (Number(settingsAny.maxCashoutMultiplier) === 100 && Number(settingsAny.reservePercent) === 30) {
    set.maxCashoutMultiplier = 10;
    set.reservePercent = 0;
  }
  await PlatformSettingsModel.updateOne({ key: "global" }, { $set: set });
}

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI is required. Add the MongoDB Atlas connection string in Railway Variables.");
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15_000,
    minPoolSize: 5,
    maxPoolSize: 30,
    maxConnecting: 4,
    waitQueueTimeoutMS: 5_000
  });

  await Promise.all([
    PlatformSettingsModel.updateOne(
      { key: "global" },
      { $setOnInsert: { key: "global" } },
      { upsert: true }
    ),
    PlatformStateModel.updateOne(
      { key: "global" },
      {
        $setOnInsert: {
          key: "global",
          activeBetEscrowMinor: 0,
          reservedRewardLiquidityMinor: 0,
          lossPoolMinor: 0,
          commissionWalletMinor: 0,
          totalCommissionEarnedMinor: 0,
          totalApprovedDepositsMinor: 0,
          totalCompletedWithdrawalsMinor: 0,
          totalRewardsPaidMinor: 0,
          totalBetVolumeMinor: 0,
          totalLossesMinor: 0,
          bonusWalletMinor: 0,
          totalBonusFundingMinor: 0,
          totalBonusesPaidMinor: 0
        }
      },
      { upsert: true }
    )
  ]);

  await migrateSettingsVersion();
  await migrateFinanceSettings();
  await seedDefaultFaqs();
  await migrateMinorUnitFields();
  await migrateWagerTracking();
  await releaseStaleQueuedBetKeys();
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
