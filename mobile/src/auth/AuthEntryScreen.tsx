import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSession } from './SessionProvider';
import { LoginScreen } from './LoginScreen';
import { nativeAuthDestination } from './auth-entry';
import { Button, Empty, Loading, Page } from '../ui/components';

export function AuthEntryScreen({ mode = 'login' }: { mode?: 'login' | 'register' | 'recovery' }) {
  const session = useSession(), params = useLocalSearchParams<{ next?: string }>();
  if (session.status === 'authenticated') return <Redirect href={nativeAuthDestination(session, typeof params.next === 'string' ? params.next : undefined) as never} />;
  if (session.status === 'anonymous') return <LoginScreen initialMode={mode} />;
  return <Page title="ThatCampus">{session.status === 'loading' ? <Loading /> : <><Empty title="Confirm your account" message={session.error ?? undefined} onRetry={() => { void session.refresh(); }} /><Button title="Sign out" kind="secondary" onPress={() => { void session.logout(); }} /></>}</Page>;
}
