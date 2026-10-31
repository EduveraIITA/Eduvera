import { useOperationContext } from '../lib/use-operation-context';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '../lib/device-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useFeeCheckout } from '../lib/use-fee-checkout';
import { useSession } from '../auth/SessionProvider';
import { ApiError, apiFetch, captureApiContext } from '../lib/api';
import { createChunkedNativePendingStorage } from '../lib/native-pending-action';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Notice } from '../ui/components';
import { feesReviewJournal, hydrateFeesReviewJournal } from './FeesReviewJournal';
import { feesConfirmation, feesIntentValid, feesPath, feesReadPath, feesResultMatches, type FeesIntent } from './FeesCommandPolicy';
type Entry = { pending: FeesIntent | null; ready: boolean; blocked: boolean; busy: boolean; retry: boolean; error: string; message: string; storage?: ReturnType<typeof createChunkedNativePendingStorage>; loaded?: Promise<void>; listeners: Set<() => void> };
const entries = new Map<string, Entry>();
function entryFor(scope: string) { let entry = entries.get(scope); if (!entry) { entry = { pending: null, ready: false, blocked: false, busy: false, retry: false, error: '', message: '', listeners: new Set() }; entries.set(scope, entry); } return entry; }
function update(entry: Entry, values: Partial<Entry>) { Object.assign(entry, values); for (const listener of entry.listeners) listener(); }
export function useFeesCommands(schoolId: string, source: string) {
  const checkout=useFeeCheckout(schoolId),checkoutBlocked=()=>{const current=checkout.controller.snapshot();return !current.ready||current.blocked||current.busy||!!current.pending;};
  const { scopeKey } = useSession(), client = useQueryClient(), active = useRef(false), entry = useMemo(() => entryFor(scopeKey), [scopeKey]), reviewJournal = feesReviewJournal(scopeKey), [, render] = useState(0);
  useEffect(() => { active.current = true; const notify = () => render(value => value + 1); entry.listeners.add(notify); reviewJournal.listeners.add(notify); void hydrateFeesReviewJournal(scopeKey, schoolId);
    if (!entry.loaded) entry.loaded = (async () => { try { const key = `thatcampus.fees-operations.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey)}`;
      entry.storage = createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (name, value) => SecureStore.setItemAsync(name, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, key);
      const raw = await entry.storage.read(), pending: unknown = raw ? JSON.parse(raw) : null;
      if (pending && (!feesIntentValid(pending, scopeKey, schoolId) || pending.accepted !== undefined && !feesResultMatches(pending, pending.accepted))) throw new Error('Retained finance evidence cannot be verified. Its data is kept. Restore secure recovery before another financial action.'); update(entry, { ready: true, pending: pending as FeesIntent | null });
    } catch (cause) { update(entry, { ready: true, blocked: true, error: cause instanceof Error ? cause.message : 'Secure finance recovery is unavailable.' }); } })();
    return () => { active.current = false; entry.listeners.delete(notify); reviewJournal.listeners.delete(notify); };
  }, [entry, scopeKey, schoolId]);
  const captureOperation = useOperationContext(JSON.stringify([schoolId, source]));
  useScreenExitGuard({ blocked: entry.busy });
  const available = () => entry.ready && !entry.blocked && !entry.busy && active.current;
  function guard() { const assertOperation = captureOperation(), context = captureApiContext(); return () => { assertOperation(); context.assertCurrent(); if (!active.current) throw new Error('The original screen closed. Its exact financial action remains retained.'); }; }
  async function clear(assertCurrent: () => void) { try { await entry.storage!.clear(); update(entry, { pending: null, retry: false }); } catch (cause) { update(entry, { blocked: true }); throw cause; } assertCurrent(); }
  async function persist(intent: FeesIntent, assertCurrent: () => void) { try { await entry.storage!.write(JSON.stringify(intent)); update(entry, { pending: intent }); } catch (cause) { update(entry, { blocked: true }); throw cause; } assertCurrent(); }
  async function finish(intent: FeesIntent, assertCurrent: () => void) { await persist(intent, assertCurrent); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }, { throwOnError: true }); assertCurrent(); await clear(assertCurrent); update(entry, { message: 'Finance recorded this exact action. Current records refreshed.' }); return intent.accepted; }
  async function run(input?: Omit<FeesIntent, 'version' | 'scope' | 'schoolId' | 'accepted'>) {
    if (!available() || input && checkoutBlocked() || input && (!reviewJournal.ready || reviewJournal.blocked || reviewJournal.busy || reviewJournal.pending) || input && entry.pending || !input && (!entry.pending || !entry.retry && entry.pending.accepted === undefined)) return undefined;
    const intent = entry.pending ?? (input ? { ...input, version: 1 as const, scope: scopeKey, schoolId, body: { ...input.body, ...(['settings', 'invoice', 'guardianDecision'].includes(input.kind) ? {} : input.kind === 'manualPayment' ? { idempotency_key: Crypto.randomUUID() } : { command_id: Crypto.randomUUID() }) } } : null);
    if (!intent || !feesIntentValid(intent, scopeKey, schoolId)) { update(entry, { error: 'This financial action does not match its reviewed source. Nothing was sent.' }); return undefined; }
    const recovering = !!entry.pending; let assertCurrent: () => void; try { assertCurrent = guard(); } catch (cause) { update(entry, { error: cause instanceof Error ? cause.message : 'Return to the original Finance screen.' }); return undefined; } update(entry, { busy: true, error: '', message: '', retry: false });
    try { if (intent.accepted === undefined) { await persist(intent, assertCurrent); const result = await apiFetch<unknown>(feesPath(intent), { method: 'POST', body: JSON.stringify(intent.body) }); assertCurrent(); if (!feesResultMatches(intent, result)) throw new Error('The result did not confirm the exact reviewed financial action. Check its owner receipt.'); intent.accepted = result; update(entry, { pending: intent }); } return await finish(intent, assertCurrent);
    } catch (cause) { try { assertCurrent(); } catch { return undefined; } if (!recovering && intent.accepted === undefined && cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && ![408, 409, 429].includes(cause.status)) { try { await clear(assertCurrent); } catch { update(entry, { blocked: true }); } } update(entry, { error: intent.accepted !== undefined ? 'Finance accepted this action. Finish local recovery before another action.' : cause instanceof Error ? cause.message : 'The result is unconfirmed. Its original financial details remain retained.' }); return undefined; }
    finally { update(entry, { busy: false }); }
  }
  async function check() { if (!available() || !entry.pending) return undefined; const intent = entry.pending; let assertCurrent: () => void; try { assertCurrent = guard(); } catch (cause) { update(entry, { error: cause instanceof Error ? cause.message : 'Return to the original Finance screen.' }); return undefined; } update(entry, { busy: true, error: '', retry: false });
    try { if (intent.accepted !== undefined) return await finish(intent, assertCurrent);
      if (intent.kind === 'manualPayment' || intent.kind === 'guardianDecision') { const result = await apiFetch<unknown>(feesPath(intent), { method: 'POST', body: JSON.stringify(intent.body) }); assertCurrent(); if (!feesResultMatches(intent, result)) throw new Error('The original payment action was not confirmed. Its exact evidence is retained.'); intent.accepted = result; return await finish(intent, assertCurrent); }
      const value = await apiFetch<unknown>(feesReadPath(intent)); assertCurrent();
      if (intent.kind === 'settings' || intent.kind === 'invoice') { update(entry, { error: 'Current fee records were read. This API has no exact command receipt; the earlier action remains unconfirmed. Campus support must reconcile it before another financial change.' }); return undefined; }
      const receipt = feesConfirmation(intent, value); if (!receipt) throw new Error('The receipt does not match this retained financial action. It remains locked.');
      if (receipt.state === 'accepted') { intent.accepted = receipt.result; return await finish(intent, assertCurrent); }
      if (receipt.state === 'not_found') update(entry, { retry: true, error: 'The exact command has no accepted receipt. You may retry its unchanged original details.' });
      else if (receipt.state === 'not_accepted') { await clear(assertCurrent); await client.invalidateQueries({ queryKey: ['campus', scopeKey] }); assertCurrent(); update(entry, { error: 'The original command was not accepted. Review current records before a new action.' }); }
      else update(entry, { error: 'The owning command is still pending. Check again shortly.' });
    } catch (cause) { try { assertCurrent(); } catch { return undefined; } update(entry, { error: cause instanceof Error ? cause.message : 'The exact receipt could not be checked. Nothing was resent.' }); }
    finally { update(entry, { busy: false }); }
  }
  return { ...entry, financialBlocked:()=>!entry.ready || entry.blocked || entry.busy || !!entry.pending || !reviewJournal.ready || reviewJournal.blocked || reviewJournal.busy || !!reviewJournal.pending, financialLocked: !entry.ready || entry.blocked || entry.busy || !!entry.pending || !reviewJournal.ready || reviewJournal.blocked || reviewJournal.busy || !!reviewJournal.pending, checkoutBlocked:checkoutBlocked(), reviewBlocked: !reviewJournal.ready || reviewJournal.blocked || reviewJournal.busy || !!reviewJournal.pending, locked: checkoutBlocked() || !entry.ready || entry.blocked || entry.busy || !!entry.pending || !reviewJournal.ready || reviewJournal.blocked || reviewJournal.busy || !!reviewJournal.pending, run, check };
}
export type FeesWriter = ReturnType<typeof useFeesCommands>;
export function FeesCommandStatus({ writer }: { writer: FeesWriter }) { return <>{writer.reviewBlocked && !writer.pending ? <Notice tone="warning" message="A payment report or fee-review action needs recovery. Open Reports and questions to recover its exact result before another financial change." /> : null}{writer.error ? <Notice tone="danger" message={writer.error} /> : null}{writer.message ? <Notice tone="success" message={writer.message} /> : null}{writer.pending ? <><Notice tone="warning" message={writer.pending.accepted !== undefined ? 'This financial action was accepted. Refresh its recorded result to finish recovery.' : 'This financial action has an unknown outcome. Its exact reviewed source, content and command key remain retained securely.'} /><Button title={writer.pending.accepted !== undefined ? 'Finish accepted finance action' : writer.pending.kind === 'settings' || writer.pending.kind === 'invoice' ? 'Inspect current fee records' : ['manualPayment', 'guardianDecision'].includes(writer.pending.kind) ? 'Recover identical original payment action' : 'Check exact finance result'} busy={writer.busy} onPress={() => { void writer.check(); }} />{writer.retry ? <Button title="Retry unchanged original finance action" kind="secondary" disabled={writer.busy} onPress={() => { void writer.run(); }} /> : null}</> : null}</>; }
