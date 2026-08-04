import * as crypto from "node:crypto";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { BonusClaimModel, DepositRequestModel, PlatformAuditModel, PlatformSettingsModel, PlatformStateModel, UserModel, WalletTransactionModel } from "./models.js";
import { fromMinor, toMinor } from "./money.js";
import { vipConfigFromSettings } from "./bonus.js";

type ReferralRewardType = "REFERRAL_INVITATION" | "REFERRAL_DEPOSIT" | "REFERRAL_BET";

export async function createReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = crypto.randomBytes(6).toString("base64url").slice(0, 9).toUpperCase();
    if (!(await UserModel.exists({ referralCode: candidate }))) return candidate;
  }
  throw new Error("Unable to create a referral code.");
}

export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await UserModel.findById(userId).select("referralCode");
  if (!user) throw new Error("User not found.");
  if (user.referralCode) return String(user.referralCode);
  const referralCode = await createReferralCode();
  user.referralCode = referralCode;
  await user.save();
  return referralCode;
}

const publicAppBaseUrl = () => (process.env.PUBLIC_APP_URL?.trim() || process.env.CLIENT_ORIGIN?.split(",")[0]?.trim() || "").replace(/\/$/, "");

async function creditReferralReward(input: {
  recipientId: string;
  referredUserId: string;
  type: ReferralRewardType;
  amountMinor: number;
  claimKey: string;
  referralLevel: number;
  description: string;
  session: ClientSession;
}): Promise<boolean> {
  if (input.amountMinor <= 0) return false;
  const existing = await BonusClaimModel.findOne({ claimKey: input.claimKey }).session(input.session).select("_id").lean();
  if (existing) return false;
  const recipient = await UserModel.findOne({ _id: input.recipientId, status: "ACTIVE" }).select("_id").session(input.session).lean();
  if (!recipient) return false;
  const state = await PlatformStateModel.findOneAndUpdate(
    { key: "global", bonusWalletMinor: { $gte: input.amountMinor } },
    { $inc: { bonusWalletMinor: -input.amountMinor, totalBonusesPaidMinor: input.amountMinor } },
    { new: true, session: input.session }
  );
  if (!state) return false;
  const user = await UserModel.findOneAndUpdate(
    { _id: input.recipientId, status: "ACTIVE" },
    { $inc: { balanceMinor: input.amountMinor, balance: fromMinor(input.amountMinor) } },
    { new: true, session: input.session }
  );
  if (!user) throw new Error("Referral recipient became unavailable during payout.");
  const [claim] = await BonusClaimModel.create([{
    claimKey: input.claimKey,
    userId: new mongoose.Types.ObjectId(input.recipientId),
    type: input.type,
    amountMinor: input.amountMinor,
    amount: fromMinor(input.amountMinor),
    referredUserId: new mongoose.Types.ObjectId(input.referredUserId),
    referralLevel: input.referralLevel,
    metadata: { referralLevel: input.referralLevel }
  }], { session: input.session, ordered: true });
  await WalletTransactionModel.create([{
    userId: new mongoose.Types.ObjectId(input.recipientId),
    type: "BONUS_CREDIT",
    amountMinor: input.amountMinor,
    availableDeltaMinor: input.amountMinor,
    withdrawalLockedDeltaMinor: 0,
    bettingLockedDeltaMinor: 0,
    pendingRewardsDeltaMinor: 0,
    balanceAfterMinor: Number((user as any).balanceMinor ?? 0),
    withdrawalLockedAfterMinor: Number((user as any).withdrawalLockedMinor ?? 0),
    bettingLockedAfterMinor: Number((user as any).bettingLockedMinor ?? 0),
    pendingRewardsAfterMinor: Number((user as any).pendingRewardsMinor ?? 0),
    amount: fromMinor(input.amountMinor),
    balanceAfter: fromMinor(Number((user as any).balanceMinor ?? 0)),
    lockedBalanceAfter: fromMinor(Number((user as any).withdrawalLockedMinor ?? 0)),
    referenceType: "REFERRAL",
    referenceId: String(claim._id),
    description: input.description,
    metadata: { type: input.type, referredUserId: input.referredUserId, referralLevel: input.referralLevel }
  }], { session: input.session, ordered: true });
  await PlatformAuditModel.create([{
    eventKey: `referral:${crypto.randomUUID()}`,
    type: "BONUS_PAID" as const,
    userId: new mongoose.Types.ObjectId(input.recipientId),
    referenceId: String(claim._id),
    bonusWalletDeltaMinor: -input.amountMinor,
    activeBetEscrowAfterMinor: Number((state as any).activeBetEscrowMinor ?? 0),
    reservedLiquidityAfterMinor: Number((state as any).reservedRewardLiquidityMinor ?? 0),
    lossPoolAfterMinor: Number((state as any).lossPoolMinor ?? 0),
    commissionWalletAfterMinor: Number((state as any).commissionWalletMinor ?? 0),
    bonusWalletAfterMinor: Number((state as any).bonusWalletMinor ?? 0),
    description: input.description,
    metadata: { type: input.type, amountMinor: input.amountMinor, referredUserId: input.referredUserId }
  }], { session: input.session, ordered: true });
  return true;
}

export async function processReferralDeposit(input: { referredUserId: string; depositId: string; amountMinor: number; session: ClientSession }): Promise<void> {
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).session(input.session).lean();
  const config = vipConfigFromSettings(settings);
  if (!config.referralEnabled || input.amountMinor < toMinor(config.referralMinDeposit)) return;
  const referredUser = await UserModel.findById(input.referredUserId).select("referredBy").session(input.session).lean();
  const referrerId = referredUser?.referredBy ? String(referredUser.referredBy) : "";
  if (!referrerId) return;
  const approvedDepositCount = await DepositRequestModel.countDocuments({ userId: input.referredUserId, status: "APPROVED" }).session(input.session);
  if (approvedDepositCount !== 1) return;

  const depositRewardMinor = Math.round(input.amountMinor * (config.referralDepositPercent / 100));
  await creditReferralReward({
    recipientId: referrerId,
    referredUserId: input.referredUserId,
    type: "REFERRAL_DEPOSIT",
    amountMinor: depositRewardMinor,
    claimKey: `REFERRAL_DEPOSIT:${input.depositId}`,
    referralLevel: 1,
    description: `Referral deposit bonus from a first deposit of ${fromMinor(input.amountMinor).toFixed(2)} PKR`,
    session: input.session
  });

  const directUsers = await UserModel.find({ referredBy: referrerId, role: "USER" }).select("_id").session(input.session).lean();
  const directIds = directUsers.map((item) => item._id);
  const validInviteRows = directIds.length === 0 ? [] : await DepositRequestModel.aggregate([
    { $match: { userId: { $in: directIds }, status: "APPROVED", amountMinor: { $gte: toMinor(config.referralMinDeposit) } } },
    { $group: { _id: "$userId" } }
  ]).session(input.session);
  const invitationRule = config.referralInvitationRules.find((item) => validInviteRows.length >= item.minInvites && validInviteRows.length <= item.maxInvites);
  if (invitationRule) {
    await creditReferralReward({
      recipientId: referrerId,
      referredUserId: input.referredUserId,
      type: "REFERRAL_INVITATION",
      amountMinor: toMinor(invitationRule.reward),
      claimKey: `REFERRAL_INVITATION:${input.referredUserId}`,
      referralLevel: invitationRule.level,
      description: `Invitation bonus for ${validInviteRows.length} valid invited player${validInviteRows.length === 1 ? "" : "s"}`,
      session: input.session
    });
  }
}

export async function processReferralBet(input: { bettorId: string; betId: string; stakeMinor: number; session: ClientSession }): Promise<void> {
  if (input.stakeMinor <= 0) return;
  const settings = await PlatformSettingsModel.findOne({ key: "global" }).session(input.session).lean();
  const config = vipConfigFromSettings(settings);
  if (!config.referralEnabled || config.referralCommissionRates.length === 0) return;
  let parentId = "";
  let current = await UserModel.findById(input.bettorId).select("referredBy").session(input.session).lean();
  for (let level = 1; level <= 3 && current?.referredBy; level += 1) {
    parentId = String(current.referredBy);
    const rate = config.referralCommissionRates.find((item) => item.level === level);
    if (rate) {
      await creditReferralReward({
        recipientId: parentId,
        referredUserId: input.bettorId,
        type: "REFERRAL_BET",
        amountMinor: Math.round(input.stakeMinor * (rate.percent / 100)),
        claimKey: `REFERRAL_BET:${input.betId}:L${level}`,
        referralLevel: level,
        description: `Betting commission from referred player at team level ${level}`,
        session: input.session
      });
    }
    current = await UserModel.findById(parentId).select("referredBy").session(input.session).lean();
  }
}

export async function getReferralDashboard(userId: string): Promise<any> {
  const [settings, user] = await Promise.all([
    PlatformSettingsModel.findOne({ key: "global" }).lean(),
    UserModel.findById(userId).select("referralCode").lean()
  ]);
  const config = vipConfigFromSettings(settings);
  const code = user?.referralCode || await ensureReferralCode(userId);
  const [levelOne, claims] = await Promise.all([
    UserModel.find({ referredBy: userId, role: "USER" }).select("name email phone createdAt").sort({ createdAt: -1 }).limit(500).lean(),
    BonusClaimModel.find({ userId, type: { $in: ["REFERRAL_INVITATION", "REFERRAL_DEPOSIT", "REFERRAL_BET"] } }).sort({ createdAt: -1 }).limit(200).lean()
  ]);
  const levelOneIds = levelOne.map((item) => item._id);
  const levelTwo = levelOneIds.length
    ? await UserModel.find({ referredBy: { $in: levelOneIds }, role: "USER" }).select("name email phone createdAt").limit(500).lean()
    : [];
  const levelTwoIds = levelTwo.map((item) => item._id);
  const levelThree = levelTwoIds.length
    ? await UserModel.countDocuments({ referredBy: { $in: levelTwoIds }, role: "USER" })
    : 0;
  const validInviteIds = levelOneIds.length ? await DepositRequestModel.aggregate([
    { $match: { userId: { $in: levelOneIds }, status: "APPROVED", amountMinor: { $gte: toMinor(config.referralMinDeposit) } } },
    { $group: { _id: "$userId" } }
  ]) : [];
  const sumType = (types: string[]) => claims.filter((item: any) => types.includes(item.type)).reduce((sum, item: any) => sum + Number(item.amount ?? fromMinor(item.amountMinor ?? 0)), 0);
  const mask = (item: any) => ({ id: String(item._id), name: String(item.name ?? "Player"), phone: String(item.phone ?? "").replace(/(\d{3})\d+(\d{2})$/, "$1***$2"), createdAt: item.createdAt });
  return {
    ok: true,
    enabled: config.referralEnabled,
    code,
    inviteUrl: `${publicAppBaseUrl()}/refer/${code}`,
    minDeposit: config.referralMinDeposit,
    stats: {
      totalIncome: sumType(["REFERRAL_INVITATION", "REFERRAL_DEPOSIT", "REFERRAL_BET"]),
      totalInvites: levelOne.length,
      validInvites: validInviteIds.length,
      invitationBonus: sumType(["REFERRAL_INVITATION"]),
      depositBonus: sumType(["REFERRAL_DEPOSIT"]),
      betBonus: sumType(["REFERRAL_BET"])
    },
    team: { levelOne: levelOne.length, levelTwo: levelTwo.length, levelThree, members: levelOne.slice(0, 30).map(mask) },
    invitationRules: config.referralInvitationRules,
    commissionRates: config.referralCommissionRates,
    recentRewards: claims.slice(0, 20).map((item: any) => ({ id: String(item._id), type: item.type, amount: Number(item.amount ?? fromMinor(item.amountMinor ?? 0)), level: Number(item.referralLevel ?? 0), createdAt: item.createdAt }))
  };
}
