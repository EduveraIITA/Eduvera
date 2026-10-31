import type { CampusDateFields, PublishedCampusDate } from '../../../packages/contracts/src/wire/features/calendar/campusPublishedDates';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
import { nativeCalendarValidDate } from './native-calendar';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export type CalendarDateAction = 'publish' | 'correct' | 'cancel';
export function calendarDateRoot(school: string) { return `/api/v1/schools/${encodeURIComponent(school)}/campus-dates`; }
export function calendarDateFields(values: { title: string; description: string; start: string; end: string; category: string }, record?: PublishedCampusDate): CampusDateFields {
  const { title, description, start, end, category } = values, until = end || start;
  if (title.trim().length < 2 || title.trim().length > 160 || description.trim().length > 4000 || (category.trim() && category.trim().length < 2) || category.trim().length > 80) throw new Error('Use a title from 2 to 160 characters and a category from 2 to 80 characters.');
  if (![start, until].every(day => nativeCalendarValidDate(day) && day >= '1900-01-01' && day <= '2200-12-31') || until < start || Date.parse(until) - Date.parse(start) > 366 * 86_400_000) throw new Error('Choose an inclusive date range of up to 367 days between 1900 and 2200.');
  if ([title, description, category].some(value => value.includes('\0'))) throw new Error('Remove unsupported characters.');
  return { title: title.trim(), description: description.trim(), starts_on: start, ends_on: until, category_label: category.trim() || 'Campus date', academic_term_id: record?.academic_term_id ?? null, provenance: record?.provenance ? { ...record.provenance } : null };
}
export function calendarDateReason(value: string) { const reason = value.trim(); if (reason.length < 3 || reason.length > 1000 || reason.includes('\0')) throw new Error('Explain the change in 3 to 1000 characters.'); return reason; }
export function validCalendarDateRecord(value: unknown, school: string, id?: string): value is PublishedCampusDate {
  const item = object(value);
  return !!item && uuid(item.id) && (!id || item.id === id) && item.school_id === school && Number.isSafeInteger(item.revision) && Number(item.revision) > 0 && ['published', 'cancelled'].includes(String(item.state)) && typeof item.title === 'string' && typeof item.description === 'string' && typeof item.category_label === 'string' && nativeCalendarValidDate(item.starts_on) && nativeCalendarValidDate(item.ends_on) && item.ends_on >= item.starts_on;
}
/** Verify the mutation receipt before promoting its exact source to accepted recovery. */
export function calendarDateRefreshPath(value: unknown, action: NativePendingAction) {
  const root = calendarDateRoot(action.scope.schoolId), creating = action.endpoint === root, item = value;
  const target = new RegExp(`^${root}/([0-9a-f-]{36})/(correct|cancel)$`, 'i').exec(action.endpoint);
  const body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  if (!body || !validCalendarDateRecord(item, action.scope.schoolId, creating ? undefined : target?.[1]) || !creating && !target || item.state !== (target?.[2] === 'cancel' ? 'cancelled' : 'published') || item.revision !== (creating ? 1 : Number(body.expected_revision) + 1)) throw new Error('The campus-date receipt did not match the original publication.');
  if (creating || target?.[2] === 'correct') {
    for (const key of ['title', 'description', 'starts_on', 'ends_on', 'category_label'] as const) if (item[key] !== body[key]) throw new Error('The campus-date receipt changed the reviewed publication.');
  } else if (item.cancellation_reason !== body.reason) throw new Error('The cancellation receipt did not match its original reason.');
  return `${root}/${item.id}`;
}
export function nativeCalendarDateAuthoringAllowed(record: NativePendingAction, scope: NativePendingScope): boolean {
  try {
    if (record.domain !== 'calendar' || record.method !== 'POST' || record.payload.kind !== 'json' || record.replayPolicy !== 'same_request' || record.source?.kind !== 'campus_date') return false;
    const body = object(JSON.parse(record.payload.body)), root = calendarDateRoot(scope.schoolId), read = new URL(record.refreshPath, 'https://thatcampus.invalid');
    if (!body || body.idempotency_key !== record.clientId || 'school_id' in body || read.origin !== 'https://thatcampus.invalid') return false;
    const creating = record.endpoint === root, match = new RegExp(`^${root}/([0-9a-f-]{36})/(correct|cancel)$`, 'i').exec(record.endpoint);
    const allowed = match?.[2] === 'cancel' ? ['idempotency_key', 'expected_revision', 'reason'] : ['idempotency_key', 'title', 'description', 'starts_on', 'ends_on', 'category_label', 'academic_term_id', 'provenance', ...(creating ? [] : ['expected_revision', 'reason'])];
    if (Object.keys(body).some(key => !allowed.includes(key))) return false;
    if (creating) {
      if (record.source.sourceId !== scope.schoolId || record.source.revision !== 0) return false;
      if (read.pathname === root && record.phase !== 'accepted') return [...read.searchParams.keys()].every(key => ['from', 'until', 'page'].includes(key)) && read.searchParams.getAll('from').length === 1 && read.searchParams.getAll('until').length === 1 && nativeCalendarValidDate(read.searchParams.get('from')) && nativeCalendarValidDate(read.searchParams.get('until')) && String(read.searchParams.get('until')) >= String(read.searchParams.get('from')) && Date.parse(read.searchParams.get('until')!) - Date.parse(read.searchParams.get('from')!) <= 30 * 86_400_000 && read.searchParams.get('page') === '1' && read.searchParams.getAll('page').length === 1;
      return read.pathname.startsWith(root + '/') && uuid(read.pathname.slice(root.length + 1)) && !read.search;
    }
    return !!match && uuid(match[1]) && record.source.sourceId === match[1] && Number.isSafeInteger(record.source.revision) && record.source.revision > 0 && body.expected_revision === record.source.revision && read.pathname === `${root}/${match[1]}` && !read.search;
  } catch { return false; }
}
