import { useMemo } from 'react';
import { normalizeWorkspaceManifest, assertWorkspaceManifestContext } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { peopleSetupDestinations } from '../lib/people-access';
import { ScreenBack } from '../ui/BackNavigation';
import { Empty, ListGroup, Loading, Notice, Page, Row, Section } from '../ui/components';
export function PeopleSetupScreen({ onNavigate }: { href: string; onNavigate(href: string): void }) {
  const session = useSession(), query = useApi<unknown>(session.schoolId ? '/api/v1/workspace' : null);
  const rows = useMemo(() => { try { if (!query.data || !session.user || !session.schoolId) return null; const manifest = assertWorkspaceManifestContext(normalizeWorkspaceManifest(query.data), { actorUserId: session.user.id, institutionId: session.schoolId, environment: session.environment }); return peopleSetupDestinations(manifest); } catch { return null; } }, [query.data, session.user?.id, session.schoolId, session.environment]);
  return <Page title="People setup" subtitle="Connect people to the work they do." refreshing={query.isRefetching} onRefresh={() => void query.refetch()}><ScreenBack title="Campus setup" fallbackHref="/more/setup" />
    {query.isPending ? <Loading /> : query.isError || !rows ? <Empty title="People setup access could not be confirmed" message={query.error?.message} onRetry={() => void query.refetch()} /> : <><Notice message="Create a person once. Records, responsibilities and account access remain distinct. Use the part needed for the next real operation." /><Section title="People, responsibility and access"><ListGroup>{rows.map((row, index) => <Row key={row.key} variant="plain" separator={index > 0} title={row.label} detail={row.detail} icon={row.icon} onPress={() => onNavigate(row.href)} />)}</ListGroup></Section><Notice message="A title or reporting line never grants access. Every action uses its effective responsibility or relationship in the exact scope." /></>}
  </Page>;
}
