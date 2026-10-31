import { isInternalHref } from './api-policy';
import { leaveFileUriAllowed } from './private-file-policy';
import { attendanceCommandRefused, type AttendanceTransportGuard } from './attendance-command-policy';
import { leaveExpectedStatus, leaveUuid, type LeaveAction, type LeaveFile, type LeaveRecord } from './attendance-leave-policy';
export interface LeaveIntent {
  version: 1; scopeKey: string; localId: string; ownerHref: string; studentId: string;
  kind: 'create' | 'document' | 'action'; leaveId: string | null; action: LeaveAction | null; sourceFingerprint: string | null;
  body: string; file: LeaveFile | null; phase: 'prepared' | 'unknown' | 'accepted'; acceptedLeaveId: string | null; acceptedDocumentId: string | null;
}
export type LeaveIntentInput = Pick<LeaveIntent, 'studentId' | 'kind' | 'leaveId' | 'action' | 'sourceFingerprint'> & { body: Record<string, unknown>; file?: LeaveFile | null };
export interface LeaveIntentState { ready: boolean; blocked: boolean; busy: boolean; pending: LeaveIntent | null; error: string; message: string }
export interface LeaveIntentStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export function leaveIntentEndpoint(intent: LeaveIntent) { return intent.kind === 'create' ? '/api/v1/leave-requests/' : `/api/v1/leave-requests/${intent.leaveId}/${intent.kind === 'document' ? 'documents' : intent.action}/`; }
export function validLeaveIntent(value: unknown, scopeKey: string): value is LeaveIntent {
  const intent = value as LeaveIntent;
  try {
    if (!intent || intent.version !== 1 || intent.scopeKey !== scopeKey || !leaveUuid(intent.localId) || !leaveUuid(intent.studentId) || !isInternalHref(intent.ownerHref) || !/^\/areas\/attendance\/leave(?:\/review)?(?:\?|$)/.test(intent.ownerHref) || !['create', 'document', 'action'].includes(intent.kind) || !['prepared', 'unknown', 'accepted'].includes(intent.phase) || typeof intent.body !== 'string' || intent.body.length > 12000) return false;
    if (intent.kind === 'create' ? intent.leaveId !== null || intent.action !== null || intent.sourceFingerprint !== null : !leaveUuid(intent.leaveId) || typeof intent.sourceFingerprint !== 'string' || !intent.sourceFingerprint || intent.sourceFingerprint.length > 128000) return false;
    if (intent.kind === 'action' ? !['authorize', 'clarify', 'decline', 'withdraw', 'approve', 'reject'].includes(intent.action!) || intent.file !== null : intent.action !== null) return false;
    if (intent.file && (!leaveFileUriAllowed(intent.file.uri, scopeKey) || !intent.file.name || !['application/pdf', 'image/jpeg', 'image/png'].includes(intent.file.type) || !Number.isSafeInteger(intent.file.size) || intent.file.size < 1 || intent.file.size > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(intent.file.hash))) return false;
    if (intent.kind === 'document' && !intent.file) return false;
    const body = JSON.parse(intent.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    if (intent.kind === 'create' && (body.student_id !== intent.studentId || !['medical', 'family', 'travel', 'personal'].includes(body.category) || typeof body.reason !== 'string' || body.reason.length < 5 || typeof body.starts_on !== 'string' || typeof body.ends_on !== 'string')) return false;
    if (intent.kind === 'action' && (typeof body.note !== 'string' || body.note.length > 500)) return false;
    return intent.phase === 'accepted' ? leaveUuid(intent.acceptedLeaveId) && (intent.kind === 'create' || intent.acceptedLeaveId === intent.leaveId) && (intent.kind !== 'document' || leaveUuid(intent.acceptedDocumentId)) : intent.acceptedLeaveId === null && intent.acceptedDocumentId === null;
  } catch { return false; }
}
export function acceptedLeaveResponse(intent: LeaveIntent, result: unknown): { leaveId: string; documentId: string | null } | null {
  if (!result || typeof result !== 'object') return null;
  if (intent.kind === 'document') {
    const document = result as { id?: unknown; original_name?: unknown; content_type?: unknown; size_bytes?: unknown }, file = intent.file;
    if (!file) return null;
    return leaveUuid(document.id) && document.original_name === file.name && document.content_type === file.type && document.size_bytes === file.size ? { leaveId: intent.leaveId!, documentId: document.id } : null;
  }
  const record = result as LeaveRecord;
  if (!leaveUuid(record.id) || record.student_id !== intent.studentId || !Array.isArray(record.documents) || !Array.isArray(record.audit_log)) return null;
  if (intent.kind === 'action') return record.id === intent.leaveId && record.status === leaveExpectedStatus(intent.action!) ? { leaveId: record.id, documentId: null } : null;
  const body = JSON.parse(intent.body);
  return record.category === body.category && record.starts_on === body.starts_on && record.ends_on === body.ends_on && record.reason === body.reason && ['pending_guardian', 'authorized'].includes(record.status) && (!intent.file || record.documents.some(document => document.original_name === intent.file!.name && document.content_type === intent.file!.type && document.size_bytes === intent.file!.size)) ? { leaveId: record.id, documentId: null } : null;
}
/** These legacy endpoints have no idempotency or exact command receipt.
 * Once dispatch may have started, recovery can inspect records but never resend. */
export class LeaveIntentJournal {
  private state: LeaveIntentState = { ready: false, blocked: false, busy: false, pending: null, error: '', message: '' };
  private listeners = new Set<(state: LeaveIntentState) => void>(); private hydration: Promise<void> | null = null;
  constructor(private options: { scopeKey: string; storage: LeaveIntentStorage; capture(): AttendanceTransportGuard; randomId(): string; stage(file: LeaveFile, assertCurrent: () => void): Promise<LeaveFile>; preflight(intent: LeaveIntent, assertCurrent: () => void): Promise<void>; send(intent: LeaveIntent, assertCurrent: () => void): Promise<unknown>; read(intent: LeaveIntent, assertCurrent: () => void): Promise<unknown>; cleanup(intent: LeaveIntent): Promise<void> }) {}
  snapshot() { return this.state; }
  subscribe(listener: (state: LeaveIntentState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<LeaveIntentState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener(this.state)); }
  hydrate() { if (!this.hydration) this.hydration = (async () => { try { const raw = await this.options.storage.read(); if (raw) { const intent: unknown = JSON.parse(raw); if (!validLeaveIntent(intent, this.options.scopeKey)) throw new Error('The encrypted leave action could not be verified. Its bytes were preserved; new leave actions are blocked.'); this.update({ pending: intent }); } } catch (cause) { this.update({ blocked: true, error: cause instanceof Error ? cause.message : 'Secure leave storage is unavailable.' }); } finally { this.update({ ready: true }); } })(); return this.hydration; }
  async run(input: LeaveIntentInput, context: { ownerHref: string; assertVisible(): void; accepted(value: LeaveRecord): void }) {
    if (!this.state.ready || this.state.blocked || this.state.busy || this.state.pending) return false;
    this.update({ busy: true, error: '', message: '' });
    try {
      const transport = this.options.capture(), assertCurrent = () => { transport.assertCurrent(); context.assertVisible(); }; assertCurrent();
      const original = { ...input, body: JSON.stringify(input.body), file: input.file ? { ...input.file } : null };
      const file = original.file ? await this.options.stage(original.file, assertCurrent) : null; assertCurrent();
      const intent: LeaveIntent = { version: 1, scopeKey: this.options.scopeKey, localId: this.options.randomId(), ownerHref: context.ownerHref, studentId: original.studentId, kind: original.kind, leaveId: original.leaveId, action: original.action, sourceFingerprint: original.sourceFingerprint, body: original.body, file, phase: 'prepared', acceptedLeaveId: null, acceptedDocumentId: null };
      if (!validLeaveIntent(intent, this.options.scopeKey)) throw new Error('The exact leave request could not be safely retained. Nothing was sent.');
      this.update({ pending: intent }); await this.options.storage.write(JSON.stringify(intent)); assertCurrent();
      return await this.execute(assertCurrent, context.accepted);
    } catch (cause) { this.update({ error: cause instanceof Error ? cause.message : 'This leave action was not confirmed. Its original details were kept.' }); return false; }
    finally { this.update({ busy: false }); }
  }
  async recover(context: { ownerHref: string; assertVisible(): void; accepted(value: LeaveRecord): void }) {
    if (!this.state.ready || this.state.blocked || this.state.busy || !this.state.pending) return false;
    if (this.state.pending.ownerHref !== context.ownerHref) { this.update({ error: 'Return to the original leave view before recovering its action.' }); return false; }
    this.update({ busy: true, error: '' });
    try { const transport = this.options.capture(), assertCurrent = () => { transport.assertCurrent(); context.assertVisible(); }; return await this.execute(assertCurrent, context.accepted); }
    catch (cause) { this.update({ error: cause instanceof Error ? cause.message : 'The retained action could not be inspected.' }); return false; }
    finally { this.update({ busy: false }); }
  }
  private async execute(assertCurrent: () => void, accepted: (value: LeaveRecord) => void) {
    let intent = this.state.pending!; const previouslyUnknown = intent.phase === 'unknown'; let dispatched = false;
    try {
      assertCurrent();
      if (intent.phase === 'unknown') {
        await this.options.read(intent, assertCurrent); assertCurrent();
        this.update({ error: 'Saved records were inspected. The earlier action is still unconfirmed and cannot be repeated safely. Ask campus support to reconcile it before making another leave change.' }); return false;
      }
      if (intent.phase === 'prepared') {
        await this.options.preflight(intent, assertCurrent); assertCurrent();
        const unknown: LeaveIntent = { ...intent, phase: 'unknown' }; await this.options.storage.write(JSON.stringify(unknown)); assertCurrent(); intent = unknown; this.update({ pending: intent });
        dispatched = true; const response = await this.options.send(intent, assertCurrent); assertCurrent();
        const proof = acceptedLeaveResponse(intent, response); if (!proof) throw new Error('The response did not confirm the exact learner and leave action. Keep the retained request and inspect its saved records.');
        intent = { ...intent, phase: 'accepted', acceptedLeaveId: proof.leaveId, acceptedDocumentId: proof.documentId }; this.update({ pending: intent }); await this.options.storage.write(JSON.stringify(intent)); assertCurrent();
      }
      const record = await this.options.read(intent, assertCurrent) as LeaveRecord; assertCurrent();
      if (record.id !== intent.acceptedLeaveId || record.student_id !== intent.studentId || intent.acceptedDocumentId && !record.documents.some(document => document.id === intent.acceptedDocumentId)) throw new Error('The refreshed record did not match this accepted action.');
      await this.options.cleanup(intent); assertCurrent();
      await this.options.storage.clear(); this.update({ pending: null }); assertCurrent();
      this.update({ error: '', message: 'The leave service saved this action. Current saved records are shown.' });
      accepted(record); return true;
    } catch (cause) {
      if (intent.phase !== 'accepted' && (intent.phase === 'prepared' && !dispatched && cause instanceof LeaveSourceChanged || attendanceCommandRefused(cause, previouslyUnknown))) {
        try { assertCurrent(); await this.options.storage.clear(); this.update({ pending: null }); assertCurrent(); await this.options.cleanup(intent); assertCurrent(); } catch { /* Preserve local intent if cleanup could not be confirmed. */ }
      }
      this.update({ error: `${intent.phase === 'accepted' ? 'Saved. Recovery only reads the record. ' : ''}${cause instanceof Error ? cause.message : 'The action could not be confirmed.'}${this.state.pending ? ' Its exact intent remains retained.' : ''}` }); return false;
    }
  }
}
export class LeaveSourceChanged extends Error {}
