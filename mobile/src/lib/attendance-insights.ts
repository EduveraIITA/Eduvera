import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import type { StudentEligibilityResponse } from '../../../packages/contracts/src/wire/features/school/api';
import type { Followup, FollowupContext, FollowupDetail, FollowupEntryInput } from '../../../packages/contracts/src/wire/features/coordination/api';
import type { NativePendingAction, NativePendingInput, NativePendingScope } from './native-pending-action';
import type { NativeAttendanceRelationship, NativeAttendanceSelection } from './attendance-access';

export const followupRoot = '/api/v1/coordination/follow-ups';
export const attendanceUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => !!value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const instant = (value: unknown): value is string => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown, max = 1000, min = 0): value is string => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const only = (body: Record<string, unknown>, keys: string[]) => Object.keys(body).every(key => keys.includes(key));
export const followupDetailPath = (id: string, context: FollowupContext) => `${followupRoot}/${encodeURIComponent(id)}?context=${context}`;
export function attendanceCalendarDate(now: string,timeZone: string): string {if(!instant(now) || !timeZone)throw new Error('The campus clock and time zone could not be confirmed.');const parts = new Intl.DateTimeFormat('en-US',{timeZone,year: 'numeric',month: '2-digit',day: '2-digit'}).formatToParts(new Date(now));return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;}
export function attendanceFollowupOptions(manifest: WorkspaceManifest): NativeAttendanceRelationship[] {
  return manifest.areas.find(area => area.key === 'attendance')?.surfaces.flatMap(surface => {
    const match = /^follow-ups:(self|dependent):(.+)$/.exec(surface.key);
    if (!match || !attendanceUuid(match[2])) return [];
    const relationship = match[1] as 'self' | 'dependent', studentId = match[2]!, scope = surface.scopes.find(item => item.kind === relationship && item.id === studentId);
    return scope ? [{ relationship, studentId, surface, label: scope.label || surface.label }] : [];
  }) ?? [];
}
export function resolveAttendanceFollowup(manifest: WorkspaceManifest, href: string): NativeAttendanceSelection {
  const url = new URL(href, 'https://thatcampus.invalid');
  if (url.pathname !== '/areas/attendance/follow-ups' || ['scope', 'student_id', 'followup'].some(key => url.searchParams.getAll(key).length > 1)) return { state: 'invalid' };
  const relationship = url.searchParams.get('scope'), id = url.searchParams.get('student_id');
  if (relationship !== null && !['self', 'dependent'].includes(relationship) || id !== null && !attendanceUuid(id) || url.searchParams.has('followup') && !attendanceUuid(url.searchParams.get('followup'))) return { state: 'invalid' };
  const options = attendanceFollowupOptions(manifest).filter(option => (!relationship || option.relationship === relationship) && (!id || option.studentId === id));
  return options.length === 1 ? { state: 'selected', option: options[0]! } : options.length ? { state: 'choose', options } : { state: 'invalid' };
}
export function normalizeAttendanceFollowup(value: unknown, expected: { id?: string; studentId?: string; schoolId?: string }, detail = false): FollowupDetail {
  const item = object(value);
  if (!item || !attendanceUuid(item.id) || expected.id && item.id !== expected.id || !attendanceUuid(item.student_id) || expected.studentId && item.student_id !== expected.studentId || expected.schoolId && item.school_id !== expected.schoolId || !date(item.attendance_date) || !revision(item.revision) || !text(item.question, 1000, 3) || !instant(item.due_at) || !instant(item.created_at) || !instant(item.updated_at) || !['awaiting_response', 'in_review', 'resolved'].includes(String(item.state)) || item.outcome !== null && !['absence_explained', 'record_corrected', 'query_withdrawn'].includes(String(item.outcome))) throw new Error('The follow-up response did not match the selected saved learner and conversation.');
  if (detail) {
    if (typeof item.can_resolve !== 'boolean' || !Array.isArray(item.entries) || !Array.isArray(item.guardians)) throw new Error('The saved follow-up details are incomplete.');
    const ids = new Set<string>();
    for (const value of item.entries) { const entry = object(value); if (!entry || !attendanceUuid(entry.id) || ids.has(entry.id) || !text(entry.body,1000,3) || !text(entry.actor_name,500) || !instant(entry.observed_at) || !instant(entry.recorded_at) || !['opened','guardian_reply','assisted_reply','resolved'].includes(String(entry.kind)) || !['app','phone','paper','in_person'].includes(String(entry.channel))) throw new Error('A follow-up history entry is invalid.'); ids.add(entry.id); }
    const guardians = new Set<string>();
    for (const value of item.guardians) { const guardian = object(value); if (!guardian || !attendanceUuid(guardian.id) || guardians.has(guardian.id) || !text(guardian.name,500,1)) throw new Error('A follow-up guardian choice is invalid.'); guardians.add(guardian.id); }
  }
  return item as unknown as FollowupDetail;
}
export function followupEntryInput(thread: FollowupDetail, context: FollowupContext, input: Omit<FollowupEntryInput,'expected_revision'|'idempotency_key'|'context'>, now: string): NativePendingInput {
  if (thread.state === 'resolved' || !revision(thread.revision) || !text(input.body,1000,3)) throw new Error('Add a response of 3–1,000 characters to an open saved follow-up.');
  if (context === 'guardian' && input.kind !== 'guardian_reply' || context === 'staff' && !['assisted_reply','resolved'].includes(input.kind)) throw new Error('This response is not available in the selected relationship.');
  const body: Record<string,unknown> = { context, kind: input.kind, body: input.body.trim(), expected_revision: thread.revision };
  if (input.kind === 'assisted_reply') {
    if (!thread.guardians.some(guardian => guardian.id === input.guardian_id) || !['phone','paper','in_person'].includes(input.channel ?? '') || !instant(input.observed_at) || !instant(now) || Date.parse(input.observed_at) < Date.parse(thread.created_at) - 5000 || Date.parse(input.observed_at) > Date.parse(now) + 5000) throw new Error('Choose a linked guardian, contact method and response time between opening this question and now.');
    Object.assign(body,{ guardian_id: input.guardian_id,channel: input.channel,observed_at: input.observed_at });
  } else if (input.kind === 'resolved') {
    if (!thread.can_resolve || !['absence_explained','record_corrected','query_withdrawn'].includes(input.outcome ?? '') || input.outcome === 'absence_explained' && thread.state !== 'in_review') throw new Error('This saved question is not ready for that outcome. Record its response or correct the source attendance first.');
    body.outcome = input.outcome;
  }
  return { endpoint: `${followupRoot}/${thread.id}/entries`,body,serverKey: 'idempotency_key',source: { kind: 'attendance_followup',sourceId: thread.id,revision: thread.revision,fingerprint: JSON.stringify([thread.student_id,thread.attendance_date,context]) } };
}
export function createAttendanceFollowupInput(input: { studentId: string; attendanceId: string; date: string; status: string | null; question: string; dueAt: string; now: string; sourceRevision: number }): NativePendingInput {
  if (!attendanceUuid(input.studentId) || !attendanceUuid(input.attendanceId) || !date(input.date) || !['absent','late','half_day'].includes(input.status ?? '') || !revision(input.sourceRevision)) throw new Error('Choose a saved absence, late arrival or half day. Missing marks are not absence.');
  if (!text(input.question,1000,3) || !instant(input.now) || !instant(input.dueAt) || Date.parse(input.dueAt) <= Date.parse(input.now) || Date.parse(input.dueAt) > Date.parse(input.now) + 30 * 86400000) throw new Error('Add a question and a response deadline within the next 30 days.');
  return { endpoint: followupRoot,body: { student_id: input.studentId,attendance_date: input.date,question: input.question.trim(),due_at: input.dueAt },serverKey: 'idempotency_key',source: { kind: 'attendance_followup_creation',sourceId: input.attendanceId,revision: input.sourceRevision,fingerprint: JSON.stringify([input.studentId,input.date,input.status]) } };
}
/** Restored follow-up actions retain an exact learner/date/context and owning route. */
export function attendanceFollowupActionAllowed(record: NativePendingAction, _scope: NativePendingScope) {
  try {
    if (record.method !== 'POST' || record.payload.kind !== 'json' || record.replayPolicy !== 'same_request' || !record.source || !revision(record.source.revision)) return false;
    const body = object(JSON.parse(record.payload.body)), source = record.source, owner = new URL(record.ownerHref,'https://thatcampus.invalid'), read = new URL(record.refreshPath,'https://thatcampus.invalid');
    if (!body || body.idempotency_key !== record.clientId || !attendanceUuid(source.sourceId)) return false;
    const fingerprint: unknown = JSON.parse(source.fingerprint ?? 'null');
    if (!Array.isArray(fingerprint) || fingerprint.length !== 3 || !attendanceUuid(fingerprint[0]) || !date(fingerprint[1])) return false;
    const [studentId,day,context] = fingerprint;
    if (record.endpoint === followupRoot) {
      if (source.kind !== 'attendance_followup_creation' || !['absent','late','half_day'].includes(String(context)) || !['/areas/attendance/registers','/areas/attendance/coordination'].includes(owner.pathname) || body.student_id !== studentId || body.attendance_date !== day || !text(body.question,1000,3) || !instant(body.due_at) || !only(body,['student_id','attendance_date','question','due_at','idempotency_key'])) return false;
      if (read.pathname === followupRoot && record.phase !== 'accepted') return read.searchParams.get('context') === 'staff' && read.searchParams.get('student_id') === studentId && [...read.searchParams.keys()].every(key => ['context','student_id','state'].includes(key));
      return read.pathname.startsWith(`${followupRoot}/`) && attendanceUuid(read.pathname.slice(followupRoot.length+1)) && read.search === '?context=staff';
    }
    if (source.kind !== 'attendance_followup' || !['guardian','staff'].includes(String(context)) || record.endpoint !== `${followupRoot}/${source.sourceId}/entries` || record.refreshPath !== followupDetailPath(source.sourceId,context as FollowupContext) || body.expected_revision !== source.revision || body.context !== context || !text(body.body,1000,3)) return false;
    if (!['/areas/attendance/follow-ups','/areas/attendance/coordination','/areas/attendance/registers'].includes(owner.pathname)) return false;
    if (context === 'guardian' && (owner.searchParams.get('student_id') !== studentId || owner.searchParams.getAll('student_id').length !== 1 || !['self','dependent'].includes(owner.searchParams.get('scope') ?? ''))) return false;
    if (context === 'guardian') return body.kind === 'guardian_reply' && only(body,['context','kind','body','expected_revision','idempotency_key']);
    if (body.kind === 'assisted_reply') return attendanceUuid(body.guardian_id) && ['phone','paper','in_person'].includes(String(body.channel)) && instant(body.observed_at) && only(body,['context','kind','body','expected_revision','idempotency_key','guardian_id','channel','observed_at']);
    return body.kind === 'resolved' && ['absence_explained','record_corrected','query_withdrawn'].includes(String(body.outcome)) && only(body,['context','kind','body','expected_revision','idempotency_key','outcome']);
  } catch { return false; }
}
export function followupAcceptedPath(value: unknown, action: NativePendingAction): string {
  const receipt = object(value), create = action.endpoint === followupRoot;
  if (!receipt || !attendanceUuid(receipt.id) || receipt.revision !== (create ? 1 : (action.source?.revision ?? -1)+1) || !create && receipt.id !== action.source?.sourceId) throw new Error('The response did not confirm this exact follow-up and reviewed revision. Keep its original action retained.');
  const body = JSON.parse(action.payload.kind === 'json' ? action.payload.body : '{}') as {context?: FollowupContext};
  return followupDetailPath(receipt.id,create ? 'staff' : body.context!);
}
export function followupSavedMatches(value: unknown, action: NativePendingAction, schoolId: string): FollowupDetail {
  const [studentId,day,context] = JSON.parse(action.source?.fingerprint ?? '[]') as string[], create = action.endpoint === followupRoot;
  const id = new URL(action.refreshPath,'https://thatcampus.invalid').pathname.slice(followupRoot.length+1), item = normalizeAttendanceFollowup(value,{id,studentId,schoolId},true);
  if (item.attendance_date !== day || item.revision < (create ? 1 : action.source!.revision+1)) throw new Error('The saved record did not match the acknowledged follow-up action.');
  const body = JSON.parse(action.payload.kind === 'json' ? action.payload.body : '{}') as Record<string,unknown>;
  if (create && (item.question !== body.question || Date.parse(item.due_at) !== Date.parse(String(body.due_at)))) throw new Error('The created question did not match its retained original.');
  if (!create && !item.entries.some(entry => entry.kind === body.kind && entry.body === body.body)) throw new Error('The acknowledged response is not present in this saved follow-up.');
  if (context === 'guardian' && body.context !== 'guardian') throw new Error('The response context changed.');
  return item;
}
export function normalizeAttendanceEligibility(value: unknown, studentId: string): StudentEligibilityResponse {
  const item = object(value), student = object(item?.student), subject = object(item?.subject), projection = object(item?.projection), policy = object(item?.policy), definition = object(subject?.subject);
  if (student?.id !== studentId || !subject || !definition || !text(definition.name,500,1) || !policy || !projection || !text(policy.name,500,1) || !text(policy.text,10000) || typeof projection.eligible !== 'boolean' || ['classes_held','classes_attended','classes_excused'].some(key => !Number.isSafeInteger(subject[key]) || Number(subject[key]) < 0) || !['number','string'].includes(typeof subject.percentage) || String(subject.percentage).trim() === '' || !Number.isFinite(Number(subject.percentage)) || Number(subject.percentage) < 0 || Number(subject.percentage) > 100 || typeof policy.minimum_percentage !== 'number' || !Number.isFinite(policy.minimum_percentage) || policy.minimum_percentage < 0 || policy.minimum_percentage > 100 || ['additional_missed','projected_percentage','threshold'].some(key => typeof projection[key] !== 'number' || !Number.isFinite(projection[key]) || Number(projection[key]) < 0) || !Number.isSafeInteger(projection.additional_missed) || Number(projection.projected_percentage)>100 || projection.threshold !== policy.minimum_percentage) throw new Error('The eligibility response did not confirm this learner and the published attendance policy.');
  return item as unknown as StudentEligibilityResponse;
}
export type AttendanceThreshold = {id: string;name: string;admission_number: string;class_section_id: string;class_name: string;recorded_days: number;percentage: number;threshold: number};
export function attendanceThresholds(value: unknown, scope: Pick<NativePendingScope,'schoolId'|'mode'|'namespaceId'>, day: string): AttendanceThreshold[] {
  const data = object(value), context = object(data?.context), environment = object(context?.environment);
  if (!data || data.surface !== 'thresholds' || data.date !== day || context?.institution_id !== scope.schoolId || environment?.kind !== scope.mode || (environment.namespace_id ?? null) !== scope.namespaceId || !Array.isArray(data.thresholds)) throw new Error('The attendance patterns did not match this campus, date and selected environment.');
  const ids = new Set<string>();
  for (const value of data.thresholds) { const item = object(value); if (!item || !attendanceUuid(item.id) || ids.has(item.id) || !attendanceUuid(item.class_section_id) || !text(item.name,500,1) || !text(item.class_name,500,1) || !Number.isSafeInteger(item.recorded_days) || Number(item.recorded_days) < 5 || typeof item.percentage !== 'number' || item.percentage < 0 || item.percentage > 100 || typeof item.threshold !== 'number' || item.threshold < 0 || item.threshold > 100) throw new Error('An attendance pattern is incomplete. Missing records were not treated as absence.'); ids.add(item.id); }
  return data.thresholds as AttendanceThreshold[];
}
export type { Followup, FollowupDetail, FollowupContext, FollowupEntryInput };
