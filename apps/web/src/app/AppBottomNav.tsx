type AppNavKey = "GAME" | "CHAT" | "WALLET" | "PROFILE";

interface AppBottomNavProps {
  active: AppNavKey;
  loggedIn: boolean;
  onGame: () => void;
  onChat: () => void;
  onWallet: () => void;
  onProfile: () => void;
}

function NavIcon({ kind }: { kind: AppNavKey }) {
  const paths: Record<AppNavKey, string> = {
    GAME: "M4 18 12 4l8 14-8-3-8 3Zm8-8v5",
    CHAT: "M5 6h14v10H9l-4 3V6Zm4 5h.01M12 11h.01M15 11h.01",
    WALLET: "M4 7h16v12H4zM4 10h16M8 15h3",
    PROFILE: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[kind]} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

export function AppBottomNav({ active, loggedIn, onGame, onChat, onWallet, onProfile }: AppBottomNavProps) {
  const items: Array<{ key: AppNavKey; label: string; onClick: () => void }> = [
    { key: "GAME", label: "Game", onClick: onGame },
    { key: "CHAT", label: "Chat", onClick: onChat },
    { key: "WALLET", label: "Wallet", onClick: onWallet },
    { key: "PROFILE", label: loggedIn ? "Profile" : "Login", onClick: onProfile }
  ];
  return <nav className="app-bottom-nav" aria-label="App navigation">{items.map((item) => <button className={active === item.key ? "active" : ""} key={item.key} type="button" aria-current={active === item.key ? "page" : undefined} onClick={item.onClick}><span className="app-bottom-nav__icon"><NavIcon kind={item.key} /></span><span>{item.label}</span></button>)}</nav>;
}
