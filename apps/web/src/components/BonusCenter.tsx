import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import type { BonusDashboard, BonusSection, ReferralDashboard } from "../types";

interface BonusCenterProps {
  onClose: () => void;
  onNotify: (message: string, type?: "error" | "success") => void;
  initialSection?: BonusSection;
}

const money = (value: number) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function ProgressBar({ value }: { value: number }) {
  return <span className="vip-progress-track"><i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></span>;
}

export function BonusCenter({ onClose, onNotify, initialSection = "LEVEL_UP" }: BonusCenterProps) {
  const [section, setSection] = useState<BonusSection>(initialSection);
  const [dashboard, setDashboard] = useState<BonusDashboard | null>(null);
  const [referral, setReferral] = useState<ReferralDashboard | null>(null);
  const [referralView, setReferralView] = useState<"REWARD" | "TEAM" | "PNL">("REWARD");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [bonusResult, referralResult] = await Promise.all([
        apiRequest<BonusDashboard>("/api/bonuses"),
        apiRequest<ReferralDashboard>("/api/referrals")
      ]);
      setDashboard(bonusResult);
      setReferral(referralResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load VIP bonuses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setSection(initialSection); }, [initialSection]);

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

  const copyInviteLink = async () => {
    if (!referral?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(referral.inviteUrl);
      onNotify("Invitation link copied", "success");
    } catch {
      onNotify("Unable to copy the invitation link.", "error");
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
              <button className={section === "REFERRAL" ? "active" : ""} onClick={() => setSection("REFERRAL")}><span>↗</span>Invite</button>
              <button className={section === "LEVEL_UP" ? "active" : ""} onClick={() => setSection("LEVEL_UP")}><span>🎁</span>Level Up</button>
              <button className={section === "MONTHLY" ? "active" : ""} onClick={() => setSection("MONTHLY")}><span>🪙</span>Monthly</button>
              <button className={section === "WITHDRAWAL" ? "active" : ""} onClick={() => setSection("WITHDRAWAL")}><span>♛</span>Withdrawal</button>
            </nav>

            {section === "REFERRAL" && referral && (
              <section className="referral-page-card">
                {!referral.enabled ? <div className="bonus-state">Invitation rewards are currently paused.</div> : <><nav className="referral-subtabs" aria-label="Invitation sections"><button className={referralView === "REWARD" ? "active" : ""} onClick={() => setReferralView("REWARD")}>Reward</button><button className={referralView === "TEAM" ? "active" : ""} onClick={() => setReferralView("TEAM")}>Team management</button><button className={referralView === "PNL" ? "active" : ""} onClick={() => setReferralView("PNL")}>User profit and loss</button></nav><div className={referralView === "REWARD" ? "" : "referral-view-hidden"}>
                  <div className="referral-hero"><div><span className="referral-kicker">INVITE TO EARN</span><h2>Invite friends, earn rewards</h2><p>Share your exclusive link and receive bonuses when invited players register and complete a qualifying deposit.</p></div><div className="referral-code-art" aria-hidden="true">↗</div></div>
                  <div className="referral-stat-grid"><article><span>Total income</span><strong>{money(referral.stats.totalIncome)} PKR</strong></article><article><span>Total invites</span><strong>{referral.stats.totalInvites}</strong></article><article><span>Valid invites</span><strong>{referral.stats.validInvites}</strong></article><article><span>Invitation bonus</span><strong>{money(referral.stats.invitationBonus)} PKR</strong></article></div>
                  <div className="referral-share-card"><div><span>Invite friends via link</span><strong>{referral.inviteUrl}</strong><small>Invitee deposit requirement: {money(referral.minDeposit)} PKR</small></div><button type="button" onClick={() => void copyInviteLink()}>Copy link</button></div>
                  <div className="referral-steps"><article><b>1</b><span><strong>Invite friends</strong><small>Share your invitation link.</small></span></article><article><b>2</b><span><strong>They register</strong><small>The referral code is applied automatically.</small></span></article><article><b>3</b><span><strong>They deposit</strong><small>Once the qualifying deposit is approved, rewards are credited.</small></span></article></div>
                  <div className="referral-table-grid"><div className="referral-table-wrap"><h3>Invitation reward</h3><div className="referral-table"><div className="referral-table-head"><span>Level</span><span>Valid invites</span><span>Reward</span></div>{referral.invitationRules.map((row) => <div className="referral-table-row" key={row.level}><span>Level {row.level}</span><span>{row.minInvites}–{row.maxInvites}</span><strong>{money(row.reward)} PKR</strong></div>)}</div></div><div className="referral-table-wrap"><h3>Betting commission</h3><div className="referral-table"><div className="referral-table-head"><span>Level</span><span>Share</span></div>{referral.commissionRates.map((row) => <div className="referral-table-row" key={row.level}><span>Level {row.level}</span><strong>{row.percent.toFixed(2)}%</strong></div>)}<div className="referral-table-note">Deposit commission: 5% · rewards require a minimum {money(referral.minDeposit)} PKR deposit.</div></div></div></div>
                  <div className="referral-team-summary"><span>Team management</span><strong>{referral.team.levelOne} direct · {referral.team.levelTwo} level 2 · {referral.team.levelThree} level 3</strong></div>
                  {referral.recentRewards.length > 0 && <div className="bonus-claim-history"><h3>Recent rewards</h3>{referral.recentRewards.slice(0, 5).map((reward) => <div key={reward.id}><span>{reward.type === "REFERRAL_INVITATION" ? "Invitation bonus" : reward.type === "REFERRAL_DEPOSIT" ? "Deposit commission" : "Betting commission"}</span><strong>+{money(reward.amount)} PKR</strong><small>{new Date(reward.createdAt).toLocaleString()}</small></div>)}</div>}
                  </div>{referralView === "TEAM" && <div className="referral-members"><h3>Team management</h3><p>Direct invited users are listed here. Their private contact details stay masked.</p>{referral.team.members.length === 0 ? <div className="bonus-state">No invited users yet.</div> : referral.team.members.map((member) => <div className="referral-member-row" key={member.id}><span><strong>{member.name}</strong><small>{member.phone || "Phone not provided"}</small></span><small>{new Date(member.createdAt).toLocaleDateString()}</small></div>)}</div>}{referralView === "PNL" && <div className="referral-members"><h3>User profit and loss</h3><p>Profit and loss reporting will populate here as referral betting commission settles. Current settled betting commission: <strong>{money(referral.stats.betBonus)} PKR</strong>.</p></div>}
                </>}
              </section>
            )}

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
                <div className="bonus-rules"><h3>Rules</h3><ol><li>Each VIP level upgrade reward can be claimed once only.</li><li>VIP progress uses approved real deposits and settled real-money bets.</li><li>Refunded bets and rejected deposits do not count.</li></ol></div>
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
              <section className="bonus-claim-history"><h3>Recent rewards</h3>{dashboard.recentClaims.slice(0, 5).map((claim) => <div key={claim.id}><span>{claim.type === "LEVEL_UP" ? `VIP${claim.vipLevel} level bonus` : claim.type === "MONTHLY" ? `${claim.periodKey} monthly bonus` : claim.type === "REFERRAL_INVITATION" ? "Invitation bonus" : claim.type === "REFERRAL_DEPOSIT" ? "Deposit commission" : "Betting commission"}</span><strong>+{money(claim.amount)} PKR</strong><small>{new Date(claim.createdAt).toLocaleString()}</small></div>)}</section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
