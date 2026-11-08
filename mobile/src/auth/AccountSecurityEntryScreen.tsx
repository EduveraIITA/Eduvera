import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from './SessionProvider';
import { accountSecurityEntryHref } from './account-recovery';
import { Button, Empty, Loading, Page } from '../ui/components';
import { useAccountMailEntry } from './use-account-mail-entry';

/** Existing verification email URLs enter the one canonical security owner.
 * Authentication is confirmed before the campus shell receives the proof. */
export function AccountSecurityEntryScreen() {
  const session = useSession(), params = useLocalSearchParams(), entry = useAccountMailEntry('email_verification', params);
  const router = useRouter();
  const target = entry.invalid ? null : accountSecurityEntryHref({ ...params, token: undefined, ...(entry.continuation ? {continue: entry.continuation} : {}) });
  if (!entry.ready) return <Page title="Account security"><Loading label="Opening your secure link…" /></Page>;
  if (!target) return <Page title="Account security"><Empty title="This verification link is incomplete" message="Use the Verify email button in your email. If the link no longer works, request a new one in Account security." /><Button title="Go to Account security" onPress={() => router.replace(session.status === 'authenticated' ? '/more/account/security' : '/login?next=%2Fmore%2Faccount%2Fsecurity')} /></Page>;
  if (session.status === 'anonymous') return <Redirect href={`/login?next=${encodeURIComponent(target)}` as never} />;
  if (session.status === 'authenticated') return <Redirect href={target as never} />;
  return <Page title="Account security">{session.status === 'loading' ? <Loading label="Confirming your account…" /> : <><Empty title="Confirm your account" message={session.error ?? undefined} onRetry={() => { void session.refresh(); }} /><Button title="Sign out" kind="secondary" onPress={() => { void session.logout(); }} /></>}</Page>;
}
