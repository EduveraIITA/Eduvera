import { GraduationCap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

const DEMO = [
  { u: "meera.principal", name: "Meera Kapoor", role: "Principal", hint: "Every register, every decision" },
  { u: "kavita.staff", name: "Kavita Mehta", role: "Teacher", hint: "Class registers and leave" },
  { u: "pooja.parent", name: "Pooja Sharma", role: "Parent", hint: "Aarav and Ananya" },
  { u: "aarav.student", name: "Aarav Sharma", role: "Student", hint: "Class 7A" },
];

export function LoginPage() {
  const { status, persona, login, demoMode } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signed-in" && persona) return <Navigate to="/" replace />;

  async function run(id: string, pw: string) {
    setBusy(true); setError(null);
    try { await login(id.trim(), pw); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not sign in."); }
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

        <label className="field">
          <span className="lbl">Username or email</span>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span className="lbl">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>

        {error ? <div className="t-bsm cri-c">{error}</div> : null}

        <button className="btn pri" type="submit" disabled={busy} style={{ padding: 12 }}>{busy ? "Signing in…" : "Sign in"}</button>

        {demoMode ? (
          <div className="col xs">
            <div className="lbl">Demo accounts · password <span className="mono" style={{ textTransform: "none" }}>OmniDemo@2026</span></div>
            <div className="demo-grid">
              {DEMO.map((d) => (
                <button key={d.u} type="button" className="demo-acc" disabled={busy} onClick={() => { setIdentifier(d.u); setPassword("OmniDemo@2026"); void run(d.u, "OmniDemo@2026"); }}>
                  <b>{d.name}</b><span>{d.role} · {d.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
