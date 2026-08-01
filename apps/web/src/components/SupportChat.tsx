import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";
import type { AuthUser } from "../types";

interface Props {
  user: AuthUser;
  onNotify: (message: string, type?: "error" | "success") => void;
  embedded?: boolean;
  active?: boolean;
  onUnreadChange?: (count: number) => void;
}

interface SupportMessage {
  id: string;
  senderId: string | { _id: string; name: string };
  senderRole: string;
  senderName?: string;
  message: string;
  createdAt: number | string;
}

export function SupportChat({ user, onNotify, embedded = false, active = false, onUnreadChange }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void apiRequest<{ conversation?: { unreadForUser?: number } | null }>("/api/support/me")
      .then((result) => setUnread(Math.max(0, Number(result.conversation?.unreadForUser ?? 0))))
      .catch(() => undefined);
  }, []);
  useEffect(() => { onUnreadChange?.(unread); }, [onUnreadChange, unread]);

  useEffect(() => {
    const onMessage = (item: SupportMessage & { userId?: string }) => {
      if (item.userId && item.userId !== user.id) return;
      setMessages((items) => items.some((entry) => entry.id === item.id) ? items : [...items, item]);
      if (!active && !open) setUnread((value) => value + 1);
    };
    socket.on("support:new", onMessage);
    return () => { socket.off("support:new", onMessage); };
  }, [active, open, user.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, active, open]);

  const load = () => {
    setOpen(true);
    setUnread(0);
    setLoading(true);
    socket.emit("support:load", undefined, (result: { ok: boolean; messages?: any[]; message?: string }) => {
      setLoading(false);
      if (!result.ok) { onNotify(result.message || "Unable to load support chat.", "error"); return; }
      setMessages((result.messages ?? []).map((item: any) => ({
        id: String(item._id ?? item.id), senderId: item.senderId, senderRole: item.senderRole,
        senderName: typeof item.senderId === "object" ? item.senderId.name : undefined,
        message: item.message, createdAt: item.createdAt
      })));
    });
  };

  useEffect(() => {
    if (embedded && active) load();
  }, [active, embedded]);

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    socket.emit("support:send", { message }, (result: { ok: boolean; message?: string | SupportMessage }) => {
      if (!result.ok) onNotify(typeof result.message === "string" ? result.message : "Unable to send support message.", "error");
    });
  };

  const panel = (embedded ? active : open) && <section className={embedded ? "support-chat-inline" : "support-chat-panel"}>
    <header>
      <div><span className="support-online-dot" /><strong>Customer Support</strong><small>Usually replies within a few minutes</small></div>
      {!embedded && <button onClick={() => setOpen(false)} aria-label="Close customer support">X</button>}
    </header>
    <div className="support-chat-messages" ref={scrollRef}>
      {loading ? <div className="support-empty">Loading conversation...</div> : messages.length === 0 ? <div className="support-empty"><strong>How can we help?</strong><span>Send a message about your account, deposit, withdrawal or game issue.</span></div> : messages.map((item) => {
        const senderId = typeof item.senderId === "object" ? item.senderId._id : item.senderId;
        const mine = senderId === user.id || item.senderRole === "USER";
        return <article className={mine ? "mine" : "support"} key={item.id}><small>{mine ? "You" : item.senderName || "Support"}</small><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>;
      })}
    </div>
    <footer><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message..." onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} /><button onClick={send} disabled={!draft.trim()} aria-label="Send support message">Send</button></footer>
  </section>;

  return panel;
}
