import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import type { DepositRequest, WalletSnapshot, WalletTransaction, WithdrawalRequest } from "../types";

interface FinanceModalProps {
  wallet: WalletSnapshot;
  onClose: () => void;
  onWalletRefresh: (wallet: WalletSnapshot) => void;
  initialTab?: "DEPOSIT" | "WITHDRAW" | "HISTORY";
}

interface NowPaymentsConfig {
  enabled: boolean;
  currencies: string[];
}

interface NowPaymentInstructions {
  depositId: string;
  paymentId: string;
  status: string;
  payAmount: number;
  payCurrency: string;
  payAddress: string;
  payinExtraId: string;
  network: string;
  expiresAt: string;
}

const NOWPAYMENTS_METHOD = "NOWPayments Crypto";
const JAZZCASH_TILL_ID = "984046332";
const depositMethods = [
  { value: "JazzCash", label: "Jazzcash", icon: "JC" },
  { value: "EasyPaisa", label: "Easypaisa", icon: "EP" },
  { value: "USDT Manual", label: "Crypto", icon: "₮" },
  { value: "Bank Transfer", label: "Bank", icon: "⌂" }
];
const withdrawalMethods = [
  { value: "EasyPaisa", label: "Easypaisa", icon: "EP" },
  { value: "JazzCash", label: "Jazzcash", icon: "JC" },
  { value: "Bank Transfer", label: "Bank", icon: "⌂" },
  { value: "USDT Manual", label: "USDT", icon: "₮" }
];
const depositQuickAmounts = [100, 300, 500, 1_000, 3_000, 5_000, 10_000, 30_000, 50_000];

export function FinanceModal({ wallet, onClose, onWalletRefresh, initialTab = "DEPOSIT" }: FinanceModalProps) {
  const [tab, setTab] = useState<"DEPOSIT" | "WITHDRAW" | "HISTORY">(initialTab);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("JazzCash");
  const [reference, setReference] = useState("");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [financeSettings, setFinanceSettings] = useState({ minDeposit: 100, minWithdrawal: 500, wageringRequirementPercent: 30, depositsEnabled: true, withdrawalsEnabled: true });
  const [nowPayments, setNowPayments] = useState<NowPaymentsConfig>({ enabled: false, currencies: [] });
  const [cryptoCurrency, setCryptoCurrency] = useState("");
  const [cryptoPayment, setCryptoPayment] = useState<NowPaymentInstructions | null>(null);

  const wagerTarget = Math.max(0, Number(wallet.wagerRequirementTarget ?? 0));
  const wagerRemaining = Math.max(0, Number(wallet.wagerRequirementRemaining ?? 0));
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
    void apiRequest<NowPaymentsConfig>("/api/payments/nowpayments/config")
      .then((result) => {
        setNowPayments(result);
        setCryptoCurrency(result.currencies[0] ?? "");
      })
      .catch(() => setNowPayments({ enabled: false, currencies: [] }));
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
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const refreshWallet = async () => {
    const result = await apiRequest<{ wallet: WalletSnapshot }>("/api/wallet");
    onWalletRefresh(result.wallet);
  };

  const selectMethod = (value: string) => {
    setMethod(value);
    setCryptoPayment(null);
  };

  const submitDeposit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (method === NOWPAYMENTS_METHOD) {
        const result = await apiRequest<{ payment: NowPaymentInstructions }>("/api/payments/nowpayments", {
          method: "POST",
          body: JSON.stringify({ amount: Number(amount), payCurrency: cryptoCurrency })
        });
        setCryptoPayment(result.payment);
        setMessage("Crypto payment created. Send the exact amount below; your wallet is credited automatically after confirmation.");
        return;
      }
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

  const copyPaymentValue = (value: string) => {
    void navigator.clipboard.writeText(value)
      .then(() => setMessage("Copied to clipboard."))
      .catch(() => setMessage("Copy failed. Select and copy the value manually."));
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
        <nav className="finance-tabs">
          <button className={tab === "DEPOSIT" ? "active" : ""} onClick={() => setTab("DEPOSIT")}>Deposit</button>
          <button className={tab === "WITHDRAW" ? "active" : ""} onClick={() => { setTab("WITHDRAW"); if (method === NOWPAYMENTS_METHOD) setMethod("Bank Transfer"); }}>Withdraw</button>
          <button className={tab === "HISTORY" ? "active" : ""} onClick={() => setTab("HISTORY")}>History</button>
        </nav>

        {tab === "DEPOSIT" && (
          <form className="finance-form finance-reference-form" onSubmit={submitDeposit}>
            <div className="finance-methods">{[...depositMethods, ...(nowPayments.enabled ? [{ value: NOWPAYMENTS_METHOD, label: "NOW Crypto", icon: "N" }] : [])].map((item) => <button type="button" key={item.value} className={`finance-method ${method === item.value ? "active" : ""}`} onClick={() => selectMethod(item.value)}><strong>{item.icon}</strong><span>{item.label}</span></button>)}</div>
            <div className="finance-section-label">Select amount</div>
            <div className="finance-quick-amounts">{depositQuickAmounts.map((value) => <button type="button" key={value} className={Number(amount) === value ? "active" : ""} onClick={() => { setAmount(String(value)); setCryptoPayment(null); }}>{value.toLocaleString()}</button>)}</div>
            <label className="finance-input-label">Deposit amount<input type="number" min={financeSettings.minDeposit} step="0.01" placeholder="PKR" value={amount} onChange={(event) => { setAmount(event.target.value); setCryptoPayment(null); }} required /></label>
            {method === NOWPAYMENTS_METHOD
              ? <label className="finance-input-label">Pay with<select value={cryptoCurrency} onChange={(event) => { setCryptoCurrency(event.target.value); setCryptoPayment(null); }}>{nowPayments.currencies.map((currency) => <option value={currency} key={currency}>{currency.toUpperCase()}</option>)}</select></label>
              : <label className="finance-input-label">Transaction/reference ID<input value={reference} onChange={(event) => setReference(event.target.value)} required /></label>}
            <div className="finance-tutorial"><strong>Deposit tutorial</strong><span>1. Scan the payment QR or use the payment account details below.</span><span>2. Enter the exact amount and submit your transaction reference.</span><span>3. Approved deposits add a {financeSettings.wageringRequirementPercent}% wagering requirement.</span></div>
            <button className="finance-submit" disabled={busy || !financeSettings.depositsEnabled || (method === NOWPAYMENTS_METHOD && (!cryptoCurrency || Boolean(cryptoPayment)))}>{!financeSettings.depositsEnabled ? "Deposits disabled" : busy ? "Submitting..." : cryptoPayment ? "Payment created" : method === NOWPAYMENTS_METHOD ? "Create crypto payment" : "Submit deposit"}</button>
            {method === "JazzCash" && <section className="jazzcash-payment-card"><img src="/jazzcash-raast-qr.jpg" alt="JazzCash Raast QR payment instructions for YouSaf Internet" /><div className="till-id-row"><div><span>Till ID</span><strong>{JAZZCASH_TILL_ID}</strong></div><button type="button" onClick={() => copyPaymentValue(JAZZCASH_TILL_ID)}>Copy Till ID</button></div><small>Scan the QR code or dial *786*10# and enter this Till ID to pay via JazzCash.</small></section>}
            {cryptoPayment && <section className="crypto-payment-card" aria-live="polite">
              <header><div><small>NOWPayments</small><strong>Send exactly {cryptoPayment.payAmount} {cryptoPayment.payCurrency.toUpperCase()}</strong></div><span>{cryptoPayment.status.replaceAll("_", " ")}</span></header>
              {cryptoPayment.network && <p>Network <strong>{cryptoPayment.network.toUpperCase()}</strong></p>}
              <label>Payment address<div><code>{cryptoPayment.payAddress}</code><button type="button" onClick={() => copyPaymentValue(cryptoPayment.payAddress)}>Copy</button></div></label>
              {cryptoPayment.payinExtraId && <label>Memo / destination tag<div><code>{cryptoPayment.payinExtraId}</code><button type="button" onClick={() => copyPaymentValue(cryptoPayment.payinExtraId)}>Copy</button></div></label>}
              {cryptoPayment.expiresAt && <small>Payment estimate expires {new Date(cryptoPayment.expiresAt).toLocaleString()}.</small>}
            </section>}
          </form>
        )}

        {tab === "WITHDRAW" && (
          <form className="finance-form finance-reference-form" onSubmit={submitWithdrawal}>
            <div className="finance-balance-summary"><div><strong>{formatMoney(wallet.balance)}</strong><span>Cash balance</span></div><div><strong>{formatMoney(Math.max(0, wallet.balance - wallet.pendingRewards))}</strong><span>Withdrawable</span></div></div>
            <div className="finance-methods finance-withdraw-methods">{withdrawalMethods.map((item) => <button type="button" key={item.value} className={`finance-method ${method === item.value ? "active" : ""}`} onClick={() => selectMethod(item.value)}><strong>{item.icon}</strong><span>{item.label}</span></button>)}</div>
            <label className="finance-input-label">Choose account<textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add your wallet, bank or account details" required rows={3} /></label>
            <button type="button" className="finance-add-account" onClick={() => setDetails("")}>Add new account</button>
            <label className="finance-input-label">Withdrawal amount ({financeSettings.minWithdrawal.toLocaleString()} - {formatMoney(wallet.balance)} PKR)<input type="number" min={financeSettings.minWithdrawal} max={wallet.balance} step="0.01" placeholder="Withdrawal amount" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <div className="finance-withdraw-summary"><div><span>Withdraw amount</span><strong>RS:{formatMoney(Number(amount) || 0)}</strong></div><div><span>Remain wagers</span><strong>{formatMoney(wagerRemaining)} PKR</strong></div><div><span>Remaining withdrawal attempts</span><strong>{wagerTarget > 0 && wagerRemaining > 0 ? "Locked" : "Available"}</strong></div></div>
            <small className="finance-tutorial">{wagerTarget <= 0 ? "An approved deposit will start the wagering progress." : wagerRemaining <= 0 ? "Wagering completed. Your settled winnings are available for withdrawal." : `Complete ${formatMoney(wagerRemaining)} PKR more in settled real bets to unlock winnings.`}</small>
            <button className="finance-submit" disabled={busy || !financeSettings.withdrawalsEnabled}>{!financeSettings.withdrawalsEnabled ? "Withdrawals disabled" : busy ? "Submitting..." : "Submit withdrawal"}</button>
          </form>
        )}

        {message && <div className="finance-message">{message}</div>}

        {tab === "HISTORY" && (
          <div className="finance-history">
            <h3>Wallet transactions</h3>
            {transactions.map((item) => <div className="history-item" key={item._id}><span>{item.description || item.type}<small>{new Date(item.createdAt).toLocaleString()}</small></span><strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount.toLocaleString()} PKR</strong></div>)}
            <h3>Deposit requests</h3>
            {deposits.map((item) => <div className="history-item" key={item._id}><span>{item.method}<small>{item.gatewayStatus ? `Gateway: ${item.gatewayStatus.replaceAll("_", " ")}${item.gatewayPayAmount && item.gatewayPayCurrency ? ` · ${item.gatewayPayAmount} ${item.gatewayPayCurrency.toUpperCase()}` : ""}${item.gatewayPayAddress ? ` · ${item.gatewayPayAddress}` : ""}` : item.reference}</small></span><strong>{item.amount.toLocaleString()} · {item.status}</strong></div>)}
            <h3>Withdrawal requests</h3>
            {withdrawals.map((item) => <div className="history-item" key={item._id}><span>{item.method}<small>{new Date(item.createdAt).toLocaleString()}</small></span><strong>{item.amount.toLocaleString()} · {item.status}</strong></div>)}
          </div>
        )}
      </section>
    </div>
  );
}
