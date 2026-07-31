import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import type { BonusDashboard, BonusSection } from "../types";

interface BonusCenterProps {
  onClose: () => void;
  onNotify: (message: string, type?: "error" | "success") => void;
}

const money = (value: number) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function ProgressBar({ value }: { value: number }) {
  return <span className="vip-progress-track"><i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></span>;
}

export function BonusCenter({ onClose, onNotify }: BonusCenterProps) {
  const [section, setSection] = useState<BonusSection>("LEVEL_UP");
  const [dashboard, setDashboard] = useState<BonusDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard(await apiRequest<BonusDashboard>("/api/bonuses"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load VIP bonuses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const claim = async (path: string, successText: string) => {
    setBusy(true);
    try {
      const result = await apiRequest<{ amount: number; dashboard: BonusDashboard }>(path, { method: "POST" });
      setDashboard(result.dashboard);
      onNotify(`${successText}: ${money(result.amount)} PKR`, "success");
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "Unable to claim bonus.", "error");
    } finally {
      setBusy(false);
    }
  };

  const nextTarget = dashboard?.progress.nextRule;
  const monthlyStatus = useMemo(() => {
    if (!dashboard) return "";
    if (dashboard.monthly.claimed) return `Claimed for ${dashboard.monthly.claimPeriodKey}`;
    if (!dashboard.monthly.claimOpen) return `Claim window opens ${new Date(dashboard.monthly.claimWindowStart).toLocaleString()}`;
    if (dashboard.monthly.eligibleBonus <= 0) return "Previous month did not reach a bonus tier";
    return `${money(dashboard.monthly.eligibleBonus)} PKR available`;
  }, [dashboard]);

  return (
    <div className="bonus-backdrop" role="dialog" aria-modal="true" aria-label="VIP bonus center">
      <section className="bonus-center">
        <header className="bonus-topbar">
          <button type="button" onClick={onClose} aria-label="Back">‹</button>
          <strong>VIP Bonus Center</strong>
          <button type="button" onClick={() => void load()} aria-label="Refresh">↻</button>
        </header>

        {loading && <div className="bonus-state">Loading VIP progress…</div>}
        {error && <div className="bonus-state error"><span>{error}</span><button onClick={() => void load()}>Try again</button></div>}

        {!loading && dashboard && (
          <div className="bonus-scroll">
            <section className="vip-hero">
              <div className="vip-hero-art" aria-hidden="true"><span>♛</span><i>✦</i><i>✦</i><i>✦</i></div>
              <h1>VIP REWARDS</h1>
              <p>Level-up bonuses, monthly rewards and better withdrawal access.</p>
            </section>

            <section className="vip-status-card">
              <div className="vip-status-title">
                <span>VIP {dashboard.progress.vipLevel}</span>
                <small>{nextTarget ? `Next VIP ${nextTarget.level}` : "Maximum level reached"}</small>
              </div>
              <div className="vip-medal" aria-hidden="true"><span>{dashboard.progress.vipLevel}</span></div>
              <div className="vip-metric">
                <label>Current deposit</label>
                <div><ProgressBar value={dashboard.progress.depositPercent} /><span>{money(dashboard.progress.lifetimeDeposit)} / {nextTarget ? money(nextTarget.requiredDeposit) : "MAX"}</span></div>
              </div>
              <div className="vip-metric">
                <label>Current valid bet</label>
                <div><ProgressBar value={dashboard.progress.turnoverPercent} /><span>{money(dashboard.progress.lifetimeValidBet)} / {nextTarget ? money(nextTarget.requiredTurnover) : "MAX"}</span></div>
              </div>
            </section>

            <nav className="bonus-tabs" aria-label="VIP reward sections">
              <button className={section === "LEVEL_UP" ? "active" : ""} onClick={() => setSection("LEVEL_UP")}><span>🎁</span>Level Up</button>
              <button className={section === "MONTHLY" ? "active" : ""} onClick={() => setSection("MONTHLY")}><span>🪙</span>Monthly</button>
              <button className={section === "WITHDRAWAL" ? "active" : ""} onClick={() => setSection("WITHDRAWAL")}><span>♛</span>Withdrawal</button>
            </nav>

            {section === "LEVEL_UP" && (
              <section className="bonus-page-card">
                <div className="bonus-receive-row">
                  <div><span className="bonus-icon">🎁</span><p>BONUS<strong>Rs {money(dashboard.levelUp.claimableAmount)}</strong></p></div>
                  <button
                    disabled={busy || !dashboard.levelUp.enabled || dashboard.levelUp.claimableAmount <= 0}
                    onClick={() => void claim("/api/bonuses/level-up/claim", "Level-up bonus received")}
                  >{busy ? "Processing…" : dashboard.levelUp.claimableAmount > 0 ? "RECEIVE" : "CLAIMED"}</button>
                </div>
                <div className="bonus-ribbon">LEVEL UP BONUS</div>
                <div className="bonus-table two-columns">
                  <div className="bonus-table-head"><span>VIP Level</span><span>Upgrade Prize (Rs)</span></div>
                  {dashboard.config.vipLevels.map((row) => (
                    <div className="bonus-table-row" key={row.level}>
                      <strong>VIP{row.level}</strong>
                      <span className={dashboard.levelUp.claimedLevels.includes(row.level) ? "claimed" : ""}>
                        {row.levelUpBonus > 0 ? money(row.levelUpBonus) : "-"}
                        {dashboard.levelUp.claimedLevels.includes(row.level) && <small> ✓</small>}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="bonus-rules"><h3>Rules</h3><ol><li>Each VIP level upgrade reward can be claimed once only.</li><li>VIP progress uses approved real deposits and settled real-money bets.</li><li>Demo bets, refunded bets and rejected deposits do not count.</li></ol></div>
              </section>
            )}

            {section === "MONTHLY" && (
              <section className="bonus-page-card">
                <div className="monthly-progress-card">
                  <div><span>Current month deposit</span><strong>{money(dashboard.monthly.currentDeposit)}</strong></div>
                  <div><span>Current valid bet</span><strong>{money(dashboard.monthly.currentValidBet)}</strong></div>
                  <p>Projected monthly bonus <b>Rs {money(dashboard.monthly.projectedBonus)}</b></p>
                </div>
                <div className="bonus-receive-row">
                  <div><span className="bonus-icon">🪙</span><p>BONUS<strong>Rs {money(dashboard.monthly.eligibleBonus)}</strong><small>{monthlyStatus}</small></p></div>
                  <button
                    disabled={busy || !dashboard.monthly.enabled || dashboard.monthly.claimed || !dashboard.monthly.claimOpen || dashboard.monthly.eligibleBonus <= 0}
                    onClick={() => void claim("/api/bonuses/monthly/claim", "Monthly bonus received")}
                  >{busy ? "Processing…" : dashboard.monthly.claimed ? "CLAIMED" : "RECEIVE"}</button>
                </div>
                <div className="bonus-ribbon">MONTHLY BONUS</div>
                <div className="bonus-table three-columns">
                  <div className="bonus-table-head"><span>Required Deposit</span><span>Required Turnover</span><span>Monthly Bonus</span></div>
                  {dashboard.config.monthlyBonusRules.map((row, index) => (
                    <div className="bonus-table-row" key={`${row.requiredDeposit}-${index}`}>
                      <span>{money(row.requiredDeposit)}</span><span>{money(row.requiredTurnover)}</span><strong>{money(row.bonus)}</strong>
                    </div>
                  ))}
                </div>
                <div className="bonus-rules"><h3>Rules</h3><ol><li>Each member can claim the VIP monthly bonus once per claim period.</li><li>The reward is based on the previous calendar month’s approved deposits and settled valid bets.</li><li>The standard claim window starts on day {dashboard.config.monthlyClaimStartDay} and remains open for {dashboard.config.monthlyClaimWindowHours} hours.</li></ol></div>
              </section>
            )}

            {section === "WITHDRAWAL" && (
              <section className="bonus-page-card">
                <div className="withdrawal-summary">
                  <span>VIP {dashboard.progress.vipLevel}</span>
                  <strong>{dashboard.withdrawal.unlimited ? "Unlimited withdrawals" : `${dashboard.withdrawal.remainingToday} of ${dashboard.withdrawal.dailyLimit} remaining today`}</strong>
                  <small>Used today: {dashboard.withdrawal.usedToday} · Timezone: {dashboard.withdrawal.timezone}</small>
                </div>
                <div className="bonus-ribbon">VIP WITHDRAWAL LIMITS</div>
                <div className="bonus-table two-columns">
                  <div className="bonus-table-head"><span>VIP Level</span><span>Daily Withdrawals</span></div>
                  {dashboard.config.vipLevels.map((row) => (
                    <div className={`bonus-table-row ${row.level === dashboard.progress.vipLevel ? "current" : ""}`} key={row.level}>
                      <strong>VIP{row.level}</strong><span>{row.dailyWithdrawalLimit < 0 ? "Unlimited" : `${row.dailyWithdrawalLimit}x`}</span>
                    </div>
                  ))}
                </div>
                <div className="bonus-rules"><h3>Rules</h3><ol><li>Daily withdrawal usage resets at midnight in {dashboard.withdrawal.timezone}.</li><li>Pending, processing and completed requests count toward the daily limit.</li><li>Unused withdrawal requests do not carry over to the next day.</li><li>Rejected requests do not consume the daily allowance.</li></ol></div>
              </section>
            )}

            {dashboard.recentClaims.length > 0 && (
              <section className="bonus-claim-history"><h3>Recent rewards</h3>{dashboard.recentClaims.slice(0, 5).map((claim) => <div key={claim.id}><span>{claim.type === "LEVEL_UP" ? `VIP${claim.vipLevel} level bonus` : `${claim.periodKey} monthly bonus`}</span><strong>+{money(claim.amount)} PKR</strong><small>{new Date(claim.createdAt).toLocaleString()}</small></div>)}</section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
