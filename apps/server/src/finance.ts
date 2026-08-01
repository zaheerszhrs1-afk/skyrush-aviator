import mongoose from "mongoose";
import {
  DepositRequestModel,
  PlatformAuditModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WalletTransactionModel,
  WithdrawalRequestModel,
  type TransactionType
} from "./models.js";
import { fromMinor, minorFromDocument, toMinor } from "./money.js";
import { enforceVipWithdrawalLimit } from "./bonus.js";

function walletFields(user: any) {
  const balanceMinor = minorFromDocument(user, "balanceMinor", "balance");
  const withdrawalLockedMinor = minorFromDocument(user, "withdrawalLockedMinor", "lockedBalance");
  const bettingLockedMinor = Number.isSafeInteger(Number(user?.bettingLockedMinor)) ? Number(user.bettingLockedMinor) : 0;
  const pendingRewardsMinor = Number.isSafeInteger(Number(user?.pendingRewardsMinor)) ? Number(user.pendingRewardsMinor) : 0;
  const wagerRequirementMinor = Number.isSafeInteger(Number(user?.wagerRequirementMinor)) ? Math.max(0, Number(user.wagerRequirementMinor)) : 0;
  const wagerTargetMinor = Number.isSafeInteger(Number(user?.wagerTargetMinor))
    ? Math.max(wagerRequirementMinor, Number(user.wagerTargetMinor))
    : wagerRequirementMinor;
  const wagerCompletedMinor = Number.isSafeInteger(Number(user?.wagerCompletedMinor))
    ? Math.min(wagerTargetMinor, Math.max(0, Number(user.wagerCompletedMinor)))
    : Math.max(0, wagerTargetMinor - wagerRequirementMinor);
  return {
    balanceMinor,
    withdrawalLockedMinor,
    bettingLockedMinor,
    pendingRewardsMinor,
    wagerRequirementMinor,
    wagerTargetMinor,
    wagerCompletedMinor
  };
}

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
  referenceType: string;
  referenceId: string;
  description: string;
  metadata?: Record<string, unknown>;
}): WalletTransactionInputDocument {
  const userId = toObjectId(input.userId);
  const wallet = walletFields(input.user);
  return {
    userId,
    type: input.type,
    amountMinor: input.amountMinor,
    availableDeltaMinor: input.availableDeltaMinor ?? 0,
    withdrawalLockedDeltaMinor: input.withdrawalLockedDeltaMinor ?? 0,
    bettingLockedDeltaMinor: input.bettingLockedDeltaMinor ?? 0,
    pendingRewardsDeltaMinor: input.pendingRewardsDeltaMinor ?? 0,
    balanceAfterMinor: wallet.balanceMinor,
    withdrawalLockedAfterMinor: wallet.withdrawalLockedMinor,
    bettingLockedAfterMinor: wallet.bettingLockedMinor,
    pendingRewardsAfterMinor: wallet.pendingRewardsMinor,
    amount: fromMinor(input.amountMinor),
    balanceAfter: fromMinor(wallet.balanceMinor),
    lockedBalanceAfter: fromMinor(wallet.withdrawalLockedMinor),
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    description: input.description,
    metadata: input.metadata ?? {}
  };
}

export async function getWalletSnapshot(userId: string): Promise<{
  balance: number;
  lockedBalance: number;
  bettingLockedBalance: number;
  pendingRewards: number;
  wagerRequirementRemaining: number;
  wagerRequirementTarget: number;
  wagerRequirementCompleted: number;
  totalBalance: number;
}> {
  const user = await UserModel.findById(userId)
    .select("balance lockedBalance balanceMinor withdrawalLockedMinor bettingLockedMinor pendingRewardsMinor wagerRequirementMinor wagerTargetMinor wagerCompletedMinor")
    .lean();
  if (!user) throw new Error("User not found.");
  const wallet = walletFields(user);
  return {
    balance: fromMinor(wallet.balanceMinor),
    lockedBalance: fromMinor(wallet.withdrawalLockedMinor),
    bettingLockedBalance: fromMinor(wallet.bettingLockedMinor),
    pendingRewards: fromMinor(wallet.pendingRewardsMinor),
    wagerRequirementRemaining: fromMinor(wallet.wagerRequirementMinor),
    wagerRequirementTarget: fromMinor(wallet.wagerTargetMinor),
    wagerRequirementCompleted: fromMinor(wallet.wagerCompletedMinor),
    totalBalance: fromMinor(
      wallet.balanceMinor + wallet.withdrawalLockedMinor + wallet.bettingLockedMinor + wallet.pendingRewardsMinor
    )
  };
}

export async function createDepositRequest(input: {
  userId: string;
  amount: number;
  method: string;
  reference: string;
  note?: string;
}): Promise<any> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  if (settings?.depositsEnabled === false) throw new Error("Deposits are currently disabled.");
  const amountMinor = toMinor(input.amount);
  const minDeposit = Number(settings?.minDeposit ?? 100);
  if (amountMinor < toMinor(minDeposit)) throw new Error(`Minimum deposit is ${minDeposit.toFixed(2)} PKR.`);
  if (!input.method.trim() || !input.reference.trim()) throw new Error("Method and payment reference are required.");

  return DepositRequestModel.create({
    userId: input.userId,
    amountMinor,
    amount: fromMinor(amountMinor),
    method: input.method.trim(),
    reference: input.reference.trim(),
    note: input.note?.trim() ?? ""
  });
}

export async function createNowPaymentsDepositRequest(input: {
  userId: string;
  amount: number;
}): Promise<any> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  if (settings?.depositsEnabled === false) throw new Error("Deposits are currently disabled.");
  const amountMinor = toMinor(input.amount);
  const minDeposit = Number(settings?.minDeposit ?? 100);
  if (amountMinor < toMinor(minDeposit)) throw new Error(`Minimum deposit is ${minDeposit.toFixed(2)} PKR.`);

  const deposit = new DepositRequestModel({
    userId: input.userId,
    amountMinor,
    amount: fromMinor(amountMinor),
    method: "NOWPayments Crypto",
    reference: "NOWPAYMENTS:PENDING",
    gatewayProvider: "NOWPAYMENTS",
    gatewayStatus: "creating"
  });
  deposit.reference = `NOWPAYMENTS:${deposit._id}`;
  await deposit.save();
  return deposit;
}

export async function createWithdrawalRequest(input: {
  userId: string;
  amount: number;
  method: string;
  accountDetails: string;
}): Promise<any> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  if (settings?.withdrawalsEnabled === false) throw new Error("Withdrawals are currently disabled.");
  const amountMinor = toMinor(input.amount);
  const minWithdrawal = Number(settings?.minWithdrawal ?? 500);
  if (amountMinor < toMinor(minWithdrawal)) throw new Error(`Minimum withdrawal is ${minWithdrawal.toFixed(2)} PKR.`);
  if (!input.method.trim() || !input.accountDetails.trim()) throw new Error("Method and account details are required.");
  await enforceVipWithdrawalLimit(input.userId);

  let created: any;
  await mongoose.connection.transaction(async (session) => {
    const user = await UserModel.findOneAndUpdate(
      { _id: input.userId, status: "ACTIVE", balanceMinor: { $gte: amountMinor } },
      {
        $inc: {
          balanceMinor: -amountMinor,
          withdrawalLockedMinor: amountMinor,
          balance: -fromMinor(amountMinor),
          lockedBalance: fromMinor(amountMinor)
        }
      },
      { new: true, session }
    );
    if (!user) throw new Error("Insufficient available balance.");

    const [withdrawal] = await WithdrawalRequestModel.create(
      [{
        userId: input.userId,
        amountMinor,
        amount: fromMinor(amountMinor),
        method: input.method.trim(),
        accountDetails: input.accountDetails.trim()
      }],
      { session, ordered: true }
    );
    created = withdrawal;

    await WalletTransactionModel.create(
      [walletTransaction({
        userId: input.userId,
        type: "WITHDRAWAL_LOCK",
        amountMinor: -amountMinor,
        availableDeltaMinor: -amountMinor,
        withdrawalLockedDeltaMinor: amountMinor,
        user,
        referenceType: "WITHDRAWAL",
        referenceId: String(withdrawal._id),
        description: "Withdrawal amount moved to the withdrawal lock"
      })],
      { session, ordered: true }
    );
  });

  return created;
}

async function processDepositReview(input: {
  depositId: string;
  adminId?: string;
  action: "APPROVE" | "REJECT";
  note?: string;
  automatic?: boolean;
}): Promise<{ userId: string }> {
  let affectedUserId = "";
  await mongoose.connection.transaction(async (session) => {
    const deposit = await DepositRequestModel.findOne({ _id: input.depositId, status: "PENDING" }).session(session);
    if (!deposit) throw new Error("Pending deposit request not found.");
    if ((deposit as any).gatewayProvider && !input.automatic) {
      throw new Error("Gateway deposits are settled automatically and cannot be reviewed manually.");
    }
    affectedUserId = String(deposit.userId);
    const amountMinor = Number.isSafeInteger(Number((deposit as any).amountMinor))
      ? Number((deposit as any).amountMinor)
      : toMinor(Number(deposit.amount));

    if (input.action === "REJECT") {
      deposit.status = "REJECTED";
      if (input.adminId) deposit.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
      deposit.reviewedAt = new Date();
      deposit.reviewNote = input.note?.trim() ?? "";
      await deposit.save({ session });
      return;
    }

    const settings = await PlatformSettingsModel.findOne({ key: "global" }).session(session).lean();
    const wageringPercent = Math.min(100, Math.max(0, Number(settings?.wageringRequirementPercent ?? 30)));
    const wagerRequirementMinor = Math.round(amountMinor * (wageringPercent / 100));

    const user = await UserModel.findById(deposit.userId).session(session);
    if (!user) throw new Error("Deposit user no longer exists.");

    const wallet = walletFields(user);
    const startsNewWagerCycle = wallet.wagerRequirementMinor <= 0;
    (user as any).balanceMinor = wallet.balanceMinor + amountMinor;
    (user as any).balance = fromMinor((user as any).balanceMinor);
    (user as any).vipLifetimeDepositMinor = Number((user as any).vipLifetimeDepositMinor ?? 0) + amountMinor;
    (user as any).wagerRequirementMinor = wallet.wagerRequirementMinor + wagerRequirementMinor;
    (user as any).wagerTargetMinor = startsNewWagerCycle
      ? wagerRequirementMinor
      : wallet.wagerTargetMinor + wagerRequirementMinor;
    (user as any).wagerCompletedMinor = startsNewWagerCycle ? 0 : wallet.wagerCompletedMinor;
    (user as any).wagerTrackingVersion = 2;
    await user.save({ session });

    deposit.status = "APPROVED";
    if (input.adminId) deposit.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
    deposit.reviewedAt = new Date();
    deposit.reviewNote = input.note?.trim() ?? "";
    (deposit as any).amountMinor = amountMinor;
    (deposit as any).wageringPercentApplied = wageringPercent;
    (deposit as any).wagerRequirementMinor = wagerRequirementMinor;
    await deposit.save({ session });

    const state = await PlatformStateModel.findOneAndUpdate(
      { key: "global" },
      {
        $inc: {
          totalApprovedDepositsMinor: amountMinor,
          totalApprovedDeposits: fromMinor(amountMinor)
        }
      },
      { session, new: true, upsert: true }
    );
    if (!state) throw new Error("Platform accounting state is unavailable.");

    await WalletTransactionModel.create(
      [walletTransaction({
        userId: deposit.userId,
        type: "DEPOSIT_CREDIT",
        amountMinor,
        availableDeltaMinor: amountMinor,
        user,
        referenceType: "DEPOSIT",
        referenceId: String(deposit._id),
        description: `${input.automatic ? "Deposit automatically settled" : "Deposit approved"} via ${deposit.method}; wagering requirement ${fromMinor(wagerRequirementMinor).toFixed(2)} PKR`,
        metadata: { wageringPercent, wagerRequirementMinor, automatic: input.automatic === true }
      })],
      { session, ordered: true }
    );

    await PlatformAuditModel.create(
      [{
        eventKey: `deposit-approved:${deposit._id}`,
        type: "DEPOSIT_APPROVED" as const,
        userId: deposit.userId,
        ...(input.adminId ? { adminId: new mongoose.Types.ObjectId(input.adminId) } : {}),
        referenceId: String(deposit._id),
        activeBetEscrowAfterMinor: Number((state as any).activeBetEscrowMinor ?? 0),
        reservedLiquidityAfterMinor: Number((state as any).reservedRewardLiquidityMinor ?? 0),
        lossPoolAfterMinor: Number((state as any).lossPoolMinor ?? 0),
        commissionWalletAfterMinor: Number((state as any).commissionWalletMinor ?? 0),
        description: `${input.automatic ? "Automatically settled" : "Approved"} deposit of ${fromMinor(amountMinor).toFixed(2)} PKR with ${wageringPercent.toFixed(2)}% wagering requirement`,
        metadata: { wageringPercent, wagerRequirementMinor, automatic: input.automatic === true }
      }],
      { session, ordered: true }
    );
  });

  return { userId: affectedUserId };
}

export async function reviewDeposit(input: {
  depositId: string;
  adminId: string;
  action: "APPROVE" | "REJECT";
  note?: string;
}): Promise<{ userId: string }> {
  return processDepositReview(input);
}

export async function settleNowPaymentsDeposit(depositId: string): Promise<{ userId: string }> {
  try {
    return await processDepositReview({
      depositId,
      action: "APPROVE",
      automatic: true,
      note: "Automatically settled after a signed NOWPayments finished callback."
    });
  } catch (error) {
    const existing = await DepositRequestModel.findOne({
      _id: depositId,
      gatewayProvider: "NOWPAYMENTS",
      status: "APPROVED"
    }).select("userId").lean();
    if (existing) return { userId: String(existing.userId) };
    throw error;
  }
}

export async function reviewWithdrawal(input: {
  withdrawalId: string;
  adminId: string;
  action: "PROCESS" | "COMPLETE" | "REJECT";
  note?: string;
}): Promise<{ userId: string }> {
  let affectedUserId = "";
  await mongoose.connection.transaction(async (session) => {
    const withdrawal = await WithdrawalRequestModel.findById(input.withdrawalId).session(session);
    if (!withdrawal || withdrawal.status === "COMPLETED" || withdrawal.status === "REJECTED") {
      throw new Error("Open withdrawal request not found.");
    }
    affectedUserId = String(withdrawal.userId);
    const amountMinor = Number.isSafeInteger(Number((withdrawal as any).amountMinor))
      ? Number((withdrawal as any).amountMinor)
      : toMinor(Number(withdrawal.amount));

    if (input.action === "PROCESS") {
      withdrawal.status = "PROCESSING";
      withdrawal.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
      withdrawal.reviewedAt = new Date();
      withdrawal.reviewNote = input.note?.trim() ?? "";
      await withdrawal.save({ session });
      return;
    }

    if (input.action === "REJECT") {
      const user = await UserModel.findOneAndUpdate(
        { _id: withdrawal.userId, withdrawalLockedMinor: { $gte: amountMinor } },
        {
          $inc: {
            balanceMinor: amountMinor,
            withdrawalLockedMinor: -amountMinor,
            balance: fromMinor(amountMinor),
            lockedBalance: -fromMinor(amountMinor)
          }
        },
        { new: true, session }
      );
      if (!user) throw new Error("Unable to restore the locked withdrawal balance.");

      withdrawal.status = "REJECTED";
      withdrawal.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
      withdrawal.reviewedAt = new Date();
      withdrawal.reviewNote = input.note?.trim() ?? "";
      (withdrawal as any).amountMinor = amountMinor;
      await withdrawal.save({ session });

      await WalletTransactionModel.create(
        [walletTransaction({
          userId: withdrawal.userId,
          type: "WITHDRAWAL_REFUND",
          amountMinor,
          availableDeltaMinor: amountMinor,
          withdrawalLockedDeltaMinor: -amountMinor,
          user,
          referenceType: "WITHDRAWAL",
          referenceId: String(withdrawal._id),
          description: "Rejected withdrawal restored to available balance"
        })],
        { session, ordered: true }
      );
      return;
    }

    const user = await UserModel.findOneAndUpdate(
      { _id: withdrawal.userId, withdrawalLockedMinor: { $gte: amountMinor } },
      {
        $inc: {
          withdrawalLockedMinor: -amountMinor,
          lockedBalance: -fromMinor(amountMinor)
        }
      },
      { new: true, session }
    );
    if (!user) throw new Error("Unable to settle the locked withdrawal balance.");

    withdrawal.status = "COMPLETED";
    withdrawal.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
    withdrawal.reviewedAt = new Date();
    withdrawal.reviewNote = input.note?.trim() ?? "";
    (withdrawal as any).amountMinor = amountMinor;
    await withdrawal.save({ session });

    const state = await PlatformStateModel.findOneAndUpdate(
      { key: "global" },
      {
        $inc: {
          totalCompletedWithdrawalsMinor: amountMinor,
          totalCompletedWithdrawals: fromMinor(amountMinor)
        }
      },
      { session, new: true, upsert: true }
    );
    if (!state) throw new Error("Platform accounting state is unavailable.");

    await WalletTransactionModel.create(
      [walletTransaction({
        userId: withdrawal.userId,
        type: "WITHDRAWAL_DEBIT",
        amountMinor: -amountMinor,
        withdrawalLockedDeltaMinor: -amountMinor,
        user,
        referenceType: "WITHDRAWAL",
        referenceId: String(withdrawal._id),
        description: `Withdrawal completed via ${withdrawal.method}`
      })],
      { session, ordered: true }
    );

    await PlatformAuditModel.create(
      [{
        eventKey: `withdrawal-completed:${withdrawal._id}`,
        type: "WITHDRAWAL_COMPLETED" as const,
        userId: withdrawal.userId,
        adminId: new mongoose.Types.ObjectId(input.adminId),
        referenceId: String(withdrawal._id),
        activeBetEscrowAfterMinor: Number((state as any).activeBetEscrowMinor ?? 0),
        reservedLiquidityAfterMinor: Number((state as any).reservedRewardLiquidityMinor ?? 0),
        lossPoolAfterMinor: Number((state as any).lossPoolMinor ?? 0),
        commissionWalletAfterMinor: Number((state as any).commissionWalletMinor ?? 0),
        description: `Completed withdrawal of ${fromMinor(amountMinor).toFixed(2)} PKR`
      }],
      { session, ordered: true }
    );
  });

  return { userId: affectedUserId };
}
