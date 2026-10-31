import { Fragment, useMemo, type ReactNode } from 'react';
import type { WorkspaceManifest, WorkspaceMoreItem } from '../../../../packages/contracts/src/workspace';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../../auth/SessionProvider';
import { useApi } from '../../lib/query';
import { Empty, Loading, Page } from '../../ui/components';

export interface MoreToolContext { manifest: WorkspaceManifest; item: WorkspaceMoreItem; refreshAccess: () => void }
export function MoreToolBoundary({ itemKey, title, children }: { itemKey: string; title: string; children: (context: MoreToolContext) => ReactNode }) {
  const { user, schoolId, environment, scopeKey } = useSession();
  const query = useApi<unknown>(user && schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => {
    try {
      if (!query.data || !user || !schoolId) return null;
      const manifest = normalizeWorkspaceManifest(query.data);
      assertWorkspaceManifestContext(manifest, { actorUserId: user.id, institutionId: schoolId, environment });
      const items = manifest.more.groups?.length ? manifest.more.groups.flatMap(group => group.items) : [...manifest.more.setup, ...manifest.more.other ?? []];
      const item = items.find(candidate => candidate.key === itemKey);
      return item ? { manifest, item } : null;
    } catch { return null; }
  }, [query.data, user?.id, schoolId, environment, itemKey]);
  const refreshAccess = () => { void query.refetch(); };
  if (environment.unavailable) return <Page title={title}><Empty title="This Simulation is unavailable" message="Recover your selected world or return to Live in Simulation controls." /></Page>;
  if (query.isPending) return <Page title={title}><Loading /></Page>;
  if (query.isError || !resolved) return <Page title={title}><Empty title={`${title} access could not be confirmed`} message={query.error?.message ?? 'This tool is not available with your current campus access.'} onRetry={refreshAccess} /></Page>;
  return <Fragment key={`${scopeKey}:${itemKey}`}>{children({ ...resolved, refreshAccess })}</Fragment>;
}
