import { WorkspaceScreen } from '../../../src/features/WorkspaceScreen';
import { useCampusNavigation } from '../../../src/ui/BackNavigation';
export default function Screen() { const { onNavigate } = useCampusNavigation('/more'); return <WorkspaceScreen view='more' onNavigate={onNavigate} />; }
