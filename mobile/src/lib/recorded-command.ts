import { diningDateCommandValid, diningDateObsolete } from './dining-operations';
import { accommodationSetupCommandValid, accommodationSetupKind, accommodationSetupResult } from './accommodation-setup';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
type NativeApi = typeof import('./api');
type RecordedApiContext = ReturnType<NativeApi['captureApiContext']>;

export type RecordedDomain = 'resources' | 'facilities' | 'dining' | 'accommodation';
export interface RecordedCommand {
  version: 1; scopeKey: string; domain: RecordedDomain; root: string;
  key: string; sourceId: string; kind?: string; method: 'POST' | 'PUT';
  path: string; confirmationPath: string | null; body: string; phase: 'prepared' | 'unknown' | 'accepted';
}
export interface RecordedCommandInput {
  path: string; body: Record<string, unknown>; sourceId?: string; kind?: string; method?: 'POST' | 'PUT';
}
export function recordedConfirmationPath(domain: RecordedDomain, root: string, sourceId: string, key: string, kind?: string) {
  // Item creation belongs to campus_topology.lending_item. The loan receipt
  // endpoint cannot confirm it; only its identical idempotent request can.
  if (domain === 'resources' && kind === 'item') return null;
  const params = new URLSearchParams({ command_id: key });
  if (domain === 'accommodation' && accommodationSetupKind(kind)) return `${root}/setup/confirmation?${params}`;
  if (domain === 'dining') { params.set('source_id', sourceId); return `${root}/confirmation?${params}`; }
  return `${root}/${domain === 'resources' ? 'loans' : domain === 'facilities' ? 'repairs' : 'stays'}/${encodeURIComponent(sourceId)}/confirmation?${params}`;
}
export function validateRecordedCommand(value: unknown, scopeKey: string, domain: RecordedDomain, root: string): value is RecordedCommand {
  if (!value || typeof value !== 'object') return false;
  const record = value as RecordedCommand;
  if (record.version !== 1 || record.scopeKey !== scopeKey || record.domain !== domain || record.root !== root
    || typeof record.key !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(record.key)
    || typeof record.sourceId !== 'string' || !record.sourceId || !['POST', 'PUT'].includes(record.method)
    || !['prepared', 'unknown', 'accepted'].includes(record.phase) || typeof record.path !== 'string'
    || !record.path.startsWith(`${root}/`) || record.path.includes('?') || record.path.includes('..') || record.path.includes('\\')
    || record.confirmationPath !== recordedConfirmationPath(domain, root, record.sourceId, record.key, record.kind) || typeof record.body !== 'string') return false;
  try {
    const body = JSON.parse(record.body) as Record<string, unknown>;
    if (domain === 'dining' && record.path.includes('/dates/')) return diningDateCommandValid(record, body);
    if (domain === 'accommodation' && accommodationSetupKind(record.kind)) return accommodationSetupCommandValid(record, body);
    if (record.kind === 'item') {
      const quantity = body.quantity ?? 1;
      return domain === 'resources' && record.path === `${root}/items` && record.method === 'POST' && record.sourceId === record.key && body.command_id === record.key
        && Object.keys(body).every(key => ['command_id', 'name', 'quantity', 'asset_tag', 'campus_id', 'resource_type_id'].includes(key))
        && typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 160
        && Number.isSafeInteger(quantity) && Number(quantity) >= 1 && Number(quantity) <= 100
        && typeof body.campus_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.campus_id)
        && (body.resource_type_id === undefined || typeof body.resource_type_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.resource_type_id))
        && (body.asset_tag === undefined || typeof body.asset_tag === 'string' && body.asset_tag.trim().length <= (Number(quantity) > 1 ? 76 : 80));
    }
    return body.command_id === record.key && Number.isSafeInteger(body.expected_revision) && (body.expected_revision as number) >= 0;
  } catch { return false; }
}
export type RecordedItemValidator = (command: RecordedCommand, result: unknown) => boolean | Promise<boolean>;
export function acceptedRecordedResult(command: Pick<RecordedCommand, 'sourceId' | 'kind'> & Partial<RecordedCommand>, result: unknown, acceptsItemResult?: RecordedItemValidator) {
  if (command.domain === 'accommodation' && accommodationSetupKind(command.kind)) return accommodationSetupResult(command as RecordedCommand, result);
  if (command.kind === 'item') return command.domain === 'resources' && !!acceptsItemResult && acceptsItemResult(command as RecordedCommand, result);
  if (!result || typeof result !== 'object') return false;
  const proof = result as { id?: unknown; kind?: unknown; revision?: unknown };
  return proof.id === command.sourceId && typeof proof.revision === 'number' && Number.isSafeInteger(proof.revision) && proof.revision > 0
    && (!command.kind || proof.kind === command.kind);
}
export async function recoverRecordedItem(command: RecordedCommand, operations: { refresh(command: RecordedCommand): Promise<void>; replay(command: RecordedCommand): Promise<void> }) {
  if (command.domain !== 'resources' || command.kind !== 'item' || command.confirmationPath !== null || !validateRecordedCommand(command, command.scopeKey, 'resources', command.root)) throw new Error('The exact item recovery source could not be verified.');
  if (command.phase === 'accepted') await operations.refresh(command);
  else await operations.replay(command);
}
export function isDefinitiveRecordedRefusal(error: unknown, previouslyUncertain: boolean) {
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : undefined;
  return !previouslyUncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}
export function isRecordedCommandObsolete(command: RecordedCommand, error: unknown) {
  if (command.domain === 'dining' && command.path.includes('/dates/')) return diningDateObsolete(command, error);
  if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 409 || !('details' in error)) return false;
  const envelope = error.details as { error?: { code?: string; fields?: Record<string, Record<string, unknown>> } };
  const name = command.domain === 'resources' ? 'resource_loan_obsolete' : command.domain === 'facilities' ? 'facilities_obsolete' : command.domain === 'accommodation' ? 'accommodation_obsolete' : 'dining_obsolete';
  const proof = envelope?.error?.fields?.[name];
  const revision = (JSON.parse(command.body) as { expected_revision: number }).expected_revision;
  const sourceKey = command.domain === 'resources' ? 'loan_id' : command.domain === 'facilities' ? 'repair_id' : 'source_id';
  return envelope?.error?.code === name && proof?.confirmation === 'permanently_inapplicable' && proof.receipt_state === 'absent'
    && proof.command_id === command.key && proof[sourceKey] === command.sourceId && proof.expected_revision === revision
    && proof.reason === 'stream_advanced' && typeof proof.current_revision === 'number' && Number.isSafeInteger(proof.current_revision) && proof.current_revision > revision;
}
async function storageKey(scope: string, domain: RecordedDomain, context?: RecordedApiContext) {
  const Crypto = await import('expo-crypto');
  context?.assertCurrent(); const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scope); context?.assertCurrent();
  return `thatcampus.pending.${domain}.${digest}`;
}
async function persist(command: RecordedCommand, context: RecordedApiContext) {
  const SecureStore = await import('./device-storage'); context.assertCurrent();
  const key = await storageKey(command.scopeKey, command.domain, context); context.assertCurrent();
  await SecureStore.setItemAsync(key, JSON.stringify(command), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); context.assertCurrent();
}
async function remove(command: RecordedCommand, context: RecordedApiContext) {
  const SecureStore = await import('./device-storage'); context.assertCurrent();
  const key = await storageKey(command.scopeKey, command.domain, context); context.assertCurrent();
  // The journal forgets durable cleanup before its post-I/O visibility check.
  await SecureStore.deleteItemAsync(key);
}

export interface RecordedCommandState { ready: boolean; storageBlocked: boolean; pending: RecordedCommand | null; busy: boolean; error: string; retryAllowed: boolean }
export interface RecordedCommandContext {
  assertActive(): void;
  accepted(command: RecordedCommand): Promise<void>;
  acceptsItemResult?: RecordedItemValidator;
  refreshObsolete(): Promise<unknown>;
}
interface RecordedJournalOptions {
  scopeKey: string; domain: RecordedDomain; root: string;
  read(): Promise<string | null>;
  persist(command: RecordedCommand, context: RecordedApiContext): Promise<void>;
  remove(command: RecordedCommand, context: RecordedApiContext): Promise<void>;
  createId(): Promise<string>;
  captureContext(): RecordedApiContext;
  send(command: RecordedCommand, context: RecordedApiContext): Promise<unknown>;
  confirm(command: RecordedCommand, context: RecordedApiContext): Promise<{ state: string; result?: unknown }>;
}

/** One journal serializes every retained native stack screen in this exact scope.
 * Screens supply callbacks only for their current operation; the journal never
 * retains a screen's domain callback or lets another mount replace its intent. */
export class RecordedCommandJournal {
  private state: RecordedCommandState = { ready: false, storageBlocked: false, pending: null, busy: false, error: '', retryAllowed: false };
  private listeners = new Set<(state: RecordedCommandState) => void>();
  private hydrating?: Promise<void>;
  constructor(private options: RecordedJournalOptions) {}
  snapshot() { return this.state; }
  subscribe(listener: (state: RecordedCommandState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(changes: Partial<RecordedCommandState>) { this.state = { ...this.state, ...changes }; for (const listener of this.listeners) listener(this.state); }
  hydrate() {
    if (!this.hydrating) this.hydrating = (async () => {
      try {
        const raw = await this.options.read(), command: unknown = raw ? JSON.parse(raw) : null;
        if (raw && !validateRecordedCommand(command, this.options.scopeKey, this.options.domain, this.options.root)) throw new Error('A retained action could not be verified. Its details have been kept; contact support before repeating it.');
        const pending = command as RecordedCommand | null;
        this.update({ ready: true, pending, error: pending ? pending.phase === 'accepted' ? 'This action was saved. Refresh its record to finish.' : 'An earlier action is not confirmed. Check its result before starting another action.' : '' });
      } catch (cause) { this.update({ ready: true, storageBlocked: true, error: this.message(cause) }); }
    })();
    return this.hydrating;
  }
  private message(cause: unknown) { return cause instanceof Error ? cause.message : 'The action could not be confirmed.'; }
  preparationFailed(cause: unknown) { this.update({ error: this.message(cause) }); }
  private async action(context: RecordedCommandContext, operation: (guard: RecordedApiContext) => Promise<void>) {
    if (!this.state.ready || this.state.storageBlocked || this.state.busy) return;
    this.update({ busy: true, error: '' });
    try {
      const transport = this.options.captureContext(), guard = { assertCurrent: () => { transport.assertCurrent(); context.assertActive(); } };
      guard.assertCurrent(); await operation(guard);
    } catch (cause) { this.update({ error: this.message(cause) }); }
    finally { this.update({ busy: false }); }
  }
  private async finish(command: RecordedCommand, guard: RecordedApiContext, context: RecordedCommandContext) {
    const accepted: RecordedCommand = { ...command, phase: 'accepted' };
    this.update({ pending: accepted });
    await this.options.persist(accepted, guard); guard.assertCurrent();
    await context.accepted(accepted); guard.assertCurrent();
    await this.options.remove(accepted, guard);
    this.update({ pending: null, error: '', retryAllowed: false });
    guard.assertCurrent();
  }
  private async perform(command: RecordedCommand, guard: RecordedApiContext, context: RecordedCommandContext) {
    const unknown: RecordedCommand = { ...command, phase: 'unknown' };
    this.update({ pending: unknown });
    await this.options.persist(unknown, guard); guard.assertCurrent();
    try {
      const result = await this.options.send(command, guard); guard.assertCurrent();
      const accepted = await acceptedRecordedResult(command, result, context.acceptsItemResult); guard.assertCurrent();
      if (!accepted) throw new Error('The response did not confirm this exact record. Check its result.');
      await this.finish(command, guard, context);
    } catch (cause) {
      if (this.state.pending?.phase !== 'accepted' && isRecordedCommandObsolete(command, cause)) {
        guard.assertCurrent(); await this.options.remove(command, guard); this.update({ pending: null, retryAllowed: false }); guard.assertCurrent();
        await context.refreshObsolete(); guard.assertCurrent();
        throw new Error('This record changed before your action could apply. The current record has been refreshed; review it before sending a new action.');
      }
      if (this.state.pending?.phase !== 'accepted' && isDefinitiveRecordedRefusal(cause, command.phase !== 'prepared')) {
        guard.assertCurrent(); await this.options.remove(command, guard); this.update({ pending: null }); guard.assertCurrent();
      }
      throw cause;
    }
  }
  run(input: RecordedCommandInput, context: RecordedCommandContext) {
    if (this.state.pending) return Promise.resolve();
    return this.action(context, async guard => {
      if (input.kind === 'item' && (this.options.domain !== 'resources' || !context.acceptsItemResult)) throw new Error('Exact item batch validation is unavailable. Nothing was sent.');
      const key = await this.options.createId(); guard.assertCurrent();
      const sourceId = input.sourceId ?? key;
      const command: RecordedCommand = { version: 1, scopeKey: this.options.scopeKey, domain: this.options.domain, root: this.options.root, key, sourceId, kind: input.kind,
        method: input.method ?? 'POST', path: input.path, confirmationPath: recordedConfirmationPath(this.options.domain, this.options.root, sourceId, key, input.kind),
        body: JSON.stringify({ ...input.body, command_id: key }), phase: 'prepared' };
      if (!validateRecordedCommand(command, this.options.scopeKey, this.options.domain, this.options.root)) throw new Error('This action could not be safely retained.');
      this.update({ pending: command, retryAllowed: false });
      try { await this.options.persist(command, guard); } catch (cause) { guard.assertCurrent(); this.update({ storageBlocked: true }); throw cause; }
      guard.assertCurrent(); await this.perform(command, guard, context);
    });
  }
  check(context: RecordedCommandContext) {
    return this.action(context, async guard => {
      const command = this.state.pending; if (!command) return;
      if (command.kind === 'item' && !context.acceptsItemResult) throw new Error('Exact item batch validation is unavailable. The retained action was kept.');
      if (command.domain === 'resources' && command.kind === 'item' && command.confirmationPath === null) {
        await recoverRecordedItem(command, { refresh: value => this.finish(value, guard, context), replay: value => this.perform(value, guard, context) }); return;
      }
      if (command.phase === 'accepted') { await this.finish(command, guard, context); return; }
      if (!command.confirmationPath) throw new Error('The owning confirmation path is unavailable. The exact action was kept.');
      const receipt = await this.options.confirm(command, guard); guard.assertCurrent();
      if (receipt.state === 'accepted') {
        const accepted = await acceptedRecordedResult(command, receipt.result); guard.assertCurrent();
        if (!accepted) throw new Error('The confirmation belongs to a different record. Keep this action and check again.');
        await this.finish(command, guard, context);
      } else if (receipt.state === 'not_found') this.update({ retryAllowed: true, error: 'No accepted result was found. You may retry the same action with its unchanged details.' });
      else if (receipt.state === 'not_accepted') {
        await this.options.remove(command, guard); this.update({ pending: null, retryAllowed: false, error: 'The action was not accepted. Refresh and review the current record before sending a new action.' }); guard.assertCurrent();
      } else this.update({ error: 'The action is still being checked. Check again shortly.' });
    });
  }
  retry(context: RecordedCommandContext) {
    if (!this.state.retryAllowed) return Promise.resolve();
    return this.action(context, async guard => { const command = this.state.pending; if (!command) return; if (command.kind === 'item' && !context.acceptsItemResult) throw new Error('Exact item batch validation is unavailable. The retained action was kept.'); this.update({ retryAllowed: false }); await this.perform(command, guard, context); });
  }
}

const journals = new Map<string, RecordedCommandJournal>();
export function sharedRecordedCommandJournal(scopeKey: string, domain: RecordedDomain, root: string, create: () => RecordedCommandJournal) {
  const key = JSON.stringify([scopeKey, domain, root]), existing = journals.get(key);
  if (existing) return existing;
  const journal = create(); journals.set(key, journal); return journal;
}

/** Retains exact intent before dispatch and resolves lost responses through owner receipts. */
export function useRecordedCommand({ scopeKey, domain, root, onAccepted, acceptsItemResult, captureOperation }: {
  scopeKey: string; domain: RecordedDomain; root: string; onAccepted: (command: RecordedCommand) => Promise<void>; acceptsItemResult?: RecordedItemValidator;
  captureOperation(): () => void;
}) {
  const client = useQueryClient(), active = useRef(false);
  const journal = useMemo(() => sharedRecordedCommandJournal(scopeKey, domain, root, () => {
    let api: NativeApi | null = null;
    return new RecordedCommandJournal({ scopeKey, domain, root,
      read: async () => { api = await import('./api'); const SecureStore = await import('./device-storage'); return SecureStore.getItemAsync(await storageKey(scopeKey, domain)); },
      persist, remove,
      createId: async () => { const Crypto = await import('expo-crypto'); return Crypto.randomUUID(); },
      captureContext: () => { if (!api) throw new Error('Native action transport is not ready.'); return api.captureApiContext(); },
      send: async (command, guard) => { guard.assertCurrent(); return api!.apiFetch<unknown>(command.path, { method: command.method, body: command.body }); },
      confirm: async (command, guard) => { guard.assertCurrent(); return api!.apiFetch<{ state: string; result?: unknown }>(command.confirmationPath!); },
    });
  }), [scopeKey, domain, root]);
  const [state, setState] = useState(journal.snapshot());
  useEffect(() => { active.current = true; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { active.current = false; unsubscribe(); }; }, [journal]);
  const invoke = (operation: (context: RecordedCommandContext) => Promise<void>) => {
    try {
      // Capture the actual focused href/source before identity or storage work.
      const assertCurrent = captureOperation();
      return operation({
        assertActive() { assertCurrent(); if (!active.current) throw new Error('The original screen closed. The exact action remains retained for recovery.'); },
        accepted: onAccepted, acceptsItemResult,
        refreshObsolete: () => client.invalidateQueries({ queryKey: ['campus', scopeKey] }, { throwOnError: true }),
      });
    } catch (cause) { journal.preparationFailed(cause); return Promise.resolve(); }
  };
  return { ...state, locked: !state.ready || state.storageBlocked || state.busy || Boolean(state.pending),
    run: (input: RecordedCommandInput) => invoke(context => journal.run(input, context)), check: () => invoke(context => journal.check(context)), retry: () => invoke(context => journal.retry(context)),
  };
}
