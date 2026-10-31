import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../src/auth/SessionProvider';
import { OnboardingScreen } from '../../src/features/OnboardingScreen';
import { useCampusNavigation } from '../../src/ui/BackNavigation';
import { Loading, Page } from '../../src/ui/components';
export default function StartingPoints() {
  const session = useSession(), params = useLocalSearchParams(), query = new URLSearchParams();
  for (const [key,value] of Object.entries(params)) if (typeof value === 'string') query.set(key,value);
  const href = `/onboarding/start${query.size ? `?${query}` : ''}`, { onNavigate } = useCampusNavigation(href);
  if (session.status === 'anonymous') return <Redirect href="/login?next=%2Fonboarding%2Fstart" />;
  if (session.status !== 'authenticated') return <Page title="Confirming your account"><Loading /></Page>;
  return <><Stack.Screen options={{ headerShown: true, title: 'Starting points' }} /><OnboardingScreen href={href} onNavigate={onNavigate} /></>;
}
