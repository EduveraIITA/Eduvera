import { useCallback, useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from './api';
import { readOperationNow } from './operation-clock';
import { useOperationContext } from './use-operation-context';
export function useOperationClock(source: string) {
  const session = useSession(), focused = useIsFocused(), capture = useOperationContext(source), [now, setNow] = useState(''), [error, setError] = useState('');
  const read = useCallback(async () => { const assertCurrent = capture(); const instant = await readOperationNow({ actorId: session.user?.id ?? '', schoolId: session.schoolId ?? '', mode: session.environment.mode, namespaceId: session.environment.namespace_id ?? null, unavailable: session.environment.unavailable }, apiFetch); assertCurrent(); setNow(instant); setError(''); return instant; }, [capture, session.user?.id, session.schoolId, session.environment.mode, session.environment.namespace_id, session.environment.unavailable]);
  useEffect(() => { if (!focused) return; let active = true; void read().catch(cause => { if (active) { setNow(''); setError(cause instanceof Error ? cause.message : 'The campus clock is unavailable.'); } }); return () => { active = false; }; }, [read, focused]);
  return { now, error, read };
}
