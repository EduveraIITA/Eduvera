import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, captureApiContext } from './api';
import { useOperationContext } from './use-operation-context';
import { createChunkedNativePendingStorage } from './native-pending-action';
import { AttendanceEvidenceJournal, attendanceEvidencePath } from './attendance-evidence';
const journals = new Map<string, AttendanceEvidenceJournal>();
export function useAttendanceEvidenceCommand<T>(scopeKey: string, schoolId: string, accepted: (value: T) => void, ownerHref: string) {
  const captureView = useOperationContext(JSON.stringify([ownerHref, scopeKey, schoolId]));
  const journal = useMemo(() => {
    const existing = journals.get(scopeKey); if (existing) return existing;
    const dependencies = Promise.all([import('./device-storage'), import('expo-crypto')]).then(async ([SecureStore, Crypto]) => {
      const prefix = `thatcampus.attendance-evidence.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
      return { Crypto, storage: createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, prefix) };
    });
    let randomId: (() => string) | null = null;
    const base = `/api/v1/schools/${encodeURIComponent(schoolId)}/activities/registers`;
    const instance = new AttendanceEvidenceJournal({ scopeKey, randomId: () => { if (!randomId) throw new Error('Secure command identity is not ready.'); return randomId(); }, storage: { read: async () => { const result = await dependencies; randomId = result.Crypto.randomUUID; return result.storage.read(); }, write: async value => (await dependencies).storage.write(value), clear: async () => (await dependencies).storage.clear() }, send: command => apiFetch(attendanceEvidencePath(base, command), { method: 'POST', headers: { 'Idempotency-Key': command.key }, body: command.body }), read: command => apiFetch(`${base}/${encodeURIComponent(command.registerId)}`) });
    journals.set(scopeKey, instance); return instance;
  }, [scopeKey, schoolId]);
  const [state, setState] = useState(journal.snapshot()), active = useRef(true), acceptedRef = useRef(accepted); acceptedRef.current = accepted;
  useEffect(() => { active.current = true; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { active.current = false; unsubscribe(); }; }, [journal]);
  const context = () => { const assertView = captureView(); const transport = captureApiContext(); return { assertCurrent() { assertView(); transport.assertCurrent(); if (!active.current) throw new Error('The attendance view closed. Its exact action stays retained.'); }, accepted(value: unknown) { assertView(); transport.assertCurrent(); acceptedRef.current(value as T); } }; };
  return { ...state, locked: !state.ready || state.blocked || state.busy || !!state.pending,
    run: (input: Parameters<AttendanceEvidenceJournal['run']>[0]) => { try { return journal.run(input, context()); } catch { return Promise.resolve(false); } }, recover: () => { try { return journal.recover(context()); } catch { return Promise.resolve(false); } } };
}
