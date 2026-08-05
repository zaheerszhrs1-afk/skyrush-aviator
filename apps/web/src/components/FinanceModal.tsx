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

interface PaymentMethodConfig {
  id: string;
  code: string;
  title: string;
  logoUrl: string;
  qrImageUrl: string;
  identifierLabel: string;
  identifierValue: string;
  instructions: string;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  receiptRequired: boolean;
  sortOrder: number;
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
const depositQuickAmounts = [300, 500, 1_000, 3_000, 5_000, 10_000, 30_000, 50_000];

export function FinanceModal({ wallet, onClose, onWalletRefresh, initialTab = "DEPOSIT" }: FinanceModalProps) {
  const [tab, setTab] = useState<"DEPOSIT" | "WITHDRAW" | "HISTORY">(initialTab);
  const [depositStep, setDepositStep] = useState<"FORM" | "PAYMENT">("FORM");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [financeSettings, setFinanceSettings] = useState({ minDeposit: 100, minWithdrawal: 500, wageringRequirementPercent: 30, depositsEnabled: true, withdrawalsEnabled: true });
  const [nowPayments, setNowPayments] = useState<NowPaymentsConfig>({ enabled: false, currencies: [] });
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [cryptoCurrency, setCryptoCurrency] = useState("");
  const [cryptoPayment, setCryptoPayment] = useState<NowPaymentInstructions | null>(null);

  const wagerTarget = Math.max(0, Number(wallet.wagerRequirementTarget ?? 0));
  const wagerRemaining = Math.max(0, Number(wallet.wagerRequirementRemaining ?? 0));
  const wagerCompleted = Math.min(wagerTarget, Math.max(0, Number(wallet.wagerRequirementCompleted ?? 0)));
  const wagerProgress = wagerTarget > 0 ? Math.min(100, (wagerCompleted / wagerTarget) * 100) : 100;
  const withdrawalMinimum = Math.max(500, Number(financeSettings.minWithdrawal ?? 500));
  const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const availableDepositMethods = paymentMethods.filter((item) => item.depositEnabled);
  const availableWithdrawalMethods = paymentMethods.filter((item) => item.withdrawalEnabled);
  const selectedPaymentMethod = paymentMethods.find((item) => item.code === method) ?? null;

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
    void apiRequest<{ methods: PaymentMethodConfig[] }>("/api/payment-methods")
      .then((result) => {
        setPaymentMethods(result.methods);
        setMethod((current) => result.methods.some((item) => item.code === current && item.depositEnabled) ? current : (result.methods.find((item) => item.depositEnabled)?.code ?? ""));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load payment methods."));
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
  useEffect(() => {
    if (tab === "WITHDRAW") {
      if (method === NOWPAYMENTS_METHOD || !availableWithdrawalMethods.some((item) => item.code === method)) {
        setMethod(availableWithdrawalMethods[0]?.code ?? "");
      }
      return;
    }
    if (tab === "DEPOSIT") {
      const validMethod = method === NOWPAYMENTS_METHOD ? nowPayments.enabled : availableDepositMethods.some((item) => item.code === method);
      if (!validMethod) setMethod(availableDepositMethods[0]?.code ?? (nowPayments.enabled ? NOWPAYMENTS_METHOD : ""));
    }
  }, [tab, paymentMethods, nowPayments.enabled, method]);

  const refreshWallet = async () => {
    const result = await apiRequest<{ wallet: WalletSnapshot }>("/api/wallet");
    onWalletRefresh(result.wallet);
  };

  const selectMethod = (value: string) => {
    setMethod(value);
    setDepositStep("FORM");
    setCryptoPayment(null);
    setReceiptFile(null);
    setReceiptUrl("");
  };

  const uploadReceipt = async (file: File) => {
    if (!file.type.startsWith("image/")) throw new Error("Payment receipt must be an image.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Payment receipt must be smaller than 5 MB.");
    const fileDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Unable to read payment receipt."));
      reader.readAsDataURL(file);
    });
    const result = await apiRequest<{ receiptUrl: string }>("/api/uploads/payment-receipt", {
      method: "POST",
      body: JSON.stringify({ fileDataUrl })
    });
    return result.receiptUrl;
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
        setDepositStep("PAYMENT");
        setMessage("Crypto payment created. Send the exact amount below; your wallet is credited automatically after confirmation.");
        return;
      }
      if (depositStep === "FORM") {
        setDepositStep("PAYMENT");
        return;
      }
      const uploadedReceiptUrl = receiptUrl || (receiptFile ? await uploadReceipt(receiptFile) : "");
      if (selectedPaymentMethod?.receiptRequired && !uploadedReceiptUrl) throw new Error("Upload your payment receipt before submitting.");
      await apiRequest("/api/deposits", {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), method, reference: "RECEIPT_UPLOAD", receiptUrl: uploadedReceiptUrl })
      });
      setAmount("");
      setReceiptFile(null);
      setReceiptUrl("");
      setDepositStep("FORM");
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
          <button className={tab === "DEPOSIT" ? "active" : ""} onClick={() => { setTab("DEPOSIT"); setDepositStep("FORM"); if (!availableDepositMethods.some((item) => item.code === method) && method !== NOWPAYMENTS_METHOD) setMethod(availableDepositMethods[0]?.code ?? (nowPayments.enabled ? NOWPAYMENTS_METHOD : "")); }}>Deposit</button>
          <button className={tab === "WITHDRAW" ? "active" : ""} onClick={() => { setTab("WITHDRAW"); setDepositStep("FORM"); if (method === NOWPAYMENTS_METHOD || !availableWithdrawalMethods.some((item) => item.code === method)) setMethod(availableWithdrawalMethods[0]?.code ?? ""); }}>Withdraw</button>
          <button className={tab === "HISTORY" ? "active" : ""} onClick={() => setTab("HISTORY")}>History</button>
        </nav>

        {tab === "DEPOSIT" && (
          <form className="finance-form finance-reference-form" onSubmit={submitDeposit}>
            <div className="finance-methods">{[...availableDepositMethods.map((item) => ({ value: item.code, label: item.title, icon: item.title.slice(0, 2).toUpperCase(), logo: item.logoUrl })), ...(nowPayments.enabled ? [{ value: NOWPAYMENTS_METHOD, label: "Crypto", icon: "N", logo: "/payment-logos/crypto.png" }] : [])].map((item) => <button type="button" key={item.value} className={`finance-method ${method === item.value ? "active" : ""}`} onClick={() => selectMethod(item.value)}>{item.logo ? <img src={item.logo} alt="" /> : <strong>{item.icon}</strong>}<span>{item.label}</span></button>)}</div>
            <div className="finance-section-label">Select amount</div>
            <div className="finance-quick-amounts">{depositQuickAmounts.map((value) => <button type="button" key={value} className={Number(amount) === value ? "active" : ""} onClick={() => { setAmount(String(value)); setCryptoPayment(null); setDepositStep("FORM"); }}>{value.toLocaleString()}</button>)}</div>
            <label className="finance-input-label">Deposit amount<input type="number" min={financeSettings.minDeposit} step="0.01" placeholder="PKR" value={amount} onChange={(event) => { setAmount(event.target.value); setCryptoPayment(null); setDepositStep("FORM"); }} required /></label>
            {method === NOWPAYMENTS_METHOD
              ? <label className="finance-input-label">Pay with<select value={cryptoCurrency} onChange={(event) => { setCryptoCurrency(event.target.value); setCryptoPayment(null); }}>{nowPayments.currencies.map((currency) => <option value={currency} key={currency}>{currency.toUpperCase()}</option>)}</select></label>
              : null}
            <div className="finance-tutorial"><strong>Deposit tutorial</strong><span>1. Select an amount and tap Continue.</span><span>2. Complete the payment, then upload your receipt.</span><span>3. Approved deposits add a {financeSettings.wageringRequirementPercent}% wagering requirement.</span></div>
            {depositStep === "FORM" ? <button className="finance-submit" disabled={busy || !financeSettings.depositsEnabled || !method || (method === NOWPAYMENTS_METHOD && !cryptoCurrency)}>{!financeSettings.depositsEnabled ? "Deposits disabled" : "Continue"}</button> : <>
              {method !== NOWPAYMENTS_METHOD && selectedPaymentMethod?.receiptRequired && <label className="finance-input-label">Payment receipt<input type="file" accept="image/*" onChange={(event) => { setReceiptFile(event.target.files?.[0] ?? null); setReceiptUrl(""); }} required /></label>}
              <button className="finance-submit" disabled={busy || !financeSettings.depositsEnabled || !method || (method === NOWPAYMENTS_METHOD && (!cryptoCurrency || Boolean(cryptoPayment)))}>{!financeSettings.depositsEnabled ? "Deposits disabled" : busy ? "Submitting..." : cryptoPayment ? "Payment created" : method === NOWPAYMENTS_METHOD ? "Create crypto payment" : "Submit deposit"}</button>
            </>}
            {depositStep === "PAYMENT" && method !== NOWPAYMENTS_METHOD && selectedPaymentMethod && <section className="jazzcash-payment-card">{selectedPaymentMethod.qrImageUrl && <img src={selectedPaymentMethod.qrImageUrl} alt={`${selectedPaymentMethod.title} QR payment code`} />}<div className="till-id-heading">{selectedPaymentMethod.identifierLabel}</div>{selectedPaymentMethod.identifierValue && <div className="till-id-digits payment-id-value">{selectedPaymentMethod.identifierValue}</div>}<div className="till-id-row"><small>Use these {selectedPaymentMethod.title} payment details.</small>{selectedPaymentMethod.identifierValue && <button type="button" onClick={() => copyPaymentValue(selectedPaymentMethod.identifierValue)}>Copy ID</button>}</div><small>{selectedPaymentMethod.instructions}</small></section>}
            {depositStep === "PAYMENT" && cryptoPayment && <section className="crypto-payment-card" aria-live="polite">
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
            <div className="finance-methods finance-withdraw-methods">{availableWithdrawalMethods.map((item) => <button type="button" key={item.code} className={`finance-method ${method === item.code ? "active" : ""}`} onClick={() => selectMethod(item.code)}>{item.logoUrl ? <img src={item.logoUrl} alt="" /> : <strong>{item.title.slice(0, 2).toUpperCase()}</strong>}<span>{item.title}</span></button>)}</div>
            <label className="finance-input-label">Choose account<textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add your wallet, bank or account details" required rows={3} /></label>
            <button type="button" className="finance-add-account" onClick={() => setDetails("")}>Add new account</button>
            <div className="finance-wager-progress"><div><span>Wagering progress</span><strong>{formatMoney(wagerCompleted)} / {formatMoney(wagerTarget)} PKR</strong><small>Spent / required</small></div><div className="finance-wager-progress-bar"><span style={{ width: `${wagerProgress}%` }} /></div><p>{wagerRemaining <= 0 ? "Requirement completed. Withdrawals are unlocked." : `Spend ${formatMoney(wagerRemaining)} PKR more in settled bets to unlock withdrawals.`}</p></div>
            <label className="finance-input-label">Withdrawal amount ({withdrawalMinimum.toLocaleString()} - {formatMoney(wallet.balance)} PKR)<input type="number" min={withdrawalMinimum} max={wallet.balance} step="0.01" placeholder="Withdrawal amount" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <div className="finance-withdraw-summary"><div><span>Withdraw amount</span><strong>RS:{formatMoney(Number(amount) || 0)}</strong></div><div><span>Remain wagers</span><strong>{formatMoney(wagerRemaining)} PKR</strong></div><div><span>Remaining withdrawal attempts</span><strong>{wagerTarget > 0 && wagerRemaining > 0 ? "Locked" : "Available"}</strong></div></div>
            <button className="finance-submit" disabled={busy || !financeSettings.withdrawalsEnabled || wagerRemaining > 0 || !method}>{!financeSettings.withdrawalsEnabled ? "Withdrawals disabled" : wagerRemaining > 0 ? "Complete wagering first" : busy ? "Submitting..." : "Submit withdrawal"}</button>
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
