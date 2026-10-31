import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from './device-storage';
import { useIsFocused } from 'expo-router';
import { AppState } from 'react-native';
import type { WorkspaceAreaSurface } from '../../../packages/contracts/src/workspace';
import { apiFetch, captureApiContext } from './api';
import { useOperationContext } from './use-operation-context';
import { createChunkedNativePendingStorage, nativePendingScopeKey, type NativePendingScope } from './native-pending-action';
import { normalizeAcademicAttendanceDetail, type AcademicAttendanceDetail } from './academic-attendance';
import { AcademicSessionCommandJournal, academicSessionReadPath, academicSessionSubmitPath, sharedAcademicSessionJournal, type AcademicSessionCommandState, type AcademicSessionMark } from './academic-session-command';

const inactive: AcademicSessionCommandState = { ready: true, storageBlocked: false, busy: false, pending: null, error: '' };
export function useAcademicSessionCommand(scope: NativePendingScope, sessionId: string | null, surface: WorkspaceAreaSurface, accepted: (detail: AcademicAttendanceDetail) => void, ownerHref: string) {
  const scopeKey = nativePendingScopeKey(scope), contextKey = JSON.stringify([scopeKey, sessionId]);
  const captureView = useOperationContext(JSON.stringify([ownerHref, contextKey]));
  const focused = useIsFocused(), visible = useRef(focused); visible.current = focused;
  const active = useRef(false), current = useRef(contextKey); current.current = contextKey;
  const callback = useRef(accepted); callback.current = accepted;
  const journal = useMemo(() => sessionId ? sharedAcademicSessionJournal(scope, sessionId, () => {
    const storage = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, contextKey).then(hash => createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, `thatcampus.academic-session.${hash}`));
    return new AcademicSessionCommandJournal({ scope, sessionId, capture: captureApiContext, createKey: async () => Crypto.randomUUID(),
      storage: { read: async () => (await storage).read(), write: async value => (await storage).write(value), clear: async () => (await storage).clear() },
      send: async (command, guard) => { guard.assertCurrent(); return apiFetch(academicSessionSubmitPath(command), { method: 'POST', headers: { 'Idempotency-Key': command.key }, body: command.body }); },
      read: async (command, guard) => { guard.assertCurrent(); return apiFetch(academicSessionReadPath(command)); },
    });
  }) : null, [contextKey]);
  const [state, setState] = useState(journal?.snapshot() ?? inactive);
  useEffect(() => { active.current = true; if (!journal) { setState(inactive); return () => { active.current = false; }; } const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { active.current = false; unsubscribe(); }; }, [journal]);
  const operation = {
    assertActive() { if (!active.current || !visible.current || AppState.currentState !== 'active' || current.current !== contextKey) throw new Error('The original session view is no longer active or its account, campus, world or server changed. The original submission remains retained.'); },
    acceptCurrent(command: import('./academic-session-command').AcademicSessionCommand, value: unknown) {
      const id = command.identity;
      const detail = normalizeAcademicAttendanceDetail(value, { kind: 'scheduled_session', sessionId: id.sessionId, date: id.date }, id.schoolId, surface);
      if (detail.classId !== id.classId || detail.termId !== id.termId) throw new Error('The refreshed session belongs to a different academic source.');
      return detail;
    },
    accepted(value: AcademicAttendanceDetail) { callback.current(value); },
  };
  const capturedOperation = () => { const assertView = captureView(); return { ...operation, assertActive() { assertView(); operation.assertActive(); }, accepted(value: AcademicAttendanceDetail) { assertView(); operation.accepted(value); } }; };
  return { ...state, locked: !state.ready || state.storageBlocked || state.busy || !!state.pending,
    submit: (basis: AcademicAttendanceDetail, records: readonly AcademicSessionMark[], reason: string, photoSessionId?: string) => { try { return journal?.run(basis, records, reason, capturedOperation(), photoSessionId) ?? Promise.resolve(false); } catch { return Promise.resolve(false); } },
    recover: () => { try { return journal?.recover(capturedOperation()) ?? Promise.resolve(false); } catch { return Promise.resolve(false); } },
  };
}
