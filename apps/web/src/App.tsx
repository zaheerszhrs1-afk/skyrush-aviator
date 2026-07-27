import { useEffect, useMemo, useState } from "react";
import { Logo } from "./components/Logo";
import { BetsList } from "./components/BetsList";
import { GameGraph } from "./components/GameGraph";
import { BetPanel } from "./components/BetPanel";
import { ChatPanel } from "./components/ChatPanel";
import { socket } from "./lib/socket";
import type { ChatItem, RoundSnapshot, WalletSnapshot } from "./types";
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
  online: 0
};
const emptyWallet: WalletSnapshot = { balance: 0, activeBets: {} };

export default function App() {
  const [round, setRound] = useState<RoundSnapshot>(emptyRound);
  const [wallet, setWallet] = useState<WalletSnapshot>(emptyWallet);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    const onRound = (payload: RoundSnapshot) => setRound(payload);
    const onWallet = (payload: WalletSnapshot) => setWallet(payload);
    const onHistory = (payload: ChatItem[]) => setChat(payload);
    const onChat = (payload: ChatItem) => setChat((items) => [...items.slice(-79), payload]);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("round:state", onRound);
    socket.on("wallet:state", onWallet);
    socket.on("chat:history", onHistory);
    socket.on("chat:new", onChat);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      window.clearInterval(clock);
      socket.off("round:state", onRound);
      socket.off("wallet:state", onWallet);
      socket.off("chat:history", onHistory);
      socket.off("chat:new", onChat);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  const statusLabel = useMemo(() => connected ? "Live" : "Reconnecting", [connected]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="back">‹</button>
        <Logo />
        <div className="top-actions"><button>Add Cash</button><span className="profile">●</span></div>
      </header>
      <div className="game-title-row">
        <div className="game-name">SkyRush</div>
        <div className="balance"><span className={`connection ${connected ? "ok" : ""}`}>{statusLabel}</span><strong>{wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> PKR <button>☰</button></div>
      </div>

      <main className="game-layout">
        <BetsList bets={round.bets} />
        <section className="center-column">
          <div className="history-strip">
            {round.history.map((value, index) => <span className={value < 2 ? "blue" : value < 10 ? "purple" : "pink"} key={`${value}-${index}`}>{value.toFixed(2)}x</span>)}
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
    </div>
  );
}
