export type RoundPhase = "WAITING" | "RUNNING" | "CRASHED";
export type BetSlot = "left" | "right";
export type UserRole = "USER" | "ADMIN";

export interface PublicBet {
  id: string;
  player: string;
  amount: number;
  slot: BetSlot;
  status: "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED";
  cashoutMultiplier?: number;
  payout?: number;
  guaranteedMaxMultiplier?: number;
}

export interface RoundSnapshot {
  roundId: string;
  phase: RoundPhase;
  multiplier: number;
  phaseEndsAt: number | null;
  startedAt: number | null;
  crashPoint?: number;
  commit: string;
  history: number[];
  bets: PublicBet[];
  online: number;
  houseEdgePercent: number;
  lossPool: number;
  commissionPercent: number;
  activeBetEscrow: number;
  reservedRewardLiquidity: number;
  availableRewardLiquidity: number;
}

export interface WalletSnapshot {
  balance: number;
  lockedBalance: number;
  bettingLockedBalance: number;
  pendingRewards: number;
  totalBalance: number;
  activeBets: Partial<Record<BetSlot, PublicBet>>;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "ACTIVE" | "SUSPENDED";
  balance: number;
  lockedBalance: number;
  bettingLockedBalance: number;
  pendingRewards: number;
  totalBalance: number;
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
  activeBetEscrowAfter: number;
  reservedLiquidityAfter: number;
  lossPoolAfter: number;
  commissionWalletAfter: number;
  createdAt: string;
}
