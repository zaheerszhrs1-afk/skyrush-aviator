import { useCallback, useEffect, useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { BetsList } from "./components/BetsList";
import { GameGraph } from "./components/GameGraph";
import { BetPanel } from "./components/BetPanel";
import { ChatPanel } from "./components/ChatPanel";
import { AuthPage } from "./components/AuthPage";
import { FinanceModal } from "./components/FinanceModal";
import { AdminPanel } from "./components/AdminPanel";
import { ProvablyFairModal } from "./components/ProvablyFairModal";
import { BonusCenter } from "./components/BonusCenter";
import { apiRequest } from "./lib/api";
import { socket } from "./lib/socket";
import type { AccountMode, AuthUser, ChatItem, RoundSnapshot, WalletSnapshot } from "./types";
import "./styles.css";

const emptyRound: RoundSnapshot = {
  roundId: "loading",
  phase: "WAITING",
  multiplier: 1,
  phaseEndsAt: Date.now() + 8000,
  startedAt: null,
  commit: "",
  history: [],
  bets: [],
  demoBets: [],
  online: 0,
  automatedOnline: 75,
  demoOnline: 75,
  houseEdgePercent: 1,
  lossPool: 0,
  commissionPercent: 10,
  activeBetEscrow: 0,
  reservedRewardLiquidity: 0,
  availableRewardLiquidity: 0
};
const emptyWallet: WalletSnapshot = {
  balance: 0,
  lockedBalance: 0,
  bettingLockedBalance: 0,
  pendingRewards: 0,
  wagerRequirementRemaining: 0,
  wagerRequirementTarget: 0,
  wagerRequirementCompleted: 0,
  totalBalance: 0,
  activeBets: {},
  queuedBets: {},
  demoBalance: 0,
  demoActiveBets: {}
};

export default function App() {
  const [round, setRound] = useState<RoundSnapshot>(emptyRound);
  const [wallet, setWallet] = useState<WalletSnapshot>(emptyWallet);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminView, setAdminView] = useState(window.location.pathname.startsWith("/admin"));
  const [accountMode, setAccountMode] = useState<AccountMode>("REAL");
  const [demoResetBusy, setDemoResetBusy] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [proofRoundId, setProofRoundId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "error" | "success" }>>([]);

  const notify = useCallback((message: string, type: "error" | "success" = "error") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((items) => [...items.slice(-3), { id, message, type }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    const copyingIsAllowed = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [data-allow-copy="true"], .admin-shell'
        )
      );

    const preventTextCopy = (event: Event) => {
      if (!copyingIsAllowed(event.target)) event.preventDefault();
    };

    document.addEventListener("copy", preventTextCopy);
    document.addEventListener("cut", preventTextCopy);
    document.addEventListener("contextmenu", preventTextCopy);

    return () => {
      document.removeEventListener("copy", preventTextCopy);
      document.removeEventListener("cut", preventTextCopy);
      document.removeEventListener("contextmenu", preventTextCopy);
    };
  }, []);

  useEffect(() => {
    void apiRequest<{ user: AuthUser }>("/api/auth/me")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) {
      socket.disconnect();
      setConnected(false);
      return;
    }

    const onRound = (payload: RoundSnapshot) => setRound(payload);
    const onWallet = (payload: WalletSnapshot) => setWallet(payload);
    const onWalletPatch = (payload: Partial<WalletSnapshot>) => {
      setWallet((current) => ({ ...current, ...payload }));
    };
    const onHistory = (payload: ChatItem[]) => setChat(payload);
    const onChat = (payload: ChatItem) => setChat((items) => [...items.slice(-79), payload]);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setConnected(false);
    const onQueueResult = (payload: { ok?: boolean; message?: string }) => {
      if (payload?.ok === false && payload.message) notify(payload.message, "error");
    };

    socket.on("round:state", onRound);
    socket.on("wallet:state", onWallet);
    socket.on("wallet:patch", onWalletPatch);
    socket.on("chat:history", onHistory);
    socket.on("chat:new", onChat);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("bet:queue-result", onQueueResult);
    socket.connect();

    return () => {
      socket.off("round:state", onRound);
      socket.off("wallet:state", onWallet);
      socket.off("wallet:patch", onWalletPatch);
      socket.off("chat:history", onHistory);
      socket.off("chat:new", onChat);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("bet:queue-result", onQueueResult);
      socket.disconnect();
    };
  }, [user?.id]);

  const statusLabel = useMemo(() => connected ? "Live" : "Reconnecting", [connected]);
  const visibleBets = accountMode === "DEMO" ? round.demoBets : round.bets;
  const visibleOnline = accountMode === "DEMO" ? round.demoOnline : round.online;
  const visibleBalance = accountMode === "DEMO" ? wallet.demoBalance : wallet.balance;

  const logout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    socket.disconnect();
    setUser(null);
    setWallet(emptyWallet);
    setAdminView(false);
    setAccountMode("REAL");
    window.history.replaceState({}, "", "/");
  };

  const resetDemo = async () => {
    setDemoResetBusy(true);
    try {
      const result = await apiRequest<{ wallet: WalletSnapshot }>("/api/demo/reset", { method: "POST" });
      setWallet(result.wallet);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to reset demo balance.", "error");
    } finally {
      setDemoResetBusy(false);
    }
  };

  const openAdmin = () => {
    setAdminView(true);
    setProfileOpen(false);
    window.history.pushState({}, "", "/admin");
  };
  const closeAdmin = () => {
    setAdminView(false);
    window.history.pushState({}, "", "/");
  };

  const closeChat = useCallback(() => setChatOpen(false), []);

  const historyStrip = useMemo(() => (
    <div className={`history-strip ${historyExpanded ? "expanded" : ""}`}>
      <div className="history-values">
        {round.history.map((item) => (
          <button
            className={`history-value ${item.crashPoint < 2 ? "blue" : item.crashPoint < 10 ? "purple" : "pink"}`}
            key={item.roundId}
            type="button"
            title={`Open proof for ${item.crashPoint.toFixed(2)}x`}
            onClick={() => setProofRoundId(item.roundId)}
          >
            {item.crashPoint.toFixed(2)}x
          </button>
        ))}
      </div>
      <small className="edge-label">House edge {round.houseEdgePercent.toFixed(2)}%</small>
      <button
        className="history-expand"
        type="button"
        aria-label={historyExpanded ? "Collapse round history" : "Expand round history"}
        aria-expanded={historyExpanded}
        onClick={() => setHistoryExpanded((value) => !value)}
      >
        {historyExpanded ? "×" : "•••"}
      </button>
    </div>
  ), [historyExpanded, round.history, round.houseEdgePercent]);

  if (authLoading) return <div className="app-loading">Loading secure session…</div>;
  if (!user) return <AuthPage onAuthenticated={(authenticatedUser) => setUser(authenticatedUser)} />;
  if (adminView && user.role === "ADMIN") return <AdminPanel onBack={closeAdmin} />;

  return (
    <div className={`app-shell ${accountMode === "DEMO" ? "demo-mode" : ""}`}>
      <div className="toast-stack" aria-live="assertive" aria-atomic="true">
        {toasts.map((toast) => (
          <div className={`app-toast ${toast.type}`} key={toast.id}>
            <span aria-hidden="true">{toast.type === "error" ? "!" : "✓"}</span>
            <p>{toast.message}</p>
            <button aria-label="Dismiss message" onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}>×</button>
          </div>
        ))}
      </div>
      <header className="topbar">
        <button className="back">‹</button>
        <Logo />
        {user.role === "USER" && (
          <div className="mode-switch" aria-label="Account mode">
            <button className={accountMode === "REAL" ? "active" : ""} onClick={() => setAccountMode("REAL")}>Real</button>
            <button className={accountMode === "DEMO" ? "active" : ""} onClick={() => setAccountMode("DEMO")}>Demo</button>
          </div>
        )}
        <div className="top-actions">
          {user.role === "USER" && <button className="vip-launch" onClick={() => setBonusOpen(true)}>VIP Bonuses</button>}
          {accountMode === "REAL" ? (
            <button onClick={() => setFinanceOpen(true)}>Add Cash</button>
          ) : (
            <button onClick={() => void resetDemo()} disabled={demoResetBusy}>{demoResetBusy ? "Resetting…" : "Reset Demo"}</button>
          )}
          <div className="profile-wrap">
            <button className="profile" aria-label="Profile" onClick={() => setProfileOpen((value) => !value)}>
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : user.name.slice(0, 1).toUpperCase()}
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <small>{user.authProvider === "GOOGLE" ? "Google account" : user.authProvider === "HYBRID" ? "Email + Google" : "Email account"}</small>
                {accountMode === "REAL" ? <button onClick={() => setFinanceOpen(true)}>Wallet & payments</button> : <button onClick={() => void resetDemo()}>Reset demo balance</button>}
                {user.role === "USER" && <button onClick={() => { setBonusOpen(true); setProfileOpen(false); }}>VIP bonuses</button>}
                {user.role === "ADMIN" && <button onClick={openAdmin}>Admin panel</button>}
                <button className="danger-text" onClick={() => void logout()}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="game-title-row">
        <div className="game-name">B9T9 {accountMode === "DEMO" && <span className="demo-mode-badge">DEMO</span>}</div>
        <div className="balance">
          {accountMode === "REAL" && <span className={`connection ${connected ? "ok" : ""}`}>{statusLabel}</span>}
          <strong>{visibleBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> PKR
          {accountMode === "REAL" && (wallet.lockedBalance > 0 || wallet.bettingLockedBalance > 0) && <span className="locked-balance">Locked {(wallet.lockedBalance + wallet.bettingLockedBalance).toLocaleString()} PKR</span>}
          {accountMode === "REAL" && <button className="toolbar-button" aria-label="Wallet" onClick={() => setFinanceOpen(true)}>☰</button>}
          <button className="toolbar-button chat-symbol" aria-label="Chat" onClick={() => setChatOpen((value) => !value)}>◯</button>
        </div>
      </div>


      <main className={`game-layout ${chatOpen ? "chat-open" : ""}`}>
        <BetsList bets={visibleBets} online={visibleOnline} />
        <section className={`center-column ${historyExpanded ? "history-open" : ""}`}>
          {historyStrip}
          <GameGraph round={round} />
          <div className="bet-panels">
            <BetPanel slot="left" round={round} wallet={wallet} accountMode={accountMode} onNotify={notify} />
            <BetPanel slot="right" round={round} wallet={wallet} accountMode={accountMode} onNotify={notify} />
          </div>
        </section>
        <ChatPanel chat={chat} online={visibleOnline} onClose={closeChat} />
      </main>
      {!chatOpen && <button className="floating-chat" aria-label="Open chat" onClick={() => setChatOpen(true)}>💬</button>}
      {financeOpen && accountMode === "REAL" && <FinanceModal wallet={wallet} onClose={() => setFinanceOpen(false)} onWalletRefresh={setWallet} />}
      {proofRoundId && <ProvablyFairModal roundId={proofRoundId} onClose={() => setProofRoundId(null)} />}
      {bonusOpen && user.role === "USER" && <BonusCenter onClose={() => setBonusOpen(false)} onNotify={notify} />}
    </div>
  );
}
