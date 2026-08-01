import { Schema, model } from "mongoose";

export type UserRole = "USER" | "ADMIN" | "SUB_ADMIN";
export type AdminPermission =
  | "OVERVIEW"
  | "BETS"
  | "BONUSES"
  | "USERS"
  | "DEPOSITS"
  | "WITHDRAWALS"
  | "AUDIT"
  | "SETTINGS"
  | "SUPPORT"
  | "CONTENT"
  | "TEAM"
  | "REPORTS"
  | "FAQS"
  | "NOTIFICATIONS"
  | "GAME_CONTROL";
export type UserStatus = "ACTIVE" | "SUSPENDED";
export type AuthProvider = "PASSWORD" | "GOOGLE" | "HYBRID";
export type TransactionType =
  | "DEPOSIT_CREDIT"
  | "WITHDRAWAL_LOCK"
  | "WITHDRAWAL_DEBIT"
  | "WITHDRAWAL_REFUND"
  | "BET_DEBIT"
  | "BET_ESCROW_LOCK"
  | "BET_LOSS"
  | "CASHOUT_CREDIT"
  | "BET_REFUND"
  | "ADMIN_ADJUSTMENT"
  | "LOSS_POOL_CREDIT"
  | "POOL_PAYOUT"
  | "COMMISSION_CREDIT"
  | "COMMISSION_DEBIT"
  | "WAGER_REWARD_UNLOCK"
  | "BONUS_CREDIT";

export type PlatformAuditType =
  | "BET_ESCROW_LOCK"
  | "BET_LOSS_SETTLED"
  | "WINNER_PAID"
  | "BET_REFUNDED"
  | "COMMISSION_CREDIT"
  | "DEPOSIT_APPROVED"
  | "WITHDRAWAL_COMPLETED"
  | "SETTINGS_UPDATED"
  | "BONUS_BUDGET_FUNDED"
  | "BONUS_PAID";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, select: false },
    authProvider: { type: String, enum: ["PASSWORD", "GOOGLE", "HYBRID"], default: "PASSWORD" },
    googleSub: { type: String, unique: true, sparse: true, index: true, select: false },
    avatarUrl: { type: String, default: "", maxlength: 500 },
    phone: { type: String, default: "", maxlength: 40 },
    country: { type: String, default: "Pakistan", maxlength: 80 },
    language: { type: String, default: "English", maxlength: 40 },
    timezone: { type: String, default: "Asia/Karachi", maxlength: 80 },
    bio: { type: String, default: "", maxlength: 240 },
    marketingOptIn: { type: Boolean, default: true },
    gameNotifications: { type: Boolean, default: true },
    supportNotifications: { type: Boolean, default: true },
    adminPermissions: { type: [String], default: [] },
    role: { type: String, enum: ["USER", "ADMIN", "SUB_ADMIN"], default: "USER", index: true },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE", index: true },

    // Integer minor units (paisa) are the accounting source of truth.
    balanceMinor: { type: Number, default: 0, min: 0 },
    withdrawalLockedMinor: { type: Number, default: 0, min: 0 },
    bettingLockedMinor: { type: Number, default: 0, min: 0 },
    pendingRewardsMinor: { type: Number, default: 0, min: 0 },
    wagerRequirementMinor: { type: Number, default: 0, min: 0 },
    wagerTargetMinor: { type: Number, default: 0, min: 0 },
    wagerCompletedMinor: { type: Number, default: 0, min: 0 },
    wagerTrackingVersion: { type: Number, default: 0, min: 0 },
    demoBalanceMinor: { type: Number, default: 10_000_000, min: 0 },
    vipLevel: { type: Number, default: 0, min: 0, max: 12, index: true },
    vipLifetimeDepositMinor: { type: Number, default: 0, min: 0 },
    vipLifetimeValidBetMinor: { type: Number, default: 0, min: 0 },

    // Legacy PKR fields are retained during migration and mirrored for compatibility.
    balance: { type: Number, default: 0, min: 0 },
    lockedBalance: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);

const authSessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" }
  },
  { timestamps: true, versionKey: false }
);

const walletTransactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: [
        "DEPOSIT_CREDIT",
        "WITHDRAWAL_LOCK",
        "WITHDRAWAL_DEBIT",
        "WITHDRAWAL_REFUND",
        "BET_DEBIT",
        "BET_ESCROW_LOCK",
        "BET_LOSS",
        "CASHOUT_CREDIT",
        "BET_REFUND",
        "ADMIN_ADJUSTMENT",
        "LOSS_POOL_CREDIT",
        "POOL_PAYOUT",
        "COMMISSION_CREDIT",
        "COMMISSION_DEBIT",
        "WAGER_REWARD_UNLOCK",
        "BONUS_CREDIT"
      ],
      required: true,
      index: true
    },
    amountMinor: { type: Number, required: true, default: 0 },
    availableDeltaMinor: { type: Number, required: true, default: 0 },
    withdrawalLockedDeltaMinor: { type: Number, required: true, default: 0 },
    bettingLockedDeltaMinor: { type: Number, required: true, default: 0 },
    pendingRewardsDeltaMinor: { type: Number, required: true, default: 0 },
    balanceAfterMinor: { type: Number, required: true, default: 0 },
    withdrawalLockedAfterMinor: { type: Number, required: true, default: 0 },
    bettingLockedAfterMinor: { type: Number, required: true, default: 0 },
    pendingRewardsAfterMinor: { type: Number, required: true, default: 0 },

    // Legacy PKR display fields.
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    lockedBalanceAfter: { type: Number, required: true },
    referenceType: { type: String, default: "" },
    referenceId: { type: String, default: "", index: true },
    description: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, versionKey: false }
);
walletTransactionSchema.index({ userId: 1, createdAt: -1 });

const depositRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, required: true, trim: true, maxlength: 80 },
    reference: { type: String, required: true, trim: true, maxlength: 160 },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: "", maxlength: 500 },
    wageringPercentApplied: { type: Number, min: 0, max: 100 },
    wagerRequirementMinor: { type: Number, min: 0 }
  },
  { timestamps: true, versionKey: false }
);
depositRequestSchema.index({ userId: 1, createdAt: -1 });
depositRequestSchema.index({ userId: 1, status: 1, reviewedAt: 1 });

const withdrawalRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, required: true, trim: true, maxlength: 80 },
    accountDetails: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "REJECTED"],
      default: "PENDING",
      index: true
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: "", maxlength: 500 },
    wageringPercentApplied: { type: Number, min: 0, max: 100 },
    wagerRequirementMinor: { type: Number, min: 0 }
  },
  { timestamps: true, versionKey: false }
);
withdrawalRequestSchema.index({ userId: 1, createdAt: -1 });
withdrawalRequestSchema.index({ userId: 1, status: 1, createdAt: 1 });

const vipLevelRuleSchema = new Schema(
  {
    level: { type: Number, required: true, min: 0, max: 12 },
    requiredDeposit: { type: Number, required: true, min: 0 },
    requiredTurnover: { type: Number, required: true, min: 0 },
    levelUpBonus: { type: Number, required: true, min: 0 },
    dailyWithdrawalLimit: { type: Number, required: true, min: -1 }
  },
  { _id: false, versionKey: false }
);

const monthlyBonusRuleSchema = new Schema(
  {
    requiredDeposit: { type: Number, required: true, min: 0 },
    requiredTurnover: { type: Number, required: true, min: 0 },
    bonus: { type: Number, required: true, min: 0 }
  },
  { _id: false, versionKey: false }
);

const platformSettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    accountingVersion: { type: Number, default: 2 },
    houseEdgePercent: { type: Number, default: 1, min: 0, max: 20 },
    commissionPercent: { type: Number, default: 10, min: 0, max: 50 },
    reservePercent: { type: Number, default: 0, min: 0, max: 95 },
    minBet: { type: Number, default: 16, min: 1 },
    minDeposit: { type: Number, default: 100, min: 1 },
    minWithdrawal: { type: Number, default: 500, min: 1 },
    wageringRequirementPercent: { type: Number, default: 30, min: 0, max: 100 },
    maxBet: { type: Number, default: 100_000, min: 1 },
    maxCashoutMultiplier: { type: Number, default: 10, min: 1.01, max: 1000 },
    depositsEnabled: { type: Boolean, default: true },
    withdrawalsEnabled: { type: Boolean, default: true },
    vipEnabled: { type: Boolean, default: true },
    vipLevelBonusEnabled: { type: Boolean, default: true },
    vipMonthlyBonusEnabled: { type: Boolean, default: true },
    vipWithdrawalLimitsEnabled: { type: Boolean, default: true },
    vipTimezone: { type: String, default: "Asia/Karachi", maxlength: 80 },
    monthlyClaimStartDay: { type: Number, default: 1, min: 1, max: 28 },
    monthlyClaimWindowHours: { type: Number, default: 48, min: 1, max: 744 },
    monthlyClaimForceOpen: { type: Boolean, default: false },
    vipLevels: { type: [vipLevelRuleSchema], default: [] },
    monthlyBonusRules: { type: [monthlyBonusRuleSchema], default: [] },
    testModeEnabled: { type: Boolean, default: false },
    testCrashMultiplier: { type: Number, default: 2, min: 1, max: 1000 },
    whatsappNumber: { type: String, default: "", maxlength: 32 },
    whatsappMessage: { type: String, default: "Hello, I need support with my B9T9 account.", maxlength: 250 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true, versionKey: false }
);

const platformStateSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },

    // Integer minor-unit accounting buckets.
    activeBetEscrowMinor: { type: Number, default: 0, min: 0 },
    reservedRewardLiquidityMinor: { type: Number, default: 0, min: 0 },
    lossPoolMinor: { type: Number, default: 0, min: 0 },
    commissionWalletMinor: { type: Number, default: 0, min: 0 },
    totalCommissionEarnedMinor: { type: Number, default: 0, min: 0 },
    totalApprovedDepositsMinor: { type: Number, default: 0, min: 0 },
    totalCompletedWithdrawalsMinor: { type: Number, default: 0, min: 0 },
    totalRewardsPaidMinor: { type: Number, default: 0, min: 0 },
    totalBetVolumeMinor: { type: Number, default: 0, min: 0 },
    totalLossesMinor: { type: Number, default: 0, min: 0 },
    bonusWalletMinor: { type: Number, default: 0, min: 0 },
    totalBonusFundingMinor: { type: Number, default: 0, min: 0 },
    totalBonusesPaidMinor: { type: Number, default: 0, min: 0 },

    // Legacy fields are ignored by the new settlement engine.
    houseBankroll: { type: Number, default: 0 },
    gameProfit: { type: Number, default: 0 },
    lossPool: { type: Number, default: 0 },
    totalCommissionEarned: { type: Number, default: 0 },
    totalApprovedDeposits: { type: Number, default: 0 },
    totalCompletedWithdrawals: { type: Number, default: 0 }
  },
  { timestamps: true, versionKey: false }
);

const gameRoundSchema = new Schema(
  {
    roundId: { type: String, required: true, unique: true, index: true },
    commit: { type: String, required: true },
    serverSeed: { type: String, required: true, select: false },
    crashPoint: { type: Number, required: true },
    naturalCrashPoint: { type: Number, min: 1 },
    maxCashoutMultiplier: { type: Number, min: 1, default: 1000 },
    liquidityLimited: { type: Boolean, default: false },
    phase: { type: String, enum: ["WAITING", "RUNNING", "CRASHED"], required: true, index: true },
    startedAt: { type: Date },
    crashedAt: { type: Date },
    houseEdgePercent: { type: Number, required: true },
    commissionPercent: { type: Number, required: true, default: 10 },
    totalStakeMinor: { type: Number, default: 0 },
    totalPayoutMinor: { type: Number, default: 0 },
    totalCommissionMinor: { type: Number, default: 0 },
    totalLossesMinor: { type: Number, default: 0 },
    totalStake: { type: Number, default: 0 },
    totalPayout: { type: Number, default: 0 }
  },
  { timestamps: true, versionKey: false }
);
gameRoundSchema.index({ createdAt: -1 });

const gameBetSchema = new Schema(
  {
    betId: { type: String, required: true, unique: true, index: true },
    roundId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    player: { type: String, required: true },
    slot: { type: String, enum: ["left", "right"], required: true },
    amountMinor: { type: Number, required: true },
    reservedLiabilityMinor: { type: Number, required: true, default: 0 },
    payoutMinor: { type: Number, default: 0 },
    commissionMinor: { type: Number, default: 0 },
    wagerContributionMinor: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["QUEUED", "ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"], default: "ACTIVE", index: true },
    cashoutMultiplier: { type: Number },
    payout: { type: Number, default: 0 },
    settledAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);
gameBetSchema.index({ userId: 1, roundId: 1, slot: 1 }, { unique: true });
gameBetSchema.index({ roundId: 1, status: 1 });
gameBetSchema.index({ userId: 1, status: 1, settledAt: 1 });


const demoBetSchema = new Schema(
  {
    betId: { type: String, required: true, unique: true, index: true },
    roundId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    player: { type: String, required: true },
    slot: { type: String, enum: ["left", "right"], required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    payoutMinor: { type: Number, default: 0, min: 0 },
    commissionMinor: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0.01 },
    status: { type: String, enum: ["ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"], default: "ACTIVE", index: true },
    cashoutMultiplier: { type: Number },
    payout: { type: Number, default: 0 },
    settledAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);
demoBetSchema.index({ userId: 1, roundId: 1, slot: 1 }, { unique: true });
demoBetSchema.index({ roundId: 1, status: 1 });

const platformAuditSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: [
        "BET_ESCROW_LOCK",
        "BET_LOSS_SETTLED",
        "WINNER_PAID",
        "BET_REFUNDED",
        "COMMISSION_CREDIT",
        "DEPOSIT_APPROVED",
        "WITHDRAWAL_COMPLETED",
        "SETTINGS_UPDATED",
        "BONUS_BUDGET_FUNDED",
        "BONUS_PAID"
      ],
      required: true,
      index: true
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    adminId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    roundId: { type: String, default: "", index: true },
    betId: { type: String, default: "", index: true },
    referenceId: { type: String, default: "", index: true },
    activeBetEscrowDeltaMinor: { type: Number, default: 0 },
    reservedLiquidityDeltaMinor: { type: Number, default: 0 },
    lossPoolDeltaMinor: { type: Number, default: 0 },
    commissionWalletDeltaMinor: { type: Number, default: 0 },
    bonusWalletDeltaMinor: { type: Number, default: 0 },
    activeBetEscrowAfterMinor: { type: Number, default: 0 },
    reservedLiquidityAfterMinor: { type: Number, default: 0 },
    lossPoolAfterMinor: { type: Number, default: 0 },
    commissionWalletAfterMinor: { type: Number, default: 0 },
    bonusWalletAfterMinor: { type: Number, default: 0 },
    description: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, versionKey: false }
);
platformAuditSchema.index({ createdAt: -1 });

const bonusClaimSchema = new Schema(
  {
    claimKey: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["LEVEL_UP", "MONTHLY"], required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0.01 },
    vipLevel: { type: Number, default: 0, min: 0, max: 12 },
    periodKey: { type: String, default: "", index: true },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, versionKey: false }
);
bonusClaimSchema.index({ userId: 1, createdAt: -1 });
bonusClaimSchema.index({ type: 1, createdAt: -1 });



const passwordResetTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);

const supportConversationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", index: true },
    subject: { type: String, default: "General support", maxlength: 120 },
    assignedAdminId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    unreadForUser: { type: Number, default: 0, min: 0 },
    unreadForAdmin: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, versionKey: false }
);

const supportMessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "SupportConversation", required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    senderRole: { type: String, enum: ["USER", "ADMIN", "SUB_ADMIN"], required: true },
    message: { type: String, required: true, trim: true, maxlength: 1200 },
    readAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);
supportMessageSchema.index({ conversationId: 1, createdAt: 1 });

const contentCampaignSchema = new Schema(
  {
    type: { type: String, enum: ["POPUP", "BANNER", "ANNOUNCEMENT", "NEWS"], required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", maxlength: 2000 },
    imageUrl: { type: String, default: "", maxlength: 700 },
    imageData: { type: String, default: "" },
    linkUrl: { type: String, default: "", maxlength: 700 },
    linkLabel: { type: String, default: "Learn more", maxlength: 60 },
    linkTarget: { type: String, default: "" },
    design: { type: Schema.Types.Mixed, default: {} },
    placement: { type: String, enum: ["LOGIN", "GAME", "BOTH"], default: "GAME", index: true },
    enabled: { type: Boolean, default: true, index: true },
    dismissible: { type: Boolean, default: true },
    priority: { type: Number, default: 0, min: -1000, max: 1000 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true, versionKey: false }
);
contentCampaignSchema.index({ enabled: 1, type: 1, priority: -1, createdAt: -1 });

const faqSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 240 },
    answer: { type: String, required: true, trim: true, maxlength: 4000 },
    category: { type: String, default: "General", maxlength: 80, index: true },
    enabled: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true, versionKey: false }
);
faqSchema.index({ enabled: 1, sortOrder: 1, createdAt: 1 });

const userReportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, enum: ["ACCOUNT", "PAYMENT", "GAME", "SECURITY", "OTHER"], default: "OTHER", index: true },
    subject: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 3000 },
    status: { type: String, enum: ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"], default: "OPEN", index: true },
    adminNote: { type: String, default: "", maxlength: 2000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);
userReportSchema.index({ status: 1, createdAt: -1 });

const notificationCampaignSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 1200 },
    targetType: { type: String, enum: ["ALL", "SELECTED"], default: "ALL" },
    userIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ["DRAFT", "SCHEDULED", "SENDING", "SENT", "CANCELLED"], default: "DRAFT", index: true },
    scheduledAt: { type: Date, index: true },
    sentAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sentBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true, versionKey: false }
);
notificationCampaignSchema.index({ status: 1, scheduledAt: 1 });

const userNotificationSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "NotificationCampaign", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    readAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);
userNotificationSchema.index({ userId: 1, createdAt: -1 });
userNotificationSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

const chatMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    player: { type: String, required: true },
    message: { type: String, required: true, maxlength: 160 }
  },
  { timestamps: true, versionKey: false }
);
chatMessageSchema.index({ createdAt: -1 });

export const UserModel = model("User", userSchema);
export const AuthSessionModel = model("AuthSession", authSessionSchema);
export const WalletTransactionModel = model("WalletTransaction", walletTransactionSchema);
export const DepositRequestModel = model("DepositRequest", depositRequestSchema);
export const WithdrawalRequestModel = model("WithdrawalRequest", withdrawalRequestSchema);
export const PlatformSettingsModel = model("PlatformSettings", platformSettingsSchema);
export const PlatformStateModel = model("PlatformState", platformStateSchema);
export const GameRoundModel = model("GameRound", gameRoundSchema);
export const GameBetModel = model("GameBet", gameBetSchema);
export const DemoBetModel = model("DemoBet", demoBetSchema);
export const PlatformAuditModel = model("PlatformAudit", platformAuditSchema);
export const BonusClaimModel = model("BonusClaim", bonusClaimSchema);
export const ChatMessageModel = model("ChatMessage", chatMessageSchema);
export const PasswordResetTokenModel = model("PasswordResetToken", passwordResetTokenSchema);
export const SupportConversationModel = model("SupportConversation", supportConversationSchema);
export const SupportMessageModel = model("SupportMessage", supportMessageSchema);
export const ContentCampaignModel = model("ContentCampaign", contentCampaignSchema);
export const FaqModel = model("Faq", faqSchema);
export const UserReportModel = model("UserReport", userReportSchema);
export const NotificationCampaignModel = model("NotificationCampaign", notificationCampaignSchema);
export const UserNotificationModel = model("UserNotification", userNotificationSchema);
