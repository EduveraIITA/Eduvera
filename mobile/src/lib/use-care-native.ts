import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DeviceStorage from './device-storage';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from './api';
import { createChunkedNativePendingStorage } from './native-pending-action';
import { CareCommandJournal, type CareReference } from './care-command';
import { careRoot, type CareReceipt } from './care-native';

const journals = new Map<string, { journal: CareCommandJournal; owners: number }>();
function sharedJournal(scopeKey: string, schoolId: string) {
  const key = JSON.stringify([scopeKey, schoolId]); let existing = journals.get(key); if (existing) return existing;
  const storage = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key).then(hash => createChunkedNativePendingStorage({ get: DeviceStorage.getItemAsync, set: (key, value) => DeviceStorage.setItemAsync(key, value, { keychainAccessible: DeviceStorage.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: DeviceStorage.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, `thatcampus.care-receipts.${hash}`));
  const journal = new CareCommandJournal({ scopeKey, read: async () => (await storage).read(), write: async value => (await storage).write(value), randomId: Crypto.randomUUID, capture: captureApiContext, confirm: commandId => apiFetch(`${careRoot(schoolId)}/commands/${commandId}/confirmation/`) });
  existing = { journal, owners: 0 }; journals.set(key, existing); return existing;
}
export function useCareJournal(schoolId: string, scopeKey: string) {
  const session = useSession(), focused = useIsFocused(), mounted = useRef(true);
  const current = useRef({ scopeKey: session.scopeKey, focused }); current.current = { scopeKey: session.scopeKey, focused };
  const shared = useMemo(() => sharedJournal(scopeKey, schoolId), [scopeKey, schoolId]), journal = shared.journal;
  const [state, setState] = useState(journal.snapshot());
  useEffect(() => { mounted.current = true; shared.owners++; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { mounted.current = false; unsubscribe(); shared.owners--; if (!shared.owners) journal.dropPrivate(); }; }, [shared, journal]);
  const assertActive = () => { if (!mounted.current || current.current.scopeKey !== scopeKey || !current.current.focused || AppState.currentState !== 'active') throw new Error('Return to the exact protected care account, campus and world before continuing.'); };
  return { ...state, journal, capture: () => { assertActive(); const context = captureApiContext(); return () => { assertActive(); context.assertCurrent(); }; }, context: (accepted: (receipt: CareReceipt, reference: CareReference) => Promise<void> | void) => ({ assertActive, accepted }) };
}

/** Protected data is memory-only and removed when its query unmounts. A fresh
 * focused read is required; any failed current read hides the protected source. */
export function useCareRead<T>(path: string | null, parse: (value: unknown) => T, allowed = true) {
  const { scopeKey, status, environment } = useSession(), focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  const enabled = !!path && allowed && focused && foreground && status === 'authenticated' && !environment.unavailable;
  const signature = enabled ? JSON.stringify([scopeKey, path]) : null;
  const source = useRef({ signature: null as string | null, generation: 0 }), [verified, setVerified] = useState(0);
  if (signature !== source.current.signature) { source.current = { signature, generation: source.current.generation + 1 }; }
  const query = useQuery<T, Error>({ queryKey: ['campus', scopeKey, path], queryFn: async ({ signal }) => parse(await apiFetch(path!, { signal })), enabled, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchInterval: enabled ? 30_000 : false });
  useEffect(() => { if (!enabled) return; let active = true; const generation = source.current.generation; void query.refetch({ cancelRefetch: false, throwOnError: true }).then(() => { if (active && source.current.generation === generation) setVerified(generation); }).catch(() => {}); return () => { active = false; }; }, [enabled, path, scopeKey, query.refetch]);
  return { ...query, value: enabled && verified === source.current.generation && !query.isError ? query.data : undefined, refresh: async () => { if (!enabled) throw new Error('Confirm the current protected care context before refreshing this record.'); const generation = source.current.generation, result = await query.refetch({ throwOnError: true }); if (source.current.generation !== generation || result.data === undefined) throw new Error('The protected record could not be refreshed in the same active context.'); setVerified(generation); return result.data; } };
}
