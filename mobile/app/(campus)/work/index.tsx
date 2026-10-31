import { useLocalSearchParams } from 'expo-router';
import { WorkspaceScreen } from '../../../src/features/WorkspaceScreen';
import { useCampusNavigation } from '../../../src/ui/BackNavigation';
import { workspaceWorkRecoveryId } from '../../../src/lib/workspace-work-recovery';

export default function Screen() {
  const { onNavigate } = useCampusNavigation();
  const { item, unavailable } = useLocalSearchParams<{ item?: string | string[]; unavailable?: string | string[] }>();
  return <WorkspaceScreen view="work" selectedWorkId={workspaceWorkRecoveryId(item, unavailable)} onNavigate={onNavigate} />;
}
