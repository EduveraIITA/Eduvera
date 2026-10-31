import { useOperationContext } from './use-operation-context';
import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { getApiOrigin } from './api';
import { useNativePendingAction, type NativePendingInput } from './native-pending-action';
import { assertEventRead, eventActionRefreshPath } from './event-policy';

export function useEventWriter(schoolId: string, ownerHref: string, refreshPath: string, refreshed?: (assertCurrent: () => void) => Promise<unknown>) {
  const { user, environment, scopeKey } = useSession(), saved = useRef<unknown>(null), client = useQueryClient();
  const writer = useNativePendingAction<unknown>({captureOperation: useOperationContext(JSON.stringify([ownerHref, refreshPath])), 
    scope: { actorId: user!.id, schoolId, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }, domain: 'events', ownerHref, refreshPath,
    resolveRefreshPath: eventActionRefreshPath,
    accepted: async (value, assertCurrent, action) => { assertCurrent(); assertEventRead(value, action); saved.current = value; client.setQueryData(['campus', scopeKey, action.refreshPath], value); await client.invalidateQueries({ queryKey: ['campus', scopeKey], predicate: query => typeof query.queryKey[2] === 'string' && query.queryKey[2].startsWith('/api/v1/campus-events'), refetchType: 'active' }, { throwOnError: true }); assertCurrent(); await refreshed?.(assertCurrent); assertCurrent(); },
  });
  return { ...writer, saved,
    run(input: NativePendingInput) { return writer.run({ ...input, body: { ...input.body, school_id: schoolId } }); },
  };
}
export type EventWriter = ReturnType<typeof useEventWriter>;
