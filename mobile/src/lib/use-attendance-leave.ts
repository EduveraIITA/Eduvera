import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from './device-storage';
import { pickPrivateFile, readPrivateFile, removePrivateFile, stagePrivateFile } from './private-file';
import { apiFetch, captureApiContext } from './api';
import { useOperationContext } from './use-operation-context';
import { createChunkedNativePendingStorage, nativePendingUploadForm } from './native-pending-action';
import { LeaveIntentJournal, LeaveSourceChanged, leaveIntentEndpoint, type LeaveIntent } from './attendance-leave-journal';
import { leaveFileType, leaveListPath, leaveSourceFingerprint, type LeaveConstraints, type LeaveFile, type LeaveRecord } from './attendance-leave-policy';
const registry = new Map<string, LeaveIntentJournal>();
async function digest(bytes: Uint8Array) { return Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes).buffer)), value => value.toString(16).padStart(2, '0')).join(''); }
async function verifiedBytes(file: LeaveFile, assertCurrent: () => void) {
  assertCurrent(); const original = await readPrivateFile(file.uri); if (original.size !== file.size) throw new Error('The retained document is unavailable or changed. A different file was not substituted.');
  const bytes = original.bytes; assertCurrent(); const hash = await digest(bytes); assertCurrent();
  if (bytes.byteLength !== file.size || hash !== file.hash || leaveFileType(file.name, bytes) !== file.type) throw new Error('The retained document bytes changed. The upload was not sent.');
  return bytes;
}
export async function chooseLeaveDocument(constraints?: LeaveConstraints): Promise<LeaveFile | null> {
  const context = captureApiContext();
  const selected = await pickPrivateFile(['application/pdf', 'image/jpeg', 'image/png'], Math.min(constraints?.max_document_size_bytes ?? 10 * 1024 * 1024, 10 * 1024 * 1024));
  try {
    context.assertCurrent();
    if (!selected) return null;
    const file = await readPrivateFile(selected.uri), size = file.size;
    if (!selected.name || selected.name.length > 255) throw new Error('Use a document filename of 1–255 characters.');
    if (!size || size > Math.min(constraints?.max_document_size_bytes ?? 10 * 1024 * 1024, 10 * 1024 * 1024)) throw new Error('Choose a nonempty document within the current 10 MiB maximum.');
    const bytes = file.bytes; context.assertCurrent(); if (bytes.byteLength !== size) throw new Error('The document changed while it was being read. Choose it again.');
    const type = leaveFileType(selected.name, bytes, constraints?.max_document_size_bytes);
    if (constraints && !constraints.accepted_documents.includes(type)) throw new Error('This document type is not accepted by the current campus policy.');
    const hash = await digest(bytes); context.assertCurrent(); return { uri: selected.uri, name: selected.name, size, type, hash };
  } catch (cause) { if (selected) await removePrivateFile(selected.uri).catch(() => {}); throw cause; }
}
export function useAttendanceLeave(scopeKey: string, ownerHref: string, accepted: (record: LeaveRecord) => void) {
  const captureView = useOperationContext(JSON.stringify([ownerHref, scopeKey]));
  const journal = useMemo(() => {
    const existing = registry.get(scopeKey); if (existing) return existing;
    const storage = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey).then(hash => createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, `thatcampus.leave-intent.${hash}`));
    const instance = new LeaveIntentJournal({ scopeKey, capture: captureApiContext, randomId: Crypto.randomUUID,
      storage: { read: async () => (await storage).read(), write: async value => (await storage).write(value), clear: async () => (await storage).clear() },
      stage: async (file, assertCurrent) => {
        await verifiedBytes(file, assertCurrent); assertCurrent();
        const staged = await stagePrivateFile(file, scopeKey, 'leave');
        try { assertCurrent(); await verifiedBytes(staged, assertCurrent); return staged; }
        catch (cause) { await removePrivateFile(staged.uri).catch(() => {}); throw cause; }
      },
      preflight: async (intent, assertCurrent) => {
        if (!intent.leaveId) return;
        assertCurrent(); const source = await apiFetch<LeaveRecord>(`/api/v1/leave-requests/${intent.leaveId}/`); assertCurrent();
        if (source.id !== intent.leaveId || source.student_id !== intent.studentId || leaveSourceFingerprint(source) !== intent.sourceFingerprint) throw new LeaveSourceChanged('This leave request changed before your action was sent. Refresh and review its current saved history.');
      },
      send: async (intent, assertCurrent) => {
        assertCurrent(); if (!intent.file) return apiFetch(leaveIntentEndpoint(intent), { method: 'POST', body: intent.body });
        const bytes = await verifiedBytes(intent.file, assertCurrent);
        const body = nativePendingUploadForm({ kind: 'multipart', fields: JSON.parse(intent.body) as Record<string, string>, file: intent.file }, bytes); assertCurrent();
        return apiFetch(leaveIntentEndpoint(intent), { method: 'POST', body });
      },
      read: async (intent, assertCurrent) => {
        assertCurrent(); const id = intent.acceptedLeaveId ?? intent.leaveId;
        if (id) { const record = await apiFetch<LeaveRecord>(`/api/v1/leave-requests/${id}/`); assertCurrent(); if (record.id !== id || record.student_id !== intent.studentId) throw new Error('The refreshed leave did not match the retained learner.'); return record; }
        const records = await apiFetch<{ results: LeaveRecord[] }>(leaveListPath(intent.studentId)); assertCurrent(); if (records.results.some(record => record.student_id !== intent.studentId)) throw new Error('The list did not match the retained learner.'); return records;
      },
      cleanup: async intent => { if (intent.file) await removePrivateFile(intent.file.uri); },
    }); registry.set(scopeKey, instance); return instance;
  }, [scopeKey]);
  const [state, setState] = useState(journal.snapshot()), active = useRef(true), callback = useRef(accepted), acceptedResult = useRef<LeaveRecord | null>(null), currentOwner = useRef(ownerHref); currentOwner.current = ownerHref; callback.current = accepted;
  useEffect(() => { active.current = true; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { active.current = false; unsubscribe(); }; }, [journal]);
  const assertCurrentView = () => { captureView()(); if (!active.current || currentOwner.current !== ownerHref) throw new Error('Return to the original leave view before continuing.'); };
  const context = () => { const assertView = captureView(); return { ownerHref, assertVisible: () => { assertView(); if (!active.current || currentOwner.current !== ownerHref) throw new Error('The leave view closed. Its original intent stays in its account, campus and environment.'); }, accepted: (record: LeaveRecord) => { assertView(); acceptedResult.current = record; callback.current(record); } }; };
  return { ...state, assertCurrentView, locked: !state.ready || state.blocked || state.busy || !!state.pending, resumeHref: state.pending && state.pending.ownerHref !== ownerHref ? state.pending.ownerHref : null,
    run: async (input: Parameters<LeaveIntentJournal['run']>[0]) => { acceptedResult.current = null; try { return await journal.run(input, context()) ? acceptedResult.current : null; } catch { return null; } }, recover: () => { try { return journal.recover(context()); } catch { return Promise.resolve(false); } } };
}
