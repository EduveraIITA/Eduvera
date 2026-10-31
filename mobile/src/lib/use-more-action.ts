import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Storage from './device-storage';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from './api';
import { MoreActionJournal, type MoreActionContext, type MoreActionKind, type MoreActionPlan, type MoreActionRecord } from './more-action';
import { createChunkedNativePendingStorage } from './native-pending-action';
const journals = new Map<string, MoreActionJournal>();
export function useMoreAction(kind: MoreActionKind, validate: (plan: MoreActionPlan) => void, recover: (record: MoreActionRecord) => Promise<boolean>) {
  const { scopeKey, schoolId, environment } = useSession();
  const focused = useIsFocused(), current = useRef({ scopeKey, focused, validate, recover }); current.current = { scopeKey, focused, validate, recover };
  const journal = useMemo(() => {
    const identity = JSON.stringify([scopeKey, kind]), existing = journals.get(identity); if (existing) return existing;
    const storage = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, identity).then(hash => createChunkedNativePendingStorage({ get: Storage.getItemAsync, set: (key, value) => Storage.setItemAsync(key, value, { keychainAccessible: Storage.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: Storage.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, `thatcampus.more-action.${hash}`));
    const created = new MoreActionJournal({ scopeKey, schoolId: schoolId ?? '', mode: environment.mode, kind,
      read: async () => (await storage).read(), write: async value => (await storage).write(value), clear: async () => (await storage).clear(),
      capture: captureApiContext, send: (path, body) => apiFetch(path, { method: 'POST', body }),
    }); journals.set(identity, created); return created;
  }, [scopeKey, schoolId, kind, environment.mode]);
  const [state, setState] = useState(journal.snapshot());
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { mounted.current = false; unsubscribe(); }; }, [journal]);
  const context: MoreActionContext = {
    assertActive() { if (!mounted.current || !current.current.focused || current.current.scopeKey !== scopeKey || AppState.currentState !== 'active') throw new Error('The original account, campus, world or screen changed. The private action remains retained.'); },
    validate: plan => current.current.validate(plan), recover: record => current.current.recover(record),
  };
  return { ...state, locked: !state.ready || state.blocked || state.busy || Boolean(state.pending), run: (plan: MoreActionPlan) => journal.run(plan, context), check: () => journal.check(context), retry: () => journal.retry(context) };
}
