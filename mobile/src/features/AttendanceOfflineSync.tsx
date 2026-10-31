import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { TeacherAttendanceResponse, TeacherAttendanceSaveInput } from '../../../packages/contracts/src/wire/features/operations/api';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext, getApiOrigin } from '../lib/api';
import { nativePendingScopeKey, type NativePendingScope } from '../lib/native-pending-action';
import { attendanceOfflineEndpoint, attendanceOfflineFallbackAllowed, attendanceOfflineRegisterRead, attendanceOfflineScreenMatches, type AttendanceOfflineScreen } from '../lib/attendance-offline-policy';
import { attendanceOfflineQueue, type AttendanceOfflineQueue, type AttendanceOfflineState } from '../lib/attendance-offline-store';
import { Button, Notice, Section } from '../ui/components';

export type { AttendanceOfflineScreen } from '../lib/attendance-offline-policy';
const initial: AttendanceOfflineState = { ready: false, blocked: false, busy: false, error: '', pending: [] };

/** Ordinary online submission remains owned by the academic register's journal.
 * This adapter handles only an explicit Save on device action before any send. */
export function useAttendanceOfflineContinuity() {
  const session = useSession(), cache = useQueryClient(), [state, setState] = useState(initial), [error, setError] = useState(''), controller = useRef<{ key: string; queue: AttendanceOfflineQueue } | null>(null);
  const scope: NativePendingScope | null = session.status === 'authenticated' && session.user && session.schoolId && !session.environment.unavailable ? { actorId: session.user.id, schoolId: session.schoolId, mode: session.environment.mode, namespaceId: session.environment.namespace_id ?? null, origin: getApiOrigin() } : null;
  const key = scope ? nativePendingScopeKey(scope) : '', latest = useRef({ key, scope, session }); latest.current = { key, scope, session };
  useEffect(() => {
    let active = true, unsubscribe: (() => void) | undefined; controller.current = null; setState(initial); setError('');
    if (scope) void attendanceOfflineQueue(scope).then(queue => { if (!active) return; controller.current = { key, queue }; unsubscribe = queue.subscribe(value => { if (active) setState(value); }); }).catch(cause => { if (active) { setState({ ...initial, ready: true, blocked: true }); setError(cause instanceof Error ? cause.message : 'Secure offline storage is unavailable.'); } });
    return () => { active = false; unsubscribe?.(); controller.current = null; };
  }, [key]);
  const context = useCallback(() => {
    const value = latest.current, current = controller.current, api = captureApiContext();
    if (!value.scope || current && current.key !== value.key) throw new Error('Confirm the selected campus before continuing.');
    const assertCurrent = () => { api.assertCurrent(); if (latest.current.key !== value.key || current && controller.current?.queue !== current.queue) throw new Error('The account, campus, server or execution environment changed. The observations remain in their original scope.'); };
    const now = () => { const world = latest.current.session.environment, value = world.mode === 'simulation' ? world.virtual_clock?.now : new Date().toISOString(); if (!value || !Number.isFinite(Date.parse(value))) throw new Error('The selected campus clock is unavailable.'); return new Date(value).toISOString(); };
    assertCurrent(); return { queue: current?.queue, scope: value.scope, scopeKey: value.session.scopeKey, assertCurrent, now };
  }, []);
  const cacheSnapshot = useCallback(async (screen: TeacherAttendanceResponse) => { const current = context(); if (!current.queue) throw new Error('Secure offline storage is not ready.'); await current.queue.cacheSnapshot(screen, current.now()); current.assertCurrent(); }, [context]);
  const load = useCallback(async (classId: string, date: string, read: () => Promise<TeacherAttendanceResponse>): Promise<AttendanceOfflineScreen> => {
    const current = context(); let fresh: TeacherAttendanceResponse;
    try { fresh = await read(); current.assertCurrent(); }
    catch (cause) {
      current.assertCurrent();
      if (!attendanceOfflineFallbackAllowed(cause)) { const queue = current.queue ?? await attendanceOfflineQueue(current.scope).catch(() => undefined); current.assertCurrent(); await queue?.deny(classId, date).catch(() => {}); current.assertCurrent(); throw cause; }
      const fallback = current.queue?.fallback(classId, date, current.now()); current.assertCurrent(); if (fallback) return fallback; throw cause;
    }
    if (!attendanceOfflineScreenMatches(fresh, current.scope, classId, date)) throw new Error('The current roster did not match this selected class and date.');
    try { await current.queue?.cacheSnapshot(fresh, current.now()); current.assertCurrent(); }
    catch (cause) { current.assertCurrent(); setError(`The roster loaded, but its offline copy could not be secured: ${cause instanceof Error ? cause.message : 'Storage unavailable.'}`); }
    return current.queue?.view(classId, date, fresh) ?? fresh;
  }, [context]);
  const prepareOfflineCapture = useCallback(async (screen: TeacherAttendanceResponse, input: TeacherAttendanceSaveInput): Promise<AttendanceOfflineScreen> => {
    const current = context(); if (!current.queue) throw new Error('Secure offline storage is not ready.'); setError(''); const result = await current.queue.prepare(screen, input, current.now()); current.assertCurrent(); return result;
  }, [context]);
  const flush = useCallback(async (options: { automatic?: boolean } = {}) => {
    const current = context(); if (options.automatic && current.scope.mode !== 'live') return;
    if (!current.queue) throw new Error('Secure offline storage is not ready.');
    if (!current.queue.snapshot().pending.length) return;
    const assertOperation = () => {current.assertCurrent();if(options.automatic && AppState.currentState !== 'active')throw new Error('Automatic attendance sync waits until this app is active.');};
    await current.queue.flush({ ...options, assertCurrent: assertOperation, now: current.now,
      send: async capture => { assertOperation(); return apiFetch(attendanceOfflineEndpoint, { method: 'POST', headers: { 'Idempotency-Key': capture.id }, body: capture.body }); },
      read: async capture => { assertOperation(); return apiFetch<TeacherAttendanceResponse>(attendanceOfflineRegisterRead(capture.classSectionId, capture.date)); },
      onConfirmed: (screen, capture) => { current.assertCurrent(); cache.setQueryData(['campus', current.scopeKey, attendanceOfflineRegisterRead(capture.classSectionId, capture.date)], screen); },
    }); current.assertCurrent(); await cache.invalidateQueries({ queryKey: ['campus', current.scopeKey] }); current.assertCurrent();
  }, [context, cache]);
  return { ...state, error: error || state.error, mode: session.environment.mode, namespaceId: session.environment.namespace_id ?? null,
    cacheSnapshot, load, prepareOfflineCapture, flush,
    hasPending: (classId: string, date: string) => state.pending.some(item => item.classSectionId === classId && item.date === date),
  };
}

/** Mirrors the mounted web provider's Live-only automatic synchronization.
 * Manual flush remains available in the selected isolated Simulation namespace. */
export function AttendanceOfflineSync() {
  const offline = useAttendanceOfflineContinuity(), { scopeKey, status, environment } = useSession();
  useEffect(() => {
    if (!offline.ready || offline.blocked || status !== 'authenticated' || environment.mode !== 'live' || environment.unavailable) return;
    const sync = () => { if ((Platform.OS === 'web' || AppState.currentState === 'active') && !(typeof navigator !== 'undefined' && navigator.onLine === false)) void offline.flush({ automatic: true }).catch(() => {}); };
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') sync(); }), interval = setInterval(sync, 30_000);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('online', sync); sync();
    return () => { clearInterval(interval); subscription.remove(); if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('online', sync); };
  }, [scopeKey, status, environment.mode, environment.unavailable, offline.ready, offline.blocked, offline.flush]);
  return null;
}

export function AttendanceOfflineStatus({ classSectionId, date }: { classSectionId: string; date: string }) {
  const offline = useAttendanceOfflineContinuity(), capture = offline.pending.find(item => item.classSectionId === classSectionId && item.date === date);
  if (!capture && !offline.error) return null;
  return <Section title="Device observations">{offline.error ? <Notice tone="warning" message={offline.error} /> : null}{capture ? <><Notice tone={capture.receipt?.status === 'accepted' ? 'success' : 'warning'} message={capture.phase === 'received' ? capture.receipt?.status === 'accepted' ? 'The school accepted these observations. Confirm the current register before recording another capture.' : 'The school retained these observations for its recorded review or rejection. Confirm the current register before continuing.' : 'Saved securely on this device — not submitted. Other register changes stay blocked until these exact observations sync.'} />{capture.error ? <Notice tone="warning" message={capture.error} /> : null}<Notice message={offline.mode === 'simulation' ? 'This capture belongs only to the selected Simulation. Sync it explicitly in this world.' : 'Live sync retries while the app is active and connected.'} /><Button title={capture.phase === 'received' ? 'Confirm current register' : 'Sync retained observations'} busy={offline.busy} disabled={!offline.ready || offline.blocked} onPress={() => void offline.flush().catch(() => {})} /></> : null}</Section>;
}
