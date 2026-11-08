import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from './api';
import { learningElectiveConfirmed, learningElectiveRefreshPath } from './learning-elective-policy';
import { useLearningCommand } from './learning-write';

function affectedElectiveRead(key: readonly unknown[], actorId: string, schoolId: string) {
  const path = key[2];
  if (path === 'important-calendar') return key[3] === actorId && key[4] === schoolId;
  if (typeof path !== 'string') return false;
  const school = `/api/v1/schools/${encodeURIComponent(schoolId)}`;
  return ['/api/v1/workspace', '/api/v1/learning/offerings', '/api/v1/learning/elective-changes', `${school}/fees`, `${school}/activities`, `${school}/assessments/calendar`]
    .some(root => path === root || path.startsWith(root + '/') || path.startsWith(root + '?'));
}

/** Exact command confirmation comes before a separate current authorized read.
 * Completed Tasks and their badge share the current workspace cache entry. */
export function useLearningElective<T extends { id: string; revision: number }>(href: string, readPath: string, onFresh: (value: T) => void) {
  const { scopeKey } = useSession(), cache = useQueryClient();
  return useLearningCommand<unknown>({ ownerHref: href, refreshPath: readPath, resolveRefreshPath: learningElectiveRefreshPath, onAccepted: async (value, assertCurrent, action) => {
    const receipt = learningElectiveConfirmed(value, action); assertCurrent();
    const fresh = await apiFetch<T>(readPath); assertCurrent();
    if (!fresh || fresh.id !== receipt.id || !Number.isSafeInteger(fresh.revision) || fresh.revision < Number(receipt.revision)) throw new Error('The accepted elective change is saved, but its current view could not be confirmed.');
    await cache.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' }); assertCurrent();
    cache.setQueryData(['campus', scopeKey, readPath], fresh);
    await cache.invalidateQueries({ queryKey: ['campus', scopeKey],
      predicate: query => query.queryKey[2] !== readPath && affectedElectiveRead(query.queryKey, action.scope.actorId, action.scope.schoolId),
      refetchType: 'active' }, { throwOnError: true });
    assertCurrent(); onFresh(fresh);
  } });
}
