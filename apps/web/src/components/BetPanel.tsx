import { useEffect, useState } from "react";
import type { AccountMode, BetSlot, RoundSnapshot, WalletSnapshot } from "../types";
import { socket } from "../lib/socket";

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
  const [mode, setMode] = useState<"bet" | "auto">("bet");
  const [amount, setAmount] = useState(16);
  const [autoBet, setAutoBet] = useState(false);
  const [autoCashOut, setAutoCashOut] = useState(false);
  const [autoAt, setAutoAt] = useState(1.1);
  const [message, setMessage] = useState("");
  const activeBet = accountMode === "DEMO" ? wallet.demoActiveBets[slot] : wallet.activeBets[slot];
  const queuedBet = accountMode === "REAL" ? wallet.queuedBets[slot] : undefined;
  const acceptedBet = queuedBet ?? (activeBet && round.phase !== "RUNNING" ? activeBet : undefined);
  const payableMultiplier = activeBet
    ? Math.min(round.multiplier, activeBet.guaranteedMaxMultiplier ?? round.multiplier)
    : round.multiplier;
  const estimatedCashout = activeBet
    ? activeBet.amount + Math.max(0, activeBet.amount * (payableMultiplier - 1)) * (1 - round.commissionPercent / 100)
    : 0;

  useEffect(() => {
    setMessage("");
    setAutoBet(false);
    setAutoCashOut(false);
  }, [accountMode]);

  const handleResult = (result: BetActionResult) => {
    if (!result.ok) {
      setMessage("");
      onNotify(result.message, "error");
      return;
    }
    setMessage(result.message);
  };

  useEffect(() => {
    if (!autoCashOut || !activeBet || round.phase !== "RUNNING" || round.multiplier < autoAt) return;
    socket.emit("bet:cashout", { slot, mode: accountMode }, (result: BetActionResult) => handleResult(result));
  }, [accountMode, autoAt, autoCashOut, activeBet, round.multiplier, round.phase, slot]);

  useEffect(() => {
    if (!autoBet || !round.roundId || activeBet || queuedBet) return;
    const timer = window.setTimeout(() => {
      socket.emit("bet:place", { slot, amount, mode: accountMode }, (result: BetActionResult) => handleResult(result));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [accountMode, activeBet, amount, autoBet, queuedBet, round.phase, round.roundId, slot]);

  const primaryAction = () => {
    if (activeBet && round.phase === "RUNNING") {
      socket.emit("bet:cashout", { slot, mode: accountMode }, (result: BetActionResult) => handleResult(result));
      return;
    }
    socket.emit("bet:place", { slot, amount, mode: accountMode }, (result: BetActionResult) => handleResult(result));
  };

  const prefix = accountMode === "DEMO" ? "Demo " : "";
  const buttonTitle = activeBet && round.phase === "RUNNING"
    ? `${prefix}Cash Out`
    : queuedBet
      ? "Accepted"
      : activeBet
        ? `${prefix}Bet placed`
        : `${prefix}Bet`;

  const buttonValue = activeBet && round.phase === "RUNNING"
    ? `${estimatedCashout.toFixed(2)} PKR`
    : queuedBet
      ? `${queuedBet.amount.toFixed(2)} PKR — Next round`
      : activeBet
        ? `${activeBet.amount.toFixed(2)} PKR`
        : `${amount.toFixed(2)} PKR`;

  const controlsLocked = Boolean(acceptedBet);

  return (
    <section className={`bet-panel ${accountMode === "DEMO" ? "demo-bet-panel" : ""}`}>
      <div className="segmented">
        <button disabled={controlsLocked} className={mode === "bet" ? "active" : ""} onClick={() => setMode("bet")}>Bet</button>
        <button disabled={controlsLocked} className={mode === "auto" ? "active" : ""} onClick={() => setMode("auto")}>Auto</button>
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
          className={`primary-bet ${activeBet && round.phase === "RUNNING" ? "cashout" : ""} ${acceptedBet ? "accepted" : ""}`}
          onClick={primaryAction}
          disabled={Boolean(acceptedBet)}
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
      {accountMode === "DEMO" && <div className="panel-message demo-message">Virtual funds only — no deposits, withdrawals, loss pool, or commission wallet changes.</div>}
      {queuedBet && <div className="panel-message queued-message">Accepted and locked for the next round.</div>}
      {activeBet?.guaranteedMaxMultiplier && (
        <div className="panel-message">{accountMode === "DEMO" ? "Demo" : "Guaranteed peer-funded"} cash-out up to {activeBet.guaranteedMaxMultiplier.toFixed(2)}x</div>
      )}
      {!queuedBet && <div className="panel-message">{message}</div>}
    </section>
  );
}
