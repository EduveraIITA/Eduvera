import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Storage from './device-storage';
import type { WorkspaceAreaSurface } from '../../../packages/contracts/src/workspace';
import { apiFetch, captureApiContext } from './api';
import { useOperationContext } from './use-operation-context';
import { academicAttendancePath, normalizeAcademicAttendanceDetail, type AcademicAttendanceDetail, type AcademicAttendanceSource } from './academic-attendance';
import { AcademicRegisterActionJournal, prepareAcademicRegisterAction, type AcademicRegisterActionKind, type AcademicRegisterActionState, type AcademicRegisterReceipt } from './academic-register-action';
import { createChunkedNativePendingStorage, nativePendingScopeKey, type NativePendingScope } from './native-pending-action';
const journals = new Map<string,AcademicRegisterActionJournal>();
export function useAcademicRegisterAction(scope: NativePendingScope, source: AcademicAttendanceSource, surface: WorkspaceAreaSurface, accepted: (detail: AcademicAttendanceDetail,receipt: AcademicRegisterReceipt) => void, ownerHref: string) {
  const scopeKey = nativePendingScopeKey(scope), contextKey = JSON.stringify([scopeKey,academicAttendancePath(source)]), focused = useIsFocused();
  const captureView = useOperationContext(JSON.stringify([ownerHref, contextKey]));
  const current = useRef(contextKey), visible = useRef(focused), active = useRef(false), callback = useRef(accepted);
  current.current = contextKey; visible.current = focused; callback.current = accepted;
  const journal = useMemo(() => {
    const previous = journals.get(contextKey); if (previous) return previous;
    const storage = Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,contextKey).then(hash => createChunkedNativePendingStorage({ get: Storage.getItemAsync,set: (key,value) => Storage.setItemAsync(key,value,{ keychainAccessible: Storage.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),remove: Storage.deleteItemAsync,randomId: Crypto.randomUUID,digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value) },`thatcampus.academic-register-action.${hash}`));
    const created = new AcademicRegisterActionJournal({ scope,source,capture: captureApiContext,createKey: async () => Crypto.randomUUID(),
      storage: { read: async () => (await storage).read(),write: async value => (await storage).write(value),clear: async () => (await storage).clear() },
      send: action => apiFetch(action.endpoint,{ method: action.method,headers: { 'Idempotency-Key': action.key },body: action.body }),
      read: action => apiFetch(academicAttendancePath(action.source)),
    });
    journals.set(contextKey,created); return created;
  },[contextKey]);
  const [state,setState] = useState<AcademicRegisterActionState>(journal.snapshot());
  useEffect(() => { active.current = true; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { active.current = false; unsubscribe(); }; },[journal]);
  const operation = {
    assertActive() { if (!active.current || !visible.current || AppState.currentState !== 'active' || current.current !== contextKey) throw new Error('The original account, campus, world or academic view changed. Its action stays retained.'); },
    acceptCurrent(action: import('./academic-register-action').AcademicRegisterAction,value: unknown) {
      const detail = normalizeAcademicAttendanceDetail(value,action.source,scope.schoolId,surface);
      if (detail.classId !== action.classId || detail.termId !== action.termId) throw new Error('The refreshed register belongs to a different academic source.');
      return detail;
    },
    accepted(detail: AcademicAttendanceDetail,receipt: AcademicRegisterReceipt) { callback.current(detail,receipt); },
  };
  const capturedOperation = () => { const assertView = captureView(); return { ...operation, assertActive() { assertView(); operation.assertActive(); }, accepted(detail: AcademicAttendanceDetail, receipt: AcademicRegisterReceipt) { assertView(); operation.accepted(detail, receipt); } }; };
  return { ...state,locked: !state.ready || state.blocked || state.busy || !!state.pending,
    run: (kind: AcademicRegisterActionKind,basis: AcademicAttendanceDetail,input: Parameters<typeof prepareAcademicRegisterAction>[5]) => { try { return journal.run(key => prepareAcademicRegisterAction(scope,key,kind,source,basis,input,surface.capabilities.includes('attendance.review')),capturedOperation()); } catch { return Promise.resolve(false); } },
    recover: () => { try { return journal.recover(capturedOperation()); } catch { return Promise.resolve(false); } },
  };
}
