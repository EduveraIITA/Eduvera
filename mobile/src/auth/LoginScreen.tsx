import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from './SessionProvider';
import { Button, Field, Notice } from '../ui/components';
import { useTheme } from '../ui/theme';
import { getApiOrigin, setApiOrigin } from '../lib/api';
import { ApiError } from '../lib/api-client';
import { confirmPasswordReset, requestPasswordReset } from './account-ceremonies';
import { accountActionToken, confirmedPasswordReset, passwordResetInput, passwordResetRequestFeedback } from './account-recovery';
import { createPublicFormLease, type PublicFormState } from './public-form-operation';
import { safeAccountReturnTarget } from './account-return';
import { Glass } from '../ui/Glass';
import { useIsFocused, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { GoogleSignInButton } from './GoogleSignInButton';

type Mode = 'login' | 'register' | 'recovery' | 'reset';
export function LoginScreen({ resetToken, initialMode = 'login' }: { resetToken?: string; initialMode?: Mode }) {
  const session = useSession(), { login, googleLogin, register, completeMfa, error: sessionError, logout } = session;
  const { colors, dark } = useTheme();
  const router = useRouter();
  const focused = useIsFocused(), pathname = usePathname(), params = useLocalSearchParams<{ next?: string; google_return?: string }>();
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : initialMode);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState(''), [resetValue, setResetValue] = useState(resetToken ?? ''), [recoveryUnknown, setRecoveryUnknown] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'warning' | 'danger'>('danger');
  const [serverOpen, setServerOpen] = useState(false);
  const [server, setServer] = useState(getApiOrigin());
  const mounted = useRef(true), running = useRef(false);
  const presentation = useRef({ focused,mode,challenge,origin: getApiOrigin(),scope: session.scopeKey,pathname,next: params.next });
  presentation.current = { focused,mode,challenge,origin: getApiOrigin(),scope: session.scopeKey,pathname,next: params.next };
  const recoveryIdentity = JSON.stringify([getApiOrigin(),session.scopeKey,session.status,pathname,params.next,mode,resetToken,resetValue,identifier,password,confirmation]);
  const recoveryState = useRef<PublicFormState>({ identity: recoveryIdentity,mounted: true,focused,foreground: AppState.currentState === 'active' });
  recoveryState.current = { identity: recoveryIdentity,mounted: mounted.current,focused,foreground: AppState.currentState === 'active' };
  const recoveryLease = useRef(createPublicFormLease(recoveryState.current)); recoveryLease.current.update(recoveryState.current);
  useEffect(() => {
    mounted.current = true; recoveryState.current = { ...recoveryState.current,mounted: true }; recoveryLease.current.update(recoveryState.current);
    const listener = AppState.addEventListener('change', state => { recoveryState.current = { ...recoveryState.current,foreground: state === 'active' }; recoveryLease.current.update(recoveryState.current); });
    return () => { mounted.current = false; recoveryState.current = { ...recoveryState.current,mounted: false }; recoveryLease.current.update(recoveryState.current); listener.remove(); };
  },[]);
  useEffect(() => { setResetValue(resetToken ?? ''); setConfirmation(''); setPassword(''); setRecoveryUnknown(false); setResetDone(false); },[resetToken]);
  useEffect(() => { if (params.google_return === 'expired') { setMessage('This Google sign-in return expired or belongs to another attempt. Start sign-in again.'); router.setParams({ google_return: undefined }); } },[params.google_return,router]);
  const title = resetDone ? 'Password updated' : challenge ? 'Verify your sign-in' : mode === 'register' ? 'Create your account' : mode === 'recovery' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Welcome back';
  async function submit() {
    if (running.current || !focused || recoveryUnknown && (mode === 'recovery' || mode === 'reset')) return; running.current = true;
    setMessage(''); setMessageTone('danger'); setBusy(true);
    let assertRecovery: (() => void) | undefined, recoverySent = false;
    const sourceIdentity = recoveryIdentity;
    try {
      if (challenge) await completeMfa(challenge, code.trim());
      else if (mode === 'register') await register(identifier, password);
      else if (mode === 'recovery') {
        assertRecovery = recoveryLease.current.capture();
        const response = await requestPasswordReset(identifier, { assertCurrent: assertRecovery }); assertRecovery();
        const feedback = passwordResetRequestFeedback(response); setMessageTone(feedback.tone); setMessage(feedback.message);
      } else if (mode === 'reset') {
        const input = passwordResetInput(resetValue,password,confirmation);
        assertRecovery = recoveryLease.current.capture();
        const result = await confirmPasswordReset(input.token,input.password,{ assertCurrent: assertRecovery,onDispatch: () => { recoverySent = true; } }); assertRecovery(); confirmedPasswordReset(result);
        setResetDone(true); setPassword(''); setConfirmation(''); setResetValue(''); setMessageTone('success'); setMessage('Your password has been reset. Previous sessions are signed out. Sign in to continue.');
      } else setChallenge(await login(identifier, password));
    } catch (error) {
      if (recoverySent && recoveryState.current.identity === sourceIdentity && (!(error instanceof ApiError) || error.status >= 500 || error.status === 408)) setRecoveryUnknown(true);
      try { assertRecovery?.(); if (mounted.current) setMessage(error instanceof Error ? error.message : 'We could not complete this request.'); } catch { /* A departed account/form never receives a proof result. */ }
    }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function google(credential?: string) {
    if (running.current || !focused || challenge || !['login','register'].includes(mode)) return;
    running.current = true; setMessage(''); setMessageTone('danger'); setBusy(true);
    const source = { ...presentation.current };
    const assertCurrent = () => {
      const current = presentation.current;
      if (!mounted.current || !current.focused || current.origin !== source.origin || current.scope !== source.scope || current.pathname !== source.pathname || current.next !== source.next || current.mode !== source.mode || current.challenge !== source.challenge) throw new Error('Your sign-in screen changed. Start Google sign-in again.');
    };
    try {
      assertCurrent(); const result = await googleLogin(credential,{ returnHref: pathname,assertCurrent });
      if (mounted.current) setChallenge(result);
    } catch (cause) { if (mounted.current && presentation.current.focused) setMessage(cause instanceof Error ? cause.message : 'Google sign-in could not be confirmed. Start again.'); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function changeMode(next: Mode) { if (running.current) return; setMode(next); setMessage(''); setPassword(''); setConfirmation(''); setResetValue(''); setRecoveryUnknown(false); setResetDone(false); setChallenge(null); }
  function signInAfterReset() {
    if (running.current) return;
    const next = safeAccountReturnTarget(params.next);
    // Reset may have revoked a previously signed-in session. Start the owning
    // recheck before entering AuthEntryScreen; its loading/error states prevent
    // a stale local account from skipping the canonical sign-in boundary.
    void session.refresh().catch(() => {});
    router.replace((next ? `/login?next=${encodeURIComponent(next)}` : '/login') as never);
  }
  // This screen's outer safe area owns the system edges. Let the native scroll
  // view measure keyboard overlap in window coordinates; a KeyboardAvoidingView
  // inside the padded safe area otherwise misses that frame's top offset.
  return <SafeAreaView style={{ flex: 1, minHeight: 0, backgroundColor: colors.canvas }}>
    <ScrollView style={styles.viewport} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.scroll}>
      <View style={styles.form}>
        <Image source={dark ? require('../../assets/wordmark-dark.png') : require('../../assets/wordmark-light.png')} accessibilityLabel="ThatCampus" style={styles.wordmark} resizeMode="contain" />
        <Text style={[styles.tagline, { color: colors.muted }]}>Not just any campus. That campus.</Text>
        <View style={{ height: 32 }} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.muted }]}>{resetDone ? 'Continue through secure sign-in with your new password.' : challenge ? 'Enter the code from your authenticator or a recovery code.' : mode === 'register' ? 'Start with what your campus needs today.' : mode === 'recovery' ? 'Request a secure reset link for your account email.' : mode === 'reset' ? 'Use a strong password for your campus account.' : 'Your campus, your people, your day.'}</Text>
        {resetDone ? null : challenge ? <Field label="Verification or recovery code" value={code} onChangeText={setCode} textContentType="oneTimeCode" /> : <>
          {mode !== 'reset' ? <Field label={mode === 'login' ? 'Email or username' : 'Email'} value={identifier} onChangeText={setIdentifier} keyboardType="email-address" textContentType="username" autoComplete="username" /> : null}
          {mode === 'reset' ? <Field label="Reset token" value={resetValue} onChangeText={setResetValue} autoCapitalize="none" autoCorrect={false} autoComplete="off" maxLength={256} editable={!busy && !recoveryUnknown} /> : null}
          {mode !== 'recovery' ? <Field label={mode === 'reset' ? 'New password' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry textContentType={mode === 'login' ? 'password' : 'newPassword'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} editable={!busy && !recoveryUnknown} maxLength={128} onSubmitEditing={() => { if (mode !== 'reset' && identifier && password) void submit(); }} /> : null}
          {mode === 'reset' ? <><Text style={{ color: colors.muted,fontSize: 14,lineHeight: 21 }}>Use at least 12 characters with upper- and lowercase letters, a number and a symbol. Resetting signs out previous sessions.</Text><Field label="Confirm password" value={confirmation} onChangeText={setConfirmation} secureTextEntry textContentType="newPassword" autoComplete="new-password" maxLength={128} editable={!busy && !recoveryUnknown} onSubmitEditing={() => { if (accountActionToken(resetValue) && password && confirmation) void submit(); }} /></> : null}
        </>}
        {sessionError ? <><Notice message={sessionError} tone="warning" /><Button title="Retry sign-out" kind="secondary" busy={busy} onPress={() => { setBusy(true); void logout().finally(() => setBusy(false)); }} /></> : null}
        {message ? <Notice message={message} tone={messageTone} /> : null}
        {recoveryUnknown ? <Notice tone="warning" message="The reset result is unconfirmed. This request has not been repeated. Try signing in with the new password, or request a fresh reset link." /> : null}
        {resetDone ? <Button title="Sign in" onPress={signInAfterReset} /> : <Button title={challenge ? 'Verify and sign in' : mode === 'register' ? 'Create account' : mode === 'recovery' ? 'Send reset instructions' : mode === 'reset' ? 'Save new password' : 'Sign in'} onPress={() => { void submit(); }} busy={busy} disabled={recoveryUnknown || (challenge ? !code.trim() : mode === 'reset' ? !accountActionToken(resetValue) || !password || !confirmation : !identifier.trim() || (mode !== 'recovery' && !password))} />}
        {mode === 'reset' && !resetDone ? <Pressable accessibilityRole="button" disabled={busy} style={styles.link} onPress={() => router.replace('/forgot-password')}><Text style={{ color: colors.link,fontSize: 15 }}>Request a new reset link</Text></Pressable> : null}
        {!challenge && (mode === 'login' || mode === 'register') ? <GoogleSignInButton disabled={busy} onCredential={google} /> : null}
        {mode === 'login' && !challenge ? <Pressable accessibilityRole="button" style={styles.link} onPress={() => changeMode('recovery')}><Text style={{ color: colors.link, fontSize: 15 }}>Forgot your password?</Text></Pressable> : null}
        <View style={{ height: 16 }} />
        {!resetDone ? <Glass style={styles.switcher}><Pressable accessibilityRole="button" style={styles.link} onPress={() => mode === 'reset' ? signInAfterReset() : changeMode(mode === 'login' && !challenge ? 'register' : 'login')}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>{mode === 'login' && !challenge ? 'New to ThatCampus? Create an account' : 'Back to sign in'}</Text></Pressable></Glass> : null}
        {!challenge && mode === 'login' ? <><Pressable accessibilityRole="button" disabled={busy} style={styles.link} onPress={() => router.push('/join')}><Text style={{color:colors.link,fontSize:15}}>Have a campus invitation?</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} style={styles.link} onPress={() => router.push('/demo')}><Text style={{color:colors.link,fontSize:15}}>Explore the sample campus</Text></Pressable></> : null}
        {__DEV__ ? <><Pressable accessibilityRole="button" disabled={busy} style={styles.link} onPress={() => setServerOpen(!serverOpen)}><Text style={{ color: colors.muted, fontSize: 13 }}>Development server</Text></Pressable>{serverOpen ? <><Field label="API server address" value={server} onChangeText={setServer} keyboardType="url" editable={!busy} /><Button title="Use this server" kind="secondary" disabled={busy} onPress={() => { try { setApiOrigin(server); setServerOpen(false); setMessageTone('success'); setMessage('Server address updated.'); } catch (error) { setMessageTone('danger'); setMessage(String(error)); } }} /></> : null}</> : null}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ viewport: { flex: 1, minHeight: 0 }, scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingVertical: 48 }, form: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 12 }, wordmark: { width: 224, height: 52, alignSelf: 'center' }, tagline: { fontSize: 14, textAlign: 'center', marginTop: 4 }, title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.8 }, description: { fontSize: 16, lineHeight: 24, marginBottom: 12 }, link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 8 }, switcher: { borderRadius: 24, padding: 8 } });
