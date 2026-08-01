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
  startedAt: round.startedAt,
  crashPoint: round.crashPoint
});

socket.on("round:tick", (tick: RoundTick) => {
  currentTick = tick;
  notify();
});

// The server sends this phase-boundary event reliably so the takeoff frame is
// not lost when volatile multiplier packets are being dropped for a slow
// client.
socket.on("round:started", (tick: RoundTick) => {
  currentTick = tick;
  notify();
});

socket.on("round:state", (round: RoundSnapshot) => {
  currentTick = snapshotFromRound(round);
  notify();
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
