import mongoose from "mongoose";
import {
  DepositRequestModel,
  GameBetModel,
  GameRoundModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WithdrawalRequestModel
} from "./models.js";
import { toMinor } from "./money.js";

const safeMinor = (value: unknown): number => {
  const amount = Number(value ?? 0);
  return toMinor(Number.isFinite(amount) ? amount : 0);
};

async function migrateMinorUnitFields(): Promise<void> {
  const users = await UserModel.find({
    $or: [
      { balanceMinor: { $exists: false } },
      { withdrawalLockedMinor: { $exists: false } },
      { bettingLockedMinor: { $exists: false } },
      { pendingRewardsMinor: { $exists: false } }
    ]
  }).select("balance lockedBalance balanceMinor withdrawalLockedMinor bettingLockedMinor pendingRewardsMinor").lean();

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
            pendingRewardsMinor: Number.isSafeInteger(Number(user.pendingRewardsMinor)) ? Number(user.pendingRewardsMinor) : 0
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
    if (Object.keys(set).length > 0) await PlatformStateModel.updateOne({ key: "global" }, { $set: set });
  }
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
    maxPoolSize: 20
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
          totalLossesMinor: 0
        }
      },
      { upsert: true }
    )
  ]);

  await migrateSettingsVersion();
  await migrateMinorUnitFields();
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
