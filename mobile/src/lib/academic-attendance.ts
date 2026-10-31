import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import { assertWorkspaceManifestContext, type WorkspaceExpectedContext } from '../../../packages/contracts/src/workspace-normalizer';

export type AcademicAttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'half_day';
export type AcademicAttendanceSource =
  | { kind: 'daily_class'; classSectionId: string; date: string; studentId?: string }
  | { kind: 'scheduled_session'; sessionId: string; date?: string; studentId?: string };
export interface AcademicAttendanceStudent { id: string; name: string; admissionNumber: string; rollNumber: string; status: AcademicAttendanceStatus | null; remarks: string;attendanceId?: string;attendanceRevision?: number }
export interface AcademicAttendanceDetail {
  date: string; classId: string; schoolId: string; termId: string; className: string; term: string; room: string;
  session: { id: string; subjectName: string; periodNumber: number | null; startsAt: string; endsAt: string } | null;
  register: { id: string | null; state: 'draft' | 'submitted' | 'locked'; revision: number; submittedBy: string; submittedAt: string; lockedAt: string; autoFinalizeAt?: string };
  availability: { canMark: boolean; reason: string }; roster: AcademicAttendanceStudent[]; pendingEvidence: number;
  continuitySnapshot?: { fingerprint: string; count: number; capturedAt: string; expiresAt: string; token: string };
  evidenceRows?: Array<{ id: string; studentId: string; name: string; admissionNumber: string; captureChannel: string; observedAt: string }>;
  cameraAssisted?: boolean;
  latestCapture?: { id: string; status: 'pending' | 'accepted' | 'quarantined' | 'rejected'; source: string };
}
export interface AcademicAttendanceHistoryItem { id: string; kind: 'submission' | 'correction'; revision: number; at: string; actor: string; detail: string }
export const academicStatusLabels: Record<AcademicAttendanceStatus, string> = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused', half_day: 'Half day' };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
// Both owning academic history APIs expose PostgreSQL bigint correction IDs as
// strings. Converged participation rows deliberately use the negative ID space;
// original legacy rows retain positive IDs. Never round these through Number.
const correctionId = (v: unknown): v is string => typeof v === 'string' && /^-?[1-9]\d{0,18}$/.test(v) && BigInt(v) >= -9223372036854775808n && BigInt(v) <= 9223372036854775807n;
function fail(message: string): never { throw new Error(message); }
function sameId(a: unknown, b: string) { return uuid(a) && a.toLowerCase() === b.toLowerCase(); }

/** Source selectors are academic identities, never participation-register IDs. */
export function academicAttendanceSource(href: string): AcademicAttendanceSource | null {
  const [path, query] = href.split('#')[0]!.split('?');
  if (path !== '/areas/attendance/registers' && path !== '/areas/attendance/coordination') return null;
  const params = new URLSearchParams(query ?? '');
  const hasClass = params.has('class_section_id'), hasSession = params.has('session_id');
  if (!hasClass && !hasSession) return null;
  for (const key of ['class_section_id', 'session_id', 'date', 'student_id']) if (params.getAll(key).length > 1) fail('This attendance link contains more than one source selection. Open the current register again.');
  if (hasClass && hasSession || params.has('register_id') || params.has('occurrence_id') || params.has('review_case') || params.has('case_id') || params.has('scope') || params.get('source') === 'continuity') fail('Choose one academic register source. This link mixes different attendance workflows.');
  const classId = params.get('class_section_id'), sessionId = params.get('session_id'), day = params.get('date'), studentId = params.get('student_id');
  if (studentId !== null && !uuid(studentId)) fail('The focused learner in this attendance link is invalid.');
  if (day !== null && !date(day)) fail('This attendance link does not contain a valid calendar date.');
  const focus = studentId ? { studentId } : {};
  if (hasClass) {
    if (!uuid(classId) || !date(day)) fail('A daily register needs its exact class and date.');
    return { kind: 'daily_class', classSectionId: classId, date: day, ...focus };
  }
  if (!uuid(sessionId)) fail('This attendance link does not identify a valid teaching session.');
  return { kind: 'scheduled_session', sessionId, ...(day ? { date: day } : {}), ...focus };
}

export function academicAttendanceHref(source: AcademicAttendanceSource) {
  const query = new URLSearchParams(source.kind === 'daily_class' ? { class_section_id: source.classSectionId, date: source.date } : { session_id: source.sessionId, ...(source.date ? { date: source.date } : {}) });
  if (source.studentId) query.set('student_id', source.studentId);
  return `/areas/attendance/registers?${query}`;
}
export function academicAttendancePath(source: AcademicAttendanceSource) {
  return source.kind === 'daily_class' ? `/api/v1/attendance-registers/${encodeURIComponent(source.classSectionId)}/?${new URLSearchParams({ date: source.date })}` : `/api/v1/attendance-model/sessions/${encodeURIComponent(source.sessionId)}`;
}
export function academicAttendanceHistoryPath(source: AcademicAttendanceSource) {
  return source.kind === 'daily_class' ? `/api/v1/attendance-registers/${encodeURIComponent(source.classSectionId)}/history/?${new URLSearchParams({ date: source.date })}` : `/api/v1/attendance-model/sessions/${encodeURIComponent(source.sessionId)}/history`;
}
function canReadClass(surface: WorkspaceAreaSurface, schoolId: string, classId?: string) {
  return surface.scopes.some(scope => scope.kind === 'institution' && scope.id === schoolId || scope.kind === 'class' && !!scope.id && (!classId || sameId(scope.id, classId)));
}
export function assertAcademicAttendanceAccess(manifest: WorkspaceManifest, source: AcademicAttendanceSource, expected: WorkspaceExpectedContext, kind: 'registers' | 'coordination' = 'registers'): WorkspaceAreaSurface {
  assertWorkspaceManifestContext(manifest, expected);
  const surface = manifest.areas.find(area => area.key === 'attendance')?.surfaces.find(item => item.key === kind && item.href.split('?')[0] === `/areas/attendance/${kind}`);
  if (!surface || !surface.capabilities.some(item => ['attendance.view', 'attendance.record', 'attendance.review'].includes(item)) || !canReadClass(surface, expected.institutionId, source.kind === 'daily_class' ? source.classSectionId : undefined)) fail('This academic register is outside your current register responsibility. Return to Attendance to confirm your access.');
  return surface;
}

export function normalizeAcademicAttendanceDetail(value: unknown, source: AcademicAttendanceSource, schoolId: string, surface: WorkspaceAreaSurface): AcademicAttendanceDetail {
  if (!object(value) || !object(value.class) || !object(value.register) || !Array.isArray(value.roster)) fail('The academic register response is incomplete. Refresh this exact source.');
  const section = value.class, saved = value.register;
  if (!sameId(section.school_id, schoolId) || !uuid(section.id) || !uuid(section.term_id) || !date(value.date) || !text(section.name) || !canReadClass(surface, schoolId, section.id)) fail('The returned academic register did not match your campus and class responsibility.');
  if (source.date && value.date !== source.date || source.kind === 'daily_class' && !sameId(section.id, source.classSectionId)) fail('The returned academic register did not match the selected class and date.');
  let session: AcademicAttendanceDetail['session'] = null;
  if (source.kind === 'scheduled_session') {
    if (value.attendance_scope !== 'scheduled_session' || !object(value.session) || !sameId(value.session.id, source.sessionId) || !sameId(saved.id, source.sessionId)) fail('The returned attendance did not match the selected teaching session.');
    session = { id: source.sessionId, subjectName: text(value.session.subject_name), periodNumber: Number.isSafeInteger(value.session.period_number) && (value.session.period_number as number) > 0 ? value.session.period_number as number : null, startsAt: text(value.session.starts_at), endsAt: text(value.session.ends_at) };
  } else if (value.session || value.attendance_scope === 'scheduled_session') fail('A teaching-session response cannot replace the selected daily register.');
  if (!revision(saved.revision) || !['draft', 'submitted', 'locked'].includes(String(saved.state)) || saved.id !== null && !uuid(saved.id) || saved.id === null && (saved.state !== 'draft' || saved.revision !== 0)) fail('The saved register identity or revision could not be verified.');
  for (const instant of [saved.submitted_at, saved.locked_at]) if (instant !== null && instant !== undefined && (typeof instant !== 'string' || !Number.isFinite(Date.parse(instant)))) fail('The register submission or finalization time could not be verified.');
  const ids = new Set<string>();
  const roster = value.roster.map((row): AcademicAttendanceStudent => {
    if (!object(row) || !uuid(row.id) || !text(row.name) || row.status !== null && !Object.hasOwn(academicStatusLabels, String(row.status)) || source.kind === 'scheduled_session' && row.status === 'half_day' || typeof row.remarks !== 'string' || ids.has(String(row.id).toLowerCase())) fail('The academic roster is incomplete or contains conflicting learner identities.');
    ids.add(row.id.toLowerCase());
    if (row.attendance_id !== null && row.attendance_id !== undefined && (!uuid(row.attendance_id) || !revision(row.attendance_revision) || row.attendance_revision < 1 || row.status === null)) fail('The saved attendance decision identity could not be verified.');
    return { id: row.id, name: text(row.name), admissionNumber: text(row.admission_number), rollNumber: row.roll_number === null || row.roll_number === undefined ? '' : String(row.roll_number), status: row.status as AcademicAttendanceStatus | null, remarks: row.remarks,...(uuid(row.attendance_id) ? {attendanceId: row.attendance_id,attendanceRevision: row.attendance_revision as number} : {}) };
  });
  if (source.studentId && !ids.has(source.studentId.toLowerCase())) fail('The focused learner is no longer in this exact academic register. Return to the register list.');
  if (value.pending_evidence !== undefined && !Array.isArray(value.pending_evidence)) fail('The pending attendance evidence could not be verified.');
  let continuitySnapshot: AcademicAttendanceDetail['continuitySnapshot'];
  if (object(value.continuity_snapshot)) {
    const snapshot = value.continuity_snapshot;
    if (typeof snapshot.roster_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.roster_fingerprint) || snapshot.roster_count !== roster.length || typeof snapshot.captured_at !== 'string' || !Number.isFinite(Date.parse(snapshot.captured_at)) || typeof snapshot.expires_at !== 'string' || !Number.isFinite(Date.parse(snapshot.expires_at)) || Date.parse(snapshot.expires_at) < Date.parse(snapshot.captured_at)) fail('The server roster snapshot could not be verified. Refresh this exact register.');
    if (source.kind === 'daily_class') {
      if (typeof snapshot.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(snapshot.token)) fail('The server roster snapshot could not be verified. Refresh before recording daily attendance.');
      continuitySnapshot = { fingerprint: snapshot.roster_fingerprint,count: roster.length,capturedAt: snapshot.captured_at,expiresAt: snapshot.expires_at,token: snapshot.token };
    } else if (snapshot.token !== '' || snapshot.expires_at !== snapshot.captured_at) {
      fail('The teaching-session roster metadata did not match its owning response. Refresh this exact session.');
    }
    // Scheduled sessions return a zero-window, empty-token metadata placeholder.
    // It is not a signed daily continuity snapshot and must never enable offline
    // daily capture. Their existing keyed session writer owns submission.
  }
  const evidenceRows: NonNullable<AcademicAttendanceDetail['evidenceRows']> = [];
  for (const row of value.pending_evidence ?? []) {
    if (!object(row) || !uuid(row.id) || !uuid(row.student_id) || !ids.has(row.student_id.toLowerCase()) || typeof row.observed_at !== 'string' || !Number.isFinite(Date.parse(row.observed_at))) fail('A pending check-in does not belong to this roster.');
    evidenceRows.push({ id: row.id,studentId: row.student_id,name: text(row.student_name),admissionNumber: text(row.admission_number),captureChannel: text(row.capture_channel),observedAt: row.observed_at });
  }
  let latestCapture: AcademicAttendanceDetail['latestCapture'];
  if (object(value.latest_capture)) { const row = value.latest_capture; if (!uuid(row.id) || !['pending','accepted','quarantined','rejected'].includes(String(row.status))) fail('The latest capture receipt could not be verified.'); latestCapture = { id: row.id,status: row.status as NonNullable<AcademicAttendanceDetail['latestCapture']>['status'],source: text(row.source) }; }
  return { date: value.date, classId: section.id, schoolId, termId: section.term_id, className: text(section.name), term: text(section.term), room: text(section.room), session,
    register: { id: saved.id as string | null, state: saved.state as AcademicAttendanceDetail['register']['state'], revision: saved.revision, submittedBy: text(saved.submitted_by_name), submittedAt: text(saved.submitted_at), lockedAt: text(saved.locked_at),autoFinalizeAt: text(saved.auto_finalize_at) },
    cameraAssisted: source.kind === 'daily_class' || object(value.capture_policy) && Array.isArray(value.capture_policy.channels) && value.capture_policy.channels.includes('camera_assisted'),
    availability: { canMark: object(value.availability) && value.availability.can_mark === true, reason: object(value.availability) ? text(value.availability.reason) : '' }, roster, pendingEvidence: value.pending_evidence?.length ?? 0,...(continuitySnapshot ? { continuitySnapshot } : {}),evidenceRows,...(latestCapture ? { latestCapture } : {}) };
}

export function normalizeAcademicAttendanceHistory(value: unknown, source: AcademicAttendanceSource, basis: AcademicAttendanceDetail): AcademicAttendanceHistoryItem[] {
  if (source.date && source.date !== basis.date || source.kind === 'daily_class' && !sameId(basis.classId, source.classSectionId)) fail('The history source does not match the selected academic register.');
  if (!object(value) || !object(value.class) || !object(value.register) || value.date !== basis.date || !sameId(value.class.id, basis.classId) || !sameId(value.class.school_id, basis.schoolId) || !sameId(value.class.term_id, basis.termId) || !revision(value.register.revision) || value.register.revision < basis.register.revision || value.register.id !== basis.register.id || source.kind === 'scheduled_session' && !sameId(value.register.id, source.sessionId) || !Array.isArray(value.submissions) || !Array.isArray(value.revisions)) fail('The history did not match this exact academic register. Refresh the register before opening history again.');
  const ids = new Set<string>();
  const items: AcademicAttendanceHistoryItem[] = [];
  for (const [kind, rows] of [['submission', value.submissions], ['correction', value.revisions]] as const) for (const row of rows) {
    if (!object(row) || !(kind === 'submission' ? uuid(row.id) : correctionId(row.id)) || !revision(row.register_revision) || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || row.register_revision > value.register.revision || ids.has(`${kind}:${row.id}`)) fail('The academic history contains an unverified revision.');
    ids.add(`${kind}:${row.id}`);
    if (kind === 'submission' && (!revision(row.records_count) || !revision(row.changed_count))) fail('The submission history counts could not be verified.');
    if (kind === 'correction' && (!uuid(row.student_id) || !Object.hasOwn(academicStatusLabels, String(row.new_status)))) fail('The academic correction history is incomplete.');
    items.push({ id: `${kind}:${row.id}`, kind, revision: row.register_revision, at: row.created_at,
      actor: text(kind === 'submission' ? row.submitted_by_name : row.changed_by_name), detail: kind === 'submission'
        ? `${typeof row.records_count === 'number' ? row.records_count : 'Attendance'} recorded${typeof row.changed_count === 'number' ? ` · ${row.changed_count} changed` : ''}`
        : `${text(row.student_name) || 'Learner'} · ${academicStatusLabels[row.new_status as AcademicAttendanceStatus]}${text(row.reason) ? ` · ${text(row.reason)}` : ''}` });
  }
  return items.sort((a, b) => b.revision - a.revision || b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export function academicRosterPage(roster: readonly AcademicAttendanceStudent[], search: string, unrecordedOnly: boolean, page: number) {
  const query = search.trim().toLocaleLowerCase();
  const filtered = roster.filter(row => (!unrecordedOnly || row.status === null) && (!query || `${row.name} ${row.admissionNumber} ${row.rollNumber}`.toLocaleLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(filtered.length / 8)), current = Math.max(1, Math.min(pages, Number.isSafeInteger(page) ? page : 1));
  return { rows: filtered.slice((current - 1) * 8, current * 8), total: filtered.length, pages, page: current };
}
