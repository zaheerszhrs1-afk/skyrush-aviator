import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";
import type { AuthUser } from "../types";

interface Props { user: AuthUser; onNotify: (message: string, type?: "error" | "success") => void; }
interface SupportMessage { id: string; senderId: string | { _id: string; name: string }; senderRole: string; senderName?: string; message: string; createdAt: number | string; }

export function SupportChat({ user, onNotify }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [config, setConfig] = useState({ whatsappNumber: "", whatsappMessage: "" });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.all([
      apiRequest<typeof config>("/api/public-config").then(setConfig),
      apiRequest<{ conversation?: { unreadForUser?: number } | null }>("/api/support/me")
        .then((result) => setUnread(Math.max(0, Number(result.conversation?.unreadForUser ?? 0))))
    ]).catch(() => undefined);
  }, []);
  useEffect(() => {
    const onMessage = (item: SupportMessage & { userId?: string }) => {
      if (item.userId && item.userId !== user.id) return;
      setMessages((items) => items.some((entry) => entry.id === item.id) ? items : [...items, item]);
      if (!open) setUnread((value) => value + 1);
    };
    socket.on("support:new", onMessage);
    return () => { socket.off("support:new", onMessage); };
  }, [open, user.id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, open]);

  const load = () => {
    setOpen(true); setUnread(0); setLoading(true);
    socket.emit("support:load", undefined, (result: { ok: boolean; messages?: any[]; message?: string }) => {
      setLoading(false);
      if (!result.ok) { onNotify(result.message || "Unable to load support chat."); return; }
      setMessages((result.messages ?? []).map((item: any) => ({
        id: String(item._id ?? item.id), senderId: item.senderId, senderRole: item.senderRole,
        senderName: typeof item.senderId === "object" ? item.senderId.name : undefined,
        message: item.message, createdAt: item.createdAt
      })));
    });
  };

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    socket.emit("support:send", { message }, (result: { ok: boolean; message?: string | SupportMessage }) => {
      if (!result.ok) onNotify(typeof result.message === "string" ? result.message : "Unable to send support message.");
    });
  };

  const whatsAppUrl = config.whatsappNumber
    ? `https://wa.me/${config.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(config.whatsappMessage || "Hello, I need support with my B9T9 account.")}`
    : "";

  return <>
    {whatsAppUrl && <a className="floating-whatsapp" href={whatsAppUrl} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp">☎</a>}
    <button className="floating-support" onClick={load} aria-label="Open customer support">🎧{unread > 0 && <span>{Math.min(unread, 99)}</span>}</button>
    {open && <section className="support-chat-panel">
      <header><div><span className="support-online-dot" /><strong>Customer Support</strong><small>Usually replies within a few minutes</small></div><button onClick={() => setOpen(false)}>×</button></header>
      <div className="support-chat-messages" ref={scrollRef}>
        {loading ? <div className="support-empty">Loading conversation…</div> : messages.length === 0 ? <div className="support-empty"><strong>How can we help?</strong><span>Send a message about your account, deposit, withdrawal or game issue.</span></div> : messages.map((item) => {
          const senderId = typeof item.senderId === "object" ? item.senderId._id : item.senderId;
          const mine = senderId === user.id || item.senderRole === "USER";
          return <article className={mine ? "mine" : "support"} key={item.id}><small>{mine ? "You" : item.senderName || "Support"}</small><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>;
        })}
      </div>
      <footer><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} /><button onClick={send} disabled={!draft.trim()}>➤</button></footer>
    </section>}
  </>;
}
