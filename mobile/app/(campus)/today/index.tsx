import { WorkspaceScreen } from '../../../src/features/WorkspaceScreen';
import { useCampusNavigation } from '../../../src/ui/BackNavigation';
export default function Screen() { const { onNavigate } = useCampusNavigation('/today'); return <WorkspaceScreen view='today' onNavigate={onNavigate} />; }
