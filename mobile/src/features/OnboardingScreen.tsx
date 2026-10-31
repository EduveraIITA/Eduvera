import { useRouter } from 'expo-router';
import type { ProgressiveWorkspace } from '../../../packages/contracts/src/onboarding';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { Button, Empty, Loading, Notice, Page } from '../ui/components';
import { PurposeJourney } from './setup/PurposeJourney';
import { CapabilitySetup } from './setup/CapabilitySetup';

export type OnboardingProps = { href: string; onNavigate: (href: string) => void };
export function OnboardingScreen(props: OnboardingProps) {
  const session = useSession(), router = useRouter();
  const source = useApi<ProgressiveWorkspace>(session.environment.mode === 'live' || props.href.startsWith('/more/setup') ? '/api/v1/onboarding/workspace/' : null);
  if (session.companyOperator) return <Page title="Company workspace"><Button title="Open company console" onPress={() => router.replace('/company' as never)} /></Page>;
  if (props.href.startsWith('/onboarding') && session.environment.mode === 'simulation') return <Page title="Set up your campus in Live"><Notice message="Starting-point and account setup belong to Live. No campus will be created in this Simulation." /><Button title="Open Simulation controls" onPress={() => props.onNavigate('/more/simulation')} /></Page>;
  if (source.isPending) return <Page title="Campus setup"><Loading label="Finding your current starting points…" /></Page>;
  if (source.isError || !source.data) return <Page title="Campus setup"><Empty title="Setup could not load" message={source.error?.message} onRetry={() => { void source.refetch(); }} /></Page>;
  if (!source.data.catalogue.some(item => item.selection_kind === 'goal')) return <Page title="Your starting points couldn’t load"><Empty title="Try again to choose what you want to run" message="No new workspace has been created." onRetry={() => { void source.refetch(); }} /></Page>;
  const purpose = props.href.startsWith('/onboarding') || !source.data.workspace || source.data.status === 'purpose_required';
  return purpose ? <PurposeJourney key={source.data.workspace?.id ?? 'new'} {...props} data={source.data} /> : <CapabilitySetup {...props} workspace={source.data} onRefresh={() => { void source.refetch(); }} />;
}
