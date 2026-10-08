import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clipboard, KeyRound, LoaderCircle, LockKeyhole, MailCheck, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { AuthLayout, BackToLogin } from "./AuthPages";
import { useAuth } from "./AuthContext";
import "./account-security.css";

type MfaStatus = { status: "not_enrolled" | "pending" | "active" | "disabled"; confirmed_at: string | null; recovery_codes_remaining: number };
type Enrollment = { secret: string; otpauth_uri: string };

async function publicMutation<T>(path: string, body: unknown) {
  await apiFetch("/api/v1/auth/csrf/");
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function AccountSecurityPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? window.sessionStorage.getItem("omnischool:development-verification-token") ?? "");
  const [setup, setSetup] = useState<Enrollment | null>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mfa = useQuery({ queryKey: ["account", "mfa"], queryFn: () => apiFetch<MfaStatus>("/api/v1/auth/mfa/") });

  useEffect(() => {
    if (!setup) return;
    void QRCode.toDataURL(setup.otpauth_uri, { width: 220, margin: 1, color: { dark: "#082052", light: "#ffffff" } }).then(setQr);
  }, [setup]);

  if (auth.status === "anonymous") return <Navigate to="/login" replace />;

  async function requestVerification() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiFetch<{ delivery: string; development_token?: string }>("/api/v1/auth/email-verification/request/", { method: "POST", body: "{}" });
      if (result.development_token) setToken(result.development_token);
      setMessage(result.delivery === "email_accepted" ? "Verification email accepted by the mail server. Check your inbox." : result.delivery === "manual" ? "Development verification token is ready below." : "Email delivery could not be confirmed. Try again shortly.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmVerification(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await apiFetch("/api/v1/auth/email-verification/confirm/", { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      await auth.refresh();
      setMessage("Email verified.");
      window.sessionStorage.removeItem("omnischool:development-verification-token");
      setToken("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function beginMfa() {
    setBusy(true); setError(""); setMessage(""); setRecoveryCodes([]);
    try { setSetup(await apiFetch<Enrollment>("/api/v1/auth/mfa/enroll/", { method: "POST", body: "{}" })); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmMfa(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await apiFetch<{ active: true; recovery_codes: string[] }>("/api/v1/auth/mfa/confirm/", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      setRecoveryCodes(result.recovery_codes); setSetup(null); setQr(""); setCode(""); setMessage("Two-step verification active.");
      await queryClient.invalidateQueries({ queryKey: ["account", "mfa"] });
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const verified = auth.user?.email_verified === true;
  const mfaActive = mfa.data?.status === "active";
  const origin = params.get("from") ?? "";
  const safeOrigin = /^\/(?:principal\/more|teacher\/more|parent\/more|student\/apps)(?:\?[^#]*)?$/.test(origin) ? origin : "/";
  const next = auth.setupRequired ? "/principal/activation" : safeOrigin;
  return <main className="security-page">
    <header className="security-header"><Link to={next} aria-label="Back">←</Link><div><h1>Account security</h1><p>{auth.user?.email}</p></div></header>
    <section className="security-summary" aria-label="Security progress"><div><ShieldCheck/><span><strong>{verified && mfaActive ? "Protected" : "Action needed"}</strong><small>{Number(verified)+Number(mfaActive)} of 2 checks</small></span></div></section>
    {error ? <p className="security-alert" role="alert">{error}</p> : null}
    {message ? <p className="security-message" role="status">{message}</p> : null}
    <section className={`security-card ${verified ? "is-complete" : ""}`}>
      <header><span><MailCheck/></span><div><h2>Verify email</h2></div>{verified ? <CheckCircle2 aria-label="Complete"/> : null}</header>
      {!verified ? <><button className="security-primary" type="button" onClick={()=>void requestVerification()} disabled={busy}>{busy ? <LoaderCircle className="auth-spin"/> : <MailCheck/>} Send verification email</button><form onSubmit={confirmVerification}><label>Verification token<input value={token} onChange={(event)=>setToken(event.target.value)} autoComplete="one-time-code" required/></label><button className="security-secondary" disabled={busy || token.trim().length<32}>Confirm email</button></form></> : <p className="security-complete-copy">Verified email: <strong>{auth.user?.email}</strong></p>}
    </section>
    <section className={`security-card ${mfaActive ? "is-complete" : ""}`}>
      <header><span><KeyRound/></span><div><h2>Two-step verification</h2><p>Authenticator app required at sign-in.</p></div>{mfaActive ? <CheckCircle2 aria-label="Complete"/> : null}</header>
      {mfa.isPending ? <p>Checking status…</p> : mfaActive ? <p className="security-complete-copy">Active · {mfa.data?.recovery_codes_remaining} unused recovery codes</p> : !verified ? <p className="security-disabled"><LockKeyhole/> Verify your email first.</p> : setup ? <div className="mfa-setup">{qr ? <img src={qr} alt="Authenticator setup QR code"/> : null}<p>Scan the QR code or enter this setup key:</p><code>{setup.secret}</code><form onSubmit={confirmMfa}><label>Six-digit authenticator code<input value={code} onChange={(event)=>setCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required/></label><button className="security-primary" disabled={busy}>Activate two-step verification</button></form></div> : <button className="security-primary" type="button" onClick={()=>void beginMfa()} disabled={busy}><KeyRound/> Set up authenticator</button>}
      {recoveryCodes.length ? <div className="recovery-codes" role="status"><h3>Save these recovery codes</h3><p>Each code works once. They will not be shown again.</p><div>{recoveryCodes.map((item)=><code key={item}>{item}</code>)}</div><button className="security-secondary" type="button" onClick={()=>void navigator.clipboard.writeText(recoveryCodes.join("\n"))}><Clipboard/> Copy codes</button></div> : null}
    </section>
    {verified && mfaActive ? <Link className="security-continue" to={next}>Continue →</Link> : null}
  </main>;
}

export function ForgotPasswordPage() {
  const [email,setEmail]=useState(""); const [busy,setBusy]=useState(false); const [sent,setSent]=useState(false); const [error,setError]=useState("");
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{await publicMutation("/api/v1/auth/password-reset/request/",{email:email.trim()});setSent(true);}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <AuthLayout eyebrow="Account recovery" title="Reset your password" description="We’ll send a time-limited reset link if the email belongs to an active account.">{sent?<div className="auth-success"><CheckCircle2/><h3>Check your email</h3><p>If an active account matches, a reset link is on its way.</p><BackToLogin/></div>:<form className="auth-form" onSubmit={submit}>{error?<div className="auth-alert" role="alert">{error}</div>:null}<label className="auth-field"><span>Email address</span><div className="auth-input-wrap"><MailCheck/><input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" required autoFocus/></div></label><button className="auth-primary-button" disabled={busy}>{busy?<><LoaderCircle className="auth-spin"/> Sending…</>:"Send reset link"}</button><BackToLogin/></form>}</AuthLayout>;
}

export function ResetPasswordPage() {
  const [params]=useSearchParams();const [token,setToken]=useState(params.get("token")??"");const [password,setPassword]=useState("");const [confirm,setConfirm]=useState("");const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);const [error,setError]=useState("");
  async function submit(event:FormEvent){event.preventDefault();setError("");if(password!==confirm){setError("The passwords do not match.");return;}setBusy(true);try{await publicMutation("/api/v1/auth/password-reset/confirm/",{token:token.trim(),password});setDone(true);}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}
  return <AuthLayout eyebrow="Account recovery" title="Choose a new password" description="The reset link is single-use and signs out every existing session.">{done?<div className="auth-success"><CheckCircle2/><h3>Password updated</h3><p>Sign in again on every device using your new password.</p><BackToLogin/></div>:<form className="auth-form" onSubmit={submit}>{error?<div className="auth-alert" role="alert">{error}</div>:null}<label className="auth-field"><span>Reset token</span><div className="auth-input-wrap"><KeyRound/><input value={token} onChange={event=>setToken(event.target.value)} required/></div></label><label className="auth-field"><span>New password</span><div className="auth-input-wrap"><LockKeyhole/><input type="password" value={password} onChange={event=>setPassword(event.target.value)} minLength={12} autoComplete="new-password" required/></div></label><label className="auth-field"><span>Confirm password</span><div className="auth-input-wrap"><LockKeyhole/><input type="password" value={confirm} onChange={event=>setConfirm(event.target.value)} minLength={12} autoComplete="new-password" required/></div></label><button className="auth-primary-button" disabled={busy}>{busy?<><LoaderCircle className="auth-spin"/> Updating…</>:"Update password"}</button><BackToLogin/></form>}</AuthLayout>;
}
