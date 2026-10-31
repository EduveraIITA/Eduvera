import { useOperationContext } from '../lib/use-operation-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { ApiError, apiFetch, captureApiContext } from '../lib/api';
import { createChunkedNativePendingStorage } from '../lib/native-pending-action';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Notice } from '../ui/components';
import { setupCommandPath, setupCommandRead, setupIntentValid, setupReceiptMatches, setupReplayable, type SetupIntent } from './SetupCommandPolicy';
type Entry = { pending: SetupIntent | null; ready: boolean; blocked: boolean; busy: boolean; error: string; message: string; storage?: ReturnType<typeof createChunkedNativePendingStorage>; loaded?: Promise<void>; listeners: Set<() => void> };
const entries = new Map<string, Entry>();
function entryFor(scope: string) { let entry = entries.get(scope); if (!entry) { entry = { pending: null, ready: false, blocked: false, busy: false, error: '', message: '', listeners: new Set() }; entries.set(scope, entry); } return entry; }
function update(entry: Entry, values: Partial<Entry>) { Object.assign(entry, values); for (const listener of entry.listeners) listener(); }
export function useSetupCommand(schoolId: string, source = '') {
  const { scopeKey, user } = useSession(), client = useQueryClient(), focused = useIsFocused(), active = useRef(false), entry = useMemo(() => entryFor(scopeKey), [scopeKey]), [, render] = useState(0); active.current = focused;
  useEffect(() => { const notify = () => render(value => value + 1); entry.listeners.add(notify);
    if (!entry.loaded) entry.loaded = (async () => { try {
      const key = `thatcampus.institution-commands.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
      entry.storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (name, value) => SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
      const raw = await entry.storage.read(), pending: unknown = raw ? JSON.parse(raw) : null;
      if (pending && (!setupIntentValid(pending, scopeKey, schoolId) || pending.accepted !== undefined && !setupReceiptMatches(pending, pending.accepted))) throw new Error('Retained institution evidence cannot be verified. Restore secure recovery before another setup change.');
      update(entry, { ready: true, pending: pending as SetupIntent | null });
    } catch (cause) { update(entry, { ready: true, blocked: true, error: cause instanceof Error ? cause.message : 'Secure recovery is unavailable.' }); } })();
    return () => { active.current = false; entry.listeners.delete(notify); };
  }, [entry, scopeKey, schoolId]);
  const captureOperation = useOperationContext(JSON.stringify([schoolId, source]));
  useScreenExitGuard({ blocked: entry.busy });
  async function run(input?: Omit<SetupIntent, 'version' | 'scope' | 'schoolId' | 'accepted'>) {
    if (!entry.ready || entry.blocked || entry.busy || !active.current || input && entry.pending) return undefined;
    const intent = entry.pending ?? (input ? { ...input, version: 1 as const, scope: scopeKey, schoolId, proof: { ...input.proof, actorUserId: user?.id }, body: { ...input.body, ...(input.operation === 'organization' ? { request_id: Crypto.randomUUID() } : input.operation === 'invigilationPolicy' ? { idempotency_key: Crypto.randomUUID() } : {}) } } : null);
    if (!intent || !setupIntentValid(intent, scopeKey, schoolId)) { update(entry, { error: 'The exact reviewed institution action could not be retained. Nothing was sent.' }); return undefined; }
    const recovering = !!entry.pending; let assertOperation: () => void; try { assertOperation = captureOperation(); } catch (cause) { update(entry, { error: cause instanceof Error ? cause.message : 'Return to the original institution screen.' }); return undefined; } const context = captureApiContext();
    const guard = () => { assertOperation(); context.assertCurrent(); if (!active.current) throw new Error('The original screen is no longer active. Recover its retained action before another change.'); };
    const persist = async () => { try { await entry.storage!.write(JSON.stringify(intent)); update(entry, { pending: intent }); } catch (cause) { update(entry, { blocked: true }); throw cause; } guard(); };
    const clear = async () => { try { await entry.storage!.clear(); update(entry, { pending: null }); } catch (cause) { update(entry, { blocked: true }); throw cause; } guard(); };
    update(entry, { busy: true, error: '', message: '' });
    try {
      if (intent.accepted === undefined) {
        if (recovering && !setupReplayable(intent)) { await apiFetch(setupCommandRead(intent)); guard(); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); guard(); update(entry, { error: 'Current records were read. This API has no exact command receipt; the earlier save remains unconfirmed. Campus support must reconcile it before another institution change.' }); return undefined; }
        await persist();
        const result = await apiFetch<unknown>(setupCommandPath(intent), { method: intent.method, body: JSON.stringify(intent.body) }); guard();
        if (!setupReceiptMatches(intent, result)) throw new Error('The response did not confirm the exact reviewed action. Its original evidence remains retained.');
        intent.accepted = result; update(entry, { pending: intent }); await persist();
      }
      await client.invalidateQueries({ queryKey: ['campus', scopeKey] }, { throwOnError: true }); guard();
      await clear(); update(entry, { message: 'The owning service recorded this action. Current records refreshed.' }); return intent.accepted;
    } catch (cause) {
      try { guard(); } catch { return undefined; }
      if (!recovering && intent.accepted === undefined && cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && ![408, 409, 429].includes(cause.status)) { try { await clear(); } catch { update(entry, { blocked: true }); } }
      update(entry, { error: intent.accepted !== undefined ? 'The action was accepted. Finish local recovery before another institution change.' : cause instanceof Error ? cause.message : 'The outcome is unknown. Its exact evidence remains retained.' }); return undefined;
    } finally { update(entry, { busy: false }); }
  }
  return { ...entry, locked: !entry.ready || entry.blocked || entry.busy || !!entry.pending, run };
}
export type SetupWriter = ReturnType<typeof useSetupCommand>;
export function SetupCommandStatus({ writer }: { writer: SetupWriter }) { return <>{writer.error ? <Notice tone="danger" message={writer.error} /> : null}{writer.message ? <Notice tone="success" message={writer.message} /> : null}{writer.pending ? <><Notice tone="warning" message={writer.pending.accepted !== undefined ? 'This action was accepted. Finish refreshing its recorded result.' : 'This institution action has an unknown outcome. Its exact source and content remain securely retained.'} /><Button title={writer.pending.accepted !== undefined ? 'Finish accepted action' : setupReplayable(writer.pending) ? 'Recover identical original action' : 'Inspect current records'} busy={writer.busy} onPress={() => { void writer.run(); }} /></> : null}</>; }
