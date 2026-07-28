import { useState } from "react";
import { apiRequest } from "../lib/api";
import type { AuthUser } from "../types";
import { Logo } from "./Logo";

interface AuthPageProps {
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await apiRequest<{ ok: true; user: AuthUser }>(
        mode === "LOGIN" ? "/api/auth/login" : "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify(mode === "LOGIN" ? { email, password } : { name, email, password })
        }
      );
      onAuthenticated(result.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><Logo /></div>
        <h1>{mode === "LOGIN" ? "Welcome back" : "Create your account"}</h1>
        <p>Secure access to your wallet, bets, deposits and withdrawals.</p>
        <form onSubmit={submit}>
          {mode === "REGISTER" && (
            <label>
              Full name
              <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} required type="email" autoComplete="email" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} required type="password" minLength={8} autoComplete={mode === "LOGIN" ? "current-password" : "new-password"} />
          </label>
          {message && <div className="form-error">{message}</div>}
          <button className="auth-submit" disabled={busy}>{busy ? "Please wait..." : mode === "LOGIN" ? "Sign in" : "Register"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "LOGIN" ? "REGISTER" : "LOGIN"); setMessage(""); }}>
          {mode === "LOGIN" ? "Create a new account" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
