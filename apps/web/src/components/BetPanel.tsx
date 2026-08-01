import { useEffect, useRef, useState } from "react";
import type { AccountMode, BetSlot, RoundSnapshot, WalletSnapshot } from "../types";
import { socket } from "../lib/socket";
import { useRoundTick } from "../lib/round-tick";

type Props = {
  slot: BetSlot;
  round: RoundSnapshot;
  wallet: WalletSnapshot;
  accountMode: AccountMode;
  onNotify: (message: string, type?: "error" | "success") => void;
};

type BetActionResult = {
  ok: boolean;
  message: string;
  queued?: boolean;
};

const quickAmounts = [64, 160, 320, 1600];

export function BetPanel({ slot, round, wallet, accountMode, onNotify }: Props) {
  const roundState = useRoundTick(round);
  const [mode, setMode] = useState<"bet" | "auto">("bet");
  const [amount, setAmount] = useState(16);
  const [autoBet, setAutoBet] = useState(false);
  const [autoCashOut, setAutoCashOut] = useState(false);
  const [autoAt, setAutoAt] = useState(1.1);
  const [message, setMessage] = useState("");
  const [actionPending, setActionPending] = useState<"place" | "cashout" | null>(null);
  const autoPlaceRequestRef = useRef<string | null>(null);
  const autoCashoutRequestRef = useRef<string | null>(null);
  const lastAutoPlaceRef = useRef<string | null>(null);
  const lastAutoCashoutRef = useRef<string | null>(null);
  const activeBet = accountMode === "DEMO" ? wallet.demoActiveBets[slot] : wallet.activeBets[slot];
  const queuedBet = accountMode === "REAL" ? wallet.queuedBets[slot] : undefined;
  const acceptedBet = queuedBet ?? (activeBet && roundState.phase !== "RUNNING" ? activeBet : undefined);
  const payableMultiplier = activeBet
    ? Math.min(roundState.multiplier, activeBet.guaranteedMaxMultiplier ?? roundState.multiplier)
    : roundState.multiplier;
  const estimatedCashout = activeBet
    ? activeBet.amount + Math.max(0, activeBet.amount * (payableMultiplier - 1)) * (1 - roundState.commissionPercent / 100)
    : 0;

  useEffect(() => {
    setMessage("");
    setActionPending(null);
    setAutoBet(false);
    setAutoCashOut(false);
    autoPlaceRequestRef.current = null;
    autoCashoutRequestRef.current = null;
    lastAutoPlaceRef.current = null;
    lastAutoCashoutRef.current = null;
  }, [accountMode]);

  useEffect(() => {
    if (!actionPending) return;

    const walletSynced = actionPending === "place"
      ? Boolean(activeBet || queuedBet)
      : !activeBet;
    if (walletSynced) {
      setActionPending(null);
      return;
    }

    const fallback = window.setTimeout(() => setActionPending(null), 3000);
    return () => window.clearTimeout(fallback);
  }, [actionPending, activeBet?.id, queuedBet?.id]);

  useEffect(() => {
    if (!autoBet) {
      autoPlaceRequestRef.current = null;
      lastAutoPlaceRef.current = null;
    }
  }, [autoBet]);

  useEffect(() => {
    if (!autoCashOut) {
      autoCashoutRequestRef.current = null;
      lastAutoCashoutRef.current = null;
    }
  }, [autoCashOut]);

  const handleResult = (result: BetActionResult) => {
    if (!result.ok) {
      setMessage("");
      onNotify(result.message, "error");
      return;
    }
    setMessage(result.message);
  };

  const handleAutoResult = (result: BetActionResult, action: "place" | "cashout") => {
    if (result.ok) {
      setMessage(result.message);
      return;
    }

    setMessage("");
    const expectedRace = action === "cashout"
      ? /no active (demo )?bet found|already been settled|cash-out is available/i.test(result.message)
      : /betting is closed|already active|already accepted/i.test(result.message);
    if (!expectedRace) onNotify(result.message, "error");
  };

  useEffect(() => {
    if (!autoCashOut || !activeBet || roundState.phase !== "RUNNING" || roundState.multiplier < autoAt) return;
    const requestKey = `${accountMode}:${activeBet.id}`;
    if (autoCashoutRequestRef.current === requestKey || lastAutoCashoutRef.current === requestKey) return;

    autoCashoutRequestRef.current = requestKey;
    socket.emit("bet:cashout", { slot, mode: accountMode }, (result: BetActionResult) => {
      if (autoCashoutRequestRef.current === requestKey) autoCashoutRequestRef.current = null;
      lastAutoCashoutRef.current = requestKey;
      handleAutoResult(result, "cashout");
    });
  }, [accountMode, autoAt, autoCashOut, activeBet?.id, roundState.multiplier, roundState.phase, slot]);

  useEffect(() => {
    if (!autoBet || !roundState.roundId || activeBet || queuedBet) return;
    if (accountMode === "DEMO" && roundState.phase !== "WAITING") return;

    const requestKey = accountMode === "DEMO"
      ? `demo:${roundState.roundId}`
      : `${roundState.phase === "WAITING" ? "round" : "next"}:${roundState.roundId}`;
    if (autoPlaceRequestRef.current === requestKey || lastAutoPlaceRef.current === requestKey) return;

    autoPlaceRequestRef.current = requestKey;
    socket.emit("bet:place", { slot, amount, mode: accountMode }, (result: BetActionResult) => {
      if (autoPlaceRequestRef.current === requestKey) autoPlaceRequestRef.current = null;
      lastAutoPlaceRef.current = requestKey;
      handleAutoResult(result, "place");
    });
  }, [accountMode, activeBet?.id, amount, autoBet, queuedBet?.id, roundState.phase, roundState.roundId, slot]);

  const primaryAction = () => {
    if (actionPending) return;

    if (activeBet && roundState.phase === "RUNNING") {
      setActionPending("cashout");
      setMessage(`Cash-out requested at ${payableMultiplier.toFixed(2)}x...`);
      socket.emit("bet:cashout", { slot, mode: accountMode }, (result: BetActionResult) => {
        if (!result.ok) setActionPending(null);
        handleResult(result);
      });
      return;
    }

    setActionPending("place");
    setMessage("Placing bet...");
    socket.emit("bet:place", { slot, amount, mode: accountMode }, (result: BetActionResult) => {
      if (!result.ok) setActionPending(null);
      handleResult(result);
    });
  };

  const prefix = accountMode === "DEMO" ? "Demo " : "";
  const buttonTitle = actionPending === "cashout"
    ? `${prefix}Cashing Out...`
    : actionPending === "place"
      ? `${prefix}Placing...`
      : activeBet && roundState.phase === "RUNNING"
        ? `${prefix}Cash Out`
        : queuedBet
      ? "Accepted"
      : activeBet
        ? `${prefix}Bet placed`
        : `${prefix}Bet`;

  const buttonValue = activeBet && roundState.phase === "RUNNING"
    ? `${estimatedCashout.toFixed(2)} PKR`
    : queuedBet
      ? `${queuedBet.amount.toFixed(2)} PKR — Next round`
      : activeBet
        ? `${activeBet.amount.toFixed(2)} PKR`
        : `${amount.toFixed(2)} PKR`;

  const controlsLocked = Boolean(acceptedBet) || actionPending !== null;

  return (
    <section className={`bet-panel ${accountMode === "DEMO" ? "demo-bet-panel" : ""}`}>
      <div className="segmented">
        <button
          className={mode === "bet" ? "active" : ""}
          onClick={() => {
            setMode("bet");
            setAutoBet(false);
            setAutoCashOut(false);
          }}
        >Bet</button>
        <button className={mode === "auto" ? "active" : ""} onClick={() => setMode("auto")}>Auto</button>
      </div>

      <div className="bet-main-row">
        <div className="amount-side">
          <div className="stepper">
            <button disabled={controlsLocked} onClick={() => setAmount((value) => Math.max(16, value - 16))}>−</button>
            <input disabled={controlsLocked} value={amount} onChange={(event) => setAmount(Math.max(16, Number(event.target.value) || 16))} />
            <button disabled={controlsLocked} onClick={() => setAmount((value) => value + 16)}>+</button>
          </div>
          <div className="quick-grid">
            {quickAmounts.map((value) => <button disabled={controlsLocked} key={value} onClick={() => setAmount(value)}>{value.toLocaleString()}</button>)}
          </div>
        </div>

        <button
          className={`primary-bet ${activeBet && roundState.phase === "RUNNING" ? "cashout" : ""} ${acceptedBet ? "accepted" : ""}`}
          onClick={primaryAction}
          disabled={Boolean(acceptedBet) || actionPending !== null}
          aria-busy={actionPending !== null}
        >
          <span className="primary-bet-label">{buttonTitle}</span>{" "}
          <span className="primary-bet-value">{buttonValue}</span>
        </button>
      </div>

      {mode === "auto" && (
        <div className="auto-row">
          <label><input type="checkbox" checked={autoBet} onChange={(event) => setAutoBet(event.target.checked)} /> Auto Bet</label>
          <label><input type="checkbox" checked={autoCashOut} onChange={(event) => setAutoCashOut(event.target.checked)} /> Auto Cash Out</label>
          <input className="auto-value" type="number" min="1.01" step="0.01" value={autoAt} onChange={(event) => setAutoAt(Math.max(1.01, Number(event.target.value) || 1.1))} />
        </div>
      )}
      {queuedBet && <div className="panel-message queued-message">Accepted and locked for the next round.</div>}
      {activeBet?.guaranteedMaxMultiplier && (
        <div className="panel-message">{accountMode === "DEMO" ? "Demo" : "Guaranteed peer-funded"} cash-out up to {activeBet.guaranteedMaxMultiplier.toFixed(2)}x</div>
      )}
      {!queuedBet && <div className="panel-message">{message}</div>}
    </section>
  );
}
