import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import { createChunkedNativePendingStorage, type NativePendingAction } from '../lib/native-pending-action';
import type { NativeSimulationRun } from '../lib/simulation-policy';
import { advanceSimulationBaseline, baselineCanEnter, capturedBaselineIntent, currentBaselineRun, simulationBaselineIntentValid, type SimulationBaselineIntent } from './SimulationBaselinePolicy';
type Entry = { intent: SimulationBaselineIntent | null; ready: boolean; blocked: boolean; error: string; storage?: ReturnType<typeof createChunkedNativePendingStorage>; loaded?: Promise<void>; listeners: Set<() => void> };
const entries = new Map<string, Entry>();
function entryFor(scope: string) { let entry = entries.get(scope); if (!entry) { entry = { intent: null, ready: false, blocked: false, error: '', listeners: new Set() }; entries.set(scope, entry); } return entry; }
function update(entry: Entry, values: Partial<Entry>) { Object.assign(entry, values); for (const notify of entry.listeners) notify(); }
/** Separate encrypted follow-up; the owning capture journal remains responsible
 * for its idempotency key and for every uncertain capture response. */
export function useSimulationBaselineLaunch(schoolId: string, captureOperation: () => () => void) {
  const { scopeKey } = useSession(), entry = useMemo(() => entryFor(scopeKey), [scopeKey]), [, render] = useState(0), active = useRef(false);
  useEffect(() => {
    active.current = true; const notify = () => render(value => value + 1); entry.listeners.add(notify);
    if (!entry.loaded) entry.loaded = (async () => {
      try {
        const key = `thatcampus.simulation-baseline.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
        entry.storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
        const raw = await entry.storage.read(), value: unknown = raw ? JSON.parse(raw) : null;
        if (value && !simulationBaselineIntentValid(value, scopeKey, schoolId)) throw new Error('The retained baseline does not match this account, campus, world and server. New Simulation actions are blocked.');
        update(entry, { ready: true, intent: value as SimulationBaselineIntent | null });
      } catch (cause) { update(entry, { ready: true, blocked: true, error: cause instanceof Error ? cause.message : 'Secure baseline recovery is unavailable.' }); }
    })();
    return () => { active.current = false; entry.listeners.delete(notify); };
  }, [entry, scopeKey, schoolId]);
  function guard(assertCurrent: () => void) { assertCurrent(); if (!active.current || !entry.ready || entry.blocked || !entry.storage) throw new Error('Secure baseline recovery is not available on the original screen.'); }
  async function persist(intent: SimulationBaselineIntent, assertCurrent: () => void) {
    guard(assertCurrent);
    // After an uncertain storage acknowledgement, never continue with older
    // in-memory evidence that might permit a second unkeyed start.
    try { await entry.storage!.write(JSON.stringify(intent)); update(entry, { intent, error: '' }); }
    catch (cause) { update(entry, { blocked: true, error: 'The baseline recovery write could not be confirmed. Relaunch to read its retained state before continuing.' }); throw cause; }
    guard(assertCurrent);
  }
  async function retain(action: NativePendingAction, run: NativeSimulationRun, assertCurrent: () => void) {
    await entry.loaded; guard(assertCurrent);
    const intent = capturedBaselineIntent(scopeKey, schoolId, action, run, entry.intent);
    if (intent) await persist(intent, assertCurrent);
  }
  async function advance() {
    const assertCurrent = captureOperation(); guard(assertCurrent); if (!entry.intent) throw new Error('No saved baseline launch is retained.');
    const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/simulation/runs`;
    return advanceSimulationBaseline(entry.intent, { assertCurrent: () => guard(assertCurrent), persist: intent => persist(intent, assertCurrent), read: id => apiFetch(`${root}/${id}`), start: (id, body) => apiFetch(`${root}/${id}/start`, { method: 'POST', body: JSON.stringify(body) }) });
  }
  async function release(reviewOnly = false) {
    const assertCurrent = captureOperation(); guard(assertCurrent); const intent = entry.intent; if (!intent) throw new Error('No baseline continuation is retained.');
    const run = currentBaselineRun(await apiFetch(`/api/v1/schools/${encodeURIComponent(schoolId)}/simulation/runs/${intent.runId}`), intent); guard(assertCurrent);
    if (reviewOnly ? intent.phase !== 'captured' : !baselineCanEnter(run)) throw new Error('Start remains unconfirmed. Inspect this saved run; the earlier start will not be repeated.');
    try { await entry.storage!.clear(); update(entry, { intent: null, error: '' }); }
    catch (cause) { update(entry, { blocked: true, error: 'Baseline recovery cleanup could not be confirmed. Relaunch to inspect its retained state.' }); throw cause; }
    guard(assertCurrent); return run;
  }
  return { ...entry, locked: !entry.ready || entry.blocked || !!entry.intent, retain, advance, release };
}
