/** Shared attendance draft identity and validation; no platform storage or replay. */
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'half_day';
export interface AttendanceMark { person_id: string; status: AttendanceStatus | null; remarks: string }
export interface AttendanceDraftScope { actorId: string; schoolId: string; mode: string; namespaceId: string | null; origin?: string }
export interface AttendanceCommand {
  key: string; action: 'save' | 'submit' | 'finalize' | 'reopen';
  expectedRevision: number; body: string; phase?: 'prepared' | 'unknown' | 'accepted';
}
export interface AttendanceDraft {
  version: 1; scope: AttendanceDraftScope; registerId: string; revision: number;
  records: AttendanceMark[]; reason: string; updatedAt: string; pending: AttendanceCommand | null;
}
export function attendanceDraftKey(scope: AttendanceDraftScope, registerId: string) {
  if (!scope.actorId || !scope.schoolId || !registerId || (scope.mode !== 'live' && !scope.namespaceId)) {
    throw new Error('A confirmed account, campus and environment are required for a local draft.');
  }
  return JSON.stringify([scope.origin ?? 'unbound-server', scope.actorId, scope.schoolId, scope.mode, scope.namespaceId ?? 'live', registerId]);
}
export function validateAttendanceDraft(value: unknown, scope: AttendanceDraftScope, registerId: string): AttendanceDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as AttendanceDraft;
  try {
    if (draft.version !== 1 || draft.registerId !== registerId || attendanceDraftKey(draft.scope, draft.registerId) !== attendanceDraftKey(scope, registerId)) return null;
    if (!Number.isSafeInteger(draft.revision) || draft.revision < 0 || !Array.isArray(draft.records) || draft.records.length > 10000 || typeof draft.reason !== 'string') return null;
    const ids = new Set<string>();
    for (const mark of draft.records) {
      if (!mark || typeof mark.person_id !== 'string' || ids.has(mark.person_id) || typeof mark.remarks !== 'string' || (mark.status !== null && !['present', 'absent', 'late', 'excused', 'half_day'].includes(mark.status))) return null;
      ids.add(mark.person_id);
    }
    if (draft.pending) {
      const command = draft.pending;
      if (!['save', 'submit', 'finalize', 'reopen'].includes(command.action) || typeof command.key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(command.key) || typeof command.body !== 'string' || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 || command.phase !== undefined && !['prepared', 'unknown', 'accepted'].includes(command.phase)) return null;
      const body = JSON.parse(command.body) as { expected_revision?: number };
      if (body.expected_revision !== command.expectedRevision || command.expectedRevision !== draft.revision) return null;
    }
    return draft;
  } catch { return null; }
}

export function parseStoredAttendanceDraft(raw: string | null, scope: AttendanceDraftScope, registerId: string): AttendanceDraft | null {
  if (raw === null) return null;
  try {
    const draft = validateAttendanceDraft(JSON.parse(raw), scope, registerId);
    if (!draft) throw new Error('Invalid retained attendance draft');
    return draft;
  } catch { throw new Error('The encrypted attendance draft could not be verified. Its bytes were kept. Contact campus support before replacing or repeating its action.'); }
}
