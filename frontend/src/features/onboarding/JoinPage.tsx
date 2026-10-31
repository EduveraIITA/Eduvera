import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, apiFetch } from '../../lib/api';
import { AuthLayout } from '../auth/AuthPages';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { JoinCampusContinuation } from './JoinCampusContinuation';
import { getInvitationContinuation, invitationContinuationPath, validateInvitationContinuation, type InvitationContinuation } from './invitationContinuation';
import './join.css';

interface RecipientProof {
  invitation_id?: string;
  campus: { id: string; name: string };
  verification_required: boolean;
  delivery: 'email_accepted' | 'cooldown' | 'unavailable' | 'not_required' | 'failed';
  retry_after_seconds?: number;
}
interface AcceptedInvitation { school_id: string; role: string; accepted_user_id: string; continuation?: InvitationContinuation | null }
const validToken = /^(?:[0-9]{6}|[A-Za-z0-9_-]{40,100})$/;
const validCampus = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export default function JoinPage() {
  const location = useLocation(); const navigate = useNavigate(); const auth = useAuth();
  const [entryKey, setEntryKey] = useState(location.key);
  useEffect(() => {
    if (location.hash) void navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);
  // A second invitation can be opened in the same tab. Initialise it before
  // scrubbing its fragment, rather than keeping the previous recipient's form.
  if (location.hash && entryKey !== location.key) { setEntryKey(location.key); return null; }
  const campus = new URLSearchParams(location.search).get('campus');
  const workInvitation = new URLSearchParams(location.search).get('invitation');
  if (auth.executionEnvironment?.mode === 'simulation') return <AuthLayout helpContext="invitation" eyebrow="Campus invitation" title="Joining is managed in Live" description="This simulation cannot send a real verification code or change app access."><Link className="auth-back-link" to="/more/simulation">Open Simulation controls</Link></AuthLayout>;
  if (workInvitation && (!campus || !validCampus.test(campus) || !validCampus.test(workInvitation))) return <AuthLayout helpContext="invitation" eyebrow="Campus invitation" title="Check your invitation" description="This work link is incomplete. Open the original invitation or ask your campus contact for help."><Link className="auth-back-link" to="/login">Back to sign in</Link></AuthLayout>;
  return campus && validCampus.test(campus) ? <JoinCampusContinuation campusId={campus} invitationId={workInvitation ?? undefined} /> : <InvitationEntry key={entryKey} />;
}

function InvitationEntry() {
  const auth = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [invitation] = useState(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('token') ?? ''; const email = params.get('email') ?? '';
    return validToken.test(token) && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, token } : { email: '', token: '' };
  });
  const [email, setEmail] = useState(invitation.email); const [token, setToken] = useState(invitation.token);
  const [detailsOpen, setDetailsOpen] = useState(!invitation.token);
  const [context, setContext] = useState<RecipientProof | null>(null);
  const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [proof, setProof] = useState('');
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [unknownResult, setUnknownResult] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false); const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [retryAt, setRetryAt] = useState(0); const [now, setNow] = useState(0);
  const stepHeading = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (context) stepHeading.current?.focus(); }, [context]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const proofUnavailable = context?.verification_required && ['unavailable', 'failed'].includes(context.delivery);
  async function requestProof(event?: FormEvent) {
    event?.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      await apiFetch('/api/v1/auth/csrf/');
      const result = await apiFetch<RecipientProof>('/api/v1/invitations/recipient-proof/', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim() }) });
      setContext(result); setNow(Date.now()); setRetryAt(result.retry_after_seconds ? Date.now() + result.retry_after_seconds * 1000 : 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This invitation could not be checked. Try again.'); }
    finally { setBusy(false); }
  }
  async function accept(event: FormEvent<HTMLFormElement> | null, recover = false) {
    event?.preventDefault(); if (busy || !context || proofUnavailable || (unknownResult && !recover)) return;
    const confirmedPerson = event ? new FormData(event.currentTarget).get('confirm_admin_person') === 'on' : false;
    let acceptanceAttempted = false;
    setBusy(true); setError('');
    try {
      await apiFetch('/api/v1/auth/csrf/');
      acceptanceAttempted = true;
      const result = await apiFetch<AcceptedInvitation>('/api/v1/invitations/accept/', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim(), first_name: name, last_name: '', password, ...(context.verification_required ? { recipient_proof: proof } : {}), ...(confirmationRequired ? { confirm_admin_person: confirmedPerson } : {}), ...(recover ? { recover_accepted: true } : {}) }) });
      setAccepted(result); setPassword(''); setProof(''); setToken('');
    } catch (cause) {
      if (cause instanceof ApiError && typeof cause.details === 'object' && cause.details !== null && 'error' in cause.details) {
        const detail = cause.details.error;
        if (typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'admin_person_confirmation_required') setConfirmationRequired(true);
        if (recover && typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'invitation_acceptance_not_confirmed') setUnknownResult(false);
      }
      if (acceptanceAttempted && (!(cause instanceof ApiError) || cause.status >= 500 || cause.status === 408 || cause.status < 400)) setUnknownResult(true);
      setError(cause instanceof Error ? cause.message : 'Acceptance was not confirmed. Your details are retained.');
    } finally { setBusy(false); }
  }
  async function openCampus() {
    if (!accepted || busy) return;
    setBusy(true); setError('');
    try {
      await auth.refresh();
      await apiFetch('/api/v1/auth/active-school/', { method: 'POST', body: JSON.stringify({ school_id: accepted.school_id }) });
      await auth.refresh();
      const supplied = accepted.continuation ? validateInvitationContinuation(accepted.continuation, accepted.school_id) : null;
      const continuation = supplied ? await getInvitationContinuation(accepted.school_id, supplied.invitation_id) : null;
      void navigate(continuation?.href ?? '/work', { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your invitation is accepted. Opening the campus failed; try again.'); }
    finally { setBusy(false); }
  }
  async function signIn() {
    const campusId = accepted?.school_id ?? context?.campus.id;
    if (!campusId || busy) return;
    setBusy(true); setError('');
    try {
      const continuation = accepted?.continuation ? validateInvitationContinuation(accepted.continuation, campusId) : null;
      const invitationId = continuation?.invitation_id ?? (context?.invitation_id && validCampus.test(context.invitation_id) ? context.invitation_id : undefined);
      if (auth.status === 'authenticated') await auth.logout();
      void navigate(`/login?next=${encodeURIComponent(invitationContinuationPath(campusId, invitationId))}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not switch accounts. Try again.'); }
    finally { setBusy(false); }
  }
  const sameAccount = auth.status === 'authenticated' && auth.user?.id === accepted?.accepted_user_id;
  return <AuthLayout helpContext="invitation" eyebrow="Campus invitation" title={accepted ? 'You’re connected' : context ? `Join ${context.campus.name}` : 'Join your campus'} description={accepted ? 'Your invitation has been accepted.' : context ? 'Use your invited account, or create one here.' : 'Open your invitation to continue.'}>
    {error ? <p role="alert" className="auth-alert">{error}</p> : null}
    {accepted ? <div className="auth-success join-success"><CheckCircle2 aria-hidden="true" /><p role="status">{accepted.role === 'member' ? 'Your account is linked to your campus person. Campus work is available only when assigned.' : 'Your campus membership is active.'}</p>
      {auth.status === 'authenticated' && !sameAccount ? <p className="auth-entry-note">You’re still signed in as {auth.user?.email}. Switch to the invited account to continue.</p> : null}
      <button type="button" className="auth-primary-button" disabled={busy} onClick={() => void (sameAccount ? openCampus() : signIn())}>{busy ? 'Opening…' : sameAccount ? accepted.continuation ? accepted.continuation.label : 'Open campus' : auth.status === 'authenticated' ? 'Sign in with invited account' : 'Sign in'}</button>
    </div> : !context ? <form className="auth-form" aria-busy={busy} onSubmit={event => void requestProof(event)}><fieldset disabled={busy} className="auth-invitation-fields">
      <label className="auth-field">Email<input className="auth-plain-input" name="email" value={email} onChange={event => setEmail(event.target.value)} type="email" required maxLength={254} autoComplete="email" /></label>
      <details className="auth-entry-details" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>Invitation details</summary><label className="auth-field">Invitation code<input className="auth-plain-input" name="token" value={token} onChange={event => setToken(event.target.value)} onInvalid={() => setDetailsOpen(true)} required minLength={6} maxLength={100} inputMode="text" placeholder="Invitation code" pattern="(?:[0-9]{6}|[A-Za-z0-9_-]{40,100})" autoComplete="one-time-code" /></label></details>
      <button className="auth-primary-button" type="submit">{busy ? 'Checking…' : 'Continue'}</button>
    </fieldset><Link className="auth-back-link" to="/login">Back to sign in</Link></form> : <form className="auth-form" aria-busy={busy} onSubmit={event => void accept(event)}>
      <p className="join-recipient" ref={stepHeading} tabIndex={-1}>{email}</p>
      {auth.status === 'authenticated' && auth.user?.email?.toLowerCase() !== email.trim().toLowerCase() ? <p className="auth-entry-note">Signed in as {auth.user?.email}. Accepting this invitation won’t switch that account.</p> : null}
      <fieldset disabled={busy} className="auth-invitation-fields">
        <label className="auth-field">Name<input className="auth-plain-input" name="first_name" value={name} onChange={event => setName(event.target.value)} required maxLength={150} autoComplete="name" /></label>
        <div className="auth-field"><label htmlFor="join-password">Password</label><div className="auth-input-wrap"><LockKeyhole size={18} aria-hidden="true" /><input id="join-password" name="password" type={passwordVisible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required minLength={1} maxLength={128} autoComplete="current-password" aria-describedby="join-password-help" /><button type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(!passwordVisible)}>{passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><small id="join-password-help">Use your current password, or create one: 12+ characters with upper/lowercase letters, a number and a symbol.</small></div>
        {context.verification_required ? <div className="join-proof"><label className="auth-field">Email verification code<input className="auth-plain-input" name="recipient_proof" value={proof} onChange={event => setProof(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} aria-describedby="join-proof-help" /></label><p id="join-proof-help" className="auth-entry-note">Use the separate 6-digit code from your email, not the invitation code.</p>{proofUnavailable ? <p role="alert" className="auth-alert">Email sending is unavailable. Try sending the code again later.</p> : null}<button type="button" className="join-secondary" disabled={busy || retrySeconds > 0} onClick={() => void requestProof()}>{retrySeconds > 0 ? `Send again in ${retrySeconds}s` : 'Send code again'}</button></div> : null}
        {confirmationRequired ? <label className="auth-person-confirmation"><input name="confirm_admin_person" type="checkbox" required /><span>I confirm this name identifies me. Link my account to my campus person profile as the invited administrator. This does not create employment or additional permissions.</span></label> : null}
        <Link className="auth-entry-recovery" to="/forgot-password" target="_blank" rel="noopener noreferrer">Reset password in a new tab</Link>
        {unknownResult ? <div className="join-proof"><p className="auth-entry-note" role="status">Joining wasn’t confirmed. Check the result before trying to accept again.</p><button type="button" className="auth-primary-button" onClick={() => void accept(null, true)}>{busy ? 'Checking…' : 'Check joining result'}</button><button type="button" className="join-secondary" onClick={() => void signIn()}>Use sign-in recovery</button></div> : <button type="submit" className="auth-primary-button" disabled={Boolean(proofUnavailable)}>{busy ? 'Accepting…' : 'Accept invitation'}</button>}
        <button type="button" className="join-secondary" onClick={() => { setContext(null); setPassword(''); setProof(''); setError(''); setUnknownResult(false); }}><ArrowLeft size={16} aria-hidden="true" />Change invitation</button>
      </fieldset>
    </form>}
  </AuthLayout>;
}
