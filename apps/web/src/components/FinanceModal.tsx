import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import type { DepositRequest, WalletSnapshot, WalletTransaction, WithdrawalRequest } from "../types";

interface FinanceModalProps {
  wallet: WalletSnapshot;
  onClose: () => void;
  onWalletRefresh: (wallet: WalletSnapshot) => void;
}

export function FinanceModal({ wallet, onClose, onWalletRefresh }: FinanceModalProps) {
  const [tab, setTab] = useState<"DEPOSIT" | "WITHDRAW" | "HISTORY">("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Bank Transfer");
  const [reference, setReference] = useState("");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [financeSettings, setFinanceSettings] = useState({ minDeposit: 100, minWithdrawal: 500, wageringRequirementPercent: 30, depositsEnabled: true, withdrawalsEnabled: true });

  const wagerTarget = Math.max(0, Number(wallet.wagerRequirementTarget ?? 0));
  const wagerRemaining = Math.max(0, Number(wallet.wagerRequirementRemaining ?? 0));
  const wagerCompleted = Math.min(
    wagerTarget,
    Math.max(0, Number(wallet.wagerRequirementCompleted ?? Math.max(0, wagerTarget - wagerRemaining)))
  );
  const wagerProgress = wagerTarget > 0 ? Math.min(100, (wagerCompleted / wagerTarget) * 100) : 0;
  const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const loadHistory = async () => {
    const [transactionResult, depositResult, withdrawalResult] = await Promise.all([
      apiRequest<{ transactions: WalletTransaction[] }>("/api/wallet/transactions"),
      apiRequest<{ deposits: DepositRequest[] }>("/api/deposits/me"),
      apiRequest<{ withdrawals: WithdrawalRequest[] }>("/api/withdrawals/me")
    ]);
    setTransactions(transactionResult.transactions);
    setDeposits(depositResult.deposits);
    setWithdrawals(withdrawalResult.withdrawals);
  };

  useEffect(() => {
    void apiRequest<{ settings: typeof financeSettings }>("/api/finance/settings")
      .then((result) => setFinanceSettings(result.settings))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load wallet settings."));
  }, []);

  useEffect(() => {
    if (tab === "HISTORY") void loadHistory().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load history."));
  }, [tab]);

  useEffect(() => {
    void refreshWallet().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab === "WITHDRAW") void refreshWallet().catch(() => undefined);
  }, [tab]);

  const refreshWallet = async () => {
    const result = await apiRequest<{ wallet: WalletSnapshot }>("/api/wallet");
    onWalletRefresh(result.wallet);
  };

  const submitDeposit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/deposits", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), method, reference })
      });
      setAmount("");
      setReference("");
      setMessage("Deposit request submitted for admin review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deposit request failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitWithdrawal = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/withdrawals", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), method, accountDetails: details })
      });
      await refreshWallet();
      setAmount("");
      setDetails("");
      setMessage("Withdrawal request submitted and amount locked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Withdrawal request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="finance-modal" role="dialog" aria-modal="true">
        <header>
          <div><strong>Wallet</strong><span>Available {formatMoney(wallet.balance)} PKR · Total {formatMoney(wallet.totalBalance)} PKR</span></div>
          <button onClick={onClose}>×</button>
        </header>
        <nav>
          <button className={tab === "DEPOSIT" ? "active" : ""} onClick={() => setTab("DEPOSIT")}>Deposit</button>
          <button className={tab === "WITHDRAW" ? "active" : ""} onClick={() => setTab("WITHDRAW")}>Withdraw</button>
          <button className={tab === "HISTORY" ? "active" : ""} onClick={() => setTab("HISTORY")}>History</button>
        </nav>

        {tab === "DEPOSIT" && (
          <form className="finance-form" onSubmit={submitDeposit}>
            <label>Amount (PKR)<input type="number" min={financeSettings.minDeposit} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value)}><option>Bank Transfer</option><option>JazzCash</option><option>EasyPaisa</option><option>USDT Manual</option></select></label>
            <label>Transaction/reference ID<input value={reference} onChange={(event) => setReference(event.target.value)} required /></label>
            <small className="finance-rule">Minimum deposit: {financeSettings.minDeposit.toLocaleString()} PKR. Approved deposits add a {financeSettings.wageringRequirementPercent}% wagering requirement.</small>
            <button disabled={busy || !financeSettings.depositsEnabled}>{!financeSettings.depositsEnabled ? "Deposits disabled" : busy ? "Submitting..." : "Submit deposit request"}</button>
          </form>
        )}

        {tab === "WITHDRAW" && (
          <form className="finance-form" onSubmit={submitWithdrawal}>
            <section className={`wager-progress-card ${wagerTarget > 0 && wagerRemaining === 0 ? "complete" : ""}`}>
              <div className="wager-progress-heading">
                <span>Current valid bet</span>
                <strong>{wagerTarget > 0 ? `${formatMoney(wagerCompleted)} / ${formatMoney(wagerTarget)}` : "No active requirement"}</strong>
              </div>
              <div className="wager-progress-track" role="progressbar" aria-label="Deposit wagering progress" aria-valuemin={0} aria-valuemax={wagerTarget || 1} aria-valuenow={wagerCompleted}>
                <span style={{ width: `${wagerProgress}%` }} />
                {wagerTarget > 0 && <b>{formatMoney(wagerCompleted)} / {formatMoney(wagerTarget)}</b>}
              </div>
              <div className="wager-progress-meta">
                <span>Locked winnings <b>{formatMoney(wallet.pendingRewards)} PKR</b></span>
                <span>Remaining <b>{formatMoney(wagerRemaining)} PKR</b></span>
              </div>
              <small>
                {wagerTarget <= 0
                  ? "An approved deposit will start the wagering progress."
                  : wagerRemaining <= 0
                    ? "Wagering completed. All settled winnings are available for withdrawal."
                    : `Complete ${formatMoney(wagerRemaining)} PKR more in settled real bets to unlock winnings.`}
              </small>
            </section>
            <label>Amount (PKR)<input type="number" min={financeSettings.minWithdrawal} max={wallet.balance} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label>Withdrawal method<select value={method} onChange={(event) => setMethod(event.target.value)}><option>Bank Transfer</option><option>JazzCash</option><option>EasyPaisa</option><option>USDT Manual</option></select></label>
            <label>Account details<textarea value={details} onChange={(event) => setDetails(event.target.value)} required rows={4} /></label>
            <small className="finance-rule">Minimum withdrawal: {financeSettings.minWithdrawal.toLocaleString()} PKR. Locked winnings become withdrawable after the wagering requirement reaches zero.</small>
            <button disabled={busy || !financeSettings.withdrawalsEnabled}>{!financeSettings.withdrawalsEnabled ? "Withdrawals disabled" : busy ? "Submitting..." : "Request withdrawal"}</button>
          </form>
        )}

        {message && <div className="finance-message">{message}</div>}

        {tab === "HISTORY" && (
          <div className="finance-history">
            <h3>Wallet transactions</h3>
            {transactions.map((item) => <div className="history-item" key={item._id}><span>{item.description || item.type}<small>{new Date(item.createdAt).toLocaleString()}</small></span><strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()} PKR</strong></div>)}
            <h3>Deposit requests</h3>
            {deposits.map((item) => <div className="history-item" key={item._id}><span>{item.method}<small>{item.reference}</small></span><strong>{item.amount.toLocaleString()} · {item.status}</strong></div>)}
            <h3>Withdrawal requests</h3>
            {withdrawals.map((item) => <div className="history-item" key={item._id}><span>{item.method}<small>{new Date(item.createdAt).toLocaleString()}</small></span><strong>{item.amount.toLocaleString()} · {item.status}</strong></div>)}
          </div>
        )}
      </section>
    </div>
  );
}
