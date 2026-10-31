import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../auth/AuthPages';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../../lib/api';
import { getInvitationContinuation, invitationContinuationPath } from './invitationContinuation';

/** A campus identifier is only navigation context; the ordinary service rechecks membership. */
export function JoinCampusContinuation({ campusId, invitationId }: { campusId: string; invitationId?: string }) {
  const auth = useAuth(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const activeMembership = auth.memberships.find(item => item.school_id === campusId);
  const [lookup, setLookup] = useState<{ key: string; membership: { school_id: string; school_name: string } | null; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const actorId = auth.user?.id;
  const lookupKey = `${actorId ?? ''}:${campusId}:${attempt}`;
  const needsLookup = auth.status === 'authenticated' && !activeMembership;
  // The shared shell intentionally contains only the active campus's memberships.
  // Look at this account's ordinary authorised membership response before deciding
  // that an invitation to another campus is unavailable.
  useEffect(() => {
    if (!needsLookup || !actorId) return;
    let current = true;
    const controller = new AbortController();
    void apiFetch<{ user: { id: string }; memberships: Array<{ school_id: string; school_name: string }> }>('/api/v1/auth/me/', { signal: controller.signal }).then(profile => {
      if (profile.user.id !== actorId) throw new Error('Your account changed. Refresh before continuing.');
      if (current) setLookup({ key: lookupKey, membership: profile.memberships.find(item => item.school_id === campusId) ?? null });
    }).catch(cause => { if (current) setLookup({ key: lookupKey, membership: null, error: cause instanceof Error ? cause.message : 'Your campus access could not be checked.' }); });
    return () => { current = false; controller.abort(); };
  }, [actorId, campusId, lookupKey, needsLookup, attempt]);
  const membership = activeMembership ?? (lookup?.key === lookupKey ? lookup.membership : null);
  const checking = needsLookup && lookup?.key !== lookupKey;
  const lookupError = needsLookup && lookup?.key === lookupKey ? lookup.error : undefined;
  const loginPath = `/login?next=${encodeURIComponent(invitationContinuationPath(campusId, invitationId))}`;
  async function openCampus() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await apiFetch('/api/v1/auth/csrf/');
      await apiFetch('/api/v1/auth/active-school/', { method: 'POST', body: JSON.stringify({ school_id: campusId }) });
      await auth.refresh();
      const continuation = invitationId ? await getInvitationContinuation(campusId, invitationId) : null;
      void navigate(continuation?.href ?? '/work', { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This campus could not open. Your accepted invitation has not been changed.'); }
    finally { setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true); setError('');
    try { await auth.logout(); void navigate(loginPath); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not switch accounts. Try again.'); }
    finally { setBusy(false); }
  }
  return <AuthLayout helpContext="invitation" eyebrow="Campus invitation" title={membership ? invitationId ? 'Open your invitation' : `Open ${membership.school_name}` : 'Open your campus'} description="Continue with the account that accepted your invitation.">
    {error ? <p className="auth-alert" role="alert">{error}</p> : null}
    {auth.status === 'loading' || checking ? <p role="status">Checking your account…</p> : auth.status === 'anonymous' ? <Link className="auth-primary-button" to={loginPath}>Sign in</Link> : lookupError ? <div className="join-success"><p role="alert">{lookupError}</p><button type="button" className="join-secondary" onClick={() => setAttempt(value => value + 1)}>Retry access check</button></div> : membership ? <div className="join-success"><p className="auth-entry-note">{auth.user?.email}</p><button className="auth-primary-button" disabled={busy} onClick={() => void openCampus()}>{busy ? 'Opening…' : invitationId ? 'Continue' : 'Open campus'}</button></div> : <div className="join-success"><p role="status">This account has no current access to the invited campus. Sign in with the invited account, or ask the campus contact to check your access.</p><button className="auth-primary-button" disabled={busy} onClick={() => void switchAccount()}>{busy ? 'Switching…' : 'Use another account'}</button><Link className="auth-back-link" to="/work">Stay in my workspace</Link></div>}
  </AuthLayout>;
}
