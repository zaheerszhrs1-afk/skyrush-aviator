import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import type { AdminWalletTransaction, AuthUser, DepositRequest, MonthlyBonusRule, PlatformAuditItem, VipLevelRule, WithdrawalRequest } from "../types";

interface Summary {
  users: number;
  depositsPending: number;
  withdrawalsPending: number;
  activeBets: number;
  totalUserBalances: number;
  withdrawalLockedFunds: number;
  activeBetEscrow: number;
  reservedRewardLiquidity: number;
  availableRewardLiquidity: number;
  lossPool: number;
  pendingRewards: number;
  totalWagerRequirement: number;
  commissionWallet: number;
  bonusWallet: number;
  totalBonusFunding: number;
  totalBonusesPaid: number;
  totalCommissionEarned: number;
  totalRewardsPaid: number;
  totalBetVolume: number;
  totalLosses: number;
  totalApprovedDeposits: number;
  totalCompletedWithdrawals: number;
  lockedFunds: number;
  dailyRevenue: number;
  monthlyRevenue: number;
  reconciliation: {
    totalInflows: number;
    accountedFunds: number;
    difference: number;
    betEscrowMirrorDifference: number;
    balanced: boolean;
  };
  recentRounds: Array<{
    _id: string;
    roundId: string;
    crashPoint: number;
    totalStake: number;
    totalPayout: number;
    totalCommission: number;
    totalLosses: number;
    crashedAt: string;
  }>;
}

interface AdminSettings {
  houseEdgePercent: number;
  commissionPercent: number;
  reservePercent: number;
  minBet: number;
  minDeposit: number;
  minWithdrawal: number;
  wageringRequirementPercent: number;
  maxBet: number;
  maxCashoutMultiplier: number;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
}

interface DailyBetRow {
  date: string;
  bets: number;
  wonBets: number;
  lostBets: number;
  openBets: number;
  betVolume: number;
  payout: number;
  playerLoss: number;
  playerProfit: number;
  commission: number;
  netResult: number;
}

interface DailyBetReport {
  days: number;
  timezone: string;
  totals: Omit<DailyBetRow, "date">;
  rows: DailyBetRow[];
}

interface AdminBonusConfig {
  vipEnabled: boolean;
  vipLevelBonusEnabled: boolean;
  vipMonthlyBonusEnabled: boolean;
  vipWithdrawalLimitsEnabled: boolean;
  vipTimezone: string;
  monthlyClaimStartDay: number;
  monthlyClaimWindowHours: number;
  monthlyClaimForceOpen: boolean;
  vipLevels: VipLevelRule[];
  monthlyBonusRules: MonthlyBonusRule[];
}

interface AdminBonusData {
  config: AdminBonusConfig;
  budget: {
    bonusWallet: number;
    totalFunding: number;
    totalPaid: number;
  };
  claims: Array<{
    id: string;
    userId: string | { _id: string; name: string; email: string };
    type: "LEVEL_UP" | "MONTHLY";
    amount: number;
    vipLevel: number;
    periodKey: string;
    createdAt: string;
  }>;
}

type AdminTab = "OVERVIEW" | "BETS" | "BONUSES" | "USERS" | "DEPOSITS" | "WITHDRAWALS" | "AUDIT" | "SETTINGS";

interface AdminPanelProps {
  onBack: () => void;
}

const money = (value: number) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR`;

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("OVERVIEW");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [betDays, setBetDays] = useState(30);
  const [betReport, setBetReport] = useState<DailyBetReport | null>(null);
  const [bonusData, setBonusData] = useState<AdminBonusData | null>(null);
  const [bonusFundAmount, setBonusFundAmount] = useState(10000);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [audit, setAudit] = useState<PlatformAuditItem[]>([]);
  const [transactions, setTransactions] = useState<AdminWalletTransaction[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = async () => setSummary((await apiRequest<{ summary: Summary }>("/api/admin/summary")).summary);
  const loadBets = async () => setBetReport(await apiRequest<DailyBetReport>(`/api/admin/bets/daily?days=${betDays}`));
  const loadBonuses = async () => setBonusData(await apiRequest<AdminBonusData>("/api/admin/bonuses"));
  const loadUsers = async () => setUsers((await apiRequest<{ users: AuthUser[] }>("/api/admin/users")).users);
  const loadDeposits = async () => {
    const [depositResult, settingsResult] = await Promise.all([
      apiRequest<{ deposits: DepositRequest[] }>("/api/admin/deposits"),
      apiRequest<{ settings: AdminSettings }>("/api/admin/settings")
    ]);
    setDeposits(depositResult.deposits);
    setSettings(settingsResult.settings);
  };
  const loadWithdrawals = async () => {
    const [withdrawalResult, settingsResult] = await Promise.all([
      apiRequest<{ withdrawals: WithdrawalRequest[] }>("/api/admin/withdrawals"),
      apiRequest<{ settings: AdminSettings }>("/api/admin/settings")
    ]);
    setWithdrawals(withdrawalResult.withdrawals);
    setSettings(settingsResult.settings);
  };
  const loadAudit = async () => {
    const [auditResult, transactionResult] = await Promise.all([
      apiRequest<{ audit: PlatformAuditItem[] }>("/api/admin/audit?limit=300"),
      apiRequest<{ transactions: AdminWalletTransaction[] }>("/api/admin/transactions?limit=300")
    ]);
    setAudit(auditResult.audit);
    setTransactions(transactionResult.transactions);
  };
  const loadSettings = async () => setSettings((await apiRequest<{ settings: AdminSettings }>("/api/admin/settings")).settings);

  useEffect(() => {
    setMessage("");
    const actions: Record<AdminTab, () => Promise<void>> = {
      OVERVIEW: loadOverview,
      BETS: loadBets,
      BONUSES: loadBonuses,
      USERS: loadUsers,
      DEPOSITS: loadDeposits,
      WITHDRAWALS: loadWithdrawals,
      AUDIT: loadAudit,
      SETTINGS: loadSettings
    };
    void actions[tab]().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load admin data."));
  }, [tab, betDays]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage("Action completed successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const userName = (value: DepositRequest["userId"] | WithdrawalRequest["userId"] | PlatformAuditItem["userId"]) => {
    if (!value) return "System";
    return typeof value === "string" ? value : `${value.name} (${value.email})`;
  };

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-title"><strong>B9T9 Admin</strong><span>Peer liquidity & operations</span></div>
        {(["OVERVIEW", "BETS", "BONUSES", "USERS", "DEPOSITS", "WITHDRAWALS", "AUDIT", "SETTINGS"] as const).map((item) => (
          <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>
            {item[0] + item.slice(1).toLowerCase()}
          </button>
        ))}
        <button className="admin-back" onClick={onBack}>← Return to game</button>
      </aside>

      <section className="admin-content">
        <header>
          <div><h1>{tab[0] + tab.slice(1).toLowerCase()}</h1><p>Winner profits come from the shared loss pool; the platform receives commission only.</p></div>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </header>
        {message && <div className="admin-message">{message}</div>}

        {tab === "OVERVIEW" && summary && (
          <>
            <div className={`settings-warning ${summary.reconciliation.balanced ? "" : "danger"}`}>
              Accounting: <strong>{summary.reconciliation.balanced ? "BALANCED" : "REVIEW REQUIRED"}</strong>
              {` · Difference ${money(summary.reconciliation.difference)} · Escrow mirror ${money(summary.reconciliation.betEscrowMirrorDifference)}`}
            </div>
            <div className="admin-kpis">
              <article><span>Users</span><strong>{summary.users}</strong></article>
              <article><span>Pending deposits</span><strong>{summary.depositsPending}</strong></article>
              <article><span>Open withdrawals</span><strong>{summary.withdrawalsPending}</strong></article>
              <article><span>Active bets</span><strong>{summary.activeBets}</strong></article>
              <article><span>Loss pool</span><strong>{money(summary.lossPool)}</strong></article>
              <article><span>Available reward liquidity</span><strong>{money(summary.availableRewardLiquidity)}</strong></article>
              <article><span>Reserved winner liquidity</span><strong>{money(summary.reservedRewardLiquidity)}</strong></article>
              <article><span>Active bet escrow</span><strong>{money(summary.activeBetEscrow)}</strong></article>
              <article><span>Commission wallet</span><strong className="positive">{money(summary.commissionWallet)}</strong></article>
              <article><span>VIP bonus wallet</span><strong className="positive">{money(summary.bonusWallet)}</strong></article>
              <article><span>Bonus budget funded</span><strong>{money(summary.totalBonusFunding)}</strong></article>
              <article><span>VIP bonuses paid</span><strong>{money(summary.totalBonusesPaid)}</strong></article>
              <article><span>Rewards paid</span><strong>{money(summary.totalRewardsPaid)}</strong></article>
              <article><span>Locked funds</span><strong>{money(summary.lockedFunds)}</strong></article>
              <article><span>Locked winnings</span><strong>{money(summary.pendingRewards)}</strong></article>
              <article><span>Wagering remaining</span><strong>{money(summary.totalWagerRequirement)}</strong></article>
              <article><span>Approved deposits</span><strong>{money(summary.totalApprovedDeposits)}</strong></article>
              <article><span>Completed withdrawals</span><strong>{money(summary.totalCompletedWithdrawals)}</strong></article>
              <article><span>Daily commission</span><strong className="positive">{money(summary.dailyRevenue)}</strong></article>
              <article><span>Monthly commission</span><strong className="positive">{money(summary.monthlyRevenue)}</strong></article>
            </div>
            <div className="admin-table-card">
              <h2>Recent rounds</h2>
              <table><thead><tr><th>Round</th><th>Crash</th><th>Stake</th><th>Losses</th><th>Payout</th><th>Commission</th><th>Date</th></tr></thead>
                <tbody>{summary.recentRounds.map((round) => <tr key={round._id}>
                  <td>{round.roundId.slice(0, 8)}</td><td>{round.crashPoint.toFixed(2)}x</td><td>{money(round.totalStake)}</td>
                  <td>{money(round.totalLosses)}</td><td>{money(round.totalPayout)}</td><td>{money(round.totalCommission)}</td>
                  <td>{new Date(round.crashedAt).toLocaleString()}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {tab === "BETS" && betReport && (
          <>
            <div className="admin-report-toolbar">
              <div>
                <h2>Daily bet report</h2>
                <p>Player loss means lost stakes. Player profit means net winnings above returned stake.</p>
              </div>
              <label>Range
                <select value={betDays} onChange={(event) => setBetDays(Number(event.target.value))}>
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                  <option value={365}>Last 365 days</option>
                </select>
              </label>
            </div>
            <div className="admin-kpis admin-bet-kpis">
              <article><span>Total bets</span><strong>{betReport.totals.bets.toLocaleString()}</strong></article>
              <article><span>Bet volume</span><strong>{money(betReport.totals.betVolume)}</strong></article>
              <article><span>Player losses</span><strong className="positive">{money(betReport.totals.playerLoss)}</strong></article>
              <article><span>Player profit</span><strong className="negative">{money(betReport.totals.playerProfit)}</strong></article>
              <article><span>Commission</span><strong className="positive">{money(betReport.totals.commission)}</strong></article>
              <article><span>Net game result</span><strong className={betReport.totals.netResult >= 0 ? "positive" : "negative"}>{money(betReport.totals.netResult)}</strong></article>
            </div>
            <div className="admin-table-card">
              <table><thead><tr><th>Date</th><th>Bets</th><th>Won / Lost / Open</th><th>Bet volume</th><th>Player loss</th><th>Player profit</th><th>Commission</th><th>Net result</th></tr></thead>
                <tbody>{betReport.rows.length === 0 ? <tr><td colSpan={8}>No bets found in this period.</td></tr> : betReport.rows.map((row) => <tr key={row.date}>
                  <td>{new Date(`${row.date}T00:00:00+05:00`).toLocaleDateString()}</td>
                  <td>{row.bets.toLocaleString()}</td>
                  <td>{row.wonBets} / {row.lostBets} / {row.openBets}</td>
                  <td>{money(row.betVolume)}</td>
                  <td className="positive">{money(row.playerLoss)}</td>
                  <td className="negative">{money(row.playerProfit)}</td>
                  <td>{money(row.commission)}</td>
                  <td className={row.netResult >= 0 ? "positive" : "negative"}>{money(row.netResult)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {tab === "BONUSES" && bonusData && (
          <>
            <div className="admin-bonus-toolbar">
              <div>
                <h2>VIP bonus budget</h2>
                <p>Level-up and monthly bonuses are paid only from this dedicated wallet.</p>
              </div>
              <label>
                Add funds (PKR)
                <input type="number" min="1" step="0.01" value={bonusFundAmount} onChange={(event) => setBonusFundAmount(Number(event.target.value))} />
              </label>
              <button disabled={busy || bonusFundAmount <= 0} onClick={() => void run(async () => {
                await apiRequest("/api/admin/bonuses/fund", { method: "POST", body: JSON.stringify({ amount: bonusFundAmount }) });
                await loadBonuses();
              })}>Fund bonus wallet</button>
            </div>

            <div className="admin-kpis admin-bonus-kpis">
              <article><span>Available bonus wallet</span><strong className="positive">{money(bonusData.budget.bonusWallet)}</strong></article>
              <article><span>Total externally funded</span><strong>{money(bonusData.budget.totalFunding)}</strong></article>
              <article><span>Total bonuses paid</span><strong>{money(bonusData.budget.totalPaid)}</strong></article>
              <article><span>Recent claims loaded</span><strong>{bonusData.claims.length}</strong></article>
            </div>

            <form className="admin-bonus-settings" onSubmit={(event) => { event.preventDefault(); void run(async () => {
              await apiRequest("/api/admin/bonuses/settings", { method: "PATCH", body: JSON.stringify(bonusData.config) });
              await loadBonuses();
            }); }}>
              <div className="admin-bonus-options">
                <label className="toggle-setting"><input type="checkbox" checked={bonusData.config.vipEnabled} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, vipEnabled: event.target.checked } })} /> Entire VIP system enabled</label>
                <label className="toggle-setting"><input type="checkbox" checked={bonusData.config.vipLevelBonusEnabled} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, vipLevelBonusEnabled: event.target.checked } })} /> Level-up bonus enabled</label>
                <label className="toggle-setting"><input type="checkbox" checked={bonusData.config.vipMonthlyBonusEnabled} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, vipMonthlyBonusEnabled: event.target.checked } })} /> Monthly bonus enabled</label>
                <label className="toggle-setting"><input type="checkbox" checked={bonusData.config.vipWithdrawalLimitsEnabled} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, vipWithdrawalLimitsEnabled: event.target.checked } })} /> VIP withdrawal limits enabled</label>
                <label className="toggle-setting"><input type="checkbox" checked={bonusData.config.monthlyClaimForceOpen} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyClaimForceOpen: event.target.checked } })} /> Force monthly claim window open</label>
                <label>VIP timezone<input value={bonusData.config.vipTimezone} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, vipTimezone: event.target.value } })} /></label>
                <label>Monthly claim starts on day<input type="number" min="1" max="28" value={bonusData.config.monthlyClaimStartDay} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyClaimStartDay: Number(event.target.value) } })} /></label>
                <label>Claim window hours<input type="number" min="1" max="744" value={bonusData.config.monthlyClaimWindowHours} onChange={(event) => setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyClaimWindowHours: Number(event.target.value) } })} /></label>
              </div>

              <div className="admin-table-card admin-config-table">
                <div className="admin-table-heading"><div><h2>VIP levels</h2><p>A user reaches a level only after meeting both lifetime deposit and valid-bet turnover.</p></div></div>
                <table><thead><tr><th>VIP</th><th>Required deposit</th><th>Required turnover</th><th>Level-up bonus</th><th>Daily withdrawals</th></tr></thead>
                  <tbody>{bonusData.config.vipLevels.map((rule, index) => <tr key={rule.level}>
                    <td><strong>VIP{rule.level}</strong></td>
                    <td><input type="number" min="0" step="0.01" value={rule.requiredDeposit} onChange={(event) => {
                      const vipLevels = [...bonusData.config.vipLevels]; vipLevels[index] = { ...rule, requiredDeposit: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, vipLevels } });
                    }} /></td>
                    <td><input type="number" min="0" step="0.01" value={rule.requiredTurnover} onChange={(event) => {
                      const vipLevels = [...bonusData.config.vipLevels]; vipLevels[index] = { ...rule, requiredTurnover: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, vipLevels } });
                    }} /></td>
                    <td><input type="number" min="0" step="0.01" value={rule.levelUpBonus} onChange={(event) => {
                      const vipLevels = [...bonusData.config.vipLevels]; vipLevels[index] = { ...rule, levelUpBonus: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, vipLevels } });
                    }} /></td>
                    <td><input type="number" min="-1" step="1" value={rule.dailyWithdrawalLimit} onChange={(event) => {
                      const vipLevels = [...bonusData.config.vipLevels]; vipLevels[index] = { ...rule, dailyWithdrawalLimit: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, vipLevels } });
                    }} /><small>-1 = unlimited</small></td>
                  </tr>)}</tbody>
                </table>
              </div>

              <div className="admin-table-card admin-config-table">
                <div className="admin-table-heading"><div><h2>Monthly bonus tiers</h2><p>The highest tier for which both previous-month requirements are met is claimable once.</p></div><button type="button" onClick={() => setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyBonusRules: [...bonusData.config.monthlyBonusRules, { requiredDeposit: 0, requiredTurnover: 0, bonus: 0 }] } })}>+ Add tier</button></div>
                <table><thead><tr><th>Required deposit</th><th>Required turnover</th><th>Monthly bonus</th><th>Action</th></tr></thead>
                  <tbody>{bonusData.config.monthlyBonusRules.map((rule, index) => <tr key={index}>
                    <td><input type="number" min="0" step="0.01" value={rule.requiredDeposit} onChange={(event) => {
                      const monthlyBonusRules = [...bonusData.config.monthlyBonusRules]; monthlyBonusRules[index] = { ...rule, requiredDeposit: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyBonusRules } });
                    }} /></td>
                    <td><input type="number" min="0" step="0.01" value={rule.requiredTurnover} onChange={(event) => {
                      const monthlyBonusRules = [...bonusData.config.monthlyBonusRules]; monthlyBonusRules[index] = { ...rule, requiredTurnover: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyBonusRules } });
                    }} /></td>
                    <td><input type="number" min="0" step="0.01" value={rule.bonus} onChange={(event) => {
                      const monthlyBonusRules = [...bonusData.config.monthlyBonusRules]; monthlyBonusRules[index] = { ...rule, bonus: Number(event.target.value) };
                      setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyBonusRules } });
                    }} /></td>
                    <td><button type="button" className="danger" onClick={() => setBonusData({ ...bonusData, config: { ...bonusData.config, monthlyBonusRules: bonusData.config.monthlyBonusRules.filter((_, rowIndex) => rowIndex !== index) } })}>Remove</button></td>
                  </tr>)}</tbody>
                </table>
              </div>

              <button className="save-settings" disabled={busy}>{busy ? "Saving…" : "Save VIP configuration"}</button>
            </form>

            <div className="admin-table-card admin-bonus-claims">
              <h2>Recent VIP bonus claims</h2>
              <table><thead><tr><th>Date</th><th>User</th><th>Reward</th><th>Level / period</th><th>Amount</th></tr></thead>
                <tbody>{bonusData.claims.length === 0 ? <tr><td colSpan={5}>No bonus claims yet.</td></tr> : bonusData.claims.map((claim) => <tr key={claim.id}>
                  <td>{new Date(claim.createdAt).toLocaleString()}</td>
                  <td>{typeof claim.userId === "string" ? claim.userId : `${claim.userId.name} (${claim.userId.email})`}</td>
                  <td>{claim.type === "LEVEL_UP" ? "Level-up bonus" : "Monthly bonus"}</td>
                  <td>{claim.type === "LEVEL_UP" ? `VIP${claim.vipLevel}` : claim.periodKey}</td>
                  <td className="positive">+{money(claim.amount)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {tab === "USERS" && (
          <div className="admin-table-card"><table><thead><tr><th>Name</th><th>Email</th><th>Available</th><th>Withdrawal lock</th><th>Bet escrow</th><th>Locked winnings</th><th>Wager remaining</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{money(user.balance)}</td>
              <td>{money(user.lockedBalance)}</td><td>{money(user.bettingLockedBalance)}</td><td>{money(user.pendingRewards)}</td><td>{money(user.wagerRequirementRemaining)}</td><td>{money(user.totalBalance)}</td><td>{user.status}</td>
              <td>{user.role === "USER" && <button disabled={busy} onClick={() => void run(async () => {
                await apiRequest(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }) });
                await loadUsers();
              })}>{user.status === "ACTIVE" ? "Suspend" : "Activate"}</button>}</td></tr>)}</tbody>
          </table></div>
        )}

        {tab === "DEPOSITS" && (
          <>
            {settings && <div className="admin-inline-setting">
              <div><strong>Minimum deposit</strong><span>This limit is validated for every new deposit request.</span></div>
              <input type="number" min="1" step="0.01" value={settings.minDeposit} onChange={(event) => setSettings({ ...settings, minDeposit: Number(event.target.value) })} />
              <button disabled={busy} onClick={() => void run(async () => {
                await apiRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify(settings) });
                await loadDeposits();
              })}>Save minimum</button>
            </div>}
            <div className="admin-table-card"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{deposits.map((item) => <tr key={item._id}><td>{userName(item.userId)}</td><td>{money(item.amount)}</td><td>{item.method}</td><td>{item.reference}</td><td>{item.status}</td>
                <td>{item.status === "PENDING" && <div className="admin-actions"><button disabled={busy} onClick={() => void run(async () => {
                  await apiRequest(`/api/admin/deposits/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "APPROVE" }) }); await loadDeposits();
                })}>Approve</button><button className="danger" disabled={busy} onClick={() => void run(async () => {
                  await apiRequest(`/api/admin/deposits/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "REJECT" }) }); await loadDeposits();
                })}>Reject</button></div>}</td></tr>)}</tbody>
            </table></div>
          </>
        )}

        {tab === "WITHDRAWALS" && (
          <>
            {settings && <div className="admin-inline-setting">
              <div><strong>Minimum withdrawal</strong><span>Only available balance can be withdrawn; locked winnings are excluded.</span></div>
              <input type="number" min="1" step="0.01" value={settings.minWithdrawal} onChange={(event) => setSettings({ ...settings, minWithdrawal: Number(event.target.value) })} />
              <button disabled={busy} onClick={() => void run(async () => {
                await apiRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify(settings) });
                await loadWithdrawals();
              })}>Save minimum</button>
            </div>}
            <div className="admin-table-card"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Details</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{withdrawals.map((item) => <tr key={item._id}><td>{userName(item.userId)}</td><td>{money(item.amount)}</td><td>{item.method}</td><td className="wrap-cell">{item.accountDetails}</td><td>{item.status}</td>
                <td>{!( ["COMPLETED", "REJECTED"] as string[]).includes(item.status) && <div className="admin-actions">
                  {item.status === "PENDING" && <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "PROCESS" }) }); await loadWithdrawals(); })}>Process</button>}
                  <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "COMPLETE" }) }); await loadWithdrawals(); })}>Complete</button>
                  <button className="danger" disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "REJECT" }) }); await loadWithdrawals(); })}>Reject</button>
                </div>}</td></tr>)}</tbody>
            </table></div>
          </>
        )}

        {tab === "AUDIT" && (
          <>
            <div className="admin-table-card"><h2>Platform bucket audit</h2><table><thead><tr><th>Date</th><th>Event</th><th>User</th><th>Escrow Δ</th><th>Reserve Δ</th><th>Pool Δ</th><th>Commission Δ</th><th>Bonus Δ</th><th>Description</th></tr></thead>
              <tbody>{audit.map((item) => <tr key={item._id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.type}</td><td>{userName(item.userId)}</td>
                <td>{money(item.activeBetEscrowDelta)}</td><td>{money(item.reservedLiquidityDelta)}</td><td>{money(item.lossPoolDelta)}</td>
                <td>{money(item.commissionWalletDelta)}</td><td>{money(item.bonusWalletDelta)}</td><td className="wrap-cell">{item.description}</td></tr>)}</tbody>
            </table></div>
            <div className="admin-table-card" style={{ marginTop: 18 }}><h2>User wallet ledger</h2><table><thead><tr><th>Date</th><th>User</th><th>Type</th><th>Amount</th><th>Available after</th><th>Withdrawal lock</th><th>Bet escrow</th><th>Description</th></tr></thead>
              <tbody>{transactions.map((item) => <tr key={item._id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{userName(item.userId)}</td><td>{item.type}</td>
                <td>{money(item.amount)}</td><td>{money(item.balanceAfter)}</td><td>{money(item.lockedBalanceAfter)}</td><td>{money(item.bettingLockedAfter ?? 0)}</td>
                <td className="wrap-cell">{item.description}</td></tr>)}</tbody>
            </table></div>
          </>
        )}

        {tab === "SETTINGS" && settings && (
          <form className="admin-settings" onSubmit={(event) => { event.preventDefault(); void run(async () => {
            await apiRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify(settings) }); await loadSettings();
          }); }}>
            <div className="settings-grid">
              <label>Global house edge %<input type="number" min="0" max="20" step="0.01" value={settings.houseEdgePercent} onChange={(event) => setSettings({ ...settings, houseEdgePercent: Number(event.target.value) })} /><small>Global probability setting only; it never changes an individual settled result.</small></label>
              <label>Platform commission %<input type="number" min="0" max="50" step="0.01" value={settings.commissionPercent} onChange={(event) => setSettings({ ...settings, commissionPercent: Number(event.target.value) })} /><small>Deducted only from gross winner profit and credited to the commission wallet.</small></label>
              <label>Protected loss-pool reserve %<input type="number" min="0" max="95" step="0.01" value={settings.reservePercent} onChange={(event) => setSettings({ ...settings, reservePercent: Number(event.target.value) })} /><small>This portion of the loss pool cannot be reserved for new bets.</small></label>
              <label>Minimum bet<input type="number" min="1" step="0.01" value={settings.minBet} onChange={(event) => setSettings({ ...settings, minBet: Number(event.target.value) })} /></label>
              <label>Minimum deposit<input type="number" min="1" step="0.01" value={settings.minDeposit} onChange={(event) => setSettings({ ...settings, minDeposit: Number(event.target.value) })} /></label>
              <label>Minimum withdrawal<input type="number" min="1" step="0.01" value={settings.minWithdrawal} onChange={(event) => setSettings({ ...settings, minWithdrawal: Number(event.target.value) })} /></label>
              <label>Deposit wagering requirement %<input type="number" min="0" max="100" step="0.01" value={settings.wageringRequirementPercent} onChange={(event) => setSettings({ ...settings, wageringRequirementPercent: Number(event.target.value) })} /><small>Example: 30% on a 5,000 PKR approved deposit requires 1,500 PKR of settled bets. Winnings remain locked until completed.</small></label>
              <label>Maximum bet<input type="number" min="1" step="0.01" value={settings.maxBet} onChange={(event) => setSettings({ ...settings, maxBet: Number(event.target.value) })} /></label>
              <label>Guaranteed maximum cash-out<input type="number" min="1.01" max="1000" step="0.01" value={settings.maxCashoutMultiplier} onChange={(event) => setSettings({ ...settings, maxCashoutMultiplier: Number(event.target.value) })} /><small>Every accepted bet reserves enough peer liquidity to pay up to this multiplier.</small></label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.depositsEnabled} onChange={(event) => setSettings({ ...settings, depositsEnabled: event.target.checked })} /> Deposits enabled</label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.withdrawalsEnabled} onChange={(event) => setSettings({ ...settings, withdrawalsEnabled: event.target.checked })} /> Withdrawals enabled</label>
            </div>
            <div className="settings-warning">Deposit wagering is added when an admin approves a deposit. Only net winnings are locked; the original stake returns to available balance. Settled wins and losses both count toward the requirement.</div>
            <button className="save-settings" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
