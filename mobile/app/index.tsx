import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../src/auth/SessionProvider';
import { LoginScreen } from '../src/auth/LoginScreen';
import { Button, Empty, Loading, Page } from '../src/ui/components';
import { useTheme } from '../src/ui/theme';
import { nativeAuthDestination } from '../src/auth/auth-entry';

export default function Entry() {
  const session = useSession(); const { colors } = useTheme();
  if (session.status === 'authenticated') return <Redirect href={nativeAuthDestination(session) as never} />;
  if (session.status === 'anonymous') return <LoginScreen />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><Page title="ThatCampus">{session.status === 'loading' ? <Loading /> : <><Empty title="Reconnect to your campus" message={session.error ?? 'The server could not be reached.'} onRetry={() => { void session.refresh(); }} /><Button title="Sign out on this device" kind="secondary" onPress={() => { void session.logout().catch(() => {}); }} /></>}</Page></SafeAreaView>;
}
