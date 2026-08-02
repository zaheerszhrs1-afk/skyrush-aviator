import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";

interface NotificationItem { _id: string; title: string; body: string; readAt?: string; createdAt: string; }
interface Props { onClose: () => void; onUnreadChange: (count: number) => void; }

const notificationTone = (item: NotificationItem): "bonus" | "wallet" | "support" | "system" => {
  const text = `${item.title} ${item.body}`.toLowerCase();
  if (/bonus|reward|vip/.test(text)) return "bonus";
  if (/deposit|withdraw|wallet|payment/.test(text)) return "wallet";
  if (/support|reply|chat/.test(text)) return "support";
  return "system";
};

const notificationMark: Record<ReturnType<typeof notificationTone>, string> = { bonus: "B", wallet: "W", support: "S", system: "i" };

export function NotificationsCenter({ onClose, onUnreadChange }: Props) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const load = () => void apiRequest<{ notifications: NotificationItem[]; unread: number }>("/api/notifications").then((result) => { setItems(result.notifications); onUnreadChange(result.unread); });
  useEffect(() => { load(); const onNew = () => load(); socket.on("notification:new", onNew); return () => { socket.off("notification:new", onNew); }; }, []);
  const markRead = async (item: NotificationItem) => { if (!item.readAt) await apiRequest(`/api/notifications/${item._id}/read`, { method: "PATCH" }); load(); };
  const readAll = async () => { await apiRequest("/api/notifications/read-all", { method: "PATCH" }); load(); };
  const unread = items.filter((item) => !item.readAt).length;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="notifications-center"><header><div><span>PLAYER INBOX</span><h2>Notifications</h2><small>{unread > 0 ? `${unread} unread` : "All caught up"}</small></div><div><button className="mark-read" onClick={() => void readAll()} disabled={unread === 0}>Mark all read</button><button className="notifications-close" onClick={onClose} aria-label="Close notifications">×</button></div></header><div className="notification-list">{items.length === 0 ? <p className="notification-empty">No notifications yet.</p> : items.map((item) => { const tone = notificationTone(item); return <article className={`notification-item ${item.readAt ? "" : "unread"}`} key={item._id} onClick={() => void markRead(item)}><span className={`notification-mark ${tone}`} aria-hidden="true">{notificationMark[tone]}</span><div className="notification-copy"><div className="notification-item-heading"><strong>{item.title}</strong>{!item.readAt && <b>NEW</b>}</div><p>{item.body}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div><span className="notification-chevron" aria-hidden="true">›</span></article>; })}</div></section></div>;
}
