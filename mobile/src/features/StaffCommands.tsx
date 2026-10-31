import { useOperationContext } from '../lib/use-operation-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { ApiError, apiFetch, captureApiContext, getApiOrigin } from '../lib/api';
import { createChunkedNativePendingStorage } from '../lib/native-pending-action';
import { Button, Notice } from '../ui/components';
import { staffCommandReplayable, staffCommandValid, staffReceiptMatches, type StaffPendingCommand as Pending } from './StaffCommandPolicy';
const paramsOf=(href:string)=>new URLSearchParams(href.split('?')[1]??'');
// Native stacks retain previous screen instances. Share journal locks and
// committed state so returning to one cannot overwrite another's unknown action.
type SecureEntry<T> = { value: T | null; busy: boolean; loaded?: Promise<void>; listeners: Set<() => void> };
const secureEntries = new Map<string, SecureEntry<unknown>>();
function secureEntry<T>(key: string): SecureEntry<T> {
  let entry = secureEntries.get(key);
  if (!entry) { entry = { value: null, busy: false, listeners: new Set() }; secureEntries.set(key, entry); }
  return entry as SecureEntry<T>;
}
function changedEntry(entry: SecureEntry<unknown>) { for (const listener of entry.listeners) listener(); }
function encryptedJournal(key: string) {
  const storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (name, value) => SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
  return {
    read: async () => (await storage.read()) ?? SecureStore.getItemAsync(key),
    write: async (value: string) => { await storage.write(value); await SecureStore.deleteItemAsync(key); },
    clear: async () => { await storage.clear(); await SecureStore.deleteItemAsync(key); },
  };
}

const refused = (cause: unknown) => cause instanceof ApiError && [400, 401, 403, 404, 410, 422].includes(cause.status);
function useVisibleRecord() {
  const [focused, setFocused] = useState(false), current = useRef(false);
  useFocusEffect(useCallback(() => { current.current = true; setFocused(true); return () => { current.current = false; setFocused(false); }; }, []));
  return { focused, current };
}

export const staffStatusLabel = (value: string) => ({ submitted: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', offered: 'Response needed', accepted: 'Accepted', declined: 'Declined', completed: 'Completed', cancelled: 'Cancelled', fallback_applied: 'Fallback applied', expired_unconfirmed: 'Expired · unconfirmed' }[value] ?? value.replaceAll('_', ' '));
// One scope-bound journal spans staff routes so navigating cannot replace an
// uncertain command with a different action. Assignment responses use their
// owning API's exact revision body; that API does not accept a command_id.
export function useStaffCommands(base: string, refresh: () => Promise<unknown>, source = '') {
  const { scopeKey } = useSession(), client = useQueryClient(), captureOperation = useOperationContext(JSON.stringify([base, source]));
  const [busy, setBusy] = useState(false), active = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [pending, setPendingState] = useState<Pending | null>(null), [journal, setJournal] = useState<string | null>(null);
  const setPending = (value: Pending | null) => { if (journal) { const entry = secureEntry<Pending>(journal); entry.value = value; changedEntry(entry); } setPendingState(value); };
  useEffect(() => { if (!journal) return; const entry = secureEntry<Pending>(journal), sync = () => { setPendingState(entry.value); setBusy(entry.busy); }; entry.listeners.add(sync); sync(); return () => { entry.listeners.delete(sync); }; }, [journal]);
  useEffect(() => { let mounted = true; void (async () => { try {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${getApiOrigin()}:${scopeKey}`);
    const key = `thatcampus.staff-command.${digest}`, entry = secureEntry<Pending>(key);
    if (!entry.loaded) entry.loaded = (async () => { const raw = await encryptedJournal(key).read();
    if (raw) {
      const command = JSON.parse(raw) as Pending;
      if (!staffCommandValid(command, base)) throw new Error('Invalid saved command');
      entry.value = command;
    }
    })();
    await entry.loaded; if (!mounted) return; setPendingState(entry.value);
    setJournal(key);
  } catch { if (mounted) setError('Secure action recovery is unavailable. Restore it before submitting staff actions.'); } })(); return () => { mounted = false; }; }, [scopeKey, base]);
  async function run(requested: Pending): Promise<boolean> {
    if (!journal || active.current || !mounted.current) return false;
    if (!staffCommandValid(requested, base)) { setError('This staff action does not match its current owning source. Nothing was sent.'); return false; }
    const entry = secureEntry<Pending>(journal);
    if (entry.busy) return false;
    if (entry.value && JSON.stringify([entry.value.path, entry.value.body]) !== JSON.stringify([requested.path, requested.body])) { setPendingState(entry.value); setError('An earlier staff action is retained. Review and recover that original action before making another change.'); return false; }
    entry.busy = true; changedEntry(entry);
    active.current = true; setBusy(true); setError(''); setMessage('');
    const recovering = entry.value !== null, command = entry.value ?? requested;
    let accepted = command.accepted;
    let context: ReturnType<typeof captureApiContext> | undefined;
    try {
      const assertOperation = captureOperation(), transport = captureApiContext(); context = { ...transport, assertCurrent() { assertOperation(); transport.assertCurrent(); } };
      if (!accepted) {
        if (recovering && !staffCommandReplayable(command)) { await refresh(); context.assertCurrent(); setError('Current staff records were read. This owner API has no exact command receipt; the earlier action remains unconfirmed. Campus support must reconcile it before another change.'); return false; }
        setPending(command);
        await encryptedJournal(journal).write(JSON.stringify(command));
        context.assertCurrent();
        if (!mounted.current) return false;
        const result = await apiFetch<Record<string, unknown>>(command.path, { method: command.method ?? 'POST', body: JSON.stringify(command.body) });
        context.assertCurrent();
        if (!staffReceiptMatches(command, result)) throw new Error('The server did not confirm this exact staff action. Its original details are retained.');
        accepted = result;
        const saved = { ...command, accepted }; setPending(saved);
        // Preserve known acceptance if local cleanup or refreshing later fails.
        await encryptedJournal(journal).write(JSON.stringify(saved));
      }
      context.assertCurrent();
      await encryptedJournal(journal).clear(); setPending(null); context.assertCurrent();
      setMessage(`${command.label}: ${accepted.status ? staffStatusLabel(String(accepted.status)) : 'recorded'}.`);
      try { context.assertCurrent(); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); context.assertCurrent(); await refresh(); context.assertCurrent(); }
      catch { setError('The action was recorded. Refresh to load its latest status.'); }
      return true;
    } catch (cause) {
      // A verified first refusal may clear only this captured scope's journal;
      // expiry can already have changed the active binding at this point.
      if (!accepted && !recovering && refused(cause)) { try { await encryptedJournal(journal).clear(); setPending(null); } catch { /* Keep original evidence locked when cleanup is unconfirmed. */ } }
      try { context?.assertCurrent(); } catch { return false; }
      setError(accepted ? 'The server recorded the action. Finish secure local cleanup before making another change.' : cause instanceof Error ? cause.message : 'The action’s result could not be confirmed.');
      return !!accepted;
    } finally { entry.busy = false; changedEntry(entry); active.current = false; setBusy(false); }
  }
  return { busy, error, message, pending, journal, run, setError, blocked: busy || !!pending || !journal };
}
export function CommandStatus({ commands }: { commands: ReturnType<typeof useStaffCommands> }) {
  return <>{commands.error ? <Notice tone="danger" message={commands.error} /> : null}{commands.message ? <Notice tone="success" message={commands.message} /> : null}{commands.pending ? <><Notice tone="warning" message={commands.pending.accepted ? `${commands.pending.label} was recorded. Finish local recovery before another action.` : `${commands.pending.label} has an unconfirmed result. Its original details are retained securely. Recover that action before making another change.`} /><Button title={commands.pending.accepted ? 'Finish local recovery' : staffCommandReplayable(commands.pending) ? 'Recover original staff action' : 'Inspect current staff records'} busy={commands.busy} onPress={() => void commands.run(commands.pending!)} /></> : null}</>;
}
export function useStaffAttention(href: string, exact: boolean) {
  const { scopeKey } = useSession(), client = useQueryClient(), attempt = useRef(''), visible = useVisibleRecord();
  useEffect(() => {
    const id = paramsOf(href).get('attention_notification_id');
    if (!visible.focused || !visible.current.current || !id || !exact || attempt.current === href) return;
    attempt.current = href;
    void apiFetch(`/api/v1/notifications/${encodeURIComponent(id)}/read/`, { method: 'POST', body: JSON.stringify({ opened_target: href }) }).then(() => client.invalidateQueries({ queryKey: ['campus', scopeKey] })).catch(() => { attempt.current = ''; });
  }, [href, exact, scopeKey, client, visible.focused, visible.current]);
}
