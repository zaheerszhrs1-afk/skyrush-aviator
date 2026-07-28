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

function walletFields(user: any) {
  const balanceMinor = minorFromDocument(user, "balanceMinor", "balance");
  const withdrawalLockedMinor = minorFromDocument(user, "withdrawalLockedMinor", "lockedBalance");
  const bettingLockedMinor = Number.isSafeInteger(Number(user?.bettingLockedMinor)) ? Number(user.bettingLockedMinor) : 0;
  const pendingRewardsMinor = Number.isSafeInteger(Number(user?.pendingRewardsMinor)) ? Number(user.pendingRewardsMinor) : 0;
  return { balanceMinor, withdrawalLockedMinor, bettingLockedMinor, pendingRewardsMinor };
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
}) {
  const wallet = walletFields(input.user);
  return {
    userId: input.userId,
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
  totalBalance: number;
}> {
  const user = await UserModel.findById(userId)
    .select("balance lockedBalance balanceMinor withdrawalLockedMinor bettingLockedMinor pendingRewardsMinor")
    .lean();
  if (!user) throw new Error("User not found.");
  const wallet = walletFields(user);
  return {
    balance: fromMinor(wallet.balanceMinor),
    lockedBalance: fromMinor(wallet.withdrawalLockedMinor),
    bettingLockedBalance: fromMinor(wallet.bettingLockedMinor),
    pendingRewards: fromMinor(wallet.pendingRewardsMinor),
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
  if (amountMinor < toMinor(100)) throw new Error("Minimum deposit is 100 PKR.");
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

export async function createWithdrawalRequest(input: {
  userId: string;
  amount: number;
  method: string;
  accountDetails: string;
}): Promise<any> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).lean();
  if (settings?.withdrawalsEnabled === false) throw new Error("Withdrawals are currently disabled.");
  const amountMinor = toMinor(input.amount);
  if (amountMinor < toMinor(500)) throw new Error("Minimum withdrawal is 500 PKR.");
  if (!input.method.trim() || !input.accountDetails.trim()) throw new Error("Method and account details are required.");

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
      { session }
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
      { session }
    );
  });

  return created;
}

export async function reviewDeposit(input: {
  depositId: string;
  adminId: string;
  action: "APPROVE" | "REJECT";
  note?: string;
}): Promise<{ userId: string }> {
  let affectedUserId = "";
  await mongoose.connection.transaction(async (session) => {
    const deposit = await DepositRequestModel.findOne({ _id: input.depositId, status: "PENDING" }).session(session);
    if (!deposit) throw new Error("Pending deposit request not found.");
    affectedUserId = String(deposit.userId);
    const amountMinor = Number.isSafeInteger(Number((deposit as any).amountMinor))
      ? Number((deposit as any).amountMinor)
      : toMinor(Number(deposit.amount));

    if (input.action === "REJECT") {
      deposit.status = "REJECTED";
      deposit.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
      deposit.reviewedAt = new Date();
      deposit.reviewNote = input.note?.trim() ?? "";
      await deposit.save({ session });
      return;
    }

    const user = await UserModel.findByIdAndUpdate(
      deposit.userId,
      { $inc: { balanceMinor: amountMinor, balance: fromMinor(amountMinor) } },
      { new: true, session }
    );
    if (!user) throw new Error("Deposit user no longer exists.");

    deposit.status = "APPROVED";
    deposit.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
    deposit.reviewedAt = new Date();
    deposit.reviewNote = input.note?.trim() ?? "";
    (deposit as any).amountMinor = amountMinor;
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
        description: `Deposit approved via ${deposit.method}`
      })],
      { session }
    );

    await PlatformAuditModel.create(
      [{
        eventKey: `deposit-approved:${deposit._id}`,
        type: "DEPOSIT_APPROVED" as const,
        userId: deposit.userId,
        adminId: new mongoose.Types.ObjectId(input.adminId),
        referenceId: String(deposit._id),
        activeBetEscrowAfterMinor: Number((state as any).activeBetEscrowMinor ?? 0),
        reservedLiquidityAfterMinor: Number((state as any).reservedRewardLiquidityMinor ?? 0),
        lossPoolAfterMinor: Number((state as any).lossPoolMinor ?? 0),
        commissionWalletAfterMinor: Number((state as any).commissionWalletMinor ?? 0),
        description: `Approved deposit of ${fromMinor(amountMinor).toFixed(2)} PKR`
      }],
      { session }
    );
  });

  return { userId: affectedUserId };
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
        { session }
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
      { session }
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
      { session }
    );
  });

  return { userId: affectedUserId };
}
