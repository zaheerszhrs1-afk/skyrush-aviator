import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import type { AdminWalletTransaction, AuthUser, DepositRequest, PlatformAuditItem, WithdrawalRequest } from "../types";

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
  commissionWallet: number;
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
  maxBet: number;
  maxCashoutMultiplier: number;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
}

type AdminTab = "OVERVIEW" | "USERS" | "DEPOSITS" | "WITHDRAWALS" | "AUDIT" | "SETTINGS";

interface AdminPanelProps {
  onBack: () => void;
}

const money = (value: number) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} PKR`;

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>("OVERVIEW");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [audit, setAudit] = useState<PlatformAuditItem[]>([]);
  const [transactions, setTransactions] = useState<AdminWalletTransaction[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = async () => setSummary((await apiRequest<{ summary: Summary }>("/api/admin/summary")).summary);
  const loadUsers = async () => setUsers((await apiRequest<{ users: AuthUser[] }>("/api/admin/users")).users);
  const loadDeposits = async () => setDeposits((await apiRequest<{ deposits: DepositRequest[] }>("/api/admin/deposits")).deposits);
  const loadWithdrawals = async () => setWithdrawals((await apiRequest<{ withdrawals: WithdrawalRequest[] }>("/api/admin/withdrawals")).withdrawals);
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
      USERS: loadUsers,
      DEPOSITS: loadDeposits,
      WITHDRAWALS: loadWithdrawals,
      AUDIT: loadAudit,
      SETTINGS: loadSettings
    };
    void actions[tab]().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load admin data."));
  }, [tab]);

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
        <div className="admin-title"><strong>SkyRush Admin</strong><span>Peer liquidity & operations</span></div>
        {(["OVERVIEW", "USERS", "DEPOSITS", "WITHDRAWALS", "AUDIT", "SETTINGS"] as const).map((item) => (
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
              <article><span>Rewards paid</span><strong>{money(summary.totalRewardsPaid)}</strong></article>
              <article><span>Locked funds</span><strong>{money(summary.lockedFunds)}</strong></article>
              <article><span>Pending rewards</span><strong>{money(summary.pendingRewards)}</strong></article>
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

        {tab === "USERS" && (
          <div className="admin-table-card"><table><thead><tr><th>Name</th><th>Email</th><th>Available</th><th>Withdrawal lock</th><th>Bet escrow</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{money(user.balance)}</td>
              <td>{money(user.lockedBalance)}</td><td>{money(user.bettingLockedBalance)}</td><td>{money(user.totalBalance)}</td><td>{user.status}</td>
              <td>{user.role === "USER" && <button disabled={busy} onClick={() => void run(async () => {
                await apiRequest(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }) });
                await loadUsers();
              })}>{user.status === "ACTIVE" ? "Suspend" : "Activate"}</button>}</td></tr>)}</tbody>
          </table></div>
        )}

        {tab === "DEPOSITS" && (
          <div className="admin-table-card"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{deposits.map((item) => <tr key={item._id}><td>{userName(item.userId)}</td><td>{money(item.amount)}</td><td>{item.method}</td><td>{item.reference}</td><td>{item.status}</td>
              <td>{item.status === "PENDING" && <div className="admin-actions"><button disabled={busy} onClick={() => void run(async () => {
                await apiRequest(`/api/admin/deposits/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "APPROVE" }) }); await loadDeposits();
              })}>Approve</button><button className="danger" disabled={busy} onClick={() => void run(async () => {
                await apiRequest(`/api/admin/deposits/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "REJECT" }) }); await loadDeposits();
              })}>Reject</button></div>}</td></tr>)}</tbody>
          </table></div>
        )}

        {tab === "WITHDRAWALS" && (
          <div className="admin-table-card"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Details</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{withdrawals.map((item) => <tr key={item._id}><td>{userName(item.userId)}</td><td>{money(item.amount)}</td><td>{item.method}</td><td className="wrap-cell">{item.accountDetails}</td><td>{item.status}</td>
              <td>{!( ["COMPLETED", "REJECTED"] as string[]).includes(item.status) && <div className="admin-actions">
                {item.status === "PENDING" && <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "PROCESS" }) }); await loadWithdrawals(); })}>Process</button>}
                <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "COMPLETE" }) }); await loadWithdrawals(); })}>Complete</button>
                <button className="danger" disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "REJECT" }) }); await loadWithdrawals(); })}>Reject</button>
              </div>}</td></tr>)}</tbody>
          </table></div>
        )}

        {tab === "AUDIT" && (
          <>
            <div className="admin-table-card"><h2>Platform bucket audit</h2><table><thead><tr><th>Date</th><th>Event</th><th>User</th><th>Escrow Δ</th><th>Reserve Δ</th><th>Pool Δ</th><th>Commission Δ</th><th>Description</th></tr></thead>
              <tbody>{audit.map((item) => <tr key={item._id}><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.type}</td><td>{userName(item.userId)}</td>
                <td>{money(item.activeBetEscrowDelta)}</td><td>{money(item.reservedLiquidityDelta)}</td><td>{money(item.lossPoolDelta)}</td>
                <td>{money(item.commissionWalletDelta)}</td><td className="wrap-cell">{item.description}</td></tr>)}</tbody>
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
              <label>Maximum bet<input type="number" min="1" step="0.01" value={settings.maxBet} onChange={(event) => setSettings({ ...settings, maxBet: Number(event.target.value) })} /></label>
              <label>Guaranteed maximum cash-out<input type="number" min="1.01" max="1000" step="0.01" value={settings.maxCashoutMultiplier} onChange={(event) => setSettings({ ...settings, maxCashoutMultiplier: Number(event.target.value) })} /><small>Every accepted bet reserves enough peer liquidity to pay up to this multiplier.</small></label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.depositsEnabled} onChange={(event) => setSettings({ ...settings, depositsEnabled: event.target.checked })} /> Deposits enabled</label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.withdrawalsEnabled} onChange={(event) => setSettings({ ...settings, withdrawalsEnabled: event.target.checked })} /> Withdrawals enabled</label>
            </div>
            <div className="settings-warning">House bankroll editing has been removed. Winner profit is reserved from the peer loss pool before a bet is accepted, so the admin wallet is never used for payouts.</div>
            <button className="save-settings" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
