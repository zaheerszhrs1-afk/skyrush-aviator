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
    if (tab === "HISTORY") void loadHistory().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load history."));
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
          <div><strong>Wallet</strong><span>Available {wallet.balance.toLocaleString()} PKR · Withdrawal lock {wallet.lockedBalance.toLocaleString()} PKR · Bet escrow {wallet.bettingLockedBalance.toLocaleString()} PKR</span></div>
          <button onClick={onClose}>×</button>
        </header>
        <nav>
          <button className={tab === "DEPOSIT" ? "active" : ""} onClick={() => setTab("DEPOSIT")}>Deposit</button>
          <button className={tab === "WITHDRAW" ? "active" : ""} onClick={() => setTab("WITHDRAW")}>Withdraw</button>
          <button className={tab === "HISTORY" ? "active" : ""} onClick={() => setTab("HISTORY")}>History</button>
        </nav>

        {tab === "DEPOSIT" && (
          <form className="finance-form" onSubmit={submitDeposit}>
            <label>Amount (PKR)<input type="number" min="100" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value)}><option>Bank Transfer</option><option>JazzCash</option><option>EasyPaisa</option><option>USDT Manual</option></select></label>
            <label>Transaction/reference ID<input value={reference} onChange={(event) => setReference(event.target.value)} required /></label>
            <button disabled={busy}>{busy ? "Submitting..." : "Submit deposit request"}</button>
          </form>
        )}

        {tab === "WITHDRAW" && (
          <form className="finance-form" onSubmit={submitWithdrawal}>
            <label>Amount (PKR)<input type="number" min="500" max={wallet.balance} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label>Withdrawal method<select value={method} onChange={(event) => setMethod(event.target.value)}><option>Bank Transfer</option><option>JazzCash</option><option>EasyPaisa</option><option>USDT Manual</option></select></label>
            <label>Account details<textarea value={details} onChange={(event) => setDetails(event.target.value)} required rows={4} /></label>
            <button disabled={busy}>{busy ? "Submitting..." : "Request withdrawal"}</button>
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
