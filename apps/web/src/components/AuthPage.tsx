import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import type { AuthUser } from "../types";
import { Logo } from "./Logo";

interface AuthPageProps { onAuthenticated: (user: AuthUser) => void; onBackToLanding?: () => void; initialMode?: "LOGIN" | "REGISTER"; }
type Mode = "LOGIN" | "REGISTER" | "FORGOT" | "RESET";

export function AuthPage({ onAuthenticated, onBackToLanding, initialMode = "LOGIN" }: AuthPageProps) {
  const resetToken = new URLSearchParams(window.location.search).get("token") ?? "";
  const [mode, setMode] = useState<Mode>(window.location.pathname.startsWith("/reset-password") && resetToken ? "RESET" : initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

  useEffect(() => {
    if (mode !== "LOGIN" || !googleClientId || !googleButton.current) return;
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
          setBusy(true); setMessage(""); setSuccess(false);
          void apiRequest<{ user: AuthUser }>("/api/auth/google", { method: "POST", body: JSON.stringify({ credential: response.credential }) })
            .then((result) => onAuthenticatedRef.current(result.user))
            .catch((error) => setMessage(error instanceof Error ? error.message : "Google sign-in failed."))
            .finally(() => setBusy(false));
        }
      });
      googleButton.current.replaceChildren();
      google.accounts.id.renderButton(googleButton.current, { type: "standard", theme: "filled_black", size: "large", text: "continue_with", shape: "pill", width: 360 });
    };
    render();
  }, [googleClientId, mode]);

  const switchMode = (next: Mode) => { setMode(next); setMessage(""); setSuccess(false); setPassword(""); setConfirmPassword(""); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage(""); setSuccess(false);
    try {
      if (mode === "FORGOT") {
        const result = await apiRequest<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
        setMessage(result.message); setSuccess(true); return;
      }
      if (mode === "RESET") {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const result = await apiRequest<{ message: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token: resetToken, password }) });
        setMessage(result.message); setSuccess(true);
        window.history.replaceState({}, "", "/");
        window.setTimeout(() => switchMode("LOGIN"), 1200);
        return;
      }
      const result = await apiRequest<{ user: AuthUser }>(mode === "LOGIN" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST", body: JSON.stringify(mode === "LOGIN" ? { identifier: email, password } : { name, email, phone, password })
      });
      onAuthenticated(result.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally { setBusy(false); }
  };

  const title = mode === "REGISTER" ? "Create your account" : mode === "FORGOT" ? "Reset your password" : mode === "RESET" ? "Choose a new password" : "Welcome back";

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><Logo /></div>
      <h1>{title}</h1>
      <p>{mode === "FORGOT" ? "Enter your email and we will send a secure reset link." : mode === "RESET" ? "Create a strong password for your account." : "Secure access to your wallet and real bets."}</p>

      {mode === "LOGIN" && googleClientId && <><div className="google-login-wrap" aria-busy={busy}><div ref={googleButton} /><small>Google sign-in is available for user accounts only.</small></div><div className="auth-divider"><span>or use email</span></div></>}

      <form onSubmit={submit}>
        {mode === "REGISTER" && <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" /></label>}
        {mode !== "RESET" && <label>{mode === "LOGIN" ? "Email or phone number" : "Email"}<input value={email} onChange={(event) => setEmail(event.target.value)} required type={mode === "LOGIN" ? "text" : "email"} autoComplete={mode === "LOGIN" ? "username" : "email"} placeholder={mode === "LOGIN" ? "you@example.com or +92..." : undefined} /></label>}
        {mode === "REGISTER" && <label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} required type="tel" autoComplete="tel" placeholder="+92 300 1234567" /></label>}
        {!["FORGOT"].includes(mode) && <label>{mode === "RESET" ? "New password" : "Password"}<input value={password} onChange={(event) => setPassword(event.target.value)} required type="password" minLength={8} autoComplete={mode === "LOGIN" ? "current-password" : "new-password"} /></label>}
        {mode === "RESET" && <label>Confirm new password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" minLength={8} autoComplete="new-password" /></label>}
        {message && <div className={success ? "form-success" : "form-error"}>{message}</div>}
        <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "LOGIN" ? "Sign in" : mode === "REGISTER" ? "Register" : mode === "FORGOT" ? "Send reset link" : "Reset password"}</button>
      </form>

      {mode === "LOGIN" && <button className="auth-forgot" onClick={() => switchMode("FORGOT")}>Forgot password?</button>}
      {mode === "LOGIN" || mode === "REGISTER" ? <button className="auth-switch" onClick={() => switchMode(mode === "LOGIN" ? "REGISTER" : "LOGIN")}>{mode === "LOGIN" ? "Create a new account" : "Already have an account? Sign in"}</button> : <button className="auth-switch" onClick={() => switchMode("LOGIN")}>← Back to sign in</button>}
      {onBackToLanding && ["LOGIN", "REGISTER"].includes(mode) && <button className="auth-home-link" onClick={onBackToLanding}>← Back to home</button>}
      <button className="admin-login-link" onClick={() => { window.history.replaceState({}, "", "/admin/login"); window.location.reload(); }}>Administrator login</button>
    </section>
  </main>;
}
