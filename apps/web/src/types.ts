export type RoundPhase = "WAITING" | "RUNNING" | "CRASHED";
export type BetSlot = "left" | "right";
export type AccountMode = "REAL" | "DEMO";
export type UserRole = "USER" | "ADMIN";
export type AuthProvider = "PASSWORD" | "GOOGLE" | "HYBRID";

export interface PublicBet {
  id: string;
  player: string;
  amount: number;
  slot: BetSlot;
  status: "QUEUED" | "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED";
  cashoutMultiplier?: number;
  payout?: number;
  guaranteedMaxMultiplier?: number;
  isDemo?: boolean;
  isDemoBot?: boolean;
}

export interface RoundHistoryItem {
  roundId: string;
  crashPoint: number;
  crashedAt: number;
}

export interface RoundProof {
  roundId: string;
  result: number;
  crashedAt: number;
  serverSeed: string;
  clientSeed: string;
  commit: string;
  calculatedCommit: string;
  combinedHash: string;
  resultHex: string;
  resultDecimal: string;
  calculatedResult: number;
  naturalResult: number;
  liquidityLimited: boolean;
  verified: boolean;
  verificationStatus: "VERIFIED" | "PARTIAL" | "FAILED";
}

export interface RoundSnapshot {
  roundId: string;
  phase: RoundPhase;
  multiplier: number;
  phaseEndsAt: number | null;
  startedAt: number | null;
  crashPoint?: number;
  commit: string;
  history: RoundHistoryItem[];
  bets: PublicBet[];
  demoBets: PublicBet[];
  online: number;
  automatedOnline: number;
  demoOnline: number;
  houseEdgePercent: number;
  lossPool: number;
  commissionPercent: number;
  activeBetEscrow: number;
  reservedRewardLiquidity: number;
  availableRewardLiquidity: number;
}

export interface RoundTick {
  roundId: string;
  phase: RoundPhase;
  multiplier: number;
  phaseEndsAt: number | null;
  startedAt: number | null;
  crashPoint?: number;
}

export interface WalletSnapshot {
  balance: number;
  lockedBalance: number;
  bettingLockedBalance: number;
  pendingRewards: number;
  wagerRequirementRemaining: number;
  wagerRequirementTarget: number;
  wagerRequirementCompleted: number;
  totalBalance: number;
  activeBets: Partial<Record<BetSlot, PublicBet>>;
  queuedBets: Partial<Record<BetSlot, PublicBet>>;
  demoBalance: number;
  demoActiveBets: Partial<Record<BetSlot, PublicBet>>;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED";
  authProvider: AuthProvider;
  avatarUrl: string;
  balance: number;
  lockedBalance: number;
  bettingLockedBalance: number;
  pendingRewards: number;
  wagerRequirementRemaining: number;
  wagerRequirementTarget: number;
  wagerRequirementCompleted: number;
  totalBalance: number;
  demoBalance: number;
}

export interface ChatItem {
  id: string;
  player: string;
  message: string;
  createdAt: number;
}

export interface WalletTransaction {
  _id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  lockedBalanceAfter: number;
  bettingLockedAfter?: number;
  pendingRewardsAfter?: number;
  description: string;
  createdAt: string;
}

export interface DepositRequest {
  _id: string;
  userId: string | { _id: string; name: string; email: string };
  amount: number;
  method: string;
  reference: string;
  note?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

export interface WithdrawalRequest {
  _id: string;
  userId: string | { _id: string; name: string; email: string };
  amount: number;
  method: string;
  accountDetails: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
  createdAt: string;
}

export interface AdminWalletTransaction extends WalletTransaction {
  userId: string | { _id: string; name: string; email: string };
}

export interface PlatformAuditItem {
  _id: string;
  type: string;
  description: string;
  userId?: string | { _id: string; name: string; email: string };
  adminId?: string | { _id: string; name: string; email: string };
  roundId?: string;
  betId?: string;
  activeBetEscrowDelta: number;
  reservedLiquidityDelta: number;
  lossPoolDelta: number;
  commissionWalletDelta: number;
  bonusWalletDelta: number;
  activeBetEscrowAfter: number;
  reservedLiquidityAfter: number;
  lossPoolAfter: number;
  commissionWalletAfter: number;
  bonusWalletAfter: number;
  createdAt: string;
}

export type BonusSection = "LEVEL_UP" | "MONTHLY" | "WITHDRAWAL";

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

export interface BonusDashboard {
  ok: true;
  config: {
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
  };
  progress: {
    vipLevel: number;
    lifetimeDeposit: number;
    lifetimeValidBet: number;
    currentRule: VipLevelRule;
    nextRule: VipLevelRule | null;
    depositPercent: number;
    turnoverPercent: number;
  };
  levelUp: {
    enabled: boolean;
    claimableLevels: number[];
    claimableAmount: number;
    claimedLevels: number[];
  };
  monthly: {
    enabled: boolean;
    currentPeriodKey: string;
    currentDeposit: number;
    currentValidBet: number;
    projectedBonus: number;
    claimPeriodKey: string;
    claimDeposit: number;
    claimValidBet: number;
    eligibleBonus: number;
    claimed: boolean;
    claimedAt: string | null;
    claimOpen: boolean;
    claimWindowStart: string;
    claimWindowEnd: string;
    claimWindowForced: boolean;
  };
  withdrawal: {
    dailyLimit: number;
    unlimited: boolean;
    usedToday: number;
    remainingToday: number | null;
    timezone: string;
  };
  wallet: { bonusBudget: number };
  recentClaims: Array<{
    id: string;
    type: "LEVEL_UP" | "MONTHLY";
    vipLevel: number;
    periodKey: string;
    amount: number;
    createdAt: string;
  }>;
}
