import { useSyncExternalStore } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext, getApiOrigin } from '../../lib/api';
import { ApiError } from '../../lib/api-client';

type State = { busy: boolean; phase: 'unknown' | 'accepted' | null; error: string; label: string; details?: unknown };
const stores = new Map<string, { value: State; listeners: Set<() => void> }>();
const blank: State = { busy: false, phase: null, error: '', label: '' };
/** Company endpoints currently lack replay receipts. Never retry an uncertain write. */
export function useCompanyAction(refresh: () => Promise<unknown>) {
  const session = useSession(), key = JSON.stringify([getApiOrigin(), session.user?.id, session.companyOperator === true, session.environment.mode]);
  let store = stores.get(key); if (!store) { store = { value: blank, listeners: new Set() }; stores.set(key, store); }
  const current = store;
  const state = useSyncExternalStore(callback => { current.listeners.add(callback); return () => { current.listeners.delete(callback); }; }, () => current.value, () => blank);
  const change = (values: Partial<State>) => { current.value = { ...current.value, ...values }; current.listeners.forEach(callback => callback()); };
  const assertAllowed = () => { if (!session.companyOperator || session.status !== 'authenticated' || session.environment.mode !== 'live') throw new Error('Confirm your current company operator access in Live.'); };
  async function check() { if (current.value.busy) return; change({ busy: true, error: '' }); try { assertAllowed(); const context = captureApiContext(); await refresh(); context.assertCurrent(); if (current.value.phase === 'accepted') change({ phase: null, label: '' }); else change({ error: 'Current company records were refreshed. The earlier result still has no exact receipt. Inspect it before making any new change; it has not been repeated.' }); } catch (cause) { change({ error: cause instanceof Error ? cause.message : 'Current company records could not be checked.' }); } finally { change({ busy: false }); } }
  async function run<T>(label: string, endpoint: string, body: Record<string, unknown>): Promise<T | null> {
    if (current.value.busy || current.value.phase) return null;
    let sent = false; change({ busy: true, error: '', label, details: undefined });
    try {
      assertAllowed(); const context = captureApiContext();
      if (!/^\/api\/v1\/company\//.test(endpoint)) throw new Error('This action is outside the company console.');
      sent = true;
      const result = await apiFetch<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });
      context.assertCurrent(); change({ phase: 'accepted' });
      try { await refresh(); context.assertCurrent(); change({ phase: null, label: '' }); }
      catch (cause) {
        // The accepted response closes the submitted editor even when the list
        // refresh fails. Keeping that editor open could create a duplicate.
        context.assertCurrent();
        change({ error: cause instanceof Error ? cause.message : 'Saved. Refresh the current company records to continue.' });
      }
      return result;
    }
    catch (cause) { const uncertain = sent && (!(cause instanceof ApiError) || cause.status >= 500 || [408, 409, 429].includes(cause.status)); change({ phase: current.value.phase === 'accepted' ? 'accepted' : uncertain ? 'unknown' : null, details: cause instanceof ApiError ? cause.details : undefined, error: cause instanceof Error ? cause.message : 'The company action could not be confirmed.' }); return null; }
    finally { change({ busy: false }); }
  }
  return { ...state, locked: state.busy || state.phase !== null, run, check };
}
