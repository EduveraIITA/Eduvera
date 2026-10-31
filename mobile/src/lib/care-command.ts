import { careUuid, type CareReceipt } from './care-native';
export type CareCommandKind = 'intake' | 'action' | 'recovery';
export interface CareReference { commandId: string; caseId: string; slot: string; kind: CareCommandKind; expectedRevision: number; phase: 'unknown' | 'accepted'; everUncertain: boolean; receipt?: { id: string; revision: number; receipt_id: string; action?: string } }
export interface CareJournalState { ready: boolean; blocked: boolean; busy: boolean; references: readonly CareReference[]; retryReady: readonly string[]; reviewNeeded: readonly string[]; error: string }
type Context = { assertActive(): void; accepted(result: CareReceipt, reference: CareReference): Promise<void> | void };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The protected save could not be confirmed.';
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
function slotMatches(value: CareReference) { return value.kind === 'intake' ? value.slot === 'intake' && value.caseId === value.commandId && value.expectedRevision === 0 : value.slot === `${value.kind === 'recovery' ? 'recovery' : 'case'}:${value.caseId}` && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision > 0; }
export function parseCareReceipt(value: unknown, reference: Pick<CareReference, 'caseId' | 'expectedRevision'> & Partial<Pick<CareReference, 'kind'>>): CareReceipt {
  const row = object(value);
  if (!row || row.id !== reference.caseId || !careUuid(row.receipt_id) || row.revision !== reference.expectedRevision + 1 || (reference.kind === 'action' || reference.kind === 'recovery') && typeof row.action !== 'string' || reference.kind === 'recovery' && row.action !== 'restricted_care.case.recovered' || row.action !== undefined && (typeof row.action !== 'string' || !/^restricted_care\.(?:case\.(?:opened|entry_added|reassigned|recovered|triage|active|closed)|reporting\.assessed|external_report\.recorded)$/.test(row.action))) throw new Error('This receipt does not confirm the exact protected save. Keep its reference.');
  return { id: reference.caseId, revision: row.revision as number, receipt_id: row.receipt_id, receipt: 'Recorded in the protected workspace. This is not proof of an external report.', ...(row.action ? { action: row.action as string } : {}) };
}
export function parseCareReferences(raw: string | null, scopeKey: string): CareReference[] {
  if (raw === null) return [];
  let envelope: Record<string, unknown> | null; try { envelope = object(JSON.parse(raw)); } catch { envelope = null; }
  if (!envelope || !exactKeys(envelope, ['version', 'scopeKey', 'references']) || envelope.version !== 1 || envelope.scopeKey !== scopeKey || !Array.isArray(envelope.references) || envelope.references.length > 64) throw new Error('Protected receipt references could not be verified. Their bytes were kept; new saves are blocked.');
  const slots = new Set<string>(), commands = new Set<string>();
  return envelope.references.map(value => {
    const row = object(value), ref = row as unknown as CareReference;
    if (!row || !exactKeys(row, ['commandId', 'caseId', 'slot', 'kind', 'expectedRevision', 'phase', 'everUncertain', 'receipt']) || !careUuid(ref.commandId) || !careUuid(ref.caseId) || !['intake', 'action', 'recovery'].includes(ref.kind) || !['unknown', 'accepted'].includes(ref.phase) || typeof ref.everUncertain !== 'boolean' || !slotMatches(ref) || slots.has(ref.slot) || commands.has(ref.commandId)) throw new Error('Protected receipt references could not be verified. Their bytes were kept.');
    slots.add(ref.slot); commands.add(ref.commandId);
    const result: CareReference = { commandId: ref.commandId, caseId: ref.caseId, slot: ref.slot, kind: ref.kind, expectedRevision: ref.expectedRevision, phase: ref.phase, everUncertain: ref.everUncertain };
    if (ref.phase === 'accepted') { const receiptRow = object(ref.receipt); if (!receiptRow || !exactKeys(receiptRow, ['id', 'revision', 'receipt_id', 'action'])) throw new Error('The protected receipt metadata is unreadable.'); const receipt = parseCareReceipt(receiptRow, result); result.receipt = { id: receipt.id, revision: receipt.revision, receipt_id: receipt.receipt_id, ...(receipt.action ? { action: receipt.action } : {}) }; }
    else if (ref.receipt !== undefined) throw new Error('An unconfirmed protected receipt cannot contain accepted metadata.');
    return result;
  });
}
/** Reject, rather than silently persist, an accidental protected extra field. */
export function serializeCareReferences(scopeKey: string, references: readonly CareReference[]) { const raw = JSON.stringify({ version: 1, scopeKey, references }); parseCareReferences(raw, scopeKey); return raw; }
export function exactCareRefusal(cause: unknown, reference: CareReference) {
  const error = object(cause); if (error?.status !== 409) return false;
  const envelope = object(object(error.details)?.error), proof = object(object(envelope?.fields)?.care_command_refused);
  return envelope?.code === 'care_command_refused' && proof?.confirmation === 'not_accepted' && proof.receipt_state === 'absent' && proof.command_id === reference.commandId && proof.case_id === reference.caseId && ['stream_advanced', 'route_unavailable', 'recovery_not_applicable', 'case_closed', 'target_ineligible', 'reporting_incomplete'].includes(String(proof.reason));
}
export type CareConfirmation = { state: 'not_found' | 'pending' | 'not_accepted' } | { state: 'accepted'; result: CareReceipt };
export function parseCareConfirmation(value: unknown, reference: CareReference): CareConfirmation { const row = object(value); if (!row || !['not_found', 'pending', 'not_accepted', 'accepted'].includes(String(row.state))) throw new Error('The exact protected result could not be verified.'); return row.state === 'accepted' ? { state: 'accepted', result: parseCareReceipt(row.result, reference) } : { state: row.state as 'not_found' | 'pending' | 'not_accepted' }; }

/** Only opaque references are durable. Private immutable request closures live
 * in the mounted Care session and are discarded on departure/scope change. */
export class CareCommandJournal {
  private state: CareJournalState = { ready: false, blocked: false, busy: false, references: [], retryReady: [], reviewNeeded: [], error: '' };
  private operations = new Map<string, (commandId: string) => Promise<unknown>>();
  private listeners = new Set<(value: CareJournalState) => void>();
  private hydration: Promise<void> | null = null;
  constructor(private options: { scopeKey: string; read(): Promise<string | null>; write(value: string): Promise<void>; randomId(): string; capture(): { assertCurrent(): void }; confirm(commandId: string): Promise<unknown> }) {}
  snapshot() { return this.state; }
  subscribe(listener: (value: CareJournalState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<CareJournalState>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(this.state); }
  private retain(reference: CareReference) { this.update({ references: [...this.state.references.filter(value => value.slot !== reference.slot), reference] }); }
  private async persist() { try { await this.options.write(serializeCareReferences(this.options.scopeKey, this.state.references)); this.update({ blocked: false }); } catch (cause) { this.update({ blocked: true }); throw cause; } }
  hydrate() { if (!this.hydration) this.hydration = (async () => { try { const references = parseCareReferences(await this.options.read(), this.options.scopeKey); this.update({ ready: true, blocked: false, references, error: '' }); } catch (cause) { this.update({ ready: true, blocked: true, error: errorText(cause) }); } })(); return this.hydration; }
  retryStorage() { if (this.state.busy || this.state.references.length) return Promise.resolve(); this.hydration = null; this.update({ ready: false }); return this.hydrate(); }
  dropPrivate(slot?: string) { if (slot) { for (const reference of this.state.references.filter(value => value.slot === slot)) this.operations.delete(reference.commandId); } else this.operations.clear(); this.update({ retryReady: [], error: '' }); }
  hasPrivate(reference: CareReference) { return this.operations.has(reference.commandId); }
  reviewed(slot: string) { if (!this.state.busy && !this.state.references.some(value => value.slot === slot)) this.update({ reviewNeeded: this.state.reviewNeeded.filter(value => value !== slot), error: '' }); }
  private guard(context: Context) { const transport = this.options.capture(); return () => { transport.assertCurrent(); context.assertActive(); }; }
  private async remove(reference: CareReference) {
    const previous = this.state.references; this.update({ references: previous.filter(value => value.commandId !== reference.commandId) });
    try { await this.persist(); } catch (cause) { this.update({ references: previous }); throw cause; }
    this.operations.delete(reference.commandId); this.update({ retryReady: this.state.retryReady.filter(id => id !== reference.commandId) });
  }
  private async accepted(reference: CareReference, result: CareReceipt, context: Context, assertCurrent: () => void) {
    const receipt = parseCareReceipt(result, reference), accepted: CareReference = { ...reference, phase: 'accepted', receipt: { id: receipt.id, revision: receipt.revision, receipt_id: receipt.receipt_id, ...(receipt.action ? { action: receipt.action } : {}) } };
    this.retain(accepted); this.operations.delete(reference.commandId); await this.persist(); assertCurrent();
    await context.accepted(receipt, accepted); assertCurrent(); await this.remove(accepted); this.update({ error: '' });
  }
  async start(input: { kind: CareCommandKind; caseId?: string; expectedRevision: number; operation(commandId: string): Promise<unknown> }, context: Context) {
    const slot = input.kind === 'intake' ? 'intake' : `${input.kind === 'recovery' ? 'recovery' : 'case'}:${input.caseId}`;
    if (!this.state.ready || this.state.blocked || this.state.busy || this.state.references.some(value => value.slot === slot) || this.state.reviewNeeded.includes(slot)) return false;
    if (this.state.references.length >= 64) { this.update({ error: 'Resolve earlier protected receipt references before starting another save.' }); return false; }
    this.update({ busy: true, error: '' });
    try {
      const assertCurrent = this.guard(context); assertCurrent(); const commandId = this.options.randomId();
      const reference: CareReference = { commandId, caseId: input.kind === 'intake' ? commandId : input.caseId!, slot, kind: input.kind, expectedRevision: input.expectedRevision, phase: 'unknown', everUncertain: false };
      serializeCareReferences(this.options.scopeKey, [reference]); this.operations.set(commandId, input.operation); this.retain(reference); await this.persist(); assertCurrent();
      return await this.perform(reference, context, assertCurrent);
    } catch (cause) { this.update({ error: errorText(cause) }); return false; }
    finally { this.update({ busy: false }); }
  }
  private async perform(reference: CareReference, context: Context, assertCurrent: () => void) {
    const operation = this.operations.get(reference.commandId); if (!operation) throw new Error('Private draft bytes are no longer in this session. Check the exact receipt; do not submit a replacement.');
    try { assertCurrent(); const result = await operation(reference.commandId); assertCurrent(); await this.accepted(reference, parseCareReceipt(result, reference), context, assertCurrent); return true; }
    catch (cause) {
      const retained = this.state.references.find(value => value.commandId === reference.commandId) ?? reference;
      if (retained.phase === 'accepted') { this.update({ error: 'Saved. Refresh checks its exact receipt/current access without resending protected text.' }); return false; }
      const status = object(cause)?.status;
      if (exactCareRefusal(cause, reference) || !reference.everUncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) { assertCurrent(); await this.remove(reference); this.update({ reviewNeeded: [...new Set([...this.state.reviewNeeded, reference.slot])], error: 'The protected save was not accepted. Review the current source before a new choice.' }); }
      else { this.retain({ ...retained, everUncertain: true }); await this.persist(); this.update({ error: 'Save not confirmed. Check its exact result before sending another concern or action.' }); }
      return false;
    }
  }
  async check(commandId: string, context: Context) {
    const reference = this.state.references.find(value => value.commandId === commandId); if (!reference || this.state.busy) return false;
    this.update({ busy: true, retryReady: this.state.retryReady.filter(id => id !== commandId), error: '' });
    try {
      const assertCurrent = this.guard(context); assertCurrent(); if (this.state.blocked) { await this.persist(); assertCurrent(); }
      if (reference.phase === 'accepted' && reference.receipt) { await this.accepted(reference, parseCareReceipt(reference.receipt, reference), context, assertCurrent); return true; }
      const confirmation = parseCareConfirmation(await this.options.confirm(commandId), reference); assertCurrent();
      if (confirmation.state === 'accepted') { await this.accepted(reference, confirmation.result, context, assertCurrent); return true; }
      if (confirmation.state === 'not_accepted') { await this.remove(reference); this.update({ reviewNeeded: [...new Set([...this.state.reviewNeeded, reference.slot])], error: 'This exact save was not accepted. Review the current source before starting again.' }); }
      else if (confirmation.state === 'not_found') this.update({ retryReady: this.operations.has(commandId) ? [...new Set([...this.state.retryReady, commandId])] : this.state.retryReady.filter(id => id !== commandId), error: this.operations.has(commandId) ? 'No accepted result found. You can explicitly retry this exact save with its unchanged private details.' : 'No accepted result found yet. Private draft details were not persisted. Keep this reference and check again; do not submit a replacement.' });
      else this.update({ error: 'This exact protected save is still awaiting confirmation.' });
      return false;
    } catch (cause) { this.update({ error: errorText(cause) }); return false; }
    finally { this.update({ busy: false }); }
  }
  async retry(commandId: string, context: Context) { const reference = this.state.references.find(value => value.commandId === commandId); if (!reference || reference.phase === 'accepted' || !this.state.retryReady.includes(commandId) || this.state.busy || this.state.blocked || !this.operations.has(commandId)) return false; this.update({ busy: true, retryReady: this.state.retryReady.filter(id => id !== commandId), error: '' }); try { const assertCurrent = this.guard(context); assertCurrent(); return await this.perform({ ...reference, everUncertain: true }, context, assertCurrent); } catch (cause) { this.update({ error: errorText(cause) }); return false; } finally { this.update({ busy: false }); } }
}
