export type RoundPhase = "WAITING" | "RUNNING" | "CRASHED";
export type BetSlot = "left" | "right";

export interface PublicBet {
  id: string;
  player: string;
  amount: number;
  slot: BetSlot;
  status: "ACTIVE" | "CASHED_OUT" | "LOST";
  cashoutMultiplier?: number;
  payout?: number;
  isBot?: boolean;
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
}

export interface WalletSnapshot {
  balance: number;
  activeBets: Partial<Record<BetSlot, PublicBet>>;
}

export interface ChatItem {
  id: string;
  player: string;
  message: string;
  createdAt: number;
}
