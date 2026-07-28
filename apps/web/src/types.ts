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
}

export interface WalletSnapshot {
  balance: number;
  lockedBalance: number;
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
