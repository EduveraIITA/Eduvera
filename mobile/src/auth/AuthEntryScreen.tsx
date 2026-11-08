import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from './SessionProvider';
import { LoginScreen } from './LoginScreen';
import { nativeAuthDestination } from './auth-entry';
import { Button, Empty, Loading, Page } from '../ui/components';

export function AuthEntryScreen({ mode = 'login' }: { mode?: 'login' | 'register' | 'recovery' }) {
  const session = useSession(), params = useLocalSearchParams<{ next?: string; account_link?: string }>(), router = useRouter();
  if (params.account_link === 'invalid') return <Page title="Open the original account email">
    <Empty title="This link is incomplete" message="Use the button in your ThatCampus email. If you need a new link, choose an option below." />
    <Button title="Go to Account security" onPress={() => router.replace('/account/security')} />
    <Button title="Request a new reset link" kind="secondary" onPress={() => router.replace('/forgot-password')} />
  </Page>;
  if (session.status === 'authenticated' && mode !== 'recovery') return <Redirect href={nativeAuthDestination(session, typeof params.next === 'string' ? params.next : undefined) as never} />;
  if (session.status === 'anonymous' || session.status === 'authenticated') return <LoginScreen initialMode={mode} />;
  return <Page title="ThatCampus">{session.status === 'loading' ? <Loading /> : <><Empty title="Confirm your account" message={session.error ?? undefined} onRetry={() => { void session.refresh(); }} /><Button title="Sign out" kind="secondary" onPress={() => { void session.logout(); }} /></>}</Page>;
}
