import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from './SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { Button, Empty, Field, Loading, Notice, Page, Section } from '../ui/components';
import { ControlButton, Facts } from '../ui/DomainControls';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { useTheme } from '../ui/theme';
import { checkedAcceptedInvitation, checkedInvitationProof, invitationFromFragment, invitationContinuationPath, invitationToken, invitationUuid, validateInvitationContinuation, type AcceptedInvitation, type InvitationProof } from './invitation-entry';
import { createPublicFormLease, PublicFormContextChanged, publicFormRequest } from './public-form-operation';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The invitation could not be confirmed.';
const errorCode = (cause: unknown) => cause instanceof ApiError ? (cause.details as { error?: { code?: string } } | undefined)?.error?.code : undefined;
function usePublicInvitationOperation(identity: string) {
  const focused = useIsFocused(), mounted = useRef(false);
  const state = useRef({ identity, mounted: false, focused, foreground: AppState.currentState === 'active' });
  state.current = { identity, mounted: mounted.current, focused, foreground: AppState.currentState === 'active' };
  const lease = useRef(createPublicFormLease(state.current)); lease.current.update(state.current);
  useEffect(() => {
    mounted.current = true; state.current = { ...state.current, mounted: true }; lease.current.update(state.current);
    const listener = AppState.addEventListener('change', value => { state.current = { ...state.current, foreground: value === 'active' }; lease.current.update(state.current); });
    return () => { mounted.current = false; state.current = { ...state.current, mounted: false }; lease.current.update(state.current); listener.remove(); };
  }, []);
  return useCallback(() => lease.current.capture(), []);
}
async function currentInvitationDestination(actor: string, campus: string, invitation?: string) {
  const context = captureApiContext();
  const profile = await apiFetch<{ user: { id: string; active_school_id: string } }>('/api/v1/auth/me/');
  context.assertCurrent();
  if (profile.user.id !== actor || profile.user.active_school_id !== campus) throw new Error('Confirm the invited account and campus before continuing.');
  const continuation = invitation ? validateInvitationContinuation(await apiFetch(`/api/v1/schools/${campus}/invitations/${invitation}/continuation/`), campus, invitation) : null;
  context.assertCurrent(); return continuation?.href ?? '/work';
}

export function JoinScreen() {
  const session = useSession(), router = useRouter(), { colors } = useTheme();
  const params = useLocalSearchParams<{ campus?: string; invitation?: string; '#': string }>(), fragment = typeof params['#'] === 'string' ? params['#'] : '';
  const [entry, setEntry] = useState(() => ({ fragment, serial: 0 }));
  // Capture the secret once, then remove it from the address bar without a new
  // history entry. A later invitation gets a fresh form before it is scrubbed.
  if (fragment && entry.fragment !== fragment) setEntry(old => ({ fragment, serial: old.serial + 1 }));
  useEffect(() => { if (fragment) router.setParams({ '#': undefined }); }, [fragment, router]);
  const campus = typeof params.campus === 'string' ? params.campus : undefined, invitation = typeof params.invitation === 'string' ? params.invitation : undefined;
  const invalid = campus && !invitationUuid.test(campus) || invitation && (!campus || !invitationUuid.test(invitation));
  return <><Stack.Screen options={{ headerShown: true, title: 'Campus invitation', headerTintColor: colors.link, headerShadowVisible: false, contentStyle: { backgroundColor: colors.canvas } }} />{session.environment.mode !== 'live' ? <Page title="Joining is managed in Live"><Notice message="Return to Live before changing app access or requesting an email verification code." /><ControlButton title="Simulation controls" onPress={() => router.replace('/more/simulation' as never)} /></Page> : invalid ? <Page title="Check your invitation"><Empty title="This invitation link is incomplete" message="Open the original invitation or ask your campus contact to check it." /><ControlButton title="Sign in" onPress={() => router.replace('/login')} /></Page> : campus ? <CampusContinuation campus={campus} invitation={invitation} /> : <InvitationForm key={`${session.scopeKey}:${entry.serial}`} fragment={entry.fragment} />}</>;
}

function InvitationForm({ fragment }: { fragment: string }) {
  const session = useSession(), router = useRouter(), initial = invitationFromFragment(fragment);
  const [email, setEmail] = useState(initial.email), [token, setToken] = useState(initial.token), [name, setName] = useState(''), [password, setPassword] = useState(''), [proof, setProof] = useState('');
  const [details, setDetails] = useState<InvitationProof | null>(null), [accepted, setAccepted] = useState<AcceptedInvitation | null>(null), [confirmRequired, setConfirmRequired] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [unknown, setUnknown] = useState(false), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now());
  const running = useRef(false), mounted = useRef(true);
  const captureOperation = usePublicInvitationOperation(JSON.stringify([fragment, session.scopeKey, session.status, session.user?.id, session.environment.mode, session.environment.namespace_id, email, token, name, password, proof, confirmed, details?.campus.id, details?.invitation_id]));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!retryAt) return; const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); }, [retryAt]);
  useScreenExitGuard({ blocked: session.status === 'authenticated' && busy, dirty: session.status === 'authenticated' && !accepted && !!(name || password || proof) });
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000)), unavailable = details?.verification_required && ['unavailable','failed'].includes(details.delivery), sameAccount = session.user?.id === accepted?.accepted_user_id;
  async function inspect() {
    if (running.current || unknown || accepted || !invitationToken.test(token.trim()) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    running.current = true; setBusy(true); setError('');
    let assertCurrent: (() => void) | undefined;
    try { assertCurrent = captureOperation(); const result = checkedInvitationProof(await publicFormRequest({ assertCurrent, bootstrap: Platform.OS === 'web' ? () => apiFetch('/api/v1/auth/csrf/') : undefined, submit: () => apiFetch(`/api/v1/${Platform.OS === 'web' ? '' : 'auth/native/'}invitations/recipient-proof/`, { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim() }) }) })); assertCurrent(); if (mounted.current) { setDetails(result); setNow(Date.now()); setRetryAt(Date.now() + (result.retry_after_seconds ?? 0) * 1000); } }
    catch (cause) { try { assertCurrent?.(); if (mounted.current) setError(message(cause)); } catch { /* A departed form receives no stale result. */ } }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function join(recover = false) {
    if (running.current || !details || accepted || unavailable || unknown && !recover || confirmRequired && !confirmed) return;
    running.current = true; setBusy(true); setError(''); let sent = false, assertCurrent: (() => void) | undefined;
    try {
      // Bootstrap browser CSRF before classifying an interrupted acceptance as
      // unknown. Native has no browser cookie and uses the bounded adapter.
      assertCurrent = captureOperation();
      const result = checkedAcceptedInvitation(await publicFormRequest({ assertCurrent, bootstrap: Platform.OS === 'web' ? () => apiFetch('/api/v1/auth/csrf/') : undefined, submit: () => { sent = true; return apiFetch(`/api/v1/${Platform.OS === 'web' ? '' : 'auth/native/'}invitations/accept/`, { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), token: token.trim(), first_name: name.trim(), last_name: '', password, ...(details.verification_required ? { recipient_proof: proof.trim() } : {}), ...(confirmRequired ? { confirm_admin_person: confirmed } : {}), ...(recover ? { recover_accepted: true } : {}) }) }); } }), details);
      assertCurrent();
      if (mounted.current) { setAccepted(result); setPassword(''); setProof(''); setToken(''); setUnknown(false); }
    } catch (cause) {
      if (!mounted.current) return;
      // Local recovery bookkeeping remains necessary after an uncertain dispatch;
      // no result, navigation or new request is delivered to a departed form.
      if (sent && cause instanceof PublicFormContextChanged) { setUnknown(true); return; }
      try { assertCurrent?.(); } catch { if (sent) setUnknown(true); return; }
      if (errorCode(cause) === 'admin_person_confirmation_required') setConfirmRequired(true);
      if (recover && errorCode(cause) === 'invitation_acceptance_not_confirmed') setUnknown(false);
      if (sent && (!(cause instanceof ApiError) || cause.status >= 500 || cause.status === 408 || cause.status < 400)) setUnknown(true);
      setError(message(cause));
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function continueAfterJoining() {
    if (!accepted || running.current) return; running.current = true; setBusy(true); setError('');
    try {
      const supplied = accepted.continuation ? validateInvitationContinuation(accepted.continuation, accepted.school_id) : null;
      const invitation = supplied?.invitation_id ?? details?.invitation_id;
      if (sameAccount) { await session.selectSchool(accepted.school_id); router.replace(await currentInvitationDestination(accepted.accepted_user_id, accepted.school_id, invitation) as never); }
      else { if (session.status === 'authenticated') await session.logout(); router.replace(`/login?next=${encodeURIComponent(invitationContinuationPath(accepted.school_id, invitation))}` as never); }
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  return <Page title={accepted ? 'You’re connected' : details ? `Join ${details.campus.name}` : 'Join your campus'} subtitle={accepted ? 'Your invitation has been accepted.' : 'Use the email and code from your campus invitation.'} maxWidth={560}>
    {error ? <Notice tone="danger" message={error} /> : null}
    {accepted ? <><Notice tone="success" message={accepted.role === 'member' ? 'Your account is linked to your campus person. Campus work is available when assigned.' : 'Your campus membership is active.'} />{session.status === 'authenticated' && !sameAccount ? <Notice message={`You are still signed in as ${session.user?.email}. Continue with the invited account.`} /> : null}<Button title={sameAccount ? accepted.continuation?.label ?? 'Open campus' : session.status === 'authenticated' ? 'Sign in with invited account' : 'Sign in'} busy={busy} onPress={() => { void continueAfterJoining(); }} /></> : !details ? <Section title="Invitation details"><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" maxLength={254} editable={!busy} /><Field label="Invitation code" value={token} onChangeText={setToken} autoCapitalize="none" autoComplete="one-time-code" maxLength={100} editable={!busy} /><Button title="Continue" busy={busy} disabled={!email.trim() || !invitationToken.test(token.trim())} onPress={() => { void inspect(); }} /><ControlButton title="Sign in" disabled={busy} onPress={() => router.push('/login')} /></Section> : <>
      <Facts items={[{ label: 'Invited email', value: email }, { label: 'Campus', value: details.campus.name }]} />
      {session.status === 'authenticated' && session.user?.email.toLowerCase() !== email.trim().toLowerCase() ? <Notice message={`Signed in as ${session.user?.email}. Accepting this invitation keeps that account signed in.`} /> : null}
      <Field label="Name" value={name} onChangeText={setName} maxLength={150} autoComplete="name" editable={!busy && !unknown} />
      <Field label="Account password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" maxLength={128} editable={!busy && !unknown} />
      <Notice message="Use your current account password if you already have an account. Otherwise, choose a new password." />
      {details.verification_required ? <><Field label="Email verification code" value={proof} onChangeText={setProof} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} editable={!busy && !unknown} /><Notice tone={unavailable ? 'warning' : 'info'} message={unavailable ? 'Email verification is unavailable. Ask your campus contact to check email delivery.' : 'Use the separate verification code sent to your invited email.'} /><ControlButton title={wait ? `Resend available in ${wait}s` : 'Resend verification code'} disabled={busy || unknown || wait > 0} onPress={() => { void inspect(); }} /></> : null}
      {confirmRequired ? <Button title={confirmed ? 'Confirmed: link my existing campus person' : 'Confirm this is my existing campus person'} kind="secondary" disabled={busy || unknown} onPress={() => setConfirmed(!confirmed)} /> : null}
      {unknown ? <><Notice tone="warning" message="Joining was not confirmed. Your details are retained on this screen. Check the original result before trying again." /><Button title="Check joining result" busy={busy} onPress={() => { void join(true); }} /></> : <Button title="Accept invitation" busy={busy} disabled={!name.trim() || !password || unavailable || details.verification_required && !/^\d{6}$/.test(proof.trim()) || confirmRequired && !confirmed} onPress={() => { void join(); }} />}
    </>}
  </Page>;
}

function CampusContinuation({ campus, invitation }: { campus: string; invitation?: string }) {
  const session = useSession(), router = useRouter(), actor = session.user?.id;
  const [membership, setMembership] = useState<{ school_id: string; school_name: string } | null>(null), [checking, setChecking] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => { if (session.status !== 'authenticated' || !actor) { setChecking(false); return; } let current = true; const controller = new AbortController(); setChecking(true); setError(''); void apiFetch<{ user: { id: string }; memberships: Array<{ school_id: string; school_name: string }> }>('/api/v1/auth/me/', { signal: controller.signal }).then(profile => { if (profile.user.id !== actor) throw new Error('Your account changed. Confirm it again.'); if (current) setMembership(profile.memberships.find(item => item.school_id === campus) ?? null); }).catch(cause => { if (current) setError(message(cause)); }).finally(() => { if (current) setChecking(false); }); return () => { current = false; controller.abort(); }; }, [session.status, actor, campus, attempt]);
  async function open() { if (busy || !actor || !membership) return; setBusy(true); setError(''); try { await session.selectSchool(campus); router.replace(await currentInvitationDestination(actor,campus,invitation) as never); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  async function signIn() { if (busy) return; setBusy(true); setError(''); try { if (session.status === 'authenticated') await session.logout(); router.replace(`/login?next=${encodeURIComponent(invitationContinuationPath(campus, invitation))}` as never); } catch (cause) { setError(message(cause)); } finally { setBusy(false); } }
  return <Page title={membership ? invitation ? 'Open your invitation' : `Open ${membership.school_name}` : 'Open your campus'} subtitle="Continue with the account that accepted the invitation." maxWidth={560}>{session.status === 'loading' || checking ? <Loading /> : session.status === 'error' ? <Empty title="Confirm your account" message={session.error ?? undefined} onRetry={() => { void session.refresh(); }} /> : <>{error ? <Empty title="Campus access could not be confirmed" message={error} onRetry={() => setAttempt(old => old + 1)} /> : null}{session.status === 'anonymous' ? <Button title="Sign in" busy={busy} onPress={() => { void signIn(); }} /> : membership ? <><Notice message={session.user?.email ?? ''} /><Button title={invitation ? 'Continue' : 'Open campus'} busy={busy} onPress={() => { void open(); }} /></> : !error ? <><Notice message="This account has no current access to the invited campus. Sign in with the invited account or ask your campus contact to check access." /><Button title="Use another account" busy={busy} onPress={() => { void signIn(); }} /><ControlButton title="Stay in my workspace" disabled={busy} onPress={() => router.replace('/work')} /></> : null}</>}</Page>;
}
