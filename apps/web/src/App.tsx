import { useEffect, useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { BetsList } from "./components/BetsList";
import { GameGraph } from "./components/GameGraph";
import { BetPanel } from "./components/BetPanel";
import { ChatPanel } from "./components/ChatPanel";
import { AuthPage } from "./components/AuthPage";
import { FinanceModal } from "./components/FinanceModal";
import { AdminPanel } from "./components/AdminPanel";
import { apiRequest } from "./lib/api";
import { socket } from "./lib/socket";
import type { AuthUser, ChatItem, RoundSnapshot, WalletSnapshot } from "./types";
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
  online: 0,
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
  totalBalance: 0,
  activeBets: {}
};

export default function App() {
  const [round, setRound] = useState<RoundSnapshot>(emptyRound);
  const [wallet, setWallet] = useState<WalletSnapshot>(emptyWallet);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminView, setAdminView] = useState(window.location.pathname.startsWith("/admin"));

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

    const clock = window.setInterval(() => setNow(Date.now()), 250);
    const onRound = (payload: RoundSnapshot) => setRound(payload);
    const onWallet = (payload: WalletSnapshot) => setWallet(payload);
    const onHistory = (payload: ChatItem[]) => setChat(payload);
    const onChat = (payload: ChatItem) => setChat((items) => [...items.slice(-79), payload]);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => setConnected(false);

    socket.on("round:state", onRound);
    socket.on("wallet:state", onWallet);
    socket.on("chat:history", onHistory);
    socket.on("chat:new", onChat);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.connect();

    return () => {
      window.clearInterval(clock);
      socket.off("round:state", onRound);
      socket.off("wallet:state", onWallet);
      socket.off("chat:history", onHistory);
      socket.off("chat:new", onChat);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.disconnect();
    };
  }, [user?.id]);

  const statusLabel = useMemo(() => connected ? "Live" : "Reconnecting", [connected]);

  const logout = async () => {
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    socket.disconnect();
    setUser(null);
    setWallet(emptyWallet);
    setAdminView(false);
    window.history.replaceState({}, "", "/");
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

  if (authLoading) return <div className="app-loading">Loading secure session…</div>;
  if (!user) return <AuthPage onAuthenticated={(authenticatedUser) => setUser(authenticatedUser)} />;
  if (adminView && user.role === "ADMIN") return <AdminPanel onBack={closeAdmin} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="back">‹</button>
        <Logo />
        <div className="top-actions">
          <button onClick={() => setFinanceOpen(true)}>Add Cash</button>
          <div className="profile-wrap">
            <button className="profile" aria-label="Profile" onClick={() => setProfileOpen((value) => !value)}>{user.name.slice(0, 1).toUpperCase()}</button>
            {profileOpen && (
              <div className="profile-menu">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <button onClick={() => setFinanceOpen(true)}>Wallet & payments</button>
                {user.role === "ADMIN" && <button onClick={openAdmin}>Admin panel</button>}
                <button className="danger-text" onClick={() => void logout()}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="game-title-row">
        <div className="game-name">SkyRush</div>
        <div className="balance">
          <span className={`connection ${connected ? "ok" : ""}`}>{statusLabel}</span>
          <strong>{wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> PKR
          {(wallet.lockedBalance > 0 || wallet.bettingLockedBalance > 0) && <span className="locked-balance">Locked {(wallet.lockedBalance + wallet.bettingLockedBalance).toLocaleString()} PKR</span>}
          <button className="toolbar-button" aria-label="Wallet" onClick={() => setFinanceOpen(true)}>☰</button>
          <button className="toolbar-button chat-symbol" aria-label="Chat" onClick={() => setChatOpen((value) => !value)}>◯</button>
        </div>
      </div>

      <main className={`game-layout ${chatOpen ? "chat-open" : ""}`}>
        <BetsList bets={round.bets} online={round.online} />
        <section className="center-column">
          <div className="history-strip">
            {round.history.map((value, index) => <span className={value < 2 ? "blue" : value < 10 ? "purple" : "pink"} key={`${value}-${index}`}>{value.toFixed(2)}x</span>)}
            <small className="edge-label">House edge {round.houseEdgePercent.toFixed(2)}%</small>
            <button>•••</button>
          </div>
          <GameGraph round={round} now={now} />
          <div className="bet-panels">
            <BetPanel slot="left" round={round} wallet={wallet} />
            <BetPanel slot="right" round={round} wallet={wallet} />
          </div>
        </section>
        <ChatPanel chat={chat} online={round.online} />
      </main>
      <button className="floating-chat" aria-label="Toggle chat" onClick={() => setChatOpen((value) => !value)}>💬</button>
      {financeOpen && <FinanceModal wallet={wallet} onClose={() => setFinanceOpen(false)} onWalletRefresh={setWallet} />}
    </div>
  );
}
