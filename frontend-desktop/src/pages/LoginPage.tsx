import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail } from "lucide-react";
import { CampusLoginLayout } from "../components/CampusLoginLayout";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { status, persona, login, googleLogin, completeMfa } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signed-in" && persona) return <Navigate to="/" replace />;

  async function run(id: string, pw: string) {
    setBusy(true); setError(null);
    try {
      if (challenge) { await completeMfa(challenge, code); return; }
      const result = await login(id.trim(), pw);
      setChallenge(result.challengeToken);
      if (result.challengeToken) setPassword("");
    }
    catch (err) { setError(err instanceof Error ? err.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
  function submit(e: FormEvent) { e.preventDefault(); void run(identifier, password); }

  const notStaff = status === "signed-in" && !persona;

  return <CampusLoginLayout>
    {!challenge ? <GoogleSignInButton disabled={busy} onError={setError} onCredential={async credential => {
      setBusy(true); setError(null);
      try { const result = await googleLogin(credential); setChallenge(result.challengeToken); setPassword(""); }
      finally { setBusy(false); }
    }} /> : null}
    <form onSubmit={submit} className="auth-form">
      {notStaff ? <div className="auth-alert">This account has no active school membership yet. Ask your school to complete onboarding, or open the <a href={import.meta.env.DEV ? "http://127.0.0.1:5173/" : "/"}>mobile app</a>.</div> : null}
      {challenge ? <label className="auth-field"><span>Authenticator or recovery code</span><div className="auth-input-wrap"><KeyRound size={18} aria-hidden="true" /><input value={code} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" autoFocus required /></div></label> : <>
        <label className="auth-field"><span>Username or email</span><div className="auth-input-wrap"><Mail size={18} aria-hidden="true" /><input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" placeholder="you@school.com" autoFocus required /></div></label>
        <label className="auth-field"><span>Password</span><div className="auth-input-wrap"><LockKeyhole size={18} aria-hidden="true" /><input type={visible ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required /><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        <a className="auth-login-forgot" href="/forgot-password">Forgot password?</a>
      </>}
      {error ? <div className="auth-alert" role="alert">{error}</div> : null}
      <button className="auth-primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : challenge ? "Verify and sign in" : "Sign in"}<ArrowRight size={18} aria-hidden="true" /></button>
      {challenge ? <button className="auth-text-button" type="button" onClick={() => { setChallenge(null); setCode(""); setError(null); }}>Use another account</button> : null}
    </form>
    <div className="campus-login__links">
      <p className="auth-invite-link">Have an invitation? <a href="/join">Join your institution</a></p>
      <p className="auth-switch">New to ThatCampus? <a href="/signup">Create an account</a></p>
    </div>
  </CampusLoginLayout>;
}
