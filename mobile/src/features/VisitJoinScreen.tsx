import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { VisitOnboardingProof } from '../../../packages/contracts/src/visit-onboarding';
import { useSession } from '../auth/SessionProvider';
import { createPublicFormLease } from '../auth/public-form-operation';
import { visitJoinContinuations as intents, type VisitJoinIntent } from '../auth/visit-join-continuation';
import { checkedVisitAccount, checkedVisitJoin, checkedVisitPreview, checkedVisitProof, visitJoinFragment, visitJoinReturnTarget, visitJoinUuid, visitPublicInput } from '../auth/visit-join-policy';
import { apiFetch, captureApiContext, getApiOrigin } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Empty, Field, Loading, Notice, Page, Section } from '../ui/components';
import { ControlButton } from '../ui/DomainControls';
import { VisitDetailCard, VisitPlanNotice } from './GateVisitDetails';
import { Alert } from '../ui/Alert';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'This visit could not be confirmed. Try again.';
const unavailableLink = (cause: unknown) => cause instanceof ApiError && [403,404,410].includes(cause.status);
const uncertain = (cause: unknown) => !(cause instanceof ApiError) || cause.status === 408 || cause.status >= 500;

/** One public route; the credential is scrubbed before any network request and
 * survives only in this process's bounded, origin-bound volatile continuation. */
export function VisitJoinScreen() {
  const params = useLocalSearchParams<{ continue?: string; '#': string }>(), router = useRouter(), session = useSession();
  const fragment = typeof params['#'] === 'string' ? params['#'] : '', origin = getApiOrigin();
  const [error,setError] = useState(''), captured = useRef('');
  useSyncExternalStore(intents.subscribe,intents.revision,intents.revision);
  useEffect(() => {
    if (!fragment) { captured.current=''; return; }
    if (captured.current === fragment) return; captured.current = fragment;
    const token = visitJoinFragment(fragment);
    try {
      const target = token ? intents.retain(token,origin,Crypto.randomUUID) : '/visit-join';
      router.replace(target as never);
      if (!token) setError('This visit link is incomplete. Open the original link or ask the campus to share it again.');
    } catch (cause) { router.replace('/visit-join' as never); setError(message(cause)); }
  },[fragment,origin,router]);
  const id = typeof params.continue === 'string' && visitJoinUuid.test(params.continue) ? params.continue : '';
  const intent = id ? intents.read(id,origin) : null;
  return fragment ? <Page title="Opening your visit" maxWidth={560}><Loading /></Page> : intent ? <VisitJoinForm key={`${origin}:${id}`} intent={intent} /> : <Page title="Open your visit" maxWidth={560}><Empty title="Open the original visit link" message={error || 'This continuation expired or was opened in another browser or app process. Open the original link supplied by the campus; no registration has been inferred.'} /><ControlButton title={session.status === 'authenticated' ? 'Open ThatCampus' : 'Sign in'} onPress={() => router.replace(session.status === 'authenticated' ? '/today' : '/login')} /></Page>;
}

function VisitJoinForm({ intent }: { intent: VisitJoinIntent }) {
  const session = useSession(), router = useRouter(), focused = useIsFocused(), origin = getApiOrigin();
  const [email,setEmail] = useState(''), [first,setFirst] = useState(''), [last,setLast] = useState(''), [password,setPassword] = useState(''), [confirmation,setConfirmation] = useState(''), [code,setCode] = useState('');
  const [proof,setProof] = useState<VisitOnboardingProof | null>(null), [account,setAccount] = useState(false), [accountUnknown,setAccountUnknown] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState(''), [previewAttempt,setPreviewAttempt] = useState(0), [retryAt,setRetryAt] = useState(0), [now,setNow] = useState(Date.now()), [foreground,setForeground] = useState(AppState.currentState === 'active');
  const mounted = useRef(false), lock = useRef(false);
  const identity = JSON.stringify([intent.id,origin,session.scopeKey,session.status,session.publicDemo,focused,email,first,last,password,confirmation,code,proof?.challenge_id]);
  const lease = useRef(createPublicFormLease({ identity,mounted: false,focused,foreground: AppState.currentState === 'active' }));
  lease.current.update({ identity,mounted: mounted.current,focused,foreground: AppState.currentState === 'active' });
  useEffect(() => {
    mounted.current = true; lease.current.update({ identity,mounted: true,focused,foreground: AppState.currentState === 'active' });
    const listener = AppState.addEventListener('change',value => { lease.current.update({ identity,mounted: mounted.current,focused,foreground: value === 'active' }); setForeground(value === 'active'); });
    return () => { mounted.current = false; lease.current.update({ identity,mounted: false,focused: false,foreground: false }); listener.remove(); };
  },[identity,focused]);
  const capture = useCallback(() => lease.current.capture(),[]);
  useEffect(() => { if (!focused) { setPassword(''); setConfirmation(''); setCode(''); } const listener=AppState.addEventListener('change',state => { if(state!=='active'){setPassword('');setConfirmation('');setCode('');} }); return () => listener.remove(); },[focused]);
  const current = () => { const value = intents.read(intent.id,origin); if (!value) throw new Error('Open the original visit link again.'); return value; };
  const live = session.environment.mode === 'live' && !session.environment.unavailable && !session.publicDemo;
  useScreenExitGuard({ blocked: busy || intent.completion === 'refreshing' || intent.completion === 'selecting', dirty: !intent.accountStatus && (!!password || !!code || !!first || !!last), onLeave: () => { setPassword(''); setConfirmation(''); setCode(''); } });
  useEffect(() => { if (!retryAt) return; const timer = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); },[retryAt]);
  useEffect(() => {
    if (!focused || !foreground || AppState.currentState !== 'active' || !live || !['anonymous','authenticated'].includes(session.status) || intent.accepted) return;
    let assertCurrent: () => void; try { assertCurrent = capture(); } catch { return; }
    let active = true; setError('');
    void session.requestVisitOnboarding('preview',{ token: intent.token },assertCurrent).then(value => { assertCurrent(); if (active) intents.update(intent.id,origin,entry => ({ ...entry,preview: checkedVisitPreview(value) })); }).catch(cause => { try { assertCurrent(); if (active) { setError(message(cause)); if (unavailableLink(cause)) intents.update(intent.id,origin,entry => ({ ...entry,preview:undefined })); } } catch { /* Departed public context. */ } });
    return () => { active = false; };
  },[intent.id,origin,session.status,session.scopeKey,live,focused,foreground,previewAttempt,capture]);

  // SessionProvider may remount its presentation while normal refresh/selection
  // commits. Only the accepted actor-bound continuation resumes; no POST repeats.
  useEffect(() => {
    const accepted = intent.accepted;
    if (!accepted || !focused || !foreground || AppState.currentState !== 'active' || !live || session.status !== 'authenticated' || session.user?.id !== accepted.actorId) return;
    if (intent.completion === 'refresh' || intent.completion === 'select') {
      const phase = intent.completion; let assertCurrent: () => void;
      try { assertCurrent = capture(); if (current().completion !== phase || current().accepted !== accepted) return; } catch { return; }
      try { assertCurrent(); if (phase === 'select' && !session.memberships.some(row => row.school_id === accepted.result.school_id)) throw new Error('The campus membership could not be confirmed. Retry account verification before opening this visit.'); }
      catch (cause) { setError(message(cause)); intents.update(intent.id,origin,entry => ({ ...entry,completion:'error' })); return; }
      intents.update(intent.id,origin,entry => ({ ...entry,completion: phase === 'refresh' ? 'refreshing' : 'selecting' }));
      const operation = phase === 'refresh' ? session.refresh() : session.schoolId === accepted.result.school_id ? Promise.resolve() : session.selectSchool(accepted.result.school_id);
      void operation.then(() => { intents.update(intent.id,origin,entry => entry.accepted === accepted ? { ...entry,completion: phase === 'refresh' ? 'select' : 'ready' } : entry); }).catch(() => { try { intents.update(intent.id,origin,entry => entry.accepted === accepted ? { ...entry,completion: 'error' } : entry); } catch { /* Closed/expired continuation. */ } });
    } else if (intent.completion === 'ready' && session.schoolId === accepted.result.school_id && session.memberships.some(row => row.school_id === accepted.result.school_id)) {
      try { capture()(); router.replace(accepted.result.href as never); intents.remove(intent.id); } catch { /* Only the current focused verified account can open its visit. */ }
    }
  },[intent,origin,session.status,session.user?.id,session.schoolId,session.scopeKey,live,focused,foreground,capture,router]);

  async function requestProof() {
    if (lock.current || !live || Date.now() < retryAt) return; const assertCurrent = capture();
    lock.current = true; setBusy(true); setError('');
    try { const input = visitPublicInput('proof',{ token: current().token,email }); const value = checkedVisitProof(await session.requestVisitOnboarding('proof',input,assertCurrent)); assertCurrent(); setProof(value); setCode(''); setRetryAt(Date.now()+value.retry_after_seconds*1000); setNow(Date.now()); }
    catch (cause) { try { assertCurrent(); setError(message(cause)); if (unavailableLink(cause)) intents.update(intent.id,origin,entry => ({ ...entry,preview:undefined })); } catch { /* No late proof on a changed form. */ } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function createAccount() {
    if (lock.current || !proof || accountUnknown || !live) return; const assertCurrent = capture(); let sent = false;
    lock.current = true; setBusy(true); setError('');
    try {
      if (password !== confirmation) throw new Error('The passwords do not match.');
      const input = visitPublicInput('account',{ token: current().token,email,challenge_id: proof.challenge_id,code: code.trim(),first_name: first,last_name: last,password });
      assertCurrent();
      checkedVisitAccount(await session.requestVisitOnboarding('account',input,assertCurrent,() => { sent=true;intents.update(intent.id,origin,entry => ({ ...entry,accountStatus:'dispatched' })); })); assertCurrent(); intents.update(intent.id,origin,entry => ({ ...entry,accountStatus:'complete' })); setPassword(''); setConfirmation(''); setCode(''); setFirst(''); setLast(''); setAccount(true);
    } catch (cause) { try { assertCurrent(); if (sent && uncertain(cause)) { setAccountUnknown(true); setPassword(''); setConfirmation(''); setCode(''); } else if (sent) intents.update(intent.id,origin,entry => { const {accountStatus,...rest}=entry;return rest; }); setError(message(cause)); } catch { /* No private result is delivered to another form; its dispatched marker remains. */ } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function signIn() { if (lock.current) return; const target = visitJoinReturnTarget(`/visit-join?continue=${intent.id}`); if (target) { setPassword(''); setConfirmation(''); setCode(''); router.push(`/login?next=${encodeURIComponent(target)}` as never); } }
  async function join() {
    if (lock.current || session.status !== 'authenticated' || !session.user || session.user.email_verified === false || !live || !intent.preview || intent.accepted) return;
    const assertCurrent = capture(), context = captureApiContext(), actor = session.user.id; lock.current = true; setBusy(true); setError('');
    try {
      let entry = current(); if (entry.command && entry.command.actorId !== actor) throw new Error('This retained request belongs to another account. Use the original account or reopen the original visit link.');
      if (!entry.command) entry = intents.update(intent.id,origin,value => ({ ...value,command: { actorId: actor,id: Crypto.randomUUID(),dispatched: false } }));
      const command = entry.command!; assertCurrent(); context.assertCurrent();
      intents.update(intent.id,origin,value => ({ ...value,command: { ...command,dispatched: true } }));
      const value = await apiFetch('/api/v1/auth/visit-onboarding/join/',{ method: 'POST',body: JSON.stringify({ token: entry.token,command_id: command.id }) });
      assertCurrent(); context.assertCurrent(); const result = checkedVisitJoin(value,intent.preview);
      intents.update(intent.id,origin,value => ({ ...value,accepted: { actorId: actor,result },completion: 'refresh' }));
    } catch (cause) { try { assertCurrent(); context.assertCurrent(); setError(message(cause)); if (unavailableLink(cause)) intents.update(intent.id,origin,entry => ({ ...entry,preview:undefined })); } catch { /* Original actor-bound command is retained without cross-account delivery. */ } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const verifyEmail = () => router.push(`/more/account/security?from=${encodeURIComponent(`/visit-join?continue=${intent.id}`)}` as never);
  const preview = intent.preview, remaining = Math.max(0,Math.ceil((retryAt-now)/1000)), wrongActor = !!intent.accepted && intent.accepted.actorId !== session.user?.id;
  return <Page title={preview?.visit.title ?? "Join this visit"} subtitle={preview?.campus.name} maxWidth={560}>
    {!live ? <><Notice message="Visit account creation and joining use your own normal Live account. Simulation and sample profiles cannot register real visitors." />{session.status === 'authenticated' && session.environment.mode === 'simulation' ? <Button title="Continue in Live" busy={busy} onPress={() => { if (lock.current) return; lock.current=true; setBusy(true); void session.selectEnvironment({ mode:'live' }).catch(cause => { if(mounted.current)setError(message(cause)); }).finally(() => { lock.current=false; if(mounted.current)setBusy(false); }); }} /> : <ControlButton title="Sign out of the sample profile" disabled={busy || session.status !== 'authenticated'} onPress={() => { void session.logout().catch(cause => { if(mounted.current)setError(message(cause)); }); }} />}{error ? <Notice tone="warning" message={error} /> : null}</> : session.status === 'loading' ? <Loading label="Confirming your account…" /> : session.status === 'error' ? <Empty title="Confirm your account" message={session.error ?? undefined} onRetry={() => void session.refresh()} /> : !preview ? error ? <><Empty title="Visit unavailable" message={error} onRetry={() => setPreviewAttempt(value => value+1)} /><ControlButton title={session.status === 'authenticated' ? 'Open ThatCampus' : 'Sign in'} onPress={() => router.replace(session.status === 'authenticated' ? '/today' : '/login')} /></> : <Loading label="Checking this visit link…" /> : <>
      <VisitDetailCard visit={{ ...preview.visit,place:{label:preview.visit.place_label} }} timezone={preview.timezone} /><VisitPlanNotice />
      {error ? <Notice tone="warning" message={error} /> : null}
      {session.status === 'authenticated' ? wrongActor ? <><Notice tone="warning" message="This retained registration belongs to another account. Sign out and use the original account, or reopen the original visit link to begin separately." /><ControlButton title="Sign out" onPress={() => { void session.logout().catch(cause => {if(mounted.current)setError(message(cause));}); }} /></> : session.user?.email_verified === false ? <><Notice message="Verify your account email through Account security before joining. This visit link grants no account identity." /><Button title="Verify account email" disabled={busy} onPress={verifyEmail} /></> : intent.accepted ? <><Notice tone="success" message="Your visit registration was confirmed. Opening the campus with your verified account…" />{intent.completion === 'error' || intent.completion === 'ready' && session.schoolId !== intent.accepted.result.school_id ? <ControlButton title="Retry account verification" disabled={busy} onPress={() => intents.update(intent.id,origin,value => ({ ...value,completion:'refresh' }))} /> : <Loading label="Confirming visit access…" />}</> : <><Notice message={`Continue as ${session.user?.email ?? session.user?.display_name ?? 'your signed-in account'}.`} /><Button title={intent.command?.dispatched ? 'Retry the same join request' : 'Join visit'} busy={busy} onPress={() => void join()} />{intent.command?.dispatched ? <Notice message="The original request is retained. Retry checks the same command and cannot create a second registration." /> : null}<ControlButton title="Use another account" disabled={busy} onPress={() => Alert.alert('Use another account?', 'Sign out before continuing with a different account.',[{ text:'Stay here',style:'cancel' },{ text:'Sign out',onPress:() => { void session.logout().catch(cause => {if(mounted.current)setError(message(cause));}); } }])} /></> : account || accountUnknown || intent.accountStatus ? <><Notice message={accountUnknown || intent.accountStatus === 'dispatched' ? 'The account result was not confirmed. It has not been repeated. Try normal sign-in, or use password reset if needed.' : 'Continue through normal sign-in. Any authenticator or recovery-code verification still applies.'} /><Button title="Sign in and continue" disabled={busy} onPress={signIn} /></> : <>
        <Button title="I already have an account · Sign in" disabled={busy} onPress={signIn} />
        <Section title="Create an account"><Field label="Your email" value={email} onChangeText={value => { setEmail(value); setProof(null); setCode(''); }} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" editable={!busy} maxLength={254} /><ControlButton title={remaining ? `Send another code in ${remaining}s` : proof ? 'Send another email code' : 'Send email verification code'} disabled={busy || !email.trim() || remaining>0} onPress={() => void requestProof()} />
          {proof?.delivery === 'unavailable' ? <Notice tone="warning" message="Email verification is unavailable. No account was created. Ask the campus contact to check delivery, or sign in to an existing verified account." /> : proof ? <><Notice message="Enter the code sent to your email. This proof is only for creating your own account; it does not give campus access." /><Field label="Email verification code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} editable={!busy} /><Field label="First name" value={first} onChangeText={setFirst} textContentType="givenName" autoComplete="given-name" maxLength={150} editable={!busy} /><Field label="Last name · optional" value={last} onChangeText={setLast} textContentType="familyName" autoComplete="family-name" maxLength={150} editable={!busy} /><Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" autoComplete="new-password" maxLength={128} editable={!busy} /><Notice message="Use 12–128 characters with upper- and lowercase letters, a number and a symbol. Avoid your name or email identifier." /><Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry textContentType="newPassword" autoComplete="new-password" maxLength={128} editable={!busy} /><Button title="Verify email and create account" busy={busy} disabled={!/^\d{6}$/.test(code) || !first.trim() || !password || !confirmation} onPress={() => void createAccount()} /></> : null}
        </Section>
      </>}
    </>}
  </Page>;
}
