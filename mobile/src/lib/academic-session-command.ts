import { nativePendingScopeKey, type NativePendingScope, type NativePendingStorage } from './native-pending-action';
import type { AcademicAttendanceDetail, AcademicAttendanceStatus } from './academic-attendance';

export interface AcademicSessionMark { student_id: string; status: AcademicAttendanceStatus | null; remarks: string }
export interface AcademicSessionIdentity { schoolId: string; classId: string; termId: string; sessionId: string; date: string }
export interface AcademicSessionCommand {
  version: 1; scopeKey: string; key: string; identity: AcademicSessionIdentity; expectedRevision: number;
  body: string; phase: 'prepared' | 'unknown' | 'accepted'; acceptedRevision: number | null;
}
export interface AcademicSessionCommandState { ready: boolean; storageBlocked: boolean; busy: boolean; pending: AcademicSessionCommand | null; error: string }
export interface AcademicSessionGuard { assertCurrent(): void }
export interface AcademicSessionOperation {
  assertActive(): void;
  acceptCurrent(command: AcademicSessionCommand, value: unknown): AcademicAttendanceDetail;
  accepted(value: AcademicAttendanceDetail): Promise<void> | void;
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const statuses = ['present', 'absent', 'late', 'excused'];
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
function error(cause: unknown) { return cause instanceof Error ? cause.message : 'This session submission was not confirmed.'; }

export function academicSessionIdentity(detail: AcademicAttendanceDetail): AcademicSessionIdentity {
  if (!detail.session) throw new Error('Only a verified teaching-session register can use this submission.');
  return { schoolId: detail.schoolId, classId: detail.classId, termId: detail.termId, sessionId: detail.session.id, date: detail.date };
}
export function academicSessionSubmitPath(command: Pick<AcademicSessionCommand, 'identity'>) { return `/api/v1/attendance-model/sessions/${encodeURIComponent(command.identity.sessionId)}/submit`; }
export function academicSessionReadPath(command: Pick<AcademicSessionCommand, 'identity'>) { return `/api/v1/attendance-model/sessions/${encodeURIComponent(command.identity.sessionId)}`; }
export function academicSessionBody(basis: AcademicAttendanceDetail, records: readonly AcademicSessionMark[], reason: string, photoSessionId?: string): string {
  academicSessionIdentity(basis);
  if (!whole(basis.register.revision) || !Number.isSafeInteger(basis.register.revision + 1)) throw new Error('The reviewed session revision is invalid. Nothing was sent.');
  if (!basis.availability.canMark || basis.register.state === 'locked') throw new Error('This session does not currently allow you to record attendance. Reload its saved register.');
  if (!records.length || records.length > 2000 || records.length !== basis.roster.length) throw new Error('Review every learner in this exact session before submitting.');
  const known = new Set(basis.roster.map(row => row.id.toLowerCase())), seen = new Set<string>();
  const marks = records.map(row => {
    if (!uuid(row.student_id) || !known.has(row.student_id.toLowerCase()) || seen.has(row.student_id.toLowerCase()) || row.status === null || !statuses.includes(row.status) || typeof row.remarks !== 'string' || row.remarks.trim().length > 500) throw new Error('Record one supported attendance status and a note of at most 500 characters for each learner.');
    seen.add(row.student_id.toLowerCase()); return { student_id: row.student_id, status: row.status, remarks: row.remarks.trim() };
  }).sort((a, b) => a.student_id.localeCompare(b.student_id));
  const note = reason.trim();
  if (note.length > 500 || note.length > 0 && note.length < 3 || basis.register.state === 'submitted' && note.length < 3) throw new Error('Give a correction reason of 3–500 characters.');
  if (photoSessionId !== undefined && !uuid(photoSessionId)) throw new Error('The reviewed photo analysis identifier is invalid. Nothing was sent.');
  const body = JSON.stringify({ ...(photoSessionId ? {photo_session_id: photoSessionId} : {}), expected_revision: basis.register.revision, records: marks, ...(note ? { reason: note } : {}) });
  if (body.length > 60000) throw new Error('This session submission is too large for secure local retention. Shorten notes or use the web register. Nothing was sent.');
  return body;
}
export function validAcademicSessionCommand(value: unknown, scopeKey: string, sessionId: string): value is AcademicSessionCommand {
  try {
    if (!object(value) || value.version !== 1 || value.scopeKey !== scopeKey || !uuid(value.key) || !object(value.identity) || !same(value.identity.sessionId, sessionId) || value.identity.schoolId !== JSON.parse(scopeKey)[1] || ![value.identity.schoolId, value.identity.classId, value.identity.termId, value.identity.sessionId].every(uuid) || typeof value.identity.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.identity.date) || !Number.isFinite(Date.parse(`${value.identity.date}T00:00:00Z`)) || new Date(`${value.identity.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.identity.date || !whole(value.expectedRevision) || !Number.isSafeInteger(value.expectedRevision + 1) || typeof value.body !== 'string' || value.body.length > 60000 || !['prepared', 'unknown', 'accepted'].includes(String(value.phase))) return false;
    if (value.phase === 'accepted' ? value.acceptedRevision !== value.expectedRevision + 1 : value.acceptedRevision !== null) return false;
    const body: unknown = JSON.parse(value.body);
    if (!object(body) || body.photo_session_id !== undefined && !uuid(body.photo_session_id) || body.expected_revision !== value.expectedRevision || Object.keys(body).some(key => !['expected_revision', 'records', 'reason', 'photo_session_id'].includes(key)) || !Array.isArray(body.records) || !body.records.length || body.records.length > 2000 || body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.trim() !== body.reason || body.reason.length < 3 || body.reason.length > 500)) return false;
    const ids = new Set<string>();
    return body.records.every(row => {
      if (!object(row) || !uuid(row.student_id) || ids.has(row.student_id.toLowerCase()) || !statuses.includes(String(row.status)) || typeof row.remarks !== 'string' || row.remarks.length > 500 || row.remarks !== row.remarks.trim() || Object.keys(row).some(key => !['student_id', 'status', 'remarks'].includes(key))) return false;
      ids.add(row.student_id.toLowerCase()); return true;
    });
  } catch { return false; }
}

/** Only the response to the same keyed POST can move an unknown command to accepted. */
export function acceptedAcademicSessionSubmit(command: AcademicSessionCommand, value: unknown): boolean {
  if (!object(value) || !object(value.class) || !object(value.session) || !object(value.register) || !Array.isArray(value.roster) || value.attendance_scope !== 'scheduled_session') return false;
  const id = command.identity;
  if (!same(value.class.school_id, id.schoolId) || !same(value.class.id, id.classId) || !same(value.class.term_id, id.termId) || value.date !== id.date || !same(value.session.id, id.sessionId) || !same(value.register.id, id.sessionId) || value.register.revision !== command.expectedRevision + 1 || !['submitted', 'locked'].includes(String(value.register.state))) return false;
  const request = JSON.parse(command.body) as { records: Array<{ student_id: string; status: string; remarks: string }> };
  const rows = new Map<string, Record<string, unknown>>();
  for (const row of value.roster) { if (!object(row) || !uuid(row.id) || rows.has(row.id.toLowerCase())) return false; rows.set(row.id.toLowerCase(), row); }
  return rows.size === request.records.length && request.records.every(mark => { const row = rows.get(mark.student_id.toLowerCase()); return row?.status === mark.status && row.remarks === mark.remarks; });
}

/** Scope/root shared by every retained native mount; callbacks belong to each operation. */
export class AcademicSessionCommandJournal {
  private state: AcademicSessionCommandState = { ready: false, storageBlocked: false, busy: false, pending: null, error: '' };
  private listeners = new Set<(state: AcademicSessionCommandState) => void>(); private hydration?: Promise<void>;
  constructor(private options: { scope: NativePendingScope; sessionId: string; storage: NativePendingStorage; capture(): AcademicSessionGuard; createKey(): Promise<string>; send(command: AcademicSessionCommand, guard: AcademicSessionGuard): Promise<unknown>; read(command: AcademicSessionCommand, guard: AcademicSessionGuard): Promise<unknown> }) {}
  snapshot() { return this.state; }
  subscribe(listener: (state: AcademicSessionCommandState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(change: Partial<AcademicSessionCommandState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener(this.state)); }
  hydrate() {
    if (!this.hydration) this.hydration = (async () => {
      try {
        const raw = await this.options.storage.read(); const pending: unknown = raw === null ? null : JSON.parse(raw);
        if (raw !== null && !validAcademicSessionCommand(pending, nativePendingScopeKey(this.options.scope), this.options.sessionId)) throw new Error('The encrypted session submission could not be verified. Its bytes were kept; new submissions are blocked.');
        this.update({ pending: pending as AcademicSessionCommand | null });
      } catch (cause) { this.update({ storageBlocked: true, error: error(cause) }); }
      finally { this.update({ ready: true }); }
    })();
    return this.hydration;
  }
  private async perform(operation: AcademicSessionOperation, task: (guard: AcademicSessionGuard) => Promise<void>) {
    if (!this.state.ready || this.state.storageBlocked || this.state.busy) return false;
    this.update({ busy: true, error: '' });
    try { const transport = this.options.capture(), guard = { assertCurrent: () => { transport.assertCurrent(); operation.assertActive(); } }; guard.assertCurrent(); await task(guard); guard.assertCurrent(); return true; }
    catch (cause) { this.update({ error: `${error(cause)}${this.state.pending ? this.state.pending.phase === 'accepted' ? ' Submission was accepted. Recovery only reads the saved register.' : this.state.pending.phase === 'prepared' ? ' Nothing was dispatched. The original details remain available for local recovery.' : ' The original submission remains securely retained.' : ''}` }); return false; }
    finally { this.update({ busy: false }); }
  }
  run(basis: AcademicAttendanceDetail, records: readonly AcademicSessionMark[], reason: string, operation: AcademicSessionOperation, photoSessionId?: string) {
    if (this.state.pending) return Promise.resolve(false);
    return this.perform(operation, async guard => {
      const identity = academicSessionIdentity(basis), body = academicSessionBody(basis, records, reason, photoSessionId), expectedRevision = basis.register.revision;
      if (!same(identity.sessionId, this.options.sessionId) || identity.schoolId !== this.options.scope.schoolId) throw new Error('The selected session changed. Nothing was sent.');
      const key = await this.options.createKey(); guard.assertCurrent();
      const command: AcademicSessionCommand = { version: 1, scopeKey: nativePendingScopeKey(this.options.scope), key, identity, expectedRevision, body, phase: 'prepared', acceptedRevision: null };
      if (!validAcademicSessionCommand(command, command.scopeKey, this.options.sessionId)) throw new Error('This exact session submission could not be retained. Nothing was sent.');
      this.update({ pending: command }); await this.options.storage.write(JSON.stringify(command)); guard.assertCurrent();
      await this.execute(operation, guard);
    });
  }
  recover(operation: AcademicSessionOperation) {
    if (!this.state.pending) return Promise.resolve(false);
    return this.perform(operation, guard => this.execute(operation, guard));
  }
  private async execute(operation: AcademicSessionOperation, guard: AcademicSessionGuard) {
    let command = this.state.pending!; guard.assertCurrent();
    if (command.phase !== 'accepted') {
      const unknown: AcademicSessionCommand = { ...command, phase: 'unknown' };
      await this.options.storage.write(JSON.stringify(unknown)); guard.assertCurrent(); command = unknown; this.update({ pending: command });
      const result = await this.options.send(command, guard); guard.assertCurrent();
      if (!acceptedAcademicSessionSubmit(command, result)) throw new Error('The keyed response did not confirm every requested mark and this exact session revision. Retry the original submission to recover its receipt.');
      command = { ...command, phase: 'accepted', acceptedRevision: command.expectedRevision + 1 }; this.update({ pending: command });
    }
    await this.options.storage.write(JSON.stringify(command)); guard.assertCurrent();
    const current = await this.options.read(command, guard); guard.assertCurrent();
    const detail = operation.acceptCurrent(command, current);
    if (detail.register.revision < command.acceptedRevision!) throw new Error('The refreshed session is older than the accepted submission.');
    guard.assertCurrent(); await this.options.storage.clear();
    // Clearing committed storage is factual even if the originating view loses
    // focus during that await. Never resurrect an already cleared submission.
    this.update({ pending: null, error: '' }); guard.assertCurrent();
    await operation.accepted(detail); guard.assertCurrent();
  }
}
const journals = new Map<string, AcademicSessionCommandJournal>();
export function sharedAcademicSessionJournal(scope: NativePendingScope, sessionId: string, create: () => AcademicSessionCommandJournal) {
  const key = JSON.stringify([nativePendingScopeKey(scope), sessionId]), found = journals.get(key);
  if (found) return found;
  const journal = create(); journals.set(key, journal); return journal;
}
