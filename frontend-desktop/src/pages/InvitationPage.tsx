import { CheckCircle2, GraduationCap, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

/* Accepting an invitation: same card as sign-in, since that is where it leads.
   The code is the credential; the email must match the one the school entered. */
export function InvitationPage() {
  const [form, setForm] = useState({ token: "", email: "", first_name: "", last_name: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/api/v1/auth/csrf/");
      await api("/api/v1/invitations/accept/", { method: "POST", body: JSON.stringify({ ...form, token: form.token.trim(), email: form.email.trim().toLowerCase() }) });
      setAccepted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation.");
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="icon-sq fill" style={{ width: 36, height: 36, borderRadius: 12 }}><GraduationCap size={20} strokeWidth={2} /></span>
          <div><div className="t-hsm">OmniSchool</div><div className="lbl" style={{ color: "var(--brand-text)", letterSpacing: ".06em" }}>Portal</div></div>
        </div>

        {accepted ? (
          <>
            <div className="callout pos" role="status"><CheckCircle2 size={20} color="var(--pos)" style={{ flexShrink: 0, marginTop: 1 }} /><div><div className="t-lmd">Your school account is ready</div><p className="t-bsm ink2" style={{ marginTop: 2 }}>Sign in with <b>{form.email}</b> and the password you just chose.</p></div></div>
            <Link className="btn pri" to="/login" style={{ padding: 12 }}>Sign in</Link>
          </>
        ) : (
          <>
            <div>
              <h1 className="t-hxl">Join your school</h1>
              <p className="t-bmd ink2" style={{ marginTop: 6 }}>Use the private invitation code your school administrator shared with you. It works once and expires after 30 minutes.</p>
            </div>
            <label className="field">
              <span className="lbl">Invitation code</span>
              <div style={{ position: "relative" }}>
                <KeyRound size={16} color="var(--muted)" style={{ position: "absolute", left: 12, top: 12 }} />
                <input className="input mono" style={{ paddingLeft: 36 }} value={form.token} onChange={set("token")} inputMode="numeric" placeholder="6-digit code" pattern="(?:[0-9]{6}|[A-Za-z0-9_-]{40,100})" autoComplete="one-time-code" spellCheck={false} required autoFocus />
              </div>
            </label>
            <label className="field"><span className="lbl">Invited email</span><input className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" required /><span className="t-bsm faint">Must be the address the school entered.</span></label>
            <div className="form-grid">
              <label className="field"><span className="lbl">First name</span><input className="input" value={form.first_name} onChange={set("first_name")} autoComplete="given-name" required /></label>
              <label className="field"><span className="lbl">Last name</span><input className="input" value={form.last_name} onChange={set("last_name")} autoComplete="family-name" required /></label>
            </div>
            <label className="field"><span className="lbl">Password</span><input className="input" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" required /><span className="t-bsm faint">Already have an account? Enter its existing password. Otherwise choose a strong new one — never share it with the school.</span></label>
            {error ? <div className="t-bsm cri-c" role="alert">{error}</div> : null}
            <button className="btn pri" type="submit" disabled={busy} style={{ padding: 12 }}>{busy ? "Accepting…" : "Accept invitation"}</button>
            <p className="t-bsm faint" style={{ textAlign: "center" }}>Already a member? <Link to="/login">Sign in</Link></p>
          </>
        )}
      </form>
    </div>
  );
}
