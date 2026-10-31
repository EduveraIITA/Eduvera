import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from './SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { useApi } from '../lib/query';
import { Alert } from '../ui/Alert';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { useTheme } from '../ui/theme';
import { accountReturnTitle, safeAccountReturnTarget } from './account-return';
import { nativeAuthDestination } from './auth-entry';
import { visitJoinReturnTarget } from './visit-join-policy';
import { AuthenticatorQr } from './AuthenticatorQr';

type Enrollment = { secret: string; otpauth_uri: string };
export function AccountSecurityScreen({ href }: { href: string }) {
  const session = useSession(), { colors } = useTheme(), navigation = useCampusNavigation(href), router = useRouter();
  const params = new URL(href, 'https://thatcampus.invalid').searchParams;
  const origin = safeAccountReturnTarget(params.get('from')) ?? safeAccountReturnTarget(params.get('next'));
  const onboarding = !visitJoinReturnTarget(origin) && (origin?.split('?')[0] === '/onboarding/start' || ['workspace_required', 'purpose_required'].includes(session.onboarding?.status ?? ''));
  const back = origin && !origin.split('?')[0]?.endsWith('/account/security') ? origin : nativeAuthDestination({ ...session, user: session.user ? { ...session.user, email_verified: true } : null });
  const verified = session.user?.email_verified === true, writable = session.status === 'authenticated' && !session.publicDemo && session.environment.mode === 'live';
  const mfa = useApi<{ status: string; recovery_codes_remaining: number }>(!onboarding ? '/api/v1/auth/mfa/' : null);
  const sessions = useApi<{ results: Array<{ current: boolean; user_agent: string; last_seen_at: string; expires_at: string }> }>(!onboarding ? '/api/v1/auth/sessions/' : null);
  const [verification, setVerification] = useState(() => params.get('token') ?? ''), [code, setCode] = useState('');
  const [setup, setSetup] = useState<Enrollment | null>(null), [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  useEffect(() => { if (mfa.data?.status === 'active') { setSetup(null); setCode(''); } }, [mfa.data?.status]);
  useScreenExitGuard({ blocked: busy, dirty: !!setup || codes.length > 0, title: codes.length ? 'Have you saved your recovery codes?' : 'Leave authenticator setup?',
    message: codes.length ? 'These recovery codes will not be shown again. Save them somewhere private before leaving.' : 'The setup key is kept only on this screen. You can request a new setup later.',
    onLeave: () => { setSetup(null); setCode(''); setCodes([]); } });
  async function perform(work: () => Promise<void>, uncertainWrite = false) {
    if (!writable || busy || uncertain) return;
    setBusy(true); setError(''); setMessage('');
    try { await work(); }
    catch (cause) {
      if (uncertainWrite && (!(cause instanceof ApiError) || cause.status >= 500 || cause.status === 408)) setUncertain(true);
      setError(cause instanceof Error ? cause.message : 'The security action could not be confirmed.');
    } finally { setBusy(false); }
  }
  function continueTo(target: string) {
    if (target.startsWith('/onboarding/') || visitJoinReturnTarget(target)) router.replace(target as never);
    else navigation.complete(target);
  }
  return <Page title={onboarding ? verified ? 'Email confirmed' : 'Confirm your email' : 'Account security'} subtitle={onboarding ? verified ? `${session.user?.email ?? 'Your email'} is ready. Choose the first campus task you want to run.` : 'Confirm your email before choosing your first campus task.' : undefined}
    refreshing={mfa.isRefetching || sessions.isRefetching} onRefresh={busy ? undefined : () => { void session.refresh(); if (!onboarding) { void mfa.refetch(); void sessions.refetch(); } }}>
    <ScreenBack fallbackHref={back} title={accountReturnTitle(back)} disabled={busy} />
    {error ? <Notice tone="danger" message={error} /> : null}{message ? <Notice message={message} tone="success" /> : null}
    {session.publicDemo ? <Notice message="This public demo is read-only. Sign in with your own account to manage security." /> : session.environment.mode !== 'live' ? <><Notice message="Account security is managed in Live. Return to Live before changing your account." /><Button title="Open Simulation controls" kind="secondary" onPress={() => navigation.onNavigate('/more/simulation')} /></> : null}
    {uncertain ? <Notice tone="warning" message="The result is unconfirmed. Security actions are paused on this screen. Check your account’s current status before starting another setup; the action has not been repeated." /> : null}
    <Section title="Email"><Row title={session.user?.email ?? 'Your email'} status={verified ? 'Verified' : 'Not verified'} />{!verified ? <>
      <Button title="Send verification email" busy={busy} disabled={!writable || uncertain} onPress={() => { void perform(async () => {
        const context = captureApiContext();
        const response = await apiFetch<{ delivery: string; development_token?: string }>('/api/v1/auth/email-verification/request/', { method: 'POST', body: '{}' }); context.assertCurrent();
        if (response.development_token) setVerification(response.development_token);
        setMessage(response.delivery === 'email_accepted' ? 'Verification email accepted by the mail server. Check your inbox.' : response.delivery === 'manual' ? 'Development verification token is ready below.' : 'Email delivery could not be confirmed. Try again shortly.');
      }); }} />
      <Field label="Verification token" value={verification} onChangeText={setVerification} autoCapitalize="none" autoCorrect={false} textContentType="oneTimeCode" />
      <Button title="Confirm email" busy={busy} disabled={!writable || uncertain || verification.trim().length < 32} onPress={() => { void perform(async () => {
        const context = captureApiContext(); await apiFetch('/api/v1/auth/email-verification/confirm/', { method: 'POST', body: JSON.stringify({ token: verification.trim() }) }); context.assertCurrent();
        setVerification(''); setMessage('Email verified.'); await session.refresh();
      }); }} />
    </> : null}</Section>
    {onboarding ? verified ? <><Button title="Continue" disabled={busy} onPress={() => continueTo('/onboarding/start')} /><Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>You can add an authenticator later from Account security.</Text></> : null : <>
      <Section title="Two-step verification">{mfa.isPending ? <Loading /> : mfa.isError ? <Empty title="Security status unavailable" message={mfa.error.message} onRetry={() => { void mfa.refetch(); }} /> : <Row title={mfa.data?.status === 'active' ? 'Authenticator active' : 'Add an authenticator'} detail={mfa.data?.status === 'active' ? `${mfa.data.recovery_codes_remaining} recovery codes remain.` : 'Optional extra protection with a code from your authenticator.'} icon="security" />}
        {!verified ? <Notice message="Verify your email before setting up an authenticator." /> : null}
        {mfa.data && mfa.data.status !== 'active' && !setup ? <Button title="Set up authenticator" busy={busy} disabled={!verified || !writable || uncertain || codes.length > 0} onPress={() => { void perform(async () => {
          const context = captureApiContext(); const response = await apiFetch<Enrollment>('/api/v1/auth/mfa/enroll/', { method: 'POST', body: '{}' }); context.assertCurrent();
          if (!response.secret || !response.otpauth_uri || new URL(response.otpauth_uri).searchParams.get('secret') !== response.secret) throw new Error('The server did not confirm a matching authenticator setup key.'); setSetup(response); setCode('');
        }, true); }} /> : null}
        {setup && mfa.data?.status !== 'active' ? <><AuthenticatorQr uri={setup.otpauth_uri} /><Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>Scan the QR code with an authenticator on another device, or enter this setup key in your authenticator.</Text><Text selectable style={{ color: colors.ink, fontFamily: 'monospace', fontSize: 16 }}>{setup.secret}</Text>
          <Field label="Six-digit authenticator code" value={code} onChangeText={setCode} textContentType="oneTimeCode" keyboardType="number-pad" maxLength={6} />
          <Button title="Activate two-step verification" busy={busy} disabled={!writable || uncertain || !/^\d{6}$/.test(code.trim())} onPress={() => { void perform(async () => {
            const context = captureApiContext(); const result = await apiFetch<{ active: boolean; recovery_codes: string[] }>('/api/v1/auth/mfa/confirm/', { method: 'POST', body: JSON.stringify({ code: code.trim() }) }); context.assertCurrent();
            if (result.active !== true || !Array.isArray(result.recovery_codes) || !result.recovery_codes.length) throw new Error('Activation and recovery codes were not confirmed. Check your security status.');
            setCodes(result.recovery_codes); setSetup(null); setCode(''); setMessage('Two-step verification active.'); await mfa.refetch();
          }, true); }} />
          <Button title="Cancel setup on this screen" kind="secondary" disabled={busy} onPress={() => { setSetup(null); setCode(''); }} />
        </> : null}
        {codes.length ? <><Notice tone="warning" message="Save these recovery codes somewhere private. Each works once and they will not be shown again." /><Text selectable style={{ fontFamily: 'monospace', fontSize: 16, lineHeight: 28, color: colors.ink }}>{codes.join('\n')}</Text><Button title="I have saved my codes" kind="secondary" onPress={() => setCodes([])} /></> : null}
      </Section>
      <Section title="Signed-in sessions">{sessions.isPending ? <Loading /> : sessions.isError ? <Empty title="Sessions unavailable" message={sessions.error.message} onRetry={() => { void sessions.refetch(); }} /> : sessions.data?.results.map((item, index) => <Row key={`${item.last_seen_at}:${index}`} title={item.current ? 'This session' : 'Another signed-in session'} detail={`${item.user_agent || 'Device information unavailable'}\nLast active ${new Date(item.last_seen_at).toLocaleString()}`} status={item.current ? 'Current' : undefined} />)}
        <Button title="Sign out other sessions" kind="danger" busy={busy} disabled={!writable || uncertain} onPress={() => Alert.alert('Sign out other sessions?', 'Your current session will stay signed in.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out others', style: 'destructive', onPress: () => { void perform(async () => {
          const context = captureApiContext(); await apiFetch('/api/v1/auth/sessions/revoke-others/', { method: 'POST', body: '{}' }); context.assertCurrent(); await sessions.refetch(); setMessage('Other sessions have been signed out.');
        }, true); } }])} />
      </Section>
      {verified ? <Button title="Continue" disabled={busy || !!setup || codes.length > 0} onPress={() => continueTo(back)} /> : null}
    </>}
  </Page>;
}
