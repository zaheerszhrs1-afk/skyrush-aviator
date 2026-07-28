import mongoose from "mongoose";
import {
  DepositRequestModel,
  PlatformSettingsModel,
  PlatformStateModel,
  UserModel,
  WalletTransactionModel,
  WithdrawalRequestModel
} from "./models.js";

const money = (value: number): number => Number(value.toFixed(2));

export async function getWalletSnapshot(userId: string): Promise<{ balance: number; lockedBalance: number }> {
  const user = await UserModel.findById(userId).select("balance lockedBalance").lean();
  if (!user) throw new Error("User not found.");
  return {
    balance: money(Number(user.balance ?? 0)),
    lockedBalance: money(Number(user.lockedBalance ?? 0))
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
  if (!Number.isFinite(input.amount) || input.amount < 100) throw new Error("Minimum deposit is 100 PKR.");
  if (!input.method.trim() || !input.reference.trim()) throw new Error("Method and payment reference are required.");

  return DepositRequestModel.create({
    userId: input.userId,
    amount: money(input.amount),
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
  const amount = money(input.amount);
  if (!Number.isFinite(amount) || amount < 500) throw new Error("Minimum withdrawal is 500 PKR.");
  if (!input.method.trim() || !input.accountDetails.trim()) throw new Error("Method and account details are required.");

  let created: any;
  await mongoose.connection.transaction(async (session) => {
    const user = await UserModel.findOneAndUpdate(
      { _id: input.userId, status: "ACTIVE", balance: { $gte: amount } },
      { $inc: { balance: -amount, lockedBalance: amount } },
      { new: true, session }
    );
    if (!user) throw new Error("Insufficient available balance.");

    const [withdrawal] = await WithdrawalRequestModel.create(
      [{
        userId: input.userId,
        amount,
        method: input.method.trim(),
        accountDetails: input.accountDetails.trim()
      }],
      { session }
    );
    created = withdrawal;

    await WalletTransactionModel.create(
      [{
        userId: input.userId,
        type: "WITHDRAWAL_LOCK",
        amount: -amount,
        balanceAfter: money(user.balance),
        lockedBalanceAfter: money(user.lockedBalance),
        referenceType: "WITHDRAWAL",
        referenceId: String(withdrawal._id),
        description: "Withdrawal amount locked pending review"
      }],
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
      { $inc: { balance: deposit.amount } },
      { new: true, session }
    );
    if (!user) throw new Error("Deposit user no longer exists.");

    deposit.status = "APPROVED";
    deposit.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
    deposit.reviewedAt = new Date();
    deposit.reviewNote = input.note?.trim() ?? "";
    await deposit.save({ session });

    await PlatformStateModel.updateOne(
      { key: "global" },
      { $inc: { totalApprovedDeposits: deposit.amount } },
      { session, upsert: true }
    );

    await WalletTransactionModel.create(
      [{
        userId: deposit.userId,
        type: "DEPOSIT_CREDIT",
        amount: deposit.amount,
        balanceAfter: money(user.balance),
        lockedBalanceAfter: money(user.lockedBalance),
        referenceType: "DEPOSIT",
        referenceId: String(deposit._id),
        description: `Deposit approved via ${deposit.method}`
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
        { _id: withdrawal.userId, lockedBalance: { $gte: withdrawal.amount } },
        { $inc: { balance: withdrawal.amount, lockedBalance: -withdrawal.amount } },
        { new: true, session }
      );
      if (!user) throw new Error("Unable to restore the locked withdrawal balance.");

      withdrawal.status = "REJECTED";
      withdrawal.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
      withdrawal.reviewedAt = new Date();
      withdrawal.reviewNote = input.note?.trim() ?? "";
      await withdrawal.save({ session });

      await WalletTransactionModel.create(
        [{
          userId: withdrawal.userId,
          type: "WITHDRAWAL_REFUND",
          amount: withdrawal.amount,
          balanceAfter: money(user.balance),
          lockedBalanceAfter: money(user.lockedBalance),
          referenceType: "WITHDRAWAL",
          referenceId: String(withdrawal._id),
          description: "Rejected withdrawal restored to wallet"
        }],
        { session }
      );
      return;
    }

    const user = await UserModel.findOneAndUpdate(
      { _id: withdrawal.userId, lockedBalance: { $gte: withdrawal.amount } },
      { $inc: { lockedBalance: -withdrawal.amount } },
      { new: true, session }
    );
    if (!user) throw new Error("Unable to settle the locked withdrawal balance.");

    withdrawal.status = "COMPLETED";
    withdrawal.reviewedBy = new mongoose.Types.ObjectId(input.adminId);
    withdrawal.reviewedAt = new Date();
    withdrawal.reviewNote = input.note?.trim() ?? "";
    await withdrawal.save({ session });

    await PlatformStateModel.updateOne(
      { key: "global" },
      { $inc: { totalCompletedWithdrawals: withdrawal.amount } },
      { session, upsert: true }
    );

    await WalletTransactionModel.create(
      [{
        userId: withdrawal.userId,
        type: "WITHDRAWAL_DEBIT",
        amount: -withdrawal.amount,
        balanceAfter: money(user.balance),
        lockedBalanceAfter: money(user.lockedBalance),
        referenceType: "WITHDRAWAL",
        referenceId: String(withdrawal._id),
        description: `Withdrawal completed via ${withdrawal.method}`
      }],
      { session }
    );
  });

  return { userId: affectedUserId };
}
