import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import type { AuthUser } from "../types";

type Tab = "ACCOUNT" | "SECURITY" | "PREFERENCES" | "SESSIONS" | "REPORTS";
interface Props { user: AuthUser; onClose: () => void; onUserUpdated: (user: AuthUser) => void; onNotify: (message: string, type?: "error" | "success") => void; }
interface SessionItem { id: string; userAgent: string; ip: string; createdAt: string; current: boolean; }
interface ReportItem { _id: string; category: string; subject: string; description: string; status: string; adminNote?: string; createdAt: string; }

const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

export function ProfileCenter({ user, onClose, onUserUpdated, onNotify }: Props) {
  const [tab, setTab] = useState<Tab>("ACCOUNT");
  const [form, setForm] = useState(user);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [reportForm, setReportForm] = useState({ category: "OTHER", subject: "", description: "" });

  useEffect(() => setForm(user), [user]);
  useEffect(() => {
    if (tab === "SESSIONS") void apiRequest<{ sessions: SessionItem[] }>("/api/profile/sessions").then((result) => setSessions(result.sessions)).catch(() => setSessions([]));
    if (tab === "REPORTS") void apiRequest<{ reports: ReportItem[] }>("/api/reports/me").then((result) => setReports(result.reports)).catch(() => setReports([]));
  }, [tab]);

  const completion = useMemo(() => {
    const values = [form.name, form.phone, form.country, form.language, form.timezone, form.avatarUrl, form.bio];
    return Math.round(values.filter(Boolean).length / values.length * 100);
  }, [form]);

  const saveProfile = async () => {
    setBusy(true);
    try {
      const result = await apiRequest<{ user: AuthUser; message: string }>("/api/profile", { method: "PATCH", body: JSON.stringify(form) });
      onUserUpdated(result.user); setForm(result.user); onNotify(result.message, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Unable to update profile."); }
    finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) { onNotify("New passwords do not match."); return; }
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/api/profile/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); onNotify(result.message, "success");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Unable to change password."); }
    finally { setBusy(false); }
  };

  const submitReport = async () => {
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>("/api/reports", { method: "POST", body: JSON.stringify(reportForm) });
      onNotify(result.message, "success"); setReportForm({ category: "OTHER", subject: "", description: "" });
      const next = await apiRequest<{ reports: ReportItem[] }>("/api/reports/me"); setReports(next.reports);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Unable to submit report."); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop profile-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="profile-center">
      <header className="profile-center-header">
        <div className="profile-hero-avatar">{form.avatarUrl ? <img src={form.avatarUrl} alt="" /> : initials(form.name)}</div>
        <div><span>PLAYER PROFILE</span><h2>{form.name}</h2><p>{form.email}</p></div>
        <button aria-label="Close profile" onClick={onClose}>×</button>
      </header>
      <div className="profile-progress"><span><i style={{ width: `${completion}%` }} /></span><small>Profile completeness {completion}%</small></div>
      <nav className="profile-tabs">
        {(["ACCOUNT", "SECURITY", "PREFERENCES", "SESSIONS", "REPORTS"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item[0] + item.slice(1).toLowerCase()}</button>)}
      </nav>
      <div className="profile-content">
        {tab === "ACCOUNT" && <div className="profile-form-grid">
          <label>Display name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Email<input value={form.email} disabled /></label>
          <label>Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+92..." /></label>
          <label>Country<input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></label>
          <label>Avatar URL<input value={form.avatarUrl} onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })} placeholder="https://..." /></label>
          <label className="wide">About<textarea value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} placeholder="A short profile note" /></label>
          <button className="profile-primary" disabled={busy} onClick={() => void saveProfile()}>{busy ? "Saving…" : "Save profile"}</button>
        </div>}

        {tab === "SECURITY" && <div className="profile-security">
          <div className="profile-security-note"><strong>Password protection</strong><span>Changing your password signs out every other device.</span></div>
          <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>New password<input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          <button className="profile-primary" disabled={busy || newPassword.length < 8} onClick={() => void changePassword()}>{busy ? "Updating…" : "Update password"}</button>
        </div>}

        {tab === "PREFERENCES" && <div className="profile-form-grid">
          <label>Language<select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}><option>English</option><option>Urdu</option></select></label>
          <label>Timezone<select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}><option value="Asia/Karachi">Pakistan (Asia/Karachi)</option><option value="UTC">UTC</option></select></label>
          <label className="profile-toggle wide"><input type="checkbox" checked={form.gameNotifications} onChange={(event) => setForm({ ...form, gameNotifications: event.target.checked })} /><span><strong>Platform notifications</strong><small>Receive account, promotion and game notices.</small></span></label>
          <label className="profile-toggle wide"><input type="checkbox" checked={form.supportNotifications} onChange={(event) => setForm({ ...form, supportNotifications: event.target.checked })} /><span><strong>Support notifications</strong><small>Notify me when support replies.</small></span></label>
          <label className="profile-toggle wide"><input type="checkbox" checked={form.marketingOptIn} onChange={(event) => setForm({ ...form, marketingOptIn: event.target.checked })} /><span><strong>Promotional updates</strong><small>Receive news, banners and bonus information.</small></span></label>
          <button className="profile-primary" disabled={busy} onClick={() => void saveProfile()}>{busy ? "Saving…" : "Save preferences"}</button>
        </div>}

        {tab === "SESSIONS" && <div className="session-list">
          <div className="profile-security-note"><strong>Active devices</strong><span>Review where your account is signed in.</span></div>
          {sessions.map((item) => <article key={item.id}><div><strong>{item.current ? "This device" : "Signed-in device"}</strong><span>{item.userAgent || "Unknown browser"}</span><small>{item.ip || "Unknown IP"} · {new Date(item.createdAt).toLocaleString()}</small></div>{!item.current && <button onClick={() => void apiRequest(`/api/profile/sessions/${item.id}`, { method: "DELETE" }).then(() => setSessions((items) => items.filter((session) => session.id !== item.id)))}>Sign out</button>}</article>)}
        </div>}

        {tab === "REPORTS" && <div className="report-center">
          <div className="report-form">
            <h3>Submit a report</h3>
            <select value={reportForm.category} onChange={(event) => setReportForm({ ...reportForm, category: event.target.value })}><option value="ACCOUNT">Account</option><option value="PAYMENT">Payment</option><option value="GAME">Game</option><option value="SECURITY">Security</option><option value="OTHER">Other</option></select>
            <input value={reportForm.subject} onChange={(event) => setReportForm({ ...reportForm, subject: event.target.value })} placeholder="Subject" />
            <textarea value={reportForm.description} onChange={(event) => setReportForm({ ...reportForm, description: event.target.value })} placeholder="Describe the issue in detail" />
            <button className="profile-primary" disabled={busy || reportForm.description.length < 10} onClick={() => void submitReport()}>Submit report</button>
          </div>
          <div className="report-history"><h3>My reports</h3>{reports.length === 0 ? <p>No reports submitted.</p> : reports.map((item) => <article key={item._id}><header><strong>{item.subject}</strong><span className={`report-status ${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span></header><p>{item.description}</p>{item.adminNote && <small>Admin: {item.adminNote}</small>}<time>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div>
        </div>}
      </div>
    </section>
  </div>;
}
