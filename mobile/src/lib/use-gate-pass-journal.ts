import { useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as Storage from './device-storage';
import { GatePassIssueJournal, gatePassStorageIdentity, gatePassStorageKey } from './gate-management';

type Entry = { journal: GatePassIssueJournal; listeners: Set<() => void>; hydration?: Promise<void>; error: string };
const entries = new Map<string, Entry>();
function entryFor(scope: string, schoolId: string) {
  const identity = gatePassStorageIdentity(scope, schoolId);
  let entry = entries.get(identity);
  if (!entry) {
    const key = gatePassStorageKey(scope, schoolId, value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value));
    entry = { journal: new GatePassIssueJournal(scope, schoolId, {
      read: async () => Storage.getItemAsync(await key),
      write: async value => Storage.setItemAsync(await key, value, { keychainAccessible: Storage.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      clear: async () => Storage.deleteItemAsync(await key),
    }), listeners: new Set(), error: '' };
    entries.set(identity, entry);
  }
  return entry;
}
/** Shared lock contains intent only. The bearer credential never enters this entry or storage. */
export function useGatePassJournal(scope: string, schoolId: string) {
  const entry = useMemo(() => entryFor(scope, schoolId), [scope, schoolId]), [, render] = useState(0);
  const notify = () => entry.listeners.forEach(listener => listener());
  useEffect(() => {
    const listener = () => render(value => value + 1); entry.listeners.add(listener);
    entry.hydration ??= entry.journal.hydrate().catch(cause => { entry.error = cause instanceof Error ? cause.message : 'The retained pass request is unavailable.'; }).finally(notify);
    return () => { entry.listeners.delete(listener); };
  }, [entry]);
  const perform = async <T,>(action: () => Promise<T>) => {
    entry.error = ''; const operation = action(); notify();
    try { return await operation; } catch (cause) { entry.error = cause instanceof Error ? cause.message : 'The pass request was not confirmed.'; throw cause; } finally { notify(); }
  };
  return { journal: entry.journal, error: entry.error,
    reload: () => perform(async () => { if (entry.journal.blocked && !entry.journal.busy) await entry.journal.hydrate(); }),
    issue: (input: Parameters<GatePassIssueJournal['issue']>[0]) => perform(() => entry.journal.issue(input)),
    finishAccepted: (assertCurrent: () => void) => perform(() => entry.journal.finishAccepted(assertCurrent)),
  };
}
