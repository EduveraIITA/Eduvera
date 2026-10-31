import type { WorkspaceWorkItem } from '../../../packages/contracts/src/workspace';

/** Work IDs are opaque projection identities, including domain-prefixed IDs. */
export function workspaceWorkRecoveryId(item: unknown, unavailable?: unknown): string | null {
  if (typeof item !== 'string' || !item || item.length > 512 || item !== item.trim() || /[\u0000-\u001f\u007f]/.test(item)) return null;
  if (unavailable !== undefined && unavailable !== 'source' && unavailable !== 'route') return null;
  return item;
}

/** Call only with the normalized manifest already verified for the current scope. */
export function workspaceWorkRecovery(items: readonly WorkspaceWorkItem[], selectedId: string | null | undefined) {
  const id = workspaceWorkRecoveryId(selectedId);
  if (!id) return null;
  const selected = items.find(item => item.id === id);
  return selected ? {
    title: selected.title,
    explanation: 'The source link is unavailable. No decision has been recorded. Check the owning area or contact its responsible coordinator.',
    status: selected.status_label ?? null,
  } : {
    title: 'This item is no longer in your current queue',
    explanation: 'It may have been resolved or your access may have changed. No records were changed.',
    status: null,
  };
}
