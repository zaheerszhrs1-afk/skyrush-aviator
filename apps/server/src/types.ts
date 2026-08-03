export type RoundPhase = "WAITING" | "RUNNING" | "CRASHED";
export type BetSlot = "left" | "right";

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
  online: number;
  automatedOnline: number;
  houseEdgePercent: number;
  lossPool: number;
  commissionPercent: number;
  activeBetEscrow: number;
  reservedRewardLiquidity: number;
  availableRewardLiquidity: number;
  testMode?: boolean;
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
}
