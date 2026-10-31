import { ThatCampusLoadingIcon as LoaderCircle } from "../../components/ThatCampusLoader";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  School,
  ShieldCheck,
} from "lucide-react";
import { authDestination, useAuth, type RegisterInput } from "./AuthContext";
import "./auth.css";
import { CampusLoginLayout } from "./CampusLoginLayout";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { OnboardingFrame } from "../onboarding/OnboardingFrame";
import { BrandLogo } from "../../components/BrandLogo";

function AuthBrand() {
  return (
    <Link className="auth-brand auth-brand--product" to="/" aria-label="ThatCampus portal">
      <BrandLogo/>
    </Link>
  );
}

export function AuthLayout({ eyebrow, title, description, children, variant, helpContext }: {
  variant?: "login";
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  helpContext?: "invitation";
}) {
  return <CampusLoginLayout title={title} description={description} eyebrow={variant === "login" ? undefined : eyebrow} helpContext={helpContext}>{children}</CampusLoginLayout>;
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
        placeholder="Enter your password"
        minLength={12}
        required
      />
      <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
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
  const [pending, setPending] = useState<"login" | null>(null);
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
      // Development review identities must always see the temporary profile
      // switcher first, even when a protected route supplied `next=`.
      void navigate(result.demoProfileSwitcher ? "/account/profile?demo_profiles=1" : safeNextPath(location.search) ?? "/", { replace: true });
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


  return (
    <AuthLayout variant="login" eyebrow="Welcome back" title={mfaChallenge ? "Two-step verification" : "Welcome back"} description={mfaChallenge ? "Enter your authenticator code or one unused recovery code." : "Sign in to your campus workspace."}>
      {!mfaChallenge ? <GoogleSignInButton disabled={pending !== null} onError={setError} onCredential={async credential => {
        setError(null);
        setPending("login");
        try {
          const result = await auth.googleLogin(credential);
          if (result.challengeToken) { setMfaChallenge(result.challengeToken); setPassword(""); return; }
          void navigate(safeNextPath(location.search) ?? "/", { replace: true });
        } finally { setPending(null); }
      }} /> : null}
      {mfaChallenge ? <form className="auth-form" onSubmit={submitMfa} aria-busy={pending !== null}>
        {error ? <div className="auth-alert" role="alert"><ShieldCheck size={18} /><span>{error}</span></div> : null}
        <label className="auth-field"><span>Verification code</span><div className="auth-input-wrap"><KeyRound size={18}/><input value={mfaCode} onChange={(event)=>setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus required/></div></label>
        <button className="auth-primary-button" type="submit" disabled={pending !== null}>{pending === "login" ? <><LoaderCircle className="auth-spin" size={18}/> Verifying…</> : <>Verify and sign in <ArrowRight size={18}/></>}</button>
        <button className="auth-text-button" type="button" onClick={()=>{setMfaChallenge(null);setMfaCode("");setError(null);}}>Use another account</button>
      </form> : <form className="auth-form" onSubmit={submit} aria-busy={pending !== null}>
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
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
        </label>
        <label className="auth-field">
          <span>Password</span>
          <PasswordInput value={password} onChange={setPassword} />
        </label>
        <Link className="auth-login-forgot" to="/forgot-password">Forgot password?</Link>
        <button className="auth-primary-button" type="submit" disabled={pending !== null}>
          {pending === "login" ? <><LoaderCircle className="auth-spin" size={18} /> Signing in...</> : <>Sign in <ArrowRight size={18} /></>}
        </button>
      </form>}


      <div className="campus-login__links">
        <p className="auth-invite-link">Have an invitation? <Link to="/join">Join your institution</Link></p>
        <p className="auth-switch">New to ThatCampus? <Link to="/signup">Create an account</Link></p>
      </div>
    </AuthLayout>
  );
}

export function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterInput>({
    email: "",
    password: "",
  });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.status === "authenticated") return <Navigate to={authDestination(auth)} replace />;

  const update = <Key extends keyof RegisterInput>(key: Key, value: RegisterInput[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await auth.register({
        email: form.email.trim(),
        password: form.password,
      });
      void navigate("/account/security?from=%2Fonboarding%2Fstart", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Your account could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <OnboardingFrame step="Your account" headerAction={<Link className="campus-start__quiet" to="/login">Sign in</Link>}>
      <h1>Start with what you need.</h1>
      <p className="campus-start__lead">Create your account, then choose the first thing you want to run.</p>
      <form onSubmit={submit} aria-busy={pending}>
        {error ? <p className="campus-start__error" role="alert">{error}</p> : null}
        <label className="campus-start__field">Email address<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} autoComplete="email" placeholder="you@example.com" required /></label>
        <div className="campus-start__field">
          <label htmlFor="signup-password">Create password</label>
          <div className="campus-start__password-control">
            <input id="signup-password" type={passwordVisible?'text':'password'} value={form.password} onChange={event=>update('password',event.target.value)} minLength={12} autoComplete="new-password" aria-describedby="signup-password-help" required />
            <button type="button" aria-label={passwordVisible?'Hide password':'Show password'} aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(!passwordVisible)}>{passwordVisible?<EyeOff size={20}/>:<Eye size={20}/>}</button>
          </div>
          <small id="signup-password-help">Use at least 12 characters with upper- and lowercase letters, a number and a symbol.</small>
        </div>
        <button className="campus-start__primary" type="submit" disabled={pending}>
          {pending ? <><LoaderCircle className="auth-spin" size={18} /> Creating account…</> : <>Create account <ArrowRight size={18} /></>}
        </button>
      </form>
      <p className="campus-start__note">Start privately with one campus task. Add more whenever you’re ready.</p>
      <Link className="campus-start__explore" to="/demo">Just exploring? Try the demo</Link>
      <p className="campus-start__note">Joining an existing campus? <Link to="/join">Use your invitation</Link>.</p>
    </OnboardingFrame>
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
        <span className="onboarding-eyebrow">My home</span>
        <h1>Welcome, {auth.user?.first_name || "there"}</h1>
        <p>{auth.user?.email}</p>
        <p>{[...new Set(auth.memberships.map(member=>member.school_name))].join(", ")}</p>
        <h2>Ask your administrator for access</h2>
        <p>Your account is ready. No workspace permissions have been assigned yet. Ask your institution administrator to assign a role and the permissions you need.</p>
        <p>Share your account email above so they can find you in Roles and permissions.</p>
        <Link className="auth-primary-button" to="/">Check my access <ArrowRight size={18} /></Link>
        <button className="auth-text-button" type="button" onClick={() => void auth.logout()}>Sign out</button>
      </div>
    </main>
  );
}

export function BackToLogin() {
  return <Link className="auth-back-link" to="/login"><ArrowLeft size={16} /> Back to sign in</Link>;
}
