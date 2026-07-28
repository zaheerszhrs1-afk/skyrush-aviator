import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import type { AuthUser, DepositRequest, WithdrawalRequest } from "../types";

interface Summary {
  users: number;
  depositsPending: number;
  withdrawalsPending: number;
  activeBets: number;
  houseBankroll: number;
  gameProfit: number;
  effectiveBankroll: number;
  requiredReserve: number;
  totalApprovedDeposits: number;
  totalCompletedWithdrawals: number;
  recentRounds: Array<{ _id: string; roundId: string; crashPoint: number; totalStake: number; totalPayout: number; crashedAt: string }>;
}

interface AdminSettings {
  houseEdgePercent: number;
  reservePercent: number;
  minBet: number;
  maxBet: number;
  maxCashoutMultiplier: number;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
}

interface AdminPanelProps {
  onBack: () => void;
}

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [tab, setTab] = useState<"OVERVIEW" | "USERS" | "DEPOSITS" | "WITHDRAWALS" | "SETTINGS">("OVERVIEW");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [houseBankroll, setHouseBankroll] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = async () => {
    const result = await apiRequest<{ summary: Summary }>("/api/admin/summary");
    setSummary(result.summary);
  };
  const loadUsers = async () => setUsers((await apiRequest<{ users: AuthUser[] }>("/api/admin/users")).users);
  const loadDeposits = async () => setDeposits((await apiRequest<{ deposits: DepositRequest[] }>("/api/admin/deposits")).deposits);
  const loadWithdrawals = async () => setWithdrawals((await apiRequest<{ withdrawals: WithdrawalRequest[] }>("/api/admin/withdrawals")).withdrawals);
  const loadSettings = async () => {
    const result = await apiRequest<{ settings: AdminSettings; state: { houseBankroll: number } }>("/api/admin/settings");
    setSettings(result.settings);
    setHouseBankroll(Number(result.state?.houseBankroll ?? 0));
  };

  useEffect(() => {
    setMessage("");
    const action = tab === "OVERVIEW" ? loadOverview : tab === "USERS" ? loadUsers : tab === "DEPOSITS" ? loadDeposits : tab === "WITHDRAWALS" ? loadWithdrawals : loadSettings;
    void action().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load admin data."));
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

  const userName = (value: DepositRequest["userId"] | WithdrawalRequest["userId"]) => typeof value === "string" ? value : `${value.name} (${value.email})`;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-title"><strong>SkyRush Admin</strong><span>Operations & risk control</span></div>
        {(["OVERVIEW", "USERS", "DEPOSITS", "WITHDRAWALS", "SETTINGS"] as const).map((item) => (
          <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item[0] + item.slice(1).toLowerCase()}</button>
        ))}
        <button className="admin-back" onClick={onBack}>← Return to game</button>
      </aside>
      <section className="admin-content">
        <header><div><h1>{tab[0] + tab.slice(1).toLowerCase()}</h1><p>All monetary actions are stored in MongoDB with wallet ledger entries.</p></div><button onClick={() => window.location.reload()}>Refresh</button></header>
        {message && <div className="admin-message">{message}</div>}

        {tab === "OVERVIEW" && summary && (
          <>
            <div className="admin-kpis">
              <article><span>Users</span><strong>{summary.users}</strong></article>
              <article><span>Pending deposits</span><strong>{summary.depositsPending}</strong></article>
              <article><span>Open withdrawals</span><strong>{summary.withdrawalsPending}</strong></article>
              <article><span>Active bets</span><strong>{summary.activeBets}</strong></article>
              <article><span>House bankroll</span><strong>{summary.houseBankroll.toLocaleString()} PKR</strong></article>
              <article><span>Game profit</span><strong className={summary.gameProfit >= 0 ? "positive" : "negative"}>{summary.gameProfit.toLocaleString()} PKR</strong></article>
              <article><span>Required reserve</span><strong>{summary.requiredReserve.toLocaleString()} PKR</strong></article>
              <article><span>Approved deposits</span><strong>{summary.totalApprovedDeposits.toLocaleString()} PKR</strong></article>
            </div>
            <div className="admin-table-card"><h2>Recent rounds</h2><table><thead><tr><th>Round</th><th>Crash</th><th>Stake</th><th>Payout</th><th>Date</th></tr></thead><tbody>{summary.recentRounds.map((round) => <tr key={round._id}><td>{round.roundId.slice(0, 8)}</td><td>{round.crashPoint.toFixed(2)}x</td><td>{round.totalStake.toLocaleString()}</td><td>{round.totalPayout.toLocaleString()}</td><td>{new Date(round.crashedAt).toLocaleString()}</td></tr>)}</tbody></table></div>
          </>
        )}

        {tab === "USERS" && (
          <div className="admin-table-card"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Balance</th><th>Locked</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.role}</td><td>{user.balance.toLocaleString()}</td><td>{user.lockedBalance.toLocaleString()}</td><td>{user.status}</td><td>{user.role === "USER" && <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }) }); await loadUsers(); })}>{user.status === "ACTIVE" ? "Suspend" : "Activate"}</button>}</td></tr>)}</tbody></table></div>
        )}

        {tab === "DEPOSITS" && (
          <div className="admin-table-card"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Actions</th></tr></thead><tbody>{deposits.map((item) => <tr key={item._id}><td>{userName(item.userId)}</td><td>{item.amount.toLocaleString()} PKR</td><td>{item.method}</td><td>{item.reference}</td><td>{item.status}</td><td>{item.status === "PENDING" && <div className="admin-actions"><button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/deposits/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "APPROVE" }) }); await loadDeposits(); })}>Approve</button><button className="danger" disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/deposits/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "REJECT" }) }); await loadDeposits(); })}>Reject</button></div>}</td></tr>)}</tbody></table></div>
        )}

        {tab === "WITHDRAWALS" && (
          <div className="admin-table-card"><table><thead><tr><th>User</th><th>Amount</th><th>Method</th><th>Details</th><th>Status</th><th>Actions</th></tr></thead><tbody>{withdrawals.map((item) => <tr key={item._id}><td>{userName(item.userId)}</td><td>{item.amount.toLocaleString()} PKR</td><td>{item.method}</td><td className="wrap-cell">{item.accountDetails}</td><td>{item.status}</td><td>{!(["COMPLETED", "REJECTED"] as string[]).includes(item.status) && <div className="admin-actions">{item.status === "PENDING" && <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "PROCESS" }) }); await loadWithdrawals(); })}>Process</button>}<button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "COMPLETE" }) }); await loadWithdrawals(); })}>Complete</button><button className="danger" disabled={busy} onClick={() => void run(async () => { await apiRequest(`/api/admin/withdrawals/${item._id}`, { method: "PATCH", body: JSON.stringify({ action: "REJECT" }) }); await loadWithdrawals(); })}>Reject</button></div>}</td></tr>)}</tbody></table></div>
        )}

        {tab === "SETTINGS" && settings && (
          <form className="admin-settings" onSubmit={(event) => { event.preventDefault(); void run(async () => { await apiRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ ...settings, houseBankroll }) }); await loadSettings(); }); }}>
            <div className="settings-grid">
              <label>House edge / platform win %<input type="number" min="0" max="20" step="0.01" value={settings.houseEdgePercent} onChange={(event) => setSettings({ ...settings, houseEdgePercent: Number(event.target.value) })} /><small>User RTP is approximately {(100 - settings.houseEdgePercent).toFixed(2)}%. Applies only to future rounds.</small></label>
              <label>Protected reserve %<input type="number" min="0" max="95" step="0.01" value={settings.reservePercent} onChange={(event) => setSettings({ ...settings, reservePercent: Number(event.target.value) })} /><small>This share of effective bankroll is excluded from new-bet exposure.</small></label>
              <label>House bankroll (PKR)<input type="number" min="0" step="0.01" value={houseBankroll} onChange={(event) => setHouseBankroll(Number(event.target.value))} /><small>Fund this with real platform capital before accepting real-money bets.</small></label>
              <label>Minimum bet<input type="number" min="1" step="0.01" value={settings.minBet} onChange={(event) => setSettings({ ...settings, minBet: Number(event.target.value) })} /></label>
              <label>Maximum bet<input type="number" min="1" step="0.01" value={settings.maxBet} onChange={(event) => setSettings({ ...settings, maxBet: Number(event.target.value) })} /></label>
              <label>Maximum cash-out multiplier<input type="number" min="1.01" max="1000" step="0.01" value={settings.maxCashoutMultiplier} onChange={(event) => setSettings({ ...settings, maxCashoutMultiplier: Number(event.target.value) })} /></label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.depositsEnabled} onChange={(event) => setSettings({ ...settings, depositsEnabled: event.target.checked })} /> Deposits enabled</label>
              <label className="toggle-setting"><input type="checkbox" checked={settings.withdrawalsEnabled} onChange={(event) => setSettings({ ...settings, withdrawalsEnabled: event.target.checked })} /> Withdrawals enabled</label>
            </div>
            <div className="settings-warning">The system uses a global disclosed house edge and reserve-based solvency guard. It does not target specific users or secretly force individual wins/losses.</div>
            <button className="save-settings" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
