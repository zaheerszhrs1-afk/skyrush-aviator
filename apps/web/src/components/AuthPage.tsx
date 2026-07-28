import { useEffect, useRef, useState } from "react";
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
  const googleButton = useRef<HTMLDivElement>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

  useEffect(() => {
    if (!googleClientId || !googleButton.current) return;
    let attempts = 0;
    const render = () => {
      const google = window.google;
      if (!google?.accounts?.id || !googleButton.current) {
        attempts += 1;
        if (attempts < 40) window.setTimeout(render, 150);
        return;
      }
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          setBusy(true);
          setMessage("");
          void apiRequest<{ ok: true; user: AuthUser }>("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ credential: response.credential })
          })
            .then((result) => onAuthenticated(result.user))
            .catch((error) => setMessage(error instanceof Error ? error.message : "Google sign-in failed."))
            .finally(() => setBusy(false));
        }
      });
      googleButton.current.replaceChildren();
      google.accounts.id.renderButton(googleButton.current, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 360
      });
    };
    render();
  }, [googleClientId, onAuthenticated]);

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
        <p>Secure access to your wallet, real bets and risk-free demo play.</p>

        {googleClientId && (
          <>
            <div className="google-login-wrap" aria-busy={busy}>
              <div ref={googleButton} />
              <small>Google sign-in is available for user accounts only.</small>
            </div>
            <div className="auth-divider"><span>or use email</span></div>
          </>
        )}

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
