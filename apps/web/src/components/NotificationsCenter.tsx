import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";

interface NotificationItem { _id: string; title: string; body: string; readAt?: string; createdAt: string; }
interface Props { onClose: () => void; onUnreadChange: (count: number) => void; }

export function NotificationsCenter({ onClose, onUnreadChange }: Props) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const load = () => void apiRequest<{ notifications: NotificationItem[]; unread: number }>("/api/notifications").then((result) => { setItems(result.notifications); onUnreadChange(result.unread); });
  useEffect(() => { load(); const onNew = () => load(); socket.on("notification:new", onNew); return () => { socket.off("notification:new", onNew); }; }, []);
  const markRead = async (item: NotificationItem) => { if (!item.readAt) await apiRequest(`/api/notifications/${item._id}/read`, { method: "PATCH" }); load(); };
  const readAll = async () => { await apiRequest("/api/notifications/read-all", { method: "PATCH" }); load(); };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="notifications-center"><header><div><span>INBOX</span><h2>Notifications</h2></div><div><button className="mark-read" onClick={() => void readAll()}>Mark all read</button><button onClick={onClose}>×</button></div></header><div>{items.length === 0 ? <p className="notification-empty">No notifications yet.</p> : items.map((item) => <article className={item.readAt ? "" : "unread"} key={item._id} onClick={() => void markRead(item)}><i /><div><strong>{item.title}</strong><p>{item.body}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div></article>)}</div></section></div>;
}
