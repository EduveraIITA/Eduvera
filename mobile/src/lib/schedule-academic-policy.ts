import type { SchedulePeriod } from '../../../packages/contracts/src/schedule-period';
import type { ScheduleScreen } from '../../../packages/contracts/src/wire/features/schedule-planning/api';
import type { NativePendingAction } from './native-pending-action';
import { nativeCalendarValidDate } from './native-calendar';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function academicScheduleRead(term?: string, version?: string) { const q = new URLSearchParams(); if (term) q.set('term_id', term); if (version) q.set('version_id', version); return '/api/v1/schedule-planning' + (q.size ? `?${q}` : ''); }
export function academicScheduleRefreshPath(value: unknown, action: NativePendingAction) {
  const result = value as Record<string, unknown> | null, body = action.payload.kind === 'json' ? JSON.parse(action.payload.body) as Record<string, unknown> : null;
  if (!result || !body) throw new Error('The academic schedule receipt could not be confirmed.');
  if (action.endpoint === '/api/v1/schedule-planning/years') { if (!uuid(result.term_id) || !Array.isArray(result.term_ids) || !result.term_ids.length || !result.term_ids.every(uuid) || result.term_ids[0] !== result.term_id || result.term_ids.length !== (body.terms as unknown[] | undefined)?.length) throw new Error('The prepared-year receipt did not identify the reviewed terms.'); return academicScheduleRead(result.term_id); }
  if (action.endpoint.startsWith('/api/v1/principal/')) {
    if (action.endpoint.includes('/targets/')) { if (result.school_id !== action.scope.schoolId || result.term_id !== body.term_id || result.class_section_id !== body.class_section_id || result.subject_id !== body.subject_id || result.target_minutes !== body.target_minutes || result.revision !== Number(body.expected_revision) + 1) throw new Error('The teaching target receipt did not match the reviewed scope.'); }
    else if (action.method === 'DELETE') { if (result.deleted !== true || action.endpoint.split('/').filter(Boolean).at(-1) !== result.date) throw new Error('The closure removal receipt did not match the reviewed date.'); }
    else if (result.created !== true || !Array.isArray(result.results) || result.results.length !== (Date.parse(String(body.ends_on)) - Date.parse(String(body.starts_on))) / 86_400_000 + 1 || new Set(result.results.map(row => (row as Record<string, unknown>).date)).size !== result.results.length || result.results.some(row => { const item = row as Record<string, unknown>; return item.school_id !== undefined && item.school_id !== action.scope.schoolId || !uuid(item.id) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || !nativeCalendarValidDate(item.date) || item.date < String(body.starts_on) || item.date > String(body.ends_on) || item.label !== body.label || item.kind !== body.kind || item.reason !== body.reason; })) throw new Error('The closure receipt did not match this institution and exact reviewed date range.');
    return action.refreshPath;
  }
  const creating = action.endpoint === '/api/v1/schedule-planning/drafts', match = /^\/api\/v1\/schedule-planning\/([0-9a-f-]{36})\/(save|publish|discard)$/i.exec(action.endpoint);
  if (!uuid(result.id) || !creating && result.id !== match?.[1] || match?.[2] !== 'discard' && result.revision !== (creating ? 1 : Number(body.expected_revision) + 1)) throw new Error('The timetable receipt did not match its exact draft.');
  const read = new URL(action.refreshPath, 'https://thatcampus.invalid'); return academicScheduleRead(creating ? String(body.term_id) : read.searchParams.get('term_id') ?? undefined, result.id);
}
export function cleanSchedulePeriod(period: SchedulePeriod): SchedulePeriod { return { id: period.id, weekday: period.weekday, period_number: period.period_number, starts_at: period.starts_at.slice(0, 5), ends_at: period.ends_at.slice(0, 5), subject_id: period.subject_id, teacher_user_id: period.teacher_user_id, title: period.title.trim(), slot_type: period.slot_type, room: period.room.trim() }; }
export function validateSchedulePeriods(periods: SchedulePeriod[], data: ScheduleScreen) {
  if (periods.length > 168 || new Set(periods.map(period => `${period.weekday}:${period.period_number}`)).size !== periods.length || new Set(periods.map(period => period.id)).size !== periods.length) throw new Error('Use unique period numbers per day and at most 168 periods.');
  for (const period of periods) {
    if (!uuid(period.id) || !Number.isSafeInteger(period.weekday) || period.weekday < 1 || period.weekday > 7 || !Number.isSafeInteger(period.period_number) || period.period_number < 1 || period.period_number > 24 || !period.title.trim() || period.title.length > 120 || period.room.length > 80 || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(period.starts_at) || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(period.ends_at) || period.starts_at.slice(0, 5) >= period.ends_at.slice(0, 5)) throw new Error('Review each period number, title and time.');
    if (period.teacher_user_id && !data.teachers.some(teacher => teacher.id === period.teacher_user_id) || period.subject_id && !data.subjects.some(subject => subject.id === period.subject_id)) throw new Error('Choose current teachers and subjects.');
  }
  return periods.map(cleanSchedulePeriod);
}
export function academicDateRange(from: string, until: string, data: ScheduleScreen) { const term = data.terms.find(term => term.id === data.selected_term_id); if (!term || !nativeCalendarValidDate(from) || !nativeCalendarValidDate(until) || from <= data.school_date || from < term.starts_on || until > term.ends_on || until < from || Date.parse(until) - Date.parse(from) > 370 * 86_400_000) throw new Error('Choose future dates within this term, up to 371 days. Use Daily Plan for today.'); }
