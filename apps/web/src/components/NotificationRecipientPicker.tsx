import { useMemo, useState } from "react";
import type { AuthUser } from "../types";

interface Props {
  users: AuthUser[];
  value: string[];
  onChange: (value: string[]) => void;
}

export function NotificationRecipientPicker({ users, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => !normalized || `${user.name} ${user.email}`.toLowerCase().includes(normalized));
  }, [query, users]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((user) => value.includes(user.id));
  const toggle = (id: string, checked: boolean) => onChange(checked ? [...new Set([...value, id])] : value.filter((item) => item !== id));
  const toggleVisible = () => onChange(allVisibleSelected ? value.filter((id) => !filtered.some((user) => user.id === id)) : [...new Set([...value, ...filtered.map((user) => user.id)])]);

  return <div className="recipient-picker">
    <div className="recipient-picker-head"><div><strong>Select recipients</strong><small>{value.length} selected · {users.length} active users</small></div><button type="button" onClick={toggleVisible} disabled={filtered.length === 0}>{allVisibleSelected ? "Clear visible" : "Select visible"}</button></div>
    <input className="recipient-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" aria-label="Search recipients" />
    <div className="recipient-list">{filtered.length === 0 ? <p>No users match this search.</p> : filtered.map((user) => <label className="recipient-row" key={user.id}><input type="checkbox" checked={value.includes(user.id)} onChange={(event) => toggle(user.id, event.target.checked)} /><span className="recipient-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></label>)}</div>
  </div>;
}
