export type RoundPhase = "WAITING" | "RUNNING" | "CRASHED";
export type BetSlot = "left" | "right";
export type AccountMode = "REAL" | "DEMO";

export interface PublicBet {
  id: string;
  player: string;
  amount: number;
  slot: BetSlot;
  status: "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED";
  cashoutMultiplier?: number;
  payout?: number;
  guaranteedMaxMultiplier?: number;
  isDemo?: boolean;
  isDemoBot?: boolean;
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
  demoBets: PublicBet[];
  online: number;
  demoOnline: number;
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
  demoBalance: number;
  demoActiveBets: Partial<Record<BetSlot, PublicBet>>;
}
