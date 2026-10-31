import { assertEventAdminOwner, executeEventAdminIntent } from './EventAdminExecution';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { ApiError, apiFetch, captureApiContext } from '../lib/api';
import { createChunkedNativePendingStorage } from '../lib/native-pending-action';
import { Button, Notice } from '../ui/components';
import { eventAdminIntentValid, eventAdminPath, eventAdminReceiptMatches, eventRulesValid, type EventAdminIntent } from './EventAdminPolicy';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { useOperationContext } from '../lib/use-operation-context';

type Entry = { pending: EventAdminIntent | null; busy: boolean; ready: boolean; blocked: boolean; error: string; message: string; loaded?: Promise<void>; storage?: ReturnType<typeof createChunkedNativePendingStorage>; listeners: Set<() => void> };
const entries = new Map<string, Entry>();
function entryFor(scope: string) { let entry = entries.get(scope); if (!entry) { entry = { pending: null, busy: false, ready: false, blocked: false, error: '', message: '', listeners: new Set() }; entries.set(scope, entry); } return entry; }
function update(entry: Entry, values: Partial<Entry>) { Object.assign(entry, values); for (const listener of entry.listeners) listener(); }
export function useEventAdminCommand(schoolId: string, href: string) {
  const { scopeKey } = useSession(), client = useQueryClient(), active = useRef(false), entry = useMemo(() => entryFor(scopeKey), [scopeKey]);
  const captureOperation = useOperationContext(JSON.stringify([schoolId, href]));
  const [, render] = useState(0);
  useEffect(() => {
    active.current = true; const notify = () => render(value => value + 1); entry.listeners.add(notify);
    if (!entry.loaded) entry.loaded = (async () => { try {
      const key = `thatcampus.event-admin.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
      entry.storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (name, value) => SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
      const raw = await entry.storage.read(), pending: unknown = raw ? JSON.parse(raw) : null;
      if (pending && (!eventAdminIntentValid(pending, scopeKey, schoolId) || pending.accepted !== undefined && !eventAdminReceiptMatches(pending, pending.accepted))) throw new Error('The retained event action cannot be verified. Its evidence is kept; restore secure recovery before another administrative change.');
      update(entry, { pending: pending as EventAdminIntent | null, ready: true });
    } catch (cause) { update(entry, { ready: true, blocked: true, error: cause instanceof Error ? cause.message : 'Secure event recovery is unavailable.' }); } })();
    return () => { active.current = false; entry.listeners.delete(notify); };
  }, [entry, scopeKey, schoolId]);
  useScreenExitGuard({ blocked: entry.busy });
  async function run(input?: Omit<EventAdminIntent, 'version' | 'scope' | 'schoolId' | 'ownerHref' | 'accepted'>, assertReview?: () => void) {
    if (!entry.ready || entry.blocked || entry.busy || !active.current) return false;
    if (input && entry.pending) return false;
    const intent: EventAdminIntent | null = entry.pending ?? (input ? { ...input, version: 1, scope: scopeKey, schoolId, ownerHref: href } : null);
    if (!intent || !eventAdminIntentValid(intent, scopeKey, schoolId)) { update(entry, { error: 'This exact event action could not be retained. Nothing was sent.' }); return false; }
    const recovering = !!entry.pending;
    let guard: () => void;
    try {
      const assertOperation = captureOperation(), context = captureApiContext();
      assertEventAdminOwner(intent, href); if (input && !assertReview) throw new Error('Return to the original event review before continuing this exact action.');
      guard = () => { assertOperation(); context.assertCurrent(); if (!active.current) throw new Error('The original screen closed. The action remains retained for recovery.'); };
      guard(); assertReview?.();
    } catch (cause) { update(entry, { error: cause instanceof Error ? cause.message : 'The original event review is no longer active.' }); return false; }
    const persist = async () => { try { await entry.storage!.write(JSON.stringify(intent)); update(entry, { pending: intent }); } catch (cause) { update(entry, { blocked: true, error: 'Secure event recovery could not confirm its write. Relaunch before another administrative change.' }); throw cause; } guard(); };
    const clear = async () => { try { await entry.storage!.clear(); update(entry, { pending: null }); } catch (cause) { update(entry, { blocked: true }); throw cause; } guard(); };
    update(entry, { busy: true, error: '', message: '' });
    try {
      const state = await executeEventAdminIntent(intent, recovering, {
        assertCurrent: guard, assertReview, persist: async () => persist(), clear,
        send: value => apiFetch<unknown>(eventAdminPath(value), { method: 'POST', body: JSON.stringify(value.body) }),
        inspectRules: async value => { const current = await apiFetch<unknown>(eventAdminPath(value)); guard(); if (eventRulesValid(current)) client.setQueryData(['campus', scopeKey, eventAdminPath(value)], current); return current; },
        refresh: value => client.invalidateQueries({ queryKey: ['campus', scopeKey], predicate: query => typeof query.queryKey[2] === 'string' && (query.queryKey[2].startsWith('/api/v1/campus-events') || query.queryKey[2].startsWith('/api/v1/operating-rules/') || query.queryKey[2] === '/api/v1/workspace'), refetchType: 'active' }, { throwOnError: value.kind !== 'discard' }),
      });
      if (state === 'rules_unconfirmed') { update(entry, { error: 'Current rules were read. This owner API has no command receipt; the earlier save remains unconfirmed. Campus support must reconcile it before another rules change.' }); return false; }
      update(entry, { message: intent.kind === 'discard' ? 'Event draft discarded.' : intent.kind === 'rules' ? 'Event attendance rules saved.' : intent.kind === 'grant' ? 'Reviewed event-consent authority recorded.' : 'Event-consent authority revoked. Earlier event decisions remain auditable.' }); return true;
    } catch (cause) {
      try { guard(); } catch { return false; }
      if (!recovering && intent.accepted === undefined && cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && ![408, 429].includes(cause.status)) {
        try { await clear(); } catch { update(entry, { blocked: true }); }
      }
      update(entry, { error: intent.accepted !== undefined ? 'The owning service accepted this action. Finish local recovery before another administrative change.' : cause instanceof Error ? cause.message : 'The action outcome is unknown. Its exact details remain retained.' }); return false;
    } finally { update(entry, { busy: false }); }
  }
  return { ...entry, locked: !entry.ready || entry.blocked || entry.busy || !!entry.pending, run };
}
export type EventAdminWriter = ReturnType<typeof useEventAdminCommand>;
export function EventAdminStatus({ writer, onDiscarded }: { writer: EventAdminWriter; onDiscarded?(): void }) {
  return <>{writer.error ? <Notice tone="danger" message={writer.error} /> : null}{writer.message ? <Notice tone="success" message={writer.message} /> : null}{writer.pending ? <><Notice tone="warning" message={writer.pending.accepted !== undefined ? 'This administrative action was accepted. Finish recovery to clear its local journal.' : writer.pending.kind === 'rules' ? 'This rules save has an unknown outcome. Review current rules; do not send another save.' : 'The exact original administrative action is retained securely. Recover it before another change.'} /><Button title={writer.pending.accepted !== undefined ? 'Finish administrative recovery' : writer.pending.kind === 'rules' ? 'Inspect current event rules' : 'Recover original administrative action'} busy={writer.busy} onPress={() => { const discarded = writer.pending?.kind === 'discard'; void writer.run().then(saved => { if (saved && discarded) onDiscarded?.(); }); }} /></> : null}</>;
}
