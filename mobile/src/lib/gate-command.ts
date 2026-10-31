import { useEffect, useRef, useState } from 'react';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface GateCommandInput {
  path: string; body: string; label: string; commandId?: string; visitId?: string; shared?: boolean;
  sharing?: { shareId: string; shareRootId: string; questionId: string | null };
  shareMutation?: { previousShareId: string | null; shareRootId: string; action: 'shared' | 'renewed' | 'revoked' | 'taken_over' };
}
export interface NativeGateCommand extends GateCommandInput {
  version: 1; scopeKey: string; schoolId: string; key: string; sourceId: string;
  kind: 'person' | 'visitor' | 'visit' | 'visit-shared' | 'visit-sharing'; action: string; expectedRevision: number | null;
  phase: 'unknown' | 'accepted' | 'obsolete'; confirmationPath: string | null; reviewPath: string | null;
}

export function describeGateCommand(input: GateCommandInput, scopeKey: string, schoolId: string, localKey: string): NativeGateCommand | null {
  try {
    if (!scopeKey || !schoolId || !uuid.test(localKey) || typeof input.label !== 'string' || input.label.length > 500) return null;
    const body = object(JSON.parse(input.body)), root = `/api/v1/gate/schools/${encodeURIComponent(schoolId)}`;
    const encodedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const commandId = typeof body.command_id === 'string' && uuid.test(body.command_id) ? body.command_id : undefined;
    const revision = Number.isSafeInteger(body.expected_revision) && Number(body.expected_revision) >= 0 ? Number(body.expected_revision) : null;
    let kind: NativeGateCommand['kind'], sourceId: string, action: string, confirmationPath: string | null = null, reviewPath: string | null = null;
    if (input.path === `${root}/movements/` || input.path === `${root}/staff-movements/`) {
      kind = 'person'; sourceId = String(body[input.path === `${root}/movements/` ? 'student_id' : 'staff_profile_id'] ?? ''); action = String(body.direction);
      if (!commandId || body.identity_verified !== true || !['in', 'out'].includes(action)) return null;
    } else {
      const visitor = input.path.match(new RegExp(`^${encodedRoot}/visitors/([^/]+)/(approve|deny|in|out)/$`));
      const visit = input.path.match(new RegExp(`^${encodedRoot}/visit-arrangements/([^/]+)/(cancel|movements|update)/$`));
      const createVisit = input.path === `${root}/visit-arrangements/`;
      const question = input.path.match(new RegExp(`^${encodedRoot}/visit-arrangements/([^/]+)/shared/questions/(?:([^/]+)/replies/)?$`));
      const share = input.path.match(new RegExp(`^${encodedRoot}/visit-arrangements/([^/]+)/shares/(?:([^/]+)/(revoke|takeover)/)?$`));
      if (visitor) { kind = 'visitor'; sourceId = visitor[1]!; action = visitor[2]!; if (revision === null || revision < 1 || commandId) return null; }
      else if (createVisit) { if(!commandId||revision!==0)return null;kind='visit';sourceId=commandId;action='arranged'; }
      else if (visit) { kind = 'visit'; sourceId = visit[1]!; action = visit[2] === 'cancel' ? 'cancelled' : visit[2] === 'update' ? 'changed' : 'movement_recorded'; }
      else if (question) { kind = 'visit-shared'; sourceId = question[1]!; action = question[2] ? 'replied' : 'asked'; }
      else if (share) { kind = 'visit-sharing'; sourceId = share[1]!; action = input.shareMutation?.action ?? ''; }
      else return null;
      if (kind === 'visit' || kind === 'visit-shared' || kind === 'visit-sharing') {
        if (!commandId || revision === null) return null;
        const source = `${root}/visit-arrangements/${sourceId}`;
        confirmationPath = `${source}/${kind !== 'visit' ? 'shared/' : ''}commands/${commandId}/`;
        reviewPath = `${source}/${kind === 'visit-sharing' ? 'sharing/' : kind === 'visit-shared' ? 'shared/' : ''}`;
      }
      if (kind === 'visit-shared') {
        const sharing = input.sharing;
        if (!sharing || !uuid.test(sharing.shareId) || !uuid.test(sharing.shareRootId) || sharing.questionId !== null && !uuid.test(sharing.questionId)) return null;
        const questionId = input.path.match(/\/questions\/([^/]+)\/replies\/$/)?.[1];
        if (action === 'replied' ? questionId !== sharing.questionId : body.share_id !== sharing.shareId) return null;
      }
      if (kind === 'visit-sharing') {
        const mutation = input.shareMutation;
        if (!mutation || !uuid.test(mutation.shareRootId) || mutation.previousShareId !== null && !uuid.test(mutation.previousShareId)) return null;
        if (share![3]) {
          if (share![2] !== mutation.previousShareId || revision === 0 || action !== (share![3] === 'revoke' ? 'revoked' : 'taken_over')) return null;
        } else if (!['shared', 'renewed'].includes(action) || !Number.isSafeInteger(body.expected_visit_revision) || Number(body.expected_visit_revision) < 1
          || !uuid.test(String(body.organiser_person_id)) || !Number.isSafeInteger(body.organiser_person_revision) || Number(body.organiser_person_revision) < 1
          || !Number.isFinite(Date.parse(String(body.ends_at))) || typeof body.directions !== 'string' || body.directions.length > 1000
          || action === 'shared' && mutation.shareRootId !== commandId || action === 'renewed' && !mutation.previousShareId
          || (revision === 0) !== (mutation.previousShareId === null)) return null;
      }
    }
    if (!uuid.test(sourceId) || input.commandId !== undefined && input.commandId !== commandId || input.visitId !== undefined && input.visitId !== sourceId
      || input.shared !== undefined && input.shared !== (kind === 'visit-shared')) return null;
    return { ...input, version: 1, scopeKey, schoolId, key: commandId ?? localKey, sourceId, kind, action, expectedRevision: kind === 'person' ? null : revision,
      phase: 'unknown', confirmationPath, reviewPath };
  } catch { return null; }
}
export function validateNativeGateCommand(value: unknown, scopeKey: string, schoolId: string): value is NativeGateCommand {
  const command = object(value);
  if (command.version !== 1 || command.scopeKey !== scopeKey || command.schoolId !== schoolId || !['unknown', 'accepted', 'obsolete'].includes(String(command.phase)) || typeof command.key !== 'string'
    || typeof command.path !== 'string' || typeof command.body !== 'string' || typeof command.label !== 'string') return false;
  const described = describeGateCommand(command as unknown as GateCommandInput, scopeKey, schoolId, command.key);
  return !!described && ['key', 'sourceId', 'kind', 'action', 'expectedRevision', 'confirmationPath', 'reviewPath'].every(key => described[key as keyof NativeGateCommand] === command[key]);
}
export function nativeGateAcceptedResult(command: NativeGateCommand, value: unknown, receipt = false): boolean {
  const result = object(value);
  if (command.kind === 'person') return !receipt && result.saved === true && typeof result.id === 'string' && uuid.test(result.id);
  if (command.kind === 'visitor') {
    const visitor = object(result.visitor), state = ({ approve: 'approved', deny: 'denied', in: 'inside', out: 'out' } as Record<string, string>)[command.action];
    return !receipt && result.saved === true && visitor.id === command.sourceId && visitor.state === state && visitor.revision === Number(command.expectedRevision) + 1;
  }
  if (command.kind === 'visit') {
    const visit = object(result.visit);
    return visit.id === command.sourceId && Number.isSafeInteger(visit.revision) && Number(visit.revision) > Number(command.expectedRevision);
  }
  if (command.kind === 'visit-sharing') {
    const mutation = command.shareMutation!;
    if (receipt) return result.visit_id === command.sourceId && result.share_id === command.key && result.share_root_id === mutation.shareRootId
      && result.action === mutation.action && result.revision === Number(command.expectedRevision) + 1;
    const current = object(result.current);
    return current.id === command.key && current.root_id === mutation.shareRootId && current.revision === Number(command.expectedRevision) + 1
      && result.share_revision === current.revision;
  }
  const sharing = command.sharing!, expectedQuestion = sharing.questionId ?? command.key;
  if (receipt) return result.visit_id === command.sourceId && result.share_id === sharing.shareId && result.share_root_id === sharing.shareRootId
    && result.question_id === expectedQuestion && result.action === command.action && result.revision === Number(command.expectedRevision) + 1;
  const visit = object(result.visit), share = object(result.share), question = object(result.question);
  return visit.id === command.sourceId && share.id === sharing.shareId && share.root_id === sharing.shareRootId
    && question.id === expectedQuestion && Number.isSafeInteger(question.revision) && Number(question.revision) > Number(command.expectedRevision);
}
export function nativeGateObsolete(command: NativeGateCommand, cause: unknown): boolean {
  const failure = object(cause), error = object(object(failure.details).error);
  const code = command.kind === 'visit' ? 'visit_changed' : ['visit-shared', 'visit-sharing'].includes(command.kind) ? 'visit_sharing_changed' : null;
  if (!code || failure.status !== 409 || error.code !== code) return false;
  const proof = object(object(error.fields)[code]);
  return proof.confirmation === 'permanently_inapplicable' && proof.receipt_state === 'absent' && proof.reason === 'stream_advanced'
    && proof.visit_id === command.sourceId && proof.command_id === command.key && proof.expected_revision === command.expectedRevision
    && Number.isSafeInteger(proof.current_revision) && Number(proof.current_revision) > Number(command.expectedRevision);
}
export function nativeGateFailureDisposition(command: NativeGateCommand, cause: unknown, previouslyUncertain: boolean, accepted = false): 'accepted' | 'obsolete' | 'refused' | 'unknown' {
  if (accepted || command.phase === 'accepted') return 'accepted';
  if (nativeGateObsolete(command, cause)) return 'obsolete';
  const failure = object(cause), status = failure.status;
  return !previouslyUncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status) ? 'refused' : 'unknown';
}
export function nativeGateConfirmationDisposition(command: NativeGateCommand, value: unknown): 'accepted' | 'retry-identical' | 'retain' {
  const confirmation = object(value);
  if (!command.confirmationPath) return 'retain';
  if (confirmation.state === 'accepted' && nativeGateAcceptedResult(command, confirmation.result, true)) return 'accepted';
  return confirmation.state === 'not_found' ? 'retry-identical' : 'retain';
}

interface JournalState { ready: boolean; blocked: boolean; busy: boolean; pending: NativeGateCommand | null; retryAllowed: boolean; error: string }
interface Entry { state: JournalState; listeners: Set<() => void>; loading?: Promise<void> }
interface GateOperationContext { assertCurrent(): void }
const entries = new Map<string, Entry>();
function entryFor(scopeKey: string): Entry { let entry = entries.get(scopeKey); if (!entry) { entry = { state: { ready: false, blocked: false, busy: false, pending: null, retryAllowed: false, error: '' }, listeners: new Set() }; entries.set(scopeKey, entry); } return entry; }
const update = (entry: Entry, values: Partial<JournalState>) => { entry.state = { ...entry.state, ...values }; entry.listeners.forEach(notify => notify()); };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The gate action was not confirmed.';
async function storageKey(scopeKey: string, context?: GateOperationContext) { const Crypto = await import('expo-crypto'); context?.assertCurrent(); const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, scopeKey); context?.assertCurrent(); return `thatcampus.gate-action.${digest}`; }
async function persist(command: NativeGateCommand, context: GateOperationContext) { const SecureStore = await import('./device-storage'); context.assertCurrent(); const key = await storageKey(command.scopeKey, context); context.assertCurrent(); await SecureStore.setItemAsync(key, JSON.stringify(command), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); context.assertCurrent(); }
/** Durable cleanup has completed even if the screen loses its lease during it. */
export async function clearGateCommandRecord(operations: { assertCurrent(): void; remove(): Promise<void>; forget(): void }) {
  operations.assertCurrent();
  await operations.remove();
  operations.forget();
  operations.assertCurrent();
}
async function clear(entry: Entry, scopeKey: string, context: GateOperationContext) {
  const SecureStore = await import('./device-storage'); context.assertCurrent(); const key = await storageKey(scopeKey, context); context.assertCurrent();
  await clearGateCommandRecord({ assertCurrent: () => context.assertCurrent(), remove: () => SecureStore.deleteItemAsync(key), forget: () => update(entry, { pending: null, retryAllowed: false }) });
}

/** One gate journal per exact account/campus/world, shared by retained native stack screens. */
export function useGateCommand(options: { scopeKey: string; schoolId: string; captureContext: () => GateOperationContext; refresh: (command?: NativeGateCommand) => Promise<unknown>; onAccepted?: (command?: NativeGateCommand) => void }) {
  const { scopeKey, schoolId } = options, entry = entryFor(scopeKey), [, rerender] = useState(0), active = useRef(true), callbacks = useRef(options); callbacks.current = options;
  useEffect(() => {
    active.current = true; const notify = () => rerender(value => value + 1); entry.listeners.add(notify);
    entry.loading ??= (async () => { try { const SecureStore = await import('./device-storage'), raw = await SecureStore.getItemAsync(await storageKey(scopeKey)); if (raw) { const command: unknown = JSON.parse(raw); if (!validateNativeGateCommand(command, scopeKey, schoolId)) throw new Error('A retained gate action could not be verified. Its secure record is kept; contact support before repeating it.'); update(entry, { pending: command, retryAllowed: command.phase === 'unknown' && !command.confirmationPath, error: command.phase === 'accepted' ? 'This gate action was saved. Refresh the saved result to finish.' : 'An earlier gate action needs its exact result checked.' }); } } catch (cause) { update(entry, { blocked: true, error: message(cause) }); } finally { update(entry, { ready: true }); } })();
    return () => { active.current = false; entry.listeners.delete(notify); };
  }, [entry, scopeKey, schoolId]);
  const finish = async (command: NativeGateCommand, context: GateOperationContext, operationOptions: typeof options) => {
    const accepted: NativeGateCommand = { ...command, phase: 'accepted' }; update(entry, { pending: accepted, retryAllowed: false }); await persist(accepted, context);
    context.assertCurrent(); if (!active.current) return;
    await operationOptions.refresh(command); context.assertCurrent(); await clear(entry, scopeKey, context); context.assertCurrent(); operationOptions.onAccepted?.(command); update(entry, { error: '' });
  };
  const perform = async (operation: () => Promise<void>) => {
    if (!active.current || entry.state.busy || !entry.state.ready || entry.state.blocked) return;
    update(entry, { busy: true, error: '' });
    try { await operation(); } catch (cause) { update(entry, { error: message(cause) }); } finally { update(entry, { busy: false }); }
  };
  const invoke = async (command: NativeGateCommand, previouslyUncertain: boolean, context: GateOperationContext, operationOptions: typeof options) => {
    update(entry, { pending: command, retryAllowed: false }); let accepted = false;
    try {
      await persist(command, context); context.assertCurrent();
      context.assertCurrent(); const { apiFetch } = await import('./api'); context.assertCurrent(); const result = await apiFetch(command.path, { method: 'POST', body: command.body }); context.assertCurrent();
      if (!nativeGateAcceptedResult(command, result)) throw new Error('The response did not prove this exact gate action.');
      accepted = true; await finish(command, context, operationOptions);
    } catch (cause) {
      const disposition = nativeGateFailureDisposition(command, cause, previouslyUncertain, accepted || entry.state.pending?.phase === 'accepted');
      if (disposition === 'refused') { await clear(entry, scopeKey, context); throw cause; }
      if (disposition === 'obsolete') { const obsolete: NativeGateCommand = { ...command, phase: 'obsolete' }; update(entry, { pending: obsolete, retryAllowed: false }); await persist(obsolete, context); throw new Error('The owning visit proves this command has no receipt and is obsolete. Review its current source before continuing; your entries are retained.'); }
      if (disposition === 'accepted') throw new Error('Saved. Refresh the saved gate result to finish; a new observation was not sent.');
      update(entry, { retryAllowed: !command.confirmationPath }); throw new Error(`${message(cause)} The exact original action stays securely locked. Check its owning result or retry the identical request.`);
    }
  };
  return { ...entry.state, locked: !entry.state.ready || entry.state.blocked || entry.state.busy || !!entry.state.pending,
    run: (input: GateCommandInput) => entry.state.pending ? Promise.resolve() : perform(async () => { const operationOptions = callbacks.current, context = operationOptions.captureContext(); const Crypto = await import('expo-crypto'); context.assertCurrent(); const command = describeGateCommand(input, scopeKey, schoolId, Crypto.randomUUID()); if (!command) throw new Error('This exact gate command could not be safely retained.'); await invoke(command, false, context, operationOptions); }),
    retry: () => perform(async () => { const operationOptions = callbacks.current, context = operationOptions.captureContext(), command = entry.state.pending; if (command?.phase === 'unknown' && entry.state.retryAllowed) await invoke(command, true, context, operationOptions); }),
    check: () => perform(async () => {
      const operationOptions = callbacks.current, context = operationOptions.captureContext(), command = entry.state.pending; if (!command) return;
      if (command.phase === 'accepted') { await finish(command, context, operationOptions); return; }
      const { apiFetch } = await import('./api'); context.assertCurrent();
      if (command.phase === 'obsolete' && command.reviewPath) { const current = object(await apiFetch(command.reviewPath)); context.assertCurrent(); const visit = object(current.visit); if (command.kind === 'visit-sharing' ? !Number.isSafeInteger(current.visit_revision) || !Number.isSafeInteger(current.share_revision) || Number(current.share_revision) <= Number(command.expectedRevision) : visit.id !== command.sourceId || !Number.isSafeInteger(visit.revision)) throw new Error('The current source did not match this exact visit.'); await operationOptions.refresh(command); context.assertCurrent(); await clear(entry, scopeKey, context); return; }
      if (!command.confirmationPath) throw new Error('This gate operation has no separate confirmation endpoint. Keep its exact action and retry the identical request; a changed current state alone does not prove its result.');
      context.assertCurrent(); const confirmation = object(await apiFetch(command.confirmationPath)); context.assertCurrent();
      const disposition = nativeGateConfirmationDisposition(command, confirmation);
      if (disposition === 'accepted') await finish(command, context, operationOptions);
      else if (disposition === 'retry-identical') update(entry, { retryAllowed: true, error: 'The exact owner found no receipt. You may retry the identical original action; its details remain locked.' });
      else { update(entry, { retryAllowed: false }); throw new Error(confirmation.state === 'pending' ? 'The exact action is still pending. Check again shortly.' : 'The owner did not provide an accepted result or an absent obsolete proof. The original action is kept.'); }
    }),
  };
}
