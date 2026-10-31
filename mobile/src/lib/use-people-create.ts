import { useOperationContext } from './use-operation-context';
import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { getApiOrigin } from './api';
import { useApi } from './query';
import { useNativePendingAction } from './native-pending-action';
export interface CreatedCampusPerson { id: string; label: string; revision: number; affiliations?: string[] }
export function usePeopleCreate(href: string, schoolId: string) {
  const { user, environment, scopeKey } = useSession(), cache = useQueryClient(), created = useRef<CreatedCampusPerson | null>(null);
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/people`;
  const directory = useApi<{ capabilities?: { can_manage_enrollment?: boolean } }>(`${root}/participants?page=1`);
  const writer = useNativePendingAction<CreatedCampusPerson>({captureOperation: useOperationContext(JSON.stringify([href, `${root}/participants?page=1`])),  scope: { actorId: user!.id, schoolId, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }, domain: 'people', ownerHref: href, refreshPath: `${root}/participants?page=1`,
    resolveRefreshPath: (value, action) => { if (action.endpoint !== `${root}/participants`) return action.refreshPath; const id = (value as { id?: unknown } | null)?.id; if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('The created person could not be identified. The exact request remains retained.'); return `${root}/participants/${id}`; },
    accepted: async (value, assertCurrent, action) => { if (action.endpoint !== `${root}/participants`) throw new Error('Finish the original People action in its owning screen.'); const id = action.refreshPath.split('/').at(-1); if (!value || value.id !== id || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.label !== 'string') throw new Error('The exact saved person could not be verified.'); assertCurrent(); created.current = { id: value.id, label: value.label, revision: value.revision, affiliations: value.affiliations }; await cache.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' }); assertCurrent(); } });
  return { root, writer, directory, created };
}
