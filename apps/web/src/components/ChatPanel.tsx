import { useState } from "react";
import type { ChatItem } from "../types";
import { socket } from "../lib/socket";

type Props = { chat: ChatItem[]; online: number };

export function ChatPanel({ chat, online }: Props) {
  const [message, setMessage] = useState("");

  const send = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    socket.emit("chat:send", { message: trimmed });
    setMessage("");
  };

  return (
    <aside className="chat-panel">
      <header><span className="online-dot" />{online}<button>×</button></header>
      <div className="chat-scroll">
        {chat.map((item, index) => (
          <div className="chat-message" key={item.id}>
            <span className="chat-avatar">{["🍀", "🌎", "🌌", "🎭", "🪐"][index % 5]}</span>
            <p><strong>{item.player}</strong> {item.message}</p>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input value={message} maxLength={160} placeholder="Reply" onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} />
        <button onClick={send}>↵</button>
        <small>{160 - message.length}</small>
      </div>
    </aside>
  );
}
