import { memo, useEffect, useRef, useState } from "react";
import type { AuthUser, ChatItem } from "../types";
import { socket } from "../lib/socket";
import { SupportChat } from "./SupportChat";

type Props = {
  chat: ChatItem[];
  online: number;
  onClose: () => void;
  user: AuthUser | null;
  onRequireAuth: () => void;
  onNotify: (message: string, type?: "error" | "success") => void;
  supportOpenRequest?: number;
};

const chatAvatars = ["🌋", "🌎", "🪐", "🎭", "🍀", "🌙", "⚡", "🎯"];

export const ChatPanel = memo(function ChatPanel({ chat, online, onClose, user, onRequireAuth, onNotify, supportOpenRequest = 0 }: Props) {
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"CHAT" | "SUPPORT">("CHAT");
  const [supportUnread, setSupportUnread] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [chat.length, activeTab]);

  useEffect(() => {
    if (supportOpenRequest > 0) setActiveTab("SUPPORT");
  }, [supportOpenRequest]);

  const send = () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) return;
    socket.emit("chat:send", { message: trimmed });
    setMessage("");
  };

  return (
    <aside className="chat-panel" aria-label="Live chat">
      <header className="chat-header">
        <nav className="chat-tabs" aria-label="Chat sections">
          <button className={activeTab === "CHAT" ? "active" : ""} type="button" aria-pressed={activeTab === "CHAT"} onClick={() => setActiveTab("CHAT")}>
            <span className="chat-tab-icon live" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5.5h14v10H9l-4 3v-13Z" /></svg><span className="online-dot" /></span>
            <span className="chat-tab-copy"><strong>Live chat</strong><small>{online} online</small></span>
          </button>
          <button className={activeTab === "SUPPORT" ? "active" : ""} type="button" aria-pressed={activeTab === "SUPPORT"} onClick={() => setActiveTab("SUPPORT")}>
            <span className="chat-tab-icon support" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13v-2a7 7 0 0 1 14 0v5a3 3 0 0 1-3 3h-3M5 13H3v4h4v-4H5Zm14 0h2v4h-4v-4h2Z" /></svg></span>
            <span className="chat-tab-copy"><strong>Support</strong><small>Private help</small></span>
            {supportUnread > 0 && <span className="chat-tab-badge">{Math.min(supportUnread, 99)}</span>}
          </button>
        </nav>
        <button className="chat-close" type="button" aria-label="Close chat" onClick={onClose}>X</button>
      </header>

      {activeTab === "CHAT" ? <>
        <div className="chat-scroll" ref={scrollRef}>
          {chat.map((item, index) => (
            <article className="chat-message" key={item.id}>
              <span className="chat-avatar" aria-hidden="true">{chatAvatars[index % chatAvatars.length]}</span>
              <p><strong>{item.player}</strong> {item.message}</p>
              <span className="chat-like" aria-hidden="true">♡</span>
            </article>
          ))}
          {chat.length === 0 && <p className="chat-empty">No messages yet. Start the conversation.</p>}
        </div>
        <div className="chat-input">
          <input value={message} maxLength={160} placeholder={user ? "Reply" : "Sign in to chat"} aria-label="Chat message" onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) send(); }} />
          <button className="chat-send" type="button" aria-label="Send message" onClick={send}>↵</button>
          <div className="chat-input-footer"><span aria-hidden="true">☺</span><span className="gif-chip">GIF</span><small>{160 - message.length}</small></div>
        </div>
      </> : null}
      {user ? <SupportChat user={user} onNotify={onNotify} embedded active={activeTab === "SUPPORT"} onUnreadChange={setSupportUnread} /> : activeTab === "SUPPORT" ? <section className="support-chat-inline chat-auth-prompt"><strong>Sign in to contact support</strong><span>Your live game remains visible while we open a secure support conversation.</span><button type="button" onClick={onRequireAuth}>Login or sign up</button></section> : null}
    </aside>
  );
});
