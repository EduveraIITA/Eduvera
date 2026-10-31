import type { ActivityCatalogue, ActivityPlan, ActivityPlanInput } from '../../../packages/contracts/src/wire/features/activities/api';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
import { nativeCalendarValidDate } from './native-calendar';
import { academicCoverageActionAllowed } from './academic-schedule-policy';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const scheduleActivityRoot = (school: string) => `/api/v1/schools/${encodeURIComponent(school)}/activities`;
const fields = ['title', 'purpose', 'description', 'timezone', 'starts_on', 'ends_on', 'recurrence', 'weekdays', 'starts_at', 'ends_at', 'end_day_offset', 'space_id', 'person_ids', 'group_ids', 'lead_person_id', 'recorder_person_id', 'reviewer_person_id', 'attendance_mode', 'class_section_id', 'term_id', 'subject_id', 'location_kind', 'location_label', 'location_url'] as const;
export function scheduleActivityFields(plan: ActivityPlanInput): ActivityPlanInput { return Object.fromEntries(fields.map(key => [key, plan[key]])) as unknown as ActivityPlanInput; }
export function scheduleActivityInput(plan: ActivityPlanInput, catalogue: ActivityCatalogue): ActivityPlanInput {
  if (!catalogue.can_manage || !plan.title.trim() || plan.title.trim().length > 160 || plan.description.length > 1000 || !catalogue.purposes.includes(plan.purpose)) throw new Error('Choose a supported purpose and a title from 1 to 160 characters.');
  try { new Intl.DateTimeFormat('en', { timeZone: plan.timezone }); } catch { throw new Error('Choose a valid IANA time zone.'); }
  if (!nativeCalendarValidDate(plan.starts_on) || plan.ends_on !== null && (!nativeCalendarValidDate(plan.ends_on) || plan.ends_on < plan.starts_on)) throw new Error('Choose a valid activity date range.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.starts_at) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.ends_at) || plan.end_day_offset === 0 && plan.ends_at <= plan.starts_at || plan.end_day_offset === 1 && plan.ends_at > plan.starts_at) throw new Error('Choose a valid interval of up to 24 hours. Use Ends next day for overnight work.');
  if (!['once', 'weekly'].includes(plan.recurrence) || plan.recurrence === 'weekly' && !plan.weekdays.length || plan.weekdays.some(day => !Number.isSafeInteger(day) || day < 1 || day > 7) || new Set(plan.weekdays).size !== plan.weekdays.length) throw new Error('Choose the repeating weekdays.');
  if (plan.recurrence === 'once' && plan.ends_on && plan.ends_on !== plan.starts_on) throw new Error('One-time activity uses one starting date; overnight timing is separate.');
  if (plan.person_ids.length > 500 || plan.group_ids.length > 50 || new Set(plan.person_ids).size !== plan.person_ids.length || new Set(plan.group_ids).size !== plan.group_ids.length || plan.person_ids.some(id => !catalogue.people.some(person => person.id === id)) || plan.group_ids.some(id => !catalogue.groups.some(group => group.id === id))) throw new Error('Review the current participant and group choices.');
  if (!plan.person_ids.length && !plan.group_ids.length && !plan.class_section_id && !(plan.attendance_mode === 'none' && plan.space_id)) throw new Error('Choose people, a group or a place reservation without attendance.');
  for (const [id, choices] of [[plan.space_id, catalogue.spaces], [plan.lead_person_id, catalogue.people], [plan.recorder_person_id, catalogue.recorders], [plan.reviewer_person_id, catalogue.reviewers], [plan.class_section_id, catalogue.classes], [plan.term_id, catalogue.terms], [plan.subject_id, catalogue.subjects]] as const) if (id && !choices.some(choice => choice.id === id)) throw new Error('A selected person, place or academic context is no longer available.');
  if (Boolean(plan.class_section_id) !== Boolean(plan.term_id) || plan.subject_id && !plan.class_section_id || plan.class_section_id && plan.purpose !== 'teaching') throw new Error('Academic teaching needs the exact class and term. Other purposes may select a class as a participant group.');
  if (!['none', 'roll_call'].includes(plan.attendance_mode) || plan.attendance_mode === 'roll_call' && (!plan.recorder_person_id || !plan.reviewer_person_id)) throw new Error('Choose the authorized attendance recorder and reviewer.');
  if (plan.location_kind === 'on_campus' && !plan.space_id || plan.location_kind === 'off_site' && !plan.location_label?.trim() || plan.location_kind === 'online' && !plan.location_label?.trim() && !plan.location_url?.trim()) throw new Error('Choose a place or describe the online or off-site location.');
  if (plan.location_url) { try { const url = new URL(plan.location_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { throw new Error('Use an HTTP or HTTPS joining link without embedded credentials.'); } }
  return scheduleActivityFields({ ...plan, title: plan.title.trim(), description: plan.description.trim(), weekdays: plan.recurrence === 'once' ? [] : plan.weekdays, ends_on: plan.recurrence === 'once' ? plan.starts_on : plan.ends_on });
}
export function validScheduleActivity(value: unknown, school: string, id?: string): value is ActivityPlan & { school_id: string } {
  const plan = object(value); return !!plan && uuid(plan.id) && (!id || plan.id === id) && plan.school_id === school && Number.isSafeInteger(plan.revision) && Number(plan.revision) > 0 && ['draft', 'published', 'cancelled'].includes(String(plan.state)) && ['activity', 'academic'].includes(String(plan.source)) && typeof plan.title === 'string' && nativeCalendarValidDate(plan.starts_on) && Array.isArray(plan.person_ids) && Array.isArray(plan.group_ids) && Array.isArray(plan.weekdays);
}
export function scheduleActivityRefreshPath(value: unknown, action: NativePendingAction) {
  const root = scheduleActivityRoot(action.scope.schoolId) + '/plans', path = action.endpoint, creating = path === root, match = new RegExp(`^${root}/([0-9a-f-]{36})(?:/(publish|cancel|revise))?$`, 'i').exec(path);
  const revise = match?.[2] === 'revise', id = creating || revise ? action.clientId : match?.[1], body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  if (!id || !body || !validScheduleActivity(value, action.scope.schoolId, id) || value.source !== 'activity' || value.state !== (match?.[2] === 'publish' ? 'published' : match?.[2] === 'cancel' ? 'cancelled' : 'draft') || value.revision !== (creating || revise ? 1 : Number(body.expected_revision) + 1) || revise && value.replaces_version_id !== match?.[1]) throw new Error('The activity receipt did not match this retained action.');
  if (creating && value.revision !== 1 || revise && value.revision !== 1) throw new Error('The new activity draft receipt has an unexpected revision.');
  return `${root}/${id}`;
}

/** Shared-journal boundary for the existing Activity, academic and Daily Plan owners. */
export function nativeScheduleAuthoringAllowed(record: NativePendingAction, scope: NativePendingScope): boolean {
  if(record.source?.kind==='academic_coverage_response')return academicCoverageActionAllowed(record,scope);
  try {
    if (record.domain !== 'schedule' || record.payload.kind !== 'json' || !record.source) return false;
    const body = object(JSON.parse(record.payload.body)), source = record.source, read = new URL(record.refreshPath, 'https://thatcampus.invalid');
    if (!body || read.origin !== 'https://thatcampus.invalid' || !Number.isSafeInteger(source.revision) || source.revision < 0) return false;
    const exactKey = record.replayPolicy === 'same_request' && body.idempotency_key === record.clientId;
    const revision = () => Number.isSafeInteger(body.expected_revision) && Number(body.expected_revision) > 0 && body.expected_revision === source.revision;
    const activity = scheduleActivityRoot(scope.schoolId), plans = activity + '/plans';
    if (record.endpoint === plans || record.endpoint.startsWith(plans + '/')) {
      if (!exactKey || 'school_id' in body || source.kind !== 'activity_plan') return false;
      const creating = record.endpoint === plans, match = new RegExp(`^${plans}/([0-9a-f-]{36})(?:/(publish|cancel|revise))?$`, 'i').exec(record.endpoint);
      if (creating ? record.method !== 'POST' || source.sourceId !== scope.schoolId || source.revision !== 0 : !match || !uuid(match[1]) || source.sourceId !== match[1] || !revision() || record.method !== (match[2] ? 'POST' : 'PUT')) return false;
      const newId = creating || match?.[2] === 'revise', expectedRead = `${plans}/${newId && record.phase === 'accepted' ? record.clientId : creating ? record.clientId : match?.[1]}`;
      if (read.search || (read.pathname !== expectedRead && !(creating && record.phase !== 'accepted' && read.pathname === activity + '/catalogue'))) return false;
      return true;
    }
    if (record.endpoint.startsWith('/api/v1/day-plans')) {
      if (!exactKey || body.school_id !== scope.schoolId || source.kind !== 'day_plan' || record.method !== 'POST') return false;
      const creating = record.endpoint === '/api/v1/day-plans', match = /^\/api\/v1\/day-plans\/([0-9a-f-]{36})\/(save|publish|discard)$/i.exec(record.endpoint);
      if (creating ? source.sourceId !== scope.schoolId || source.revision !== 0 || !uuid(body.class_section_id) || !nativeCalendarValidDate(body.date) : !match || source.sourceId !== match[1] || !revision()) return false;
      if (read.searchParams.getAll('school_id').length !== 1 || read.searchParams.get('school_id') !== scope.schoolId) return false;
      if (creating && record.phase !== 'accepted' && read.pathname === '/api/v1/day-plans/options') return read.searchParams.get('date') === body.date && [...read.searchParams.keys()].every(key => ['school_id', 'date'].includes(key));
      return /^\/api\/v1\/day-plans\/[0-9a-f-]{36}$/i.test(read.pathname) && (creating || read.pathname.endsWith('/' + source.sourceId)) && [...read.searchParams.keys()].every(key => key === 'school_id');
    }
    const academicRead = read.pathname === '/api/v1/schedule-planning' && [...read.searchParams.keys()].every(key => ['term_id', 'version_id'].includes(key)) && ['term_id', 'version_id'].every(key => read.searchParams.getAll(key).length <= 1 && (!read.searchParams.has(key) || uuid(read.searchParams.get(key))));
    if (!academicRead) return false;
    if (record.endpoint.startsWith('/api/v1/schedule-planning')) {
      if (!exactKey || body.school_id !== scope.schoolId || record.method !== 'POST') return false;
      if (record.endpoint === '/api/v1/schedule-planning/years') return source.kind === 'academic_year' && source.sourceId === scope.schoolId && source.revision === 0 && typeof body.academic_year === 'string' && Array.isArray(body.terms) && body.terms.length >= 1 && body.terms.length <= 6;
      if (record.endpoint === '/api/v1/schedule-planning/drafts') return source.kind === 'academic_schedule' && source.sourceId === scope.schoolId && source.revision === 0 && uuid(body.term_id) && uuid(body.class_section_id) && read.searchParams.get('term_id') === body.term_id;
      const match = /^\/api\/v1\/schedule-planning\/([0-9a-f-]{36})\/(save|publish|discard)$/i.exec(record.endpoint);
      return !!match && source.kind === 'academic_schedule' && source.sourceId === match[1] && revision() && (!read.searchParams.has('version_id') || read.searchParams.get('version_id') === source.sourceId);
    }
    if (record.replayPolicy !== 'inspect_only' || 'idempotency_key' in body || 'command_id' in body) return false;
    if (record.endpoint === '/api/v1/principal/timetable/targets/') return record.method === 'POST' && source.kind === 'curriculum_target' && source.sourceId === body.class_section_id && body.expected_revision === source.revision && uuid(body.term_id) && uuid(body.subject_id) && read.searchParams.get('term_id') === body.term_id;
    if (record.endpoint === '/api/v1/principal/calendar/closures/') return record.method === 'POST' && source.kind === 'school_closure' && source.sourceId === scope.schoolId && source.revision === 0 && uuid(body.term_id) && read.searchParams.get('term_id') === body.term_id && nativeCalendarValidDate(body.starts_on) && nativeCalendarValidDate(body.ends_on);
    const closure = /^\/api\/v1\/principal\/calendar\/closures\/(\d{4}-\d{2}-\d{2})\/$/.exec(record.endpoint);
    return !!closure && record.method === 'DELETE' && source.kind === 'school_closure' && source.sourceId === closure[1] && nativeCalendarValidDate(closure[1]) && revision();
  } catch { return false; }
}
