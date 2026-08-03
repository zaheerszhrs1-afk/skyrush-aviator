import { useCallback, useEffect, useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { BetsList } from "./components/BetsList";
import { GameGraph } from "./components/GameGraph";
import { BetPanel } from "./components/BetPanel";
import { ChatPanel } from "./components/ChatPanel";
import { AuthPage } from "./components/AuthPage";
import { AdminLoginPage } from "./components/AdminLoginPage";
import { FinanceModal } from "./components/FinanceModal";
import { AdminPanel } from "./components/AdminPanel";
import { ProvablyFairModal } from "./components/ProvablyFairModal";
import { BonusCenter } from "./components/BonusCenter";
import { ProfileCenter } from "./components/ProfileCenter";
import { CampaignExperience } from "./components/CampaignExperience";
import { FaqCenter } from "./components/FaqCenter";
import { NotificationsCenter } from "./components/NotificationsCenter";
import { WhatsAppBadge } from "./components/WhatsAppBadge";
import { apiRequest } from "./lib/api";
import { socket } from "./lib/socket";
import type { AccountMode, AuthUser, ChatItem, RoundSnapshot, WalletSnapshot } from "./types";
import "./styles.css";

const emptyRound: RoundSnapshot = { roundId: "loading", phase: "WAITING", multiplier: 1, phaseEndsAt: Date.now() + 8000, startedAt: null, commit: "", history: [], bets: [], demoBets: [], online: 0, automatedOnline: 75, demoOnline: 0, houseEdgePercent: 1, lossPool: 0, commissionPercent: 10, activeBetEscrow: 0, reservedRewardLiquidity: 0, availableRewardLiquidity: 0, testMode: false };
const emptyWallet: WalletSnapshot = { balance: 0, lockedBalance: 0, bettingLockedBalance: 0, pendingRewards: 0, wagerRequirementRemaining: 0, wagerRequirementTarget: 0, wagerRequirementCompleted: 0, totalBalance: 0, activeBets: {}, queuedBets: {}, demoBalance: 0, demoActiveBets: {} };
const adminPath = () => window.location.pathname.startsWith("/admin");

export default function App() {
  const [round, setRound] = useState<RoundSnapshot>(emptyRound); const [wallet, setWallet] = useState<WalletSnapshot>(emptyWallet); const [user, setUser] = useState<AuthUser | null>(null); const [authLoading, setAuthLoading] = useState(true);
  const [chat, setChat] = useState<ChatItem[]>([]); const [connected, setConnected] = useState(false); const [chatOpen, setChatOpen] = useState(false); const [supportOpenRequest, setSupportOpenRequest] = useState(0); const [financeOpen, setFinanceOpen] = useState(false); const [financeTab, setFinanceTab] = useState<"DEPOSIT" | "WITHDRAW" | "HISTORY">("DEPOSIT"); const [bonusOpen, setBonusOpen] = useState(false); const [guestAuthOpen, setGuestAuthOpen] = useState(false); const [authStartMode, setAuthStartMode] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false); const [profileCenterOpen, setProfileCenterOpen] = useState(false); const [faqOpen, setFaqOpen] = useState(false); const [notificationsOpen, setNotificationsOpen] = useState(false); const [notificationUnread, setNotificationUnread] = useState(0);
  const [accountMode, setAccountMode] = useState<AccountMode>("REAL"); const [demoResetBusy, setDemoResetBusy] = useState(false); const [historyExpanded, setHistoryExpanded] = useState(false); const [proofRoundId, setProofRoundId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "error" | "success" }>>([]);

  const notify = useCallback((message: string, type: "error" | "success" = "error") => { const id = Date.now() + Math.floor(Math.random() * 1000); setToasts((items) => [...items.slice(-3), { id, message, type }]); window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200); }, []);

  useEffect(() => {
    const copyingIsAllowed = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [data-allow-copy="true"], .admin-shell'));
    const preventTextCopy = (event: Event) => { if (!copyingIsAllowed(event.target)) event.preventDefault(); };
    document.addEventListener("copy", preventTextCopy); document.addEventListener("cut", preventTextCopy); document.addEventListener("contextmenu", preventTextCopy);
    return () => { document.removeEventListener("copy", preventTextCopy); document.removeEventListener("cut", preventTextCopy); document.removeEventListener("contextmenu", preventTextCopy); };
  }, []);

  useEffect(() => { void apiRequest<{ user: AuthUser }>("/api/auth/me").then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setAuthLoading(false)); }, []);
  useEffect(() => { if (user?.role === "USER") void apiRequest<{ unread: number }>("/api/notifications").then((result) => setNotificationUnread(result.unread)).catch(() => undefined); }, [user?.id]);
  useEffect(() => {
    const onCampaignNavigate = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      if (target === "BONUSES") setBonusOpen(true);
      if (target === "DEPOSIT" || target === "WITHDRAW") { setFinanceTab(target); setFinanceOpen(true); }
      if (target === "PROFILE") setProfileCenterOpen(true);
      if (target === "FAQS") setFaqOpen(true);
      if (target === "LIVE_CHAT") setChatOpen(true);
    };
    window.addEventListener("b9t9:navigate", onCampaignNavigate);
    return () => window.removeEventListener("b9t9:navigate", onCampaignNavigate);
  }, []);

  useEffect(() => {
    const onRound = (payload: RoundSnapshot) => setRound(payload); const onWallet = (payload: WalletSnapshot) => setWallet(payload); const onWalletPatch = (payload: Partial<WalletSnapshot>) => setWallet((current) => ({ ...current, ...payload }));
    const onHistory = (payload: ChatItem[]) => setChat(payload); const onChat = (payload: ChatItem) => setChat((items) => [...items.slice(-79), payload]); const onConnect = () => setConnected(true); const onDisconnect = () => setConnected(false); const onQueueResult = (payload: { ok?: boolean; message?: string }) => { if (payload?.ok === false && payload.message) notify(payload.message); };
    const onNotification = () => setNotificationUnread((value) => value + 1);
    socket.on("round:state", onRound); socket.on("wallet:state", onWallet); socket.on("wallet:patch", onWalletPatch); socket.on("chat:history", onHistory); socket.on("chat:new", onChat); socket.on("connect", onConnect); socket.on("disconnect", onDisconnect); socket.on("connect_error", onDisconnect); socket.on("bet:queue-result", onQueueResult); socket.on("notification:new", onNotification); socket.connect();
    return () => { socket.off("round:state", onRound); socket.off("wallet:state", onWallet); socket.off("wallet:patch", onWalletPatch); socket.off("chat:history", onHistory); socket.off("chat:new", onChat); socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); socket.off("connect_error", onDisconnect); socket.off("bet:queue-result", onQueueResult); socket.off("notification:new", onNotification); socket.disconnect(); };
  }, [notify, user?.id]);

  const statusLabel = useMemo(() => connected ? "Live" : "Reconnecting", [connected]); const visibleBets = round.bets; const visibleOnline = round.online; const visibleBalance = wallet.balance;

  const clearSession = () => { socket.disconnect(); setUser(null); setWallet(emptyWallet); setAccountMode("REAL"); setProfileMenuOpen(false); };
  const logout = async () => { await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => undefined); clearSession(); window.history.replaceState({}, "", "/"); };
  const adminLogout = async () => { await apiRequest("/api/admin/auth/logout", { method: "POST" }).catch(() => undefined); clearSession(); window.history.replaceState({}, "", "/admin/login"); };
  const resetDemo = async () => { setDemoResetBusy(true); notify("Demo mode is no longer available."); setDemoResetBusy(false); };
  const historyStrip = useMemo(() => <div className={`history-strip ${historyExpanded ? "expanded" : ""}`}><div className="history-values">{round.history.map((item) => <button className={`history-value ${item.crashPoint < 2 ? "blue" : item.crashPoint < 10 ? "purple" : "pink"}`} key={item.roundId} type="button" title={`Open proof for ${item.crashPoint.toFixed(2)}x`} onClick={() => setProofRoundId(item.roundId)}>{item.crashPoint.toFixed(2)}x</button>)}</div><small className="edge-label">House edge {round.houseEdgePercent.toFixed(2)}%</small><button className="history-expand" type="button" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? "×" : "•••"}</button></div>, [historyExpanded, round.history, round.houseEdgePercent]);

  if (authLoading) return <div className="app-loading">Loading secure session…</div>;
  if (adminPath() && (!user || user.role === "USER")) {
    return <><CampaignExperience placement="LOGIN" /><AdminLoginPage onAuthenticated={(authenticatedUser) => { setUser(authenticatedUser); window.history.replaceState({}, "", "/admin"); }} /></>;
  }
  const resetRequested = window.location.pathname.startsWith("/reset-password") && Boolean(new URLSearchParams(window.location.search).get("token"));
  if (!user && resetRequested) {
    return <AuthPage initialMode="LOGIN" onAuthenticated={setUser} />;
  }
  if (user && ["ADMIN", "SUB_ADMIN"].includes(user.role)) {
    return <AdminPanel currentUser={user} onSignOut={() => void adminLogout()} />;
  }

  return <div className={`app-shell ${accountMode === "DEMO" ? "demo-mode" : ""}`}>
    <div className="toast-stack" aria-live="assertive" aria-atomic="true">{toasts.map((toast) => <div className={`app-toast ${toast.type}`} key={toast.id}><span>{toast.type === "error" ? "!" : "✓"}</span><p>{toast.message}</p><button onClick={() => setToasts((items) => items.filter((item) => item.id !== toast.id))}>×</button></div>)}</div>
    <header className="topbar"><button className="back">‹</button><Logo /><div className="mode-switch"><button className={accountMode === "REAL" ? "active" : ""} onClick={() => setAccountMode("REAL")}>Real</button><button className={accountMode === "DEMO" ? "active" : ""} onClick={() => setAccountMode("DEMO")}>Demo</button></div><div className="top-actions">{user ? <>{accountMode === "DEMO" && <button onClick={() => void resetDemo()} disabled={demoResetBusy}>{demoResetBusy ? "Resetting…" : "Reset Demo"}</button>}<button className="header-icon-button notification-button" onClick={() => setNotificationsOpen(true)} aria-label="Notifications">🔔{notificationUnread > 0 && <span>{Math.min(notificationUnread, 99)}</span>}</button><div className="profile-wrap"><button className="profile" onClick={() => setProfileMenuOpen((value) => !value)}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.slice(0, 1).toUpperCase()}</button>{profileMenuOpen && <div className="profile-menu"><strong>{user.name}</strong><span>{user.email}</span><small>{user.authProvider === "GOOGLE" ? "Google account" : user.authProvider === "HYBRID" ? "Email + Google" : "Email account"}</small><button onClick={() => { setProfileCenterOpen(true); setProfileMenuOpen(false); }}>Profile & settings</button>{accountMode === "REAL" ? <button onClick={() => { setFinanceTab("DEPOSIT"); setFinanceOpen(true); }}>Wallet & payments</button> : <button onClick={() => void resetDemo()}>Reset demo balance</button>}<button onClick={() => { setBonusOpen(true); setProfileMenuOpen(false); }}>VIP bonuses</button><button onClick={() => { setFaqOpen(true); setProfileMenuOpen(false); }}>Help & FAQs</button><button className="danger-text" onClick={() => void logout()}>Sign out</button></div>}</div></> : <><button className="guest-auth-button" onClick={() => { setAuthStartMode("LOGIN"); setGuestAuthOpen(true); }}>Login</button><button className="guest-auth-button guest-auth-primary" onClick={() => { setAuthStartMode("REGISTER"); setGuestAuthOpen(true); }}>Sign up</button></>}</div></header>
    <div className="game-title-row"><div className="game-name">B9T9 {accountMode === "DEMO" && <span className="demo-mode-badge">DEMO</span>}</div><CampaignExperience placement="GAME" /><div className="balance">{accountMode === "REAL" && <span className={`connection ${connected ? "ok" : ""}`}>{statusLabel}</span>}<button className="balance-amount" type="button" onClick={() => { if (user) { setFinanceTab("DEPOSIT"); setFinanceOpen(true); } else { setAuthStartMode("LOGIN"); setGuestAuthOpen(true); } }}><strong>{visibleBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> PKR</button>{accountMode === "REAL" && (wallet.lockedBalance > 0 || wallet.bettingLockedBalance > 0) && <span className="locked-balance">Locked {(wallet.lockedBalance + wallet.bettingLockedBalance).toLocaleString()} PKR</span>}<button className="toolbar-button chat-symbol" onClick={() => setChatOpen((value) => !value)}>◯</button></div></div>
    <main className={`game-layout ${chatOpen ? "chat-open" : ""}`}><BetsList bets={visibleBets} online={visibleOnline} /><section className={`center-column ${historyExpanded ? "history-open" : ""}`}>{historyStrip}<GameGraph round={round} /><div className="bet-panels"><BetPanel slot="left" round={round} wallet={wallet} accountMode={accountMode} authenticated={Boolean(user)} onRequireAuth={() => { setAuthStartMode("LOGIN"); setGuestAuthOpen(true); }} onNotify={notify} /><BetPanel slot="right" round={round} wallet={wallet} accountMode={accountMode} authenticated={Boolean(user)} onRequireAuth={() => { setAuthStartMode("LOGIN"); setGuestAuthOpen(true); }} onNotify={notify} /></div></section><ChatPanel chat={chat} online={visibleOnline} onClose={() => setChatOpen(false)} user={user} onRequireAuth={() => { setAuthStartMode("LOGIN"); setGuestAuthOpen(true); }} onNotify={notify} supportOpenRequest={supportOpenRequest} /></main>
    {!chatOpen && <button className="floating-chat" aria-label="Open live chat" onClick={() => setChatOpen(true)}>💬</button>}<button className="floating-support floating-support-mobile" aria-label="Open customer support" onClick={() => { setSupportOpenRequest((value) => value + 1); setChatOpen(true); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h2v5H4a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2Zm16 0h-2v5h2a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2ZM12 21h3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg></button><WhatsAppBadge />
    {guestAuthOpen && <div className="guest-auth-modal modal-backdrop" role="dialog" aria-modal="true" aria-label="Sign in to play" onMouseDown={(event) => event.target === event.currentTarget && setGuestAuthOpen(false)}><button className="guest-auth-close" type="button" onClick={() => setGuestAuthOpen(false)} aria-label="Close sign in dialog">×</button><AuthPage initialMode={authStartMode} onAuthenticated={(authenticatedUser) => { setUser(authenticatedUser); setGuestAuthOpen(false); }} onBackToLanding={() => setGuestAuthOpen(false)} /></div>}{financeOpen && user && accountMode === "REAL" && <FinanceModal wallet={wallet} initialTab={financeTab} onClose={() => setFinanceOpen(false)} onWalletRefresh={setWallet} />}{proofRoundId && <ProvablyFairModal roundId={proofRoundId} onClose={() => setProofRoundId(null)} />}{bonusOpen && user && <BonusCenter onClose={() => setBonusOpen(false)} onNotify={notify} />}
    {user && profileCenterOpen && <ProfileCenter user={user} onClose={() => setProfileCenterOpen(false)} onUserUpdated={setUser} onNotify={notify} />}{faqOpen && <FaqCenter onClose={() => setFaqOpen(false)} />}{user && notificationsOpen && <NotificationsCenter onClose={() => setNotificationsOpen(false)} onUnreadChange={setNotificationUnread} />}
  </div>;
}
