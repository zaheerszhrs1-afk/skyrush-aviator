import { memo, useEffect, useRef, useState } from "react";
import type { AuthUser, ChatItem } from "../types";
import { socket } from "../lib/socket";
import { SupportChat } from "./SupportChat";

type Props = {
  chat: ChatItem[];
  online: number;
  onClose: () => void;
  user: AuthUser;
  onNotify: (message: string, type?: "error" | "success") => void;
  supportOpenRequest?: number;
};

const chatAvatars = ["🌋", "🌎", "🪐", "🎭", "🍀", "🌙", "⚡", "🎯"];

export const ChatPanel = memo(function ChatPanel({ chat, online, onClose, user, onNotify, supportOpenRequest = 0 }: Props) {
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
    const trimmed = message.trim();
    if (!trimmed) return;
    socket.emit("chat:send", { message: trimmed });
    setMessage("");
  };

  return (
    <aside className="chat-panel" aria-label="Live chat">
      <header className="chat-header">
        <nav className="chat-tabs" aria-label="Chat sections">
          <button className={activeTab === "CHAT" ? "active" : ""} type="button" onClick={() => setActiveTab("CHAT")}>
            <span className="online-dot" /> Chat <small>{online}</small>
          </button>
          <button className={activeTab === "SUPPORT" ? "active" : ""} type="button" onClick={() => setActiveTab("SUPPORT")}>
            Support {supportUnread > 0 && <small>{Math.min(supportUnread, 99)}</small>}
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
          <input value={message} maxLength={160} placeholder="Reply" aria-label="Chat message" onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) send(); }} />
          <button className="chat-send" type="button" aria-label="Send message" onClick={send}>↵</button>
          <div className="chat-input-footer"><span aria-hidden="true">☺</span><span className="gif-chip">GIF</span><small>{160 - message.length}</small></div>
        </div>
      </> : null}
      <SupportChat user={user} onNotify={onNotify} embedded active={activeTab === "SUPPORT"} onUnreadChange={setSupportUnread} />
    </aside>
  );
});
