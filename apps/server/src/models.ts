import { Schema, model } from "mongoose";

export type UserRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED";
export type TransactionType =
  | "DEPOSIT_CREDIT"
  | "WITHDRAWAL_LOCK"
  | "WITHDRAWAL_DEBIT"
  | "WITHDRAWAL_REFUND"
  | "BET_DEBIT"
  | "CASHOUT_CREDIT"
  | "BET_REFUND"
  | "ADMIN_ADJUSTMENT";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["USER", "ADMIN"], default: "USER", index: true },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE", index: true },
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
        "CASHOUT_CREDIT",
        "BET_REFUND",
        "ADMIN_ADJUSTMENT"
      ],
      required: true,
      index: true
    },
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
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, required: true, trim: true, maxlength: 80 },
    reference: { type: String, required: true, trim: true, maxlength: 160 },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: "", maxlength: 500 }
  },
  { timestamps: true, versionKey: false }
);
depositRequestSchema.index({ userId: 1, createdAt: -1 });

const withdrawalRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
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
    reviewNote: { type: String, default: "", maxlength: 500 }
  },
  { timestamps: true, versionKey: false }
);
withdrawalRequestSchema.index({ userId: 1, createdAt: -1 });

const platformSettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    houseEdgePercent: { type: Number, default: 1, min: 0, max: 20 },
    reservePercent: { type: Number, default: 30, min: 0, max: 95 },
    minBet: { type: Number, default: 16, min: 1 },
    maxBet: { type: Number, default: 100_000, min: 1 },
    maxCashoutMultiplier: { type: Number, default: 100, min: 1.01, max: 1000 },
    depositsEnabled: { type: Boolean, default: true },
    withdrawalsEnabled: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true, versionKey: false }
);

const platformStateSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    houseBankroll: { type: Number, default: 0 },
    gameProfit: { type: Number, default: 0 },
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
    phase: { type: String, enum: ["WAITING", "RUNNING", "CRASHED"], required: true, index: true },
    startedAt: { type: Date },
    crashedAt: { type: Date },
    houseEdgePercent: { type: Number, required: true },
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
    amount: { type: Number, required: true },
    status: { type: String, enum: ["ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"], default: "ACTIVE", index: true },
    cashoutMultiplier: { type: Number },
    payout: { type: Number, default: 0 },
    settledAt: { type: Date }
  },
  { timestamps: true, versionKey: false }
);
gameBetSchema.index({ userId: 1, roundId: 1, slot: 1 }, { unique: true });
gameBetSchema.index({ roundId: 1, status: 1 });

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
export const ChatMessageModel = model("ChatMessage", chatMessageSchema);

