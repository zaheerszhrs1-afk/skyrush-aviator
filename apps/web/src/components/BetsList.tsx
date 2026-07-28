import { useMemo, useState } from "react";
import type { PublicBet } from "../types";

type Props = { bets: PublicBet[]; online: number };

export function BetsList({ bets, online }: Props) {
  const [tab, setTab] = useState<"all" | "previous" | "top">("all");
  const rows = useMemo(() => {
    const source = tab === "top" ? [...bets].sort((a, b) => b.amount - a.amount) : bets;
    return source.slice(0, 45);
  }, [bets, tab]);
  const totalWin = bets.reduce((sum, bet) => sum + (bet.payout ?? 0), 0);

  return (
    <aside className="bets-card">
      <div className="tabs">
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>All Bets</button>
        <button className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Previous</button>
        <button className={tab === "top" ? "active" : ""} onClick={() => setTab("top")}>Top</button>
      </div>
      <div className="bets-summary">
        <div><strong>{bets.length} Bets · {online} Online</strong></div>
        <div><strong>{totalWin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span>Total win PKR</span></div>
      </div>
      <div className="progress"><span style={{ width: `${Math.min(100, 18 + bets.length)}%` }} /></div>
      <div className="bets-head"><span>Player</span><span>Bet PKR</span><span>X</span><span>Win PKR</span></div>
      <div className="bets-scroll">
        {rows.map((bet, index) => (
          <div key={bet.id} className={`bet-row ${bet.status === "CASHED_OUT" ? "won" : ""}`}>
            <span><i>{["🌌", "🪐", "🚀", "🌍", "🌙"][index % 5]}</i><b>{bet.player}</b>{bet.isDemoBot && <em className="demo-bot-badge">DEMO BOT</em>}</span>
            <span>{bet.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            <span>{bet.cashoutMultiplier ? `${bet.cashoutMultiplier.toFixed(2)}x` : ""}</span>
            <span>{bet.payout ? bet.payout.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ""}</span>
          </div>
        ))}
      </div>
      <div className="fair-footer">🛡 Provably Fair <span>Powered by SKYRUSH</span></div>
    </aside>
  );
}
