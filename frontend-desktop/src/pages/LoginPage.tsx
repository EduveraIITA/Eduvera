import { GraduationCap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { status, persona, login, googleLogin, completeMfa } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="icon-sq fill" style={{ width: 36, height: 36, borderRadius: 12 }}><GraduationCap size={20} strokeWidth={2} /></span>
          <div><div className="t-hsm">OmniSchool</div><div className="lbl" style={{ color: "var(--brand-text)", letterSpacing: ".06em" }}>Portal</div></div>
        </div>
        <div>
          <h1 className="t-hxl">Sign in</h1>
          <p className="t-bmd ink2" style={{ marginTop: 6 }}>Principals, teachers, parents and students all sign in here. What you see is decided by your school membership.</p>
        </div>

        {notStaff ? (
          <div className="callout cau"><span className="t-bsm">This account has no active school membership yet. Ask your school to complete onboarding, or try the <a href={import.meta.env.DEV ? "http://127.0.0.1:5173/" : "/"}>mobile app</a>.</span></div>
        ) : null}

        {challenge ? <label className="field"><span className="lbl">Authenticator or recovery code</span><input className="input" value={code} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" autoFocus required /></label> : <>
        <label className="field">
          <span className="lbl">Username or email</span>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span className="lbl">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>

        </>}

        {error ? <div className="t-bsm cri-c">{error}</div> : null}

        <button className="btn pri" type="submit" disabled={busy} style={{ padding: 12 }}>{busy ? "Signing in…" : challenge ? "Verify and sign in" : "Sign in"}</button>

        {challenge ? <button className="btn" type="button" onClick={() => { setChallenge(null); setCode(""); }}>Use another account</button> : <GoogleSignInButton disabled={busy} onError={setError} onCredential={async credential => {
          setBusy(true); setError(null);
          try { const result = await googleLogin(credential); setChallenge(result.challengeToken); setPassword(""); }
          finally { setBusy(false); }
        }} />}
      </form>
    </div>
  );
}
