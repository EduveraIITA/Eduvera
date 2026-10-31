import { Redirect } from 'expo-router';
import { useSession } from '../src/auth/SessionProvider';
import { nativeAuthDestination } from '../src/auth/auth-entry';
import { Loading, Page } from '../src/ui/components';
export default function WorkspaceEntry() { const session = useSession(); return session.status === 'loading' ? <Page title="Opening your workspace"><Loading /></Page> : <Redirect href={nativeAuthDestination(session) as never} />; }
