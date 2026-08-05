import { useSyncExternalStore } from "react";
import type { RoundSnapshot, RoundTick } from "../types";
import { socket } from "./socket";

type Listener = () => void;

let currentTick: RoundTick | null = null;
const listeners = new Set<Listener>();

const notify = () => {
  for (const listener of listeners) listener();
};

const snapshotFromRound = (round: RoundSnapshot): RoundTick => ({
  roundId: round.roundId,
  phase: round.phase,
  multiplier: round.multiplier,
  phaseEndsAt: round.phaseEndsAt,
  nextRoundStartsAt: round.nextRoundStartsAt,
  startedAt: round.startedAt,
  serverTime: round.serverTime,
  crashPoint: round.crashPoint
});

const acceptTick = (tick: RoundTick) => {
  // A reliable snapshot can arrive after a newer volatile tick. Keep the
  // newest server timestamp so the UI never regresses from RUNNING back to a
  // stale countdown frame or displays an older multiplier.
  if (currentTick?.roundId === tick.roundId && tick.serverTime < currentTick.serverTime) return;
  currentTick = tick;
  notify();
};

socket.on("round:tick", acceptTick);

// The server sends this phase-boundary event reliably so the takeoff frame is
// not lost when volatile multiplier packets are being dropped for a slow
// client.
socket.on("round:started", acceptTick);

socket.on("round:state", (round: RoundSnapshot) => {
  acceptTick(snapshotFromRound(round));
});

socket.on("disconnect", () => {
  currentTick = null;
  notify();
});

export const subscribeRoundTick = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getRoundTickSnapshot = (): RoundTick | null => currentTick;

export function useRoundTick(round: RoundSnapshot): RoundSnapshot {
  const tick = useSyncExternalStore(subscribeRoundTick, getRoundTickSnapshot, () => null);
  return tick?.roundId === round.roundId ? { ...round, ...tick } : round;
}
