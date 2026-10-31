import { academicAttendancePath, type AcademicAttendanceDetail, type AcademicAttendanceSource, type AcademicAttendanceStatus } from './academic-attendance';
import { nativePendingScopeKey, type NativePendingScope, type NativePendingStorage } from './native-pending-action';
import type { AcademicSessionMark } from './academic-session-command';
export type AcademicRegisterActionKind = 'daily_capture' | 'finalize' | 'reopen' | 'evidence_accept' | 'evidence_reject';
export interface AcademicRegisterReceipt { status: 'accepted' | 'pending' | 'quarantined' | 'rejected'; revision: number; batchId?: string; reviewId?: string; message: string }
export interface AcademicRegisterAction { version: 1; scopeKey: string; key: string; kind: AcademicRegisterActionKind; source: AcademicAttendanceSource; schoolId: string; termId: string; classId: string; registerId: string | null; expectedRevision: number; endpoint: string; method: 'POST' | 'DELETE'; body: string; phase: 'prepared' | 'unknown' | 'received'; receipt: AcademicRegisterReceipt | null }
export interface AcademicRegisterActionState { ready: boolean; blocked: boolean; busy: boolean; pending: AcademicRegisterAction | null; error: string }
export interface AcademicRegisterGuard { assertCurrent(): void }
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const same = (a: unknown,b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
function fail(message: string): never { throw new Error(message); }
export function academicRegisterActionEndpoint(source: AcademicAttendanceSource, kind: AcademicRegisterActionKind, evidenceId?: string) {
  if (kind === 'daily_capture') { if (source.kind !== 'daily_class') fail('This capture needs its exact daily class.'); return '/api/v1/attendance-continuity/batches/'; }
  const root = source.kind === 'daily_class' ? `/api/v1/attendance-registers/${encodeURIComponent(source.classSectionId)}/lock/?${new URLSearchParams({ date: source.date })}` : `/api/v1/attendance-model/sessions/${encodeURIComponent(source.sessionId)}`;
  if (kind.startsWith('evidence_')) { if (source.kind !== 'scheduled_session' || !uuid(evidenceId)) fail('Choose one pending teaching-session report.'); return `${root}/evidence/${evidenceId}/decision`; }
  return source.kind === 'daily_class' ? root : `${root}/lock`;
}
export function prepareAcademicRegisterAction(scope: NativePendingScope, key: string, kind: AcademicRegisterActionKind, source: AcademicAttendanceSource, basis: AcademicAttendanceDetail, input: { records?: readonly AcademicSessionMark[]; reason?: string; captureSource?: 'live_app' | 'paper' | 'office'; sourceReference?: string; observedAt?: string; evidenceId?: string; photoSessionId?: string }, canReview: boolean): AcademicRegisterAction {
  if (!uuid(key) || scope.schoolId !== basis.schoolId || source.kind === 'daily_class' && (source.classSectionId !== basis.classId || source.date !== basis.date) || source.kind === 'scheduled_session' && source.sessionId !== basis.session?.id || !whole(basis.register.revision)) fail('The reviewed academic source changed. Nothing was sent.');
  const reason = input.reason?.trim() ?? ''; if (reason.length > 500) fail('Use a note of at most 500 characters.');
  let body: Record<string,unknown>;
  if (kind === 'daily_capture') {
    if (!basis.availability.canMark || basis.register.state === 'locked' || source.kind !== 'daily_class') fail('This daily register does not currently allow recording.');
    const snapshot = basis.continuitySnapshot; if (!snapshot) fail('Reload the server roster snapshot before recording daily attendance.');
    const records = input.records ?? [], seen = new Set<string>(), allowed: AcademicAttendanceStatus[] = ['present','absent','late','excused','half_day'];
    if (!records.length || records.length !== basis.roster.length || records.length > 2000) fail('Review one mark for every learner in this daily register.');
    const marks = records.map(row => { if (!uuid(row.student_id) || seen.has(row.student_id) || !basis.roster.some(item => item.id === row.student_id) || !row.status || !allowed.includes(row.status) || row.remarks.trim().length > 500) fail('Record one supported status and a note of at most 500 characters for each learner.'); seen.add(row.student_id); return { student_id: row.student_id,status: row.status,remarks: row.remarks.trim() }; }).sort((a,b) => a.student_id.localeCompare(b.student_id));
    if (basis.register.state === 'submitted' && reason.length < 3) fail('Explain this correction in at least three characters.');
    const channel = input.captureSource ?? 'live_app', reference = input.sourceReference?.trim() ?? '';
    if (!['live_app','paper','office'].includes(channel) || channel !== 'live_app' && (!canReview || reference.length < 3) || reference.length > 160 || !instant(input.observedAt)) fail('Paper and office captures require current coordination authority, their source reference and an observed time.');
    if(input.photoSessionId !== undefined && !uuid(input.photoSessionId)) fail('The reviewed photo analysis identifier is invalid.');
    body = { ...(input.photoSessionId ? {photo_session_id: input.photoSessionId} : {}), class_section_id: basis.classId,date: basis.date,records: marks,expected_revision: basis.register.revision,...(reason ? { reason } : {}),source: channel,source_reference: reference,device_id: null,observed_at: input.observedAt,roster_fingerprint: snapshot.fingerprint,roster_captured_at: snapshot.capturedAt,roster_expires_at: snapshot.expiresAt,snapshot_token: snapshot.token };
  } else {
    if (!canReview) fail('This register does not offer attendance review in your current responsibility.');
    if (kind === 'finalize' && (basis.register.state !== 'submitted' || basis.register.autoFinalizeAt)) fail('Only a submitted register without scheduled automatic finalization can be finalized here.');
    if (kind === 'reopen' && (basis.register.state !== 'locked' || reason.length < 3)) fail('A final register needs a reason before reopening.');
    if (kind.startsWith('evidence_')) { if (reason.length < 3 || !basis.evidenceRows?.some(row => row.id === input.evidenceId)) fail('Choose a current pending check-in and give a verification note.'); body = { decision: kind === 'evidence_accept' ? 'accepted' : 'rejected',note: reason,expected_revision: basis.register.revision }; }
    else body = kind === 'reopen' ? { reason } : {};
  }
  const serialized = JSON.stringify(body); if (serialized.length > 100000) fail('This exact submission exceeds secure local storage. Shorten its notes. Nothing was sent.');
  return { version: 1,scopeKey: nativePendingScopeKey(scope),key,kind,source: { ...source,date: basis.date },schoolId: basis.schoolId,classId: basis.classId,termId: basis.termId,registerId: basis.register.id,expectedRevision: basis.register.revision,endpoint: academicRegisterActionEndpoint(source,kind,input.evidenceId),method: kind === 'reopen' ? 'DELETE' : 'POST',body: serialized,phase: 'prepared',receipt: null };
}
export function validAcademicRegisterAction(v: unknown, scope: NativePendingScope, source: AcademicAttendanceSource): v is AcademicRegisterAction {
  try {
    if (!object(v) || v.version !== 1 || v.scopeKey !== nativePendingScopeKey(scope) || !uuid(v.key) || v.schoolId !== scope.schoolId || !uuid(v.classId) || !uuid(v.termId) || !whole(v.expectedRevision) || !Number.isSafeInteger(v.expectedRevision + 1) || v.registerId !== null && !uuid(v.registerId) || !object(v.source) || academicAttendancePath(v.source as unknown as AcademicAttendanceSource) !== academicAttendancePath(source) || !['daily_capture','finalize','reopen','evidence_accept','evidence_reject'].includes(String(v.kind)) || !['prepared','unknown','received'].includes(String(v.phase)) || typeof v.body !== 'string' || v.body.length > 100000 || v.method !== (v.kind === 'reopen' ? 'DELETE' : 'POST')) return false;
    const body: unknown = JSON.parse(v.body); if (!object(body)) return false;
    const evidenceId = typeof v.endpoint === 'string' ? v.endpoint.match(/\/evidence\/([^/]+)\/decision$/)?.[1] : undefined;
    if (v.endpoint !== academicRegisterActionEndpoint(source,v.kind as AcademicRegisterActionKind,evidenceId)) return false;
    if (v.source.kind !== source.kind || v.source.kind === 'daily_class' && (v.source.classSectionId !== v.classId || v.source.date !== source.date) || v.source.kind === 'scheduled_session' && (!uuid(v.source.sessionId) || v.source.sessionId !== (source as Extract<AcademicAttendanceSource,{kind:'scheduled_session'}>).sessionId || v.registerId !== v.source.sessionId)) return false;
    if (v.kind === 'daily_capture' && (body.class_section_id !== v.classId || body.date !== source.date || body.expected_revision !== v.expectedRevision || !Array.isArray(body.records) || !body.records.length || !instant(body.observed_at) || typeof body.snapshot_token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.snapshot_token))) return false;
    if (v.kind === 'daily_capture') {
      if (source.kind !== 'daily_class' || body.photo_session_id !== undefined && !uuid(body.photo_session_id) || !['live_app','paper','office'].includes(String(body.source)) || typeof body.source_reference !== 'string' || body.source_reference.length > 160 || body.source !== 'live_app' && body.source_reference.trim().length < 3 || body.device_id !== null || typeof body.roster_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.roster_fingerprint) || !instant(body.roster_captured_at) || !instant(body.roster_expires_at) || !Array.isArray(body.records) || body.records.length > 2000 || body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length < 3 || body.reason.length > 500 || body.reason !== body.reason.trim()) || Object.keys(body).some(key => !['class_section_id','date','records','expected_revision','reason','source','source_reference','device_id','observed_at','roster_fingerprint','roster_captured_at','roster_expires_at','snapshot_token','photo_session_id'].includes(key))) return false;
      const seen = new Set<string>();
      for (const row of body.records) { if (!object(row) || !uuid(row.student_id) || seen.has(row.student_id.toLowerCase()) || !['present','absent','late','excused','half_day'].includes(String(row.status)) || typeof row.remarks !== 'string' || row.remarks.length > 500 || row.remarks !== row.remarks.trim() || Object.keys(row).some(key => !['student_id','status','remarks'].includes(key))) return false; seen.add(row.student_id.toLowerCase()); }
    }
    if (v.kind === 'finalize' && Object.keys(body).length || v.kind === 'reopen' && (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 500 || Object.keys(body).some(key => key !== 'reason'))) return false;
    if (String(v.kind).startsWith('evidence_') && (body.expected_revision !== v.expectedRevision || body.decision !== (v.kind === 'evidence_accept' ? 'accepted' : 'rejected') || typeof body.note !== 'string' || body.note.trim().length < 3)) return false;
    if (v.phase !== 'received') return v.receipt === null;
    if (!object(v.receipt) || !['accepted','pending','quarantined','rejected'].includes(String(v.receipt.status)) || !whole(v.receipt.revision) || v.receipt.revision !== v.expectedRevision + (v.receipt.status === 'accepted' ? 1 : 0) || typeof v.receipt.message !== 'string') return false;
    return v.kind === 'daily_capture' ? uuid(v.receipt.batchId) && (v.receipt.status !== 'quarantined' || uuid(v.receipt.reviewId)) : v.receipt.status === 'accepted';
  } catch { return false; }
}
function sourceMatches(action: AcademicRegisterAction, value: unknown): value is Record<string,unknown> & { register: Record<string,unknown>; roster: unknown[] } {
  return object(value) && object(value.class) && same(value.class.school_id,action.schoolId) && same(value.class.id,action.classId) && same(value.class.term_id,action.termId) && value.date === action.source.date && object(value.register) && (action.registerId === null ? uuid(value.register.id) : value.register.id === action.registerId) && Array.isArray(value.roster) && (action.source.kind === 'daily_class' ? !value.session : object(value.session) && same(value.session.id,action.source.sessionId));
}
export function academicRegisterActionReceipt(action: AcademicRegisterAction, value: unknown, actorId: string): AcademicRegisterReceipt {
  if (action.kind === 'daily_capture') {
    if (!object(value) || !object(value.batch)) fail('The capture receipt was not returned. Retry the unchanged observation.');
    const batch = value.batch, request = JSON.parse(action.body) as { records: Array<{ student_id: string; status: string; remarks: string }>; source: string };
    if (!uuid(batch.id) || batch.idempotency_key !== action.key || !same(batch.recorded_by,actorId) || !same(batch.school_id,action.schoolId) || !same(batch.class_section_id,action.classId) || !same(batch.term_id,action.termId) || batch.date !== action.source.date || batch.expected_register_revision !== action.expectedRevision || batch.roster_count !== request.records.length || batch.source !== request.source || batch.status !== value.status || !['accepted','pending','quarantined','rejected'].includes(String(value.status))) fail('The receipt belongs to a different capture, actor, campus or source.');
    const status = value.status as AcademicRegisterReceipt['status']; let nextRevision = action.expectedRevision;
    if (status === 'accepted') {
      if (!sourceMatches(action,value.register) || value.register.register.revision !== action.expectedRevision + 1) fail('This capture was not confirmed at its accepted register revision.');
      const rows = value.register.roster;
      if (rows.length !== request.records.length || !request.records.every(mark => rows.some(row => object(row) && row.id === mark.student_id && row.status === mark.status && row.remarks === mark.remarks))) fail('The accepted capture did not confirm its original marks.');
      nextRevision++;
    }
    const reviewId = object(value.review) && uuid(value.review.id) ? value.review.id : undefined;
    if (status === 'quarantined' && !reviewId) fail('The observation requires review but no owning review receipt was returned.');
    return { status,revision: nextRevision,batchId: batch.id,...(reviewId ? { reviewId } : {}),message: status === 'accepted' ? 'Daily attendance accepted.' : status === 'quarantined' ? 'Observation received for attendance-desk review. The accepted register was not changed.' : status === 'rejected' ? 'Observation rejected. Review the source and attendance-desk decision.' : 'Observation received. It is not accepted attendance yet.' };
  }
  if (!sourceMatches(action,value) || !whole(value.register.revision)) fail('The response did not match the reviewed academic source.');
  const state = action.kind === 'finalize' ? 'locked' : action.kind === 'reopen' ? 'submitted' : null;
  if (value.register.revision !== action.expectedRevision + 1 || state && value.register.state !== state) fail('The exact requested academic transition was not confirmed. Keep the original request for recovery.');
  if (action.kind.startsWith('evidence_')) { const evidenceId = action.endpoint.match(/\/evidence\/([^/]+)\/decision$/)?.[1]; if (!Array.isArray(value.pending_evidence) || value.pending_evidence.some(row => object(row) && row.id === evidenceId)) fail('The original report decision is not confirmed.'); }
  return { status: 'accepted',revision: value.register.revision,message: action.kind === 'finalize' ? 'Register finalized.' : action.kind === 'reopen' ? 'Register reopened for correction.' : action.kind === 'evidence_accept' ? 'Check-in accepted and attendance updated.' : 'Check-in rejected; its decision is retained.' };
}
export class AcademicRegisterActionJournal {
  private state: AcademicRegisterActionState = { ready: false,blocked: false,busy: false,pending: null,error: '' }; private listeners = new Set<(v: AcademicRegisterActionState) => void>(); private hydration?: Promise<void>;
  constructor(private options: { scope: NativePendingScope; source: AcademicAttendanceSource; storage: NativePendingStorage; capture(): AcademicRegisterGuard; createKey(): Promise<string>; send(action: AcademicRegisterAction): Promise<unknown>; read(action: AcademicRegisterAction): Promise<unknown> }) {}
  snapshot() { return this.state; } subscribe(fn: (v: AcademicRegisterActionState) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  private update(next: Partial<AcademicRegisterActionState>) { this.state = { ...this.state,...next }; this.listeners.forEach(fn => fn(this.state)); }
  hydrate() { return this.hydration ??= (async () => { try { const raw = await this.options.storage.read(), value: unknown = raw ? JSON.parse(raw) : null; if (raw && !validAcademicRegisterAction(value,this.options.scope,this.options.source)) fail('The retained academic action could not be verified. Its bytes were kept and new actions are blocked.'); this.update({ pending: value as AcademicRegisterAction | null }); } catch (cause) { this.update({ blocked: true,error: cause instanceof Error ? cause.message : String(cause) }); } finally { this.update({ ready: true }); } })(); }
  async run(prepare: (key: string) => AcademicRegisterAction, operation: { assertActive(): void; acceptCurrent(action: AcademicRegisterAction,value: unknown): AcademicAttendanceDetail; accepted(detail: AcademicAttendanceDetail,receipt: AcademicRegisterReceipt): void }) {
    if (this.state.pending) return false;
    return this.perform(operation,async guard => {
      // Snapshot the entire reviewed source/body before asynchronous identity or
      // storage work. The placeholder never leaves this local preparation.
      const reviewed = prepare('00000000-0000-4000-8000-000000000000');
      const key = await this.options.createKey(); guard.assertCurrent(); const action = { ...reviewed,key }; if (!validAcademicRegisterAction(action,this.options.scope,this.options.source)) fail('The original academic action could not be retained. Nothing was sent.'); this.update({ pending: action }); await this.options.storage.write(JSON.stringify(action)); guard.assertCurrent(); await this.execute(operation,guard); });
  }
  recover(operation: { assertActive(): void; acceptCurrent(action: AcademicRegisterAction,value: unknown): AcademicAttendanceDetail; accepted(detail: AcademicAttendanceDetail,receipt: AcademicRegisterReceipt): void }) { return !this.state.pending ? Promise.resolve(false) : this.perform(operation,guard => this.execute(operation,guard)); }
  private async perform(operation: { assertActive(): void }, task: (g: AcademicRegisterGuard) => Promise<void>) {
    if (!this.state.ready || this.state.blocked || this.state.busy) return false; this.update({ busy: true,error: '' });
    try { const transport = this.options.capture(), guard = { assertCurrent: () => { transport.assertCurrent(); operation.assertActive(); } }; guard.assertCurrent(); await task(guard); guard.assertCurrent(); return true; }
    catch (cause) { this.update({ error: `${cause instanceof Error ? cause.message : String(cause)}${this.state.pending ? ' The exact original action remains retained.' : ''}` }); return false; }
    finally { this.update({ busy: false }); }
  }
  private async execute(operation: { acceptCurrent(action: AcademicRegisterAction,value: unknown): AcademicAttendanceDetail; accepted(detail: AcademicAttendanceDetail,receipt: AcademicRegisterReceipt): void },guard: AcademicRegisterGuard) {
    let action = this.state.pending!; guard.assertCurrent();
    if (action.phase !== 'received') {
      action = { ...action,phase: 'unknown' }; await this.options.storage.write(JSON.stringify(action)); guard.assertCurrent(); this.update({ pending: action });
      const result = await this.options.send(action); guard.assertCurrent(); const receipt = academicRegisterActionReceipt(action,result,this.options.scope.actorId);
      action = { ...action,phase: 'received',receipt }; this.update({ pending: action });
    }
    await this.options.storage.write(JSON.stringify(action)); guard.assertCurrent();
    const value = await this.options.read(action); guard.assertCurrent(); const detail = operation.acceptCurrent(action,value);
    if (detail.register.revision < action.receipt!.revision) fail('The refreshed academic register is older than the original receipt.');
    guard.assertCurrent(); await this.options.storage.clear();
    this.update({ pending: null,error: '' }); guard.assertCurrent();
    operation.accepted(detail,action.receipt!); guard.assertCurrent();
  }
}
