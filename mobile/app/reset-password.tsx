import { useLocalSearchParams, useRouter } from 'expo-router';
import { LoginScreen } from '../src/auth/LoginScreen';
import { useAccountMailEntry } from '../src/auth/use-account-mail-entry';
import { Button, Empty, Loading, Page } from '../src/ui/components';
export default function PasswordReset() {
  const entry = useAccountMailEntry('password_reset', useLocalSearchParams());
  const router = useRouter();
  if (!entry.ready) return <Page title="Reset password"><Loading label="Opening your secure link…" /></Page>;
  if (entry.invalid || !entry.token) return <Page title="Reset password"><Empty title="Open the original reset email" message="Use the Reset password button in your email. If the link no longer works, request a new one." /><Button title="Request a new reset link" onPress={() => router.replace('/forgot-password')} /></Page>;
  return <LoginScreen key={entry.continuation ?? 'reset'} resetToken={entry.token} resetContinuation={entry.continuation} />;
}
