import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { createChunkedNativePendingStorage } from '../lib/native-pending-action';
import { simulationRemovalUnavailable, type NativeSimulationRun } from '../lib/simulation-policy';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Notice, Section } from '../ui/components';
import { advanceSimulationRemoval, simulationRemovalIntentValid, type SimulationRemovalIntent } from './SimulationRemovalPolicy';
type Entry = { intent: SimulationRemovalIntent | null; ready: boolean; blocked: boolean; busy: boolean; visible: boolean; error: string; notice: string; loaded?: Promise<void>; storage?: ReturnType<typeof createChunkedNativePendingStorage>; listeners: Set<() => void> };
const entries = new Map<string, Entry>();
function entryFor(scope: string) { let entry = entries.get(scope); if (!entry) { entry = { intent: null, ready: false, blocked: false, busy: false, visible: true, error: '', notice: '', listeners: new Set() }; entries.set(scope, entry); } return entry; }
function update(entry: Entry, values: Partial<Entry>) { Object.assign(entry, values); for (const listener of entry.listeners) listener(); }
export function useSimulationRemoval(schoolId: string, otherLocked: boolean, refresh: () => Promise<unknown>) {
  const { scopeKey } = useSession(), focused = useIsFocused(), active = useRef(focused), entry = useMemo(() => entryFor(scopeKey), [scopeKey]), current = useRef({ otherLocked, refresh }), [, render] = useState(0); active.current = focused; current.current = { otherLocked, refresh };
  useEffect(() => { const notify = () => render(value => value + 1); entry.listeners.add(notify);
    if (!entry.loaded) entry.loaded = (async () => { try { const key = `thatcampus.simulation-removal.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
      entry.storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
      const raw = await entry.storage.read(), intent: unknown = raw ? JSON.parse(raw) : null; if (intent && !simulationRemovalIntentValid(intent, scopeKey, schoolId)) throw new Error('Retained removal evidence cannot be verified. Recover secure storage before another Simulation action.'); update(entry, { ready: true, intent: intent as SimulationRemovalIntent | null });
    } catch (cause) { update(entry, { ready: true, blocked: true, error: cause instanceof Error ? cause.message : 'Secure removal recovery is unavailable.' }); } })();
    return () => { active.current = false; entry.listeners.delete(notify); };
  }, [entry, scopeKey, schoolId]);
  useScreenExitGuard({ blocked: entry.busy });
  function choose(run: NativeSimulationRun) { if (!entry.ready || entry.blocked || entry.intent || entry.busy || current.current.otherLocked || simulationRemovalUnavailable(run)) return; update(entry, { intent: { version: 1, scope: scopeKey, schoolId, runId: run.id, scenarioId: run.scenario_id, name: run.name, draft: run.status === 'draft', reviewedRevision: run.revision!, removalRevision: run.status === 'draft' ? null : run.revision!, phase: 'ready', submitted: false }, visible: true, error: '', notice: '' }); }
  async function execute() {
    if (!entry.ready || entry.blocked || entry.busy || !entry.intent || !active.current || current.current.otherLocked) return;
    const context = captureApiContext(), guard = () => { context.assertCurrent(); if (!active.current) throw new Error('The original Simulation screen is no longer active. Recover its retained removal.'); }, root = `/api/v1/schools/${encodeURIComponent(schoolId)}/simulation/runs`, original = entry.intent;
    let intent = { ...original }; update(entry, { busy: true, error: '' });
    const persist = async () => { await entry.storage!.write(JSON.stringify(intent)); guard(); update(entry, { intent }); };
    try {
      intent = await advanceSimulationRemoval(intent, {
        assertCurrent: guard,
        persist: async value => { intent = value; await persist(); },
        read: runId => apiFetch(`${root}/${runId}`),
        stop: (runId, body) => apiFetch(`${root}/${runId}/stop`, { method: 'POST', body: JSON.stringify(body) }),
        remove: (runId, body) => apiFetch(`${root}/${runId}/remove`, { method: 'POST', body: JSON.stringify(body) }),
      });
      update(entry, { notice: `${intent.name} ${intent.draft ? 'discarded' : 'removed'}. Run history is retained.` });
      await current.current.refresh(); guard(); await entry.storage!.clear(); guard(); update(entry, { intent: null, error: '' });
    } catch (cause) { try { guard(); } catch { return; } update(entry, { error: intent.phase === 'accepted' ? 'Removal was accepted. Refresh the list to finish recovery; nothing will be removed again.' : `${cause instanceof Error ? cause.message : 'Removal is unconfirmed.'} The submitted action remains retained. Closing does not cancel it.` }); }
    finally { update(entry, { busy: false }); }
  }
  function close() { if (entry.busy) return; if (entry.intent?.submitted) update(entry, { visible: false }); else update(entry, { intent: null, error: '' }); }
  return { ...entry, locked: !entry.ready || entry.blocked || entry.busy || !!entry.intent, choose, execute, close, show: () => update(entry, { visible: true }) };
}
export type SimulationRemoval = ReturnType<typeof useSimulationRemoval>;
export function SimulationRemovalStatus({ removal }: { removal: SimulationRemoval }) { return <>{removal.error ? <Notice tone="danger" message={removal.error} /> : null}{removal.notice ? <Notice tone="success" message={removal.notice} /> : null}{removal.intent ? removal.visible ? <Section title={`${removal.intent.draft ? 'Discard' : 'Remove'} ${removal.intent.name}?`}><Notice tone="warning" message={removal.intent.phase === 'accepted' ? 'The isolated world was removed. Refresh its saved list to finish recovery.' : `${removal.intent.draft ? 'This conditionally stops the unused draft, then removes its isolated changes.' : 'Its isolated changes cannot be recovered.'} Live is unchanged. History and recorded results remain.`} /><Button title={removal.intent.phase === 'accepted' ? 'Finish removal recovery' : removal.intent.submitted ? 'Recover exact original removal' : removal.intent.draft ? 'Discard draft' : 'Remove simulation'} kind={removal.intent.phase === 'accepted' ? 'secondary' : 'danger'} busy={removal.busy} onPress={() => void removal.execute()} /><Button title={removal.intent.submitted ? 'Close confirmation' : 'Cancel'} kind="secondary" disabled={removal.busy} onPress={removal.close} /></Section> : <><Notice tone="warning" message="An earlier removal remains unconfirmed. Its exact evidence is retained; recover it before another Simulation action." /><Button title="Review retained removal" onPress={removal.show} /></> : null}</>; }
