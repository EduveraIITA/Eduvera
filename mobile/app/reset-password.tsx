import { useLocalSearchParams, useRouter } from 'expo-router';
import { LoginScreen } from '../src/auth/LoginScreen';
import { useAccountMailEntry } from '../src/auth/use-account-mail-entry';
import { Button, Empty, Loading, Page } from '../src/ui/components';
export default function PasswordReset() {
  const entry = useAccountMailEntry('password_reset', useLocalSearchParams());
  const router = useRouter();
  if (!entry.ready) return <Page title="Reset password"><Loading label="Opening your secure link…" /></Page>;
  if (entry.invalid) return <Page title="Reset password"><Empty title="Open the original reset email" message="This link is incomplete or is no longer held on this device. Open the email again, or request a new reset link." /><Button title="Request a new reset link" onPress={() => router.replace('/forgot-password')} /></Page>;
  return <LoginScreen key={entry.continuation ?? 'reset'} initialMode="reset" {...(entry.token ? {resetToken: entry.token} : {})} />;
}
