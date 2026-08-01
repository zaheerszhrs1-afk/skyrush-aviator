import { useState } from "react";
import { apiRequest } from "../lib/api";
import type { AuthUser } from "../types";
import { Logo } from "./Logo";

interface Props { onAuthenticated: (user: AuthUser) => void; }

export function AdminLoginPage({ onAuthenticated }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await apiRequest<{ user: AuthUser }>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      onAuthenticated(result.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Administrator sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page admin-login-page">
    <section className="auth-card admin-login-card">
      <div className="auth-brand"><Logo /></div>
      <span className="admin-login-badge">SECURE ADMIN ACCESS</span>
      <h1>Administrator sign in</h1>
      <p>Primary administrators and approved staff accounts only.</p>
      <form onSubmit={submit}>
        <label>Email<input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" required minLength={8} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {message && <div className="form-error">{message}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to admin"}</button>
      </form>
      <button className="auth-switch" onClick={() => { window.history.replaceState({}, "", "/"); window.location.reload(); }}>← User login</button>
    </section>
  </main>;
}
