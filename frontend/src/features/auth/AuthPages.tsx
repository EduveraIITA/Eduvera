import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  Clock3,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  RefreshCw,
  School,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { authDestination, useAuth, type RegisterInput } from "./AuthContext";
import type { DemoPersona } from "../../lib/api";
import { SchoolBrand } from "../school/SchoolBrand";
import "./auth.css";

function AuthBrand() {
  return (
    <Link className="auth-brand" to="/" aria-label="Cambridge International School and Eduvera">
      <SchoolBrand name="Cambridge International School" className="auth-brand__school" marksLayout="side-by-side" />
    </Link>
  );
}

export function AuthLayout({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Edura OS introduction">
        <AuthBrand />
        <div className="auth-story__content">
          <h1>School records that stay current.</h1>
          <p>Attendance, timetables, leave and communication for every school role.</p>
          <div className="auth-story__proof">
            <span><ShieldCheck size={17} /><b>Role-safe access</b></span>
            <span><Clock3 size={17} /><b>Live attendance</b></span>
            <span><BookOpenCheck size={17} /><b>One source of truth</b></span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__mobile-brand"><AuthBrand /></div>
        <div className="auth-card">
          <header className="auth-card__header">
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </header>
          {children}
        </div>
      </section>
    </main>
  );
}

function PasswordInput({ value, onChange, autoComplete = "current-password" }: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-input-wrap">
      <LockKeyhole size={18} aria-hidden="true" />
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={12}
        required
      />
      <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function safeNextPath(search: string) {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [pending, setPending] = useState<"login" | DemoPersona | null>(null);
  const [error, setError] = useState(auth.serviceError);

  if (auth.status === "authenticated") return <Navigate to={authDestination(auth)} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending("login");
    try {
      const result = await auth.login({ identifier: identifier.trim(), password });
      if (result.challengeToken) {
        setMfaChallenge(result.challengeToken);
        setPassword("");
        return;
      }
      void navigate(safeNextPath(location.search) ?? "/", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sign in could not be completed.");
    } finally {
      setPending(null);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;
    setError(null);
    setPending("login");
    try {
      await auth.completeMfa(mfaChallenge, mfaCode.trim());
      void navigate(safeNextPath(location.search) ?? "/", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The verification code could not be confirmed.");
    } finally {
      setPending(null);
    }
  }

  async function enterDemo(persona: DemoPersona) {
    setError(null);
    setPending(persona);
    try {
      await auth.enterDemo(persona);
      const destination = persona === "company" ? "/company" : persona === "parent" ? "/parent/home" : persona === "student" ? "/student" : persona === "staff" ? "/teacher" : "/principal";
      void navigate(destination, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The demo workspace is unavailable.");
    } finally {
      setPending(null);
    }
  }

  return (
    <AuthLayout eyebrow="Welcome back" title="Sign in to your school" description="Use the email or username connected to your school account.">
      <p className="auth-invite-link">Have an invitation? <Link to="/join">Join your institution</Link></p>
      {mfaChallenge ? <form className="auth-form" onSubmit={submitMfa}>
        {error ? <div className="auth-alert" role="alert"><ShieldCheck size={18} /><span>{error}</span></div> : null}
        <div className="auth-verification-intro"><ShieldCheck size={20}/><div><strong>Two-step verification</strong><p>Enter the six-digit authenticator code or one unused recovery code.</p></div></div>
        <label className="auth-field"><span>Verification code</span><div className="auth-input-wrap"><KeyRound size={18}/><input value={mfaCode} onChange={(event)=>setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required/></div></label>
        <button className="auth-primary-button" type="submit" disabled={pending !== null}>{pending === "login" ? <><LoaderCircle className="auth-spin" size={18}/> Verifying…</> : <>Verify and sign in <ArrowRight size={18}/></>}</button>
        <button className="auth-text-button" type="button" onClick={()=>{setMfaChallenge(null);setMfaCode("");setError(null);}}>Use another account</button>
      </form> : <form className="auth-form" onSubmit={submit}>
        {error ? <div className="auth-alert" role="alert"><ShieldCheck size={18} /><span>{error}</span></div> : null}
        <label className="auth-field">
          <span>Email or username</span>
          <div className="auth-input-wrap">
            <Mail size={18} aria-hidden="true" />
            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              placeholder="you@school.com"
              required
              autoFocus
            />
          </div>
        </label>
        <label className="auth-field">
          <span className="auth-field__split">Password <Link to="/forgot-password">Forgot password?</Link></span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        <button className="auth-primary-button" type="submit" disabled={pending !== null}>
          {pending === "login" ? <><LoaderCircle className="auth-spin" size={18} /> Signing in...</> : <>Sign in <ArrowRight size={18} /></>}
        </button>
      </form>}

      {auth.demoMode ? (
        <div className="demo-entry">
          <div className="auth-divider"><span>or explore the live demo</span></div>
          <div className="demo-entry__buttons">
            <button type="button" disabled={pending !== null} onClick={() => void enterDemo("parent")}>
              <span><img src="/assets/pooja-sharma.png" alt="" /></span><b>Parent view</b><small>Pooja Sharma</small>
              {pending === "parent" ? <LoaderCircle className="auth-spin" size={16} /> : <ArrowRight size={16} />}
            </button>
            <button type="button" disabled={pending !== null} onClick={() => void enterDemo("student")}>
              <span><img src="/assets/aarav-sharma.png" alt="" /></span><b>Student view</b><small>Aarav Sharma</small>
              {pending === "student" ? <LoaderCircle className="auth-spin" size={16} /> : <ArrowRight size={16} />}
            </button>
            <button type="button" disabled={pending !== null} onClick={() => void enterDemo("staff")}>
              <span><img src="/assets/kavita-mehta.png" alt="" /></span><b>Teacher view</b><small>Kavita Mehta</small>
              {pending === "staff" ? <LoaderCircle className="auth-spin" size={16} /> : <ArrowRight size={16} />}
            </button>
            <button type="button" disabled={pending !== null} onClick={() => void enterDemo("admin")}>
              <span><img src="/assets/meera-kapoor.png" alt="" /></span><b>Principal view</b><small>Meera Kapoor</small>
              {pending === "admin" ? <LoaderCircle className="auth-spin" size={16} /> : <ArrowRight size={16} />}
            </button>
            <button type="button" disabled={pending !== null} onClick={() => void enterDemo("school_admin")}>
              <span aria-hidden="true">A</span><b>Admin view</b><small>Arjun Rao · Roles & access</small>
              {pending === "school_admin" ? <LoaderCircle className="auth-spin" size={16} /> : <ArrowRight size={16} />}
            </button>
            <button type="button" disabled={pending !== null} onClick={() => void enterDemo("company")}><span><ShieldCheck size={20}/></span><b>Company view</b><small>Eduera · Institution provisioning</small>{pending === "company" ? <LoaderCircle className="auth-spin" size={16}/> : <ArrowRight size={16}/>}</button>
          </div>
        </div>
      ) : null}

      <p className="auth-switch">New to Edura OS? <Link to="/signup">Create an account</Link></p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterInput>({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    role: "parent",
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "authenticated") return <Navigate to={authDestination(auth)} replace />;

  const update = <Key extends keyof RegisterInput>(key: Key, value: RegisterInput[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (form.password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await auth.register({
        ...form,
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
      });
      void navigate("/account/security", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your account could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout eyebrow="Get started" title="Create your Edura account" description="Join an institution, apply to onboard one, or create a coaching workspace.">
      <form className="auth-form" onSubmit={submit}>
        {error ? <div className="auth-alert" role="alert"><ShieldCheck size={18} /><span>{error}</span></div> : null}
        <fieldset className="auth-role-picker">
          <legend>I'm joining as</legend>
          <div>
            <button type="button" className={form.role === "parent" ? "is-selected" : ""} aria-pressed={form.role === "parent"} onClick={() => update("role", "parent")}>
              <UsersRound size={18} /><span><b>Parent</b><small>Family portal</small></span>{form.role === "parent" ? <Check size={15} /> : null}
            </button>
            <button type="button" className={form.role === "student" ? "is-selected" : ""} aria-pressed={form.role === "student"} onClick={() => update("role", "student")}>
              <GraduationCap size={18} /><span><b>Student</b><small>Learning portal</small></span>{form.role === "student" ? <Check size={15} /> : null}
            </button>
            <button type="button" className={form.role === "admin" ? "is-selected" : ""} aria-pressed={form.role === "admin"} onClick={() => update("role", "admin")}>
              <School size={18} /><span><b>Institution owner</b><small>School or coaching setup</small></span>{form.role === "admin" ? <Check size={15} /> : null}
            </button>
          </div>
        </fieldset>
        <div className="auth-name-grid">
          <label className="auth-field"><span>First name</span><div className="auth-input-wrap"><UserRound size={18} /><input value={form.first_name} onChange={(event) => update("first_name", event.target.value)} autoComplete="given-name" required /></div></label>
          <label className="auth-field"><span>Last name</span><div className="auth-input-wrap"><UserRound size={18} /><input value={form.last_name} onChange={(event) => update("last_name", event.target.value)} autoComplete="family-name" required /></div></label>
        </div>
        <label className="auth-field"><span>Email address</span><div className="auth-input-wrap"><Mail size={18} /><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" placeholder="you@example.com" required /></div></label>
        <label className="auth-field"><span>Create password</span><PasswordInput value={form.password} onChange={(value) => update("password", value)} autoComplete="new-password" /><small>Use at least 12 characters with upper- and lowercase letters, a number and a symbol.</small></label>
        <label className="auth-field"><span>Confirm password</span><PasswordInput value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" /></label>
        <button className="auth-primary-button" type="submit" disabled={pending}>
          {pending ? <><LoaderCircle className="auth-spin" size={18} /> Creating account...</> : <>Create secure account <ArrowRight size={18} /></>}
        </button>
      </form>
      <p className="auth-privacy"><ShieldCheck size={14} /> Your account sees no student records until school membership is approved.</p>
      <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  );
}

export function PendingOnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "anonymous") return <Navigate to="/login" replace />;
  if (auth.status === "authenticated" && auth.memberships.length > 0) return <Navigate to={authDestination(auth)} replace />;

  async function checkAccess() {
    setChecking(true);
    setError(null);
    try {
      await auth.refresh();
      void navigate("/", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Access could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="onboarding-page">
      <div className="onboarding-card">
        <AuthBrand />
        <div className="onboarding-illustration" aria-hidden="true"><School size={38} /><span><Check size={18} /></span></div>
        <span className="onboarding-eyebrow">Account created</span>
        <h1>Now connect with your school</h1>
        <p>Your secure account for <strong>{auth.user?.email}</strong> is ready. A school administrator needs to verify your membership before attendance or student records appear.</p>
        <ol className="onboarding-steps">
          <li className="is-complete"><span><Check size={15} /></span><div><b>Edura account</b><small>Identity and password secured</small></div></li>
          <li className="is-current"><span>2</span><div><b>School verification</b><small>Ask your school office to invite this email</small></div></li>
          <li><span>3</span><div><b>Portal access</b><small>Your role-safe workspace opens automatically</small></div></li>
        </ol>
        {error ? <div className="auth-alert" role="alert"><ShieldCheck size={18} /><span>{error}</span></div> : null}
        <button className="auth-primary-button" type="button" disabled={checking} onClick={() => void checkAccess()}>
          {checking ? <><LoaderCircle className="auth-spin" size={18} /> Checking access...</> : <><RefreshCw size={18} /> Check access again</>}
        </button>
        <button className="auth-text-button" type="button" onClick={() => void auth.logout()}>Sign out and use another account</button>
      </div>
    </main>
  );
}

export function WorkspaceUnavailablePage() {
  const auth = useAuth();
  if (auth.status === "anonymous") return <Navigate to="/login" replace />;
  return (
    <main className="onboarding-page">
      <div className="onboarding-card">
        <AuthBrand />
        <div className="onboarding-illustration" aria-hidden="true"><School size={38} /></div>
        <span className="onboarding-eyebrow">Attendance pilot</span>
        <h1>Your account is verified</h1>
        <p>This release includes the parent and student attendance workspaces. Your school role is valid, but its workspace is not part of this pilot yet.</p>
        <Link className="auth-primary-button" to="/">Check available portal <ArrowRight size={18} /></Link>
        <button className="auth-text-button" type="button" onClick={() => void auth.logout()}>Sign out</button>
      </div>
    </main>
  );
}

export function BackToLogin() {
  return <Link className="auth-back-link" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>;
}
