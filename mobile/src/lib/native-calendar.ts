import type { CalendarAssessmentDate, CalendarCategory, CalendarEntry, CalendarSourceResult, CampusCalendarScope } from '../../../packages/contracts/src/wire/features/calendar/campusCalendarSources';
import type { PublishedCampusDate, PublishedCampusDatesPage } from '../../../packages/contracts/src/wire/features/calendar/campusPublishedDates';
import type { DiningAvailabilityPage, DiningAvailabilityWarning } from '../../../packages/contracts/src/wire/features/calendar/diningAvailability';
import type { CampusEventDto, CampusEventListResponse, CampusEventStatus } from '../../../packages/contracts/src/wire/features/campus-events/types';
import type { ApiSchoolCalendarDay } from '../../../packages/contracts/src/wire/features/school/api';

export type { CalendarCategory, CalendarEntry, CampusCalendarScope };
export type NativeCalendarFetcher = <T>(path: string, options?: { signal?: AbortSignal }) => Promise<T>;
export interface NativeCalendarSourceResult extends CalendarSourceResult { campusDays?: ApiSchoolCalendarDay[] }
export interface NativeCalendarMonthCell { date: string; inMonth: boolean }

export const nativeCalendarSourceLabels: Record<CalendarCategory, string> = {
  milestones: 'Dates & deadlines', dates: 'Campus dates', events: 'Events', assessments: 'Assessments', services: 'Service changes',
};
const dayMs = 86_400_000;
const pageLimit = 10;
const origin = 'https://thatcampus.invalid';
const warningMessages: Record<DiningAvailabilityWarning['reason'], string> = {
  nonexistent_time: 'Published dining hours need review: the local time does not exist when the clocks change.',
  ambiguous_time: 'Published dining hours need review: the local time occurs twice when the clocks change.',
  invalid_duration: 'Published dining hours need review: the times do not form a valid serving window.',
  cancelled_for_date: 'Dining cancelled for this date.',
};

function invalid(message: string): never { throw new Error(message); }
function text(value: unknown): value is string { return typeof value === 'string'; }
function identifier(value: unknown): value is string { return text(value) && value.trim().length > 0; }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function instant(value: unknown): value is string { return text(value) && Number.isFinite(Date.parse(value)); }
function active(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Calendar loading was cancelled.'); error.name = 'AbortError'; throw error;
}
function requireDate(value: string) { if (!nativeCalendarValidDate(value)) invalid('Choose a valid calendar date.'); }

/** Civil dates are validated and moved in UTC, independently of the device zone. */
export function nativeCalendarValidDate(value: unknown): value is string {
  return text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function nativeCalendarShiftDay(date: string, days: number): string {
  requireDate(date);
  if (!Number.isSafeInteger(days)) invalid('Choose a finite day movement.');
  const moved = new Date(Date.parse(`${date}T12:00:00Z`) + days * dayMs);
  if (!Number.isFinite(moved.getTime())) invalid('The calendar date is outside the supported range.');
  const result = moved.toISOString().slice(0, 10); requireDate(result); return result;
}
export function nativeCalendarMonthRange(date: string): { from: string; until: string } {
  requireDate(date);
  const first = new Date(`${date.slice(0, 7)}-01T12:00:00Z`), last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { from: first.toISOString().slice(0, 10), until: last.toISOString().slice(0, 10) };
}
export function nativeCalendarShiftMonth(date: string, months: number): string {
  requireDate(date);
  if (!Number.isSafeInteger(months)) invalid('Choose a finite month movement.');
  const moved = new Date(`${date}T12:00:00Z`), day = moved.getUTCDate();
  moved.setUTCDate(1); moved.setUTCMonth(moved.getUTCMonth() + months);
  if (!Number.isFinite(moved.getTime())) invalid('The calendar date is outside the supported range.');
  const first = moved.toISOString().slice(0, 10); requireDate(first);
  const { until } = nativeCalendarMonthRange(first);
  moved.setUTCDate(Math.min(day, Number(until.slice(8, 10))));
  return moved.toISOString().slice(0, 10);
}
/** Complete Monday-first weeks covering this month; no working-week assumption. */
export function nativeCalendarMonthCells(date: string): NativeCalendarMonthCell[] {
  const { from, until } = nativeCalendarMonthRange(date);
  const offset = (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = Date.parse(`${from}T12:00:00Z`) - offset * dayMs;
  const count = Math.ceil((offset + Number(until.slice(8, 10))) / 7) * 7;
  return Array.from({ length: count }, (_, index) => { const day = new Date(start + index * dayMs).toISOString().split('T')[0]!; return { date: day, inMonth: day.slice(0, 7) === from.slice(0, 7) }; });
}

/** Return a campus-local civil date, never a device-local or localized date label. */
export function nativeCalendarDay(value: Date | string | number, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) invalid('A calendar source returned an invalid instant.');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', era: 'short' }).formatToParts(date);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === kind)?.value ?? '';
  const year = part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
  const yearText = year >= 0 && year <= 9999 ? String(year).padStart(4, '0') : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  return `${yearText}-${part('month')}-${part('day')}`;
}
function validateRange(from: string, until: string) {
  requireDate(from); requireDate(until);
  if (until < from || Date.parse(until) - Date.parse(from) > 30 * dayMs) invalid('Choose a calendar range of up to 31 days.');
}
function localDateStart(date: string, timeZone: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let lower = target - 36 * 3_600_000, upper = target + 36 * 3_600_000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const local = Date.parse(`${nativeCalendarDay(middle, timeZone)}T00:00:00Z`);
    if (local < target) lower = middle + 1; else upper = middle;
  }
  return lower;
}
/** Inclusive owner API range, including DST changes and skipped local midnights. */
export function nativeCalendarInstantRange(from: string, until: string, timeZone: string): { from: string; to: string } {
  validateRange(from, until);
  const next = new Date(Date.parse(`${until}T00:00:00Z`) + dayMs).toISOString().split('T')[0]!;
  return { from: new Date(localDateStart(from, timeZone)).toISOString(), to: new Date(localDateStart(next, timeZone) - 1).toISOString() };
}
function entryDates(start: string, end: string, timeZone: string) {
  if (!instant(start) || !instant(end) || Date.parse(end) < Date.parse(start)) invalid('A calendar source returned invalid dates.');
  return { startsOn: nativeCalendarDay(start, timeZone), endsOn: nativeCalendarDay(Math.max(Date.parse(start), Date.parse(end) - 1), timeZone) };
}
function localTarget(base: string | undefined): URL | undefined {
  if (!base) return undefined;
  try { const target = new URL(base, origin); return target.origin === origin && !target.username && !target.password && !target.hash ? target : undefined; } catch { return undefined; }
}
/** Only an explicit owning contribution can become an owning-details link. */
export function nativeCalendarSourceHref(base: string | undefined, kind: 'events' | 'assessments', id: string): string | undefined {
  const target = localTarget(base); if (!target || !identifier(id)) return undefined;
  if (kind === 'events') {
    if (!/^\/areas\/events\/(?:manage|assigned|calendar)\/?$/.test(target.pathname)) return undefined;
    target.pathname = `${target.pathname.replace(/\/$/, '')}/${encodeURIComponent(id)}`;
  } else {
    // Family results is not an assessment-details route.
    if (!/^\/areas\/assessments\/(?:manage|assigned)\/?$/.test(target.pathname)) return undefined;
    target.searchParams.set('assessment', id);
  }
  return `${target.pathname}${target.search}`;
}
function serviceHref(href: string): string | undefined {
  const target = localTarget(href);
  return target && /^\/areas\/dining(?:\/|$)/.test(target.pathname) ? `${target.pathname}${target.search}` : undefined;
}
export function nativeCalendarOverlaps(entry: CalendarEntry, from: string, until: string): boolean { return entry.startsOn <= until && entry.endsOn >= from; }
function deduplicate(entries: CalendarEntry[]): CalendarEntry[] {
  const unique = new Map<string, CalendarEntry>();
  for (const entry of entries) if ((unique.get(entry.id)?.revision ?? -1) <= (entry.revision ?? -1)) unique.set(entry.id, entry);
  return [...unique.values()];
}

export function nativeCalendarDateEntries(days: readonly ApiSchoolCalendarDay[]): CalendarEntry[] {
  return days.map(day => {
    if (!identifier(day.id) || !nativeCalendarValidDate(day.date) || !text(day.label) || typeof day.is_instructional !== 'boolean'
      || day.revision !== undefined && !positive(day.revision) || day.reason !== undefined && !text(day.reason)) invalid('Campus dates returned an invalid record.');
    return { id: `dates:${day.id}`, category: 'dates', sourceId: day.id, title: day.label.trim() || 'Academic date', startsOn: day.date, endsOn: day.date,
      allDay: true, revision: day.revision, summary: day.reason?.trim() || undefined,
      status: day.kind === 'public_holiday' || day.kind === 'local_holiday' ? 'Holiday' : day.kind === 'emergency_closure' ? 'Closure' : day.kind === 'instructional_override' ? 'Teaching day changed' : undefined };
  });
}
export function nativeCalendarPublishedEntries(items: readonly PublishedCampusDate[], schoolId: string): CalendarEntry[] {
  return items.map(item => {
    if (!identifier(item.id) || item.school_id !== schoolId || !text(item.title) || !text(item.description) || !text(item.category_label)
      || !nativeCalendarValidDate(item.starts_on) || !nativeCalendarValidDate(item.ends_on) || item.ends_on < item.starts_on
      || !positive(item.revision) || !['published', 'cancelled'].includes(item.state)
      || item.cancellation_reason != null && !text(item.cancellation_reason)) invalid('Published dates returned an invalid or mismatched record.');
    return { id: `milestones:${item.id}`, category: 'milestones', sourceId: item.id, title: item.title, startsOn: item.starts_on, endsOn: item.ends_on,
      allDay: true, revision: item.revision, summary: item.description, publication: item, categoryLabel: item.category_label,
      status: item.state === 'cancelled' ? 'Cancelled' : undefined };
  });
}
export function nativeCalendarEventEntries(items: readonly CampusEventDto[], scope: CampusCalendarScope): CalendarEntry[] {
  return deduplicate(items.filter(item => item.status !== 'draft').map(item => {
    if (!identifier(item.id) || item.school_id !== scope.schoolId || !text(item.title) || !text(item.venue) || !positive(item.revision)
      || !['published', 'completed', 'cancelled'].includes(item.status) || item.cancellation_reason != null && !text(item.cancellation_reason)) invalid('Events returned an invalid or mismatched record.');
    return { id: `events:${item.id}`, category: 'events', sourceId: item.id, revision: item.revision, title: item.title,
      ...entryDates(item.starts_at, item.ends_at, scope.timeZone), startsAt: item.starts_at, endsAt: item.ends_at, allDay: false,
      location: item.venue || undefined, status: item.status === 'cancelled' ? 'Cancelled' : item.status === 'completed' ? 'Completed' : undefined,
      summary: item.status === 'cancelled' ? item.cancellation_reason || undefined : undefined,
      href: nativeCalendarSourceHref(scope.eventHref, 'events', item.id) };
  }));
}
export function nativeCalendarAssessmentEntries(items: readonly CalendarAssessmentDate[], scope: CampusCalendarScope): CalendarEntry[] {
  return deduplicate(items.map(item => {
    if (!identifier(item.id) || !text(item.title) || !instant(item.scheduled_at) || !text(item.venue) || !text(item.subject_name) || !text(item.class_name)
      || item.duration_minutes !== null && (!Number.isFinite(item.duration_minutes) || item.duration_minutes < 0)) invalid('Assessments returned an invalid dated record.');
    const endsAt = new Date(Date.parse(item.scheduled_at) + (item.duration_minutes ?? 0) * 60_000).toISOString();
    return { id: `assessments:${item.id}`, category: 'assessments', sourceId: item.id, title: item.title,
      ...entryDates(item.scheduled_at, endsAt, scope.timeZone), startsAt: item.scheduled_at, ...(item.duration_minutes ? { endsAt } : {}), allDay: false,
      location: item.venue || undefined, summary: [item.subject_name, item.class_name].filter(Boolean).join(' · ') || undefined,
      href: nativeCalendarSourceHref(scope.assessmentHref, 'assessments', item.id) };
  }));
}
export function nativeCalendarServiceEntries(items: DiningAvailabilityPage['items'], warnings: DiningAvailabilityWarning[], scope: CampusCalendarScope): CalendarEntry[] {
  const entries: CalendarEntry[] = items.filter(item => item.changed_for_date || item.state === 'cancelled' || item.state === 'paused').map(item => {
    if (!identifier(item.id) || !identifier(item.source_id) || !positive(item.source_revision) || !text(item.service_name) || !text(item.label)
      || !nativeCalendarValidDate(item.local_date) || !identifier(item.timezone) || typeof item.changed_for_date !== 'boolean' || !text(item.href)
      || item.space_label != null && !text(item.space_label) || !['planned', 'published', 'open', 'paused', 'ended', 'cancelled'].includes(item.state)
      || item.availability_only !== true || item.venue_reserved !== false) invalid('Service changes returned an invalid or mismatched record.');
    return { id: `services:${item.id}`, category: 'services', sourceId: item.source_id, revision: item.source_revision,
      title: `${item.service_name} · ${item.label}`, ...entryDates(item.starts_at, item.ends_at, scope.timeZone), startsAt: item.starts_at, endsAt: item.ends_at,
      allDay: false, location: item.space_label || undefined, status: item.state === 'cancelled' ? 'Cancelled' : item.state === 'paused' ? 'Paused' : 'Changed for this date', href: serviceHref(item.href) };
  });
  for (const warning of warnings) {
    if (!identifier(warning.plan_id) || !identifier(warning.plan_version_id) || !nativeCalendarValidDate(warning.local_date)
      || !Object.hasOwn(warningMessages, warning.reason) || !text(warning.href)) invalid('Service changes returned an invalid dated warning.');
    if (items.some(item => item.plan_id === warning.plan_id && item.local_date === warning.local_date)) continue;
    entries.push({ id: `services:warning:${warning.plan_version_id}:${warning.local_date}:${warning.reason}`, category: 'services', sourceId: warning.plan_id,
      title: warning.reason === 'cancelled_for_date' ? 'Dining cancelled' : 'Dining hours need review', startsOn: warning.local_date, endsOn: warning.local_date,
      allDay: true, status: warning.reason === 'cancelled_for_date' ? 'Cancelled' : 'Needs review', summary: warningMessages[warning.reason], href: serviceHref(warning.href) });
  }
  return deduplicate(entries);
}

function pageMatches(response: PublishedCampusDatesPage | DiningAvailabilityPage, page: number, from: string, until: string) {
  if (!response || !Array.isArray(response.items) || response.page !== page || !positive(response.page_size) || !nonnegative(response.total)
    || !positive(response.total_pages) || page > response.total_pages || response.from !== from || response.until !== until
    || response.items.length > response.page_size) invalid('A calendar source returned an incomplete or mismatched page. Refresh this source.');
}
function contributedSource(scope: CampusCalendarScope, category: 'events' | 'assessments') {
  const target = localTarget(category === 'events' ? scope.eventHref : scope.assessmentHref);
  const pattern = category === 'events' ? /^\/areas\/events\/(?:manage|assigned|calendar)\/?$/ : /^\/areas\/assessments\/(?:manage|assigned|results)\/?$/;
  if (!target || !pattern.test(target.pathname)) invalid('This source is not available in the selected Calendar context.');
  if (scope.studentId && (target.searchParams.get('student_id') !== scope.studentId || !['self', 'dependent'].includes(target.searchParams.get('scope') ?? ''))) invalid('The Calendar source did not match the selected learner.');
}

/** Source-owned reads only. Authentication/world binding remain the injected transport's responsibility. */
export async function loadNativeCalendarSource(category: CalendarCategory, scope: CampusCalendarScope, from: string, until: string,
  fetcher: NativeCalendarFetcher, signal?: AbortSignal): Promise<NativeCalendarSourceResult> {
  validateRange(from, until); active(signal);
  if (!identifier(scope.schoolId)) invalid('Confirm the campus before loading Calendar.');
  // Validate the source time zone before any read or date projection.
  nativeCalendarDay(`${from}T12:00:00Z`, scope.timeZone);
  const read = async <T>(path: string): Promise<T> => { active(signal); const result = await fetcher<T>(path, { signal }); active(signal); return result; };
  const overlap = (entries: CalendarEntry[]) => deduplicate(entries).filter(entry => nativeCalendarOverlaps(entry, from, until));
  if (category === 'dates') {
    const result = await read<{ results: ApiSchoolCalendarDay[] }>(`/api/v1/calendar/days/?${new URLSearchParams({ school_id: scope.schoolId, from, to: until })}`);
    if (!result || !Array.isArray(result.results)) invalid('Campus dates returned an incomplete response.');
    const entries = overlap(nativeCalendarDateEntries(result.results));
    return { entries, partial: false, campusDays: result.results.filter(day => day.date >= from && day.date <= until) };
  }
  if (category === 'milestones') {
    const entries: CalendarEntry[] = [], ids = new Set<string>(); let partial = false;
    let totals: string | undefined;
    for (let page = 1; page <= pageLimit; page++) {
      const response = await read<PublishedCampusDatesPage>(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/campus-dates?${new URLSearchParams({ from, until, page: String(page) })}`);
      pageMatches(response, page, from, until);
      const currentTotals = `${response.total}:${response.page_size}:${response.total_pages}`;
      if (totals && totals !== currentTotals) partial = true; totals = currentTotals;
      for (const entry of nativeCalendarPublishedEntries(response.items, scope.schoolId)) { if (ids.has(entry.id)) partial = true; ids.add(entry.id); entries.push(entry); }
      if (page >= response.total_pages) return { entries: overlap(entries), partial };
    }
    return { entries: overlap(entries), partial: true };
  }
  if (category === 'events') {
    contributedSource(scope, category);
    const range = nativeCalendarInstantRange(from, until, scope.timeZone);
    const statuses: CampusEventStatus[] = ['published', 'completed', 'cancelled'];
    const sources = await Promise.all(statuses.map(async status => {
      const entries: CalendarEntry[] = [], seen = new Set<string>(); let cursor: string | null = null;
      for (let page = 0; page < pageLimit; page++) {
        const params = new URLSearchParams({ school_id: scope.schoolId, ...range, status, limit: '100' });
        if (scope.studentId) params.set('student_id', scope.studentId); if (cursor) params.set('cursor', cursor);
        const response = await read<CampusEventListResponse>(`/api/v1/campus-events?${params}`);
        if (!response || !Array.isArray(response.items) || response.items.length > 100 || response.next_cursor !== null && !identifier(response.next_cursor)) invalid('Events returned an incomplete cursor page.');
        entries.push(...nativeCalendarEventEntries(response.items, scope));
        cursor = response.next_cursor;
        if (!cursor) return { entries, partial: false };
        if (seen.has(cursor)) return { entries, partial: true }; seen.add(cursor);
      }
      return { entries, partial: true };
    }));
    return { entries: overlap(sources.flatMap(source => source.entries)), partial: sources.some(source => source.partial) };
  }
  if (category === 'assessments') {
    contributedSource(scope, category);
    const params = new URLSearchParams({ from, to: until }); if (scope.studentId) params.set('student_id', scope.studentId);
    const result = await read<{ items: CalendarAssessmentDate[] }>(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/assessments/calendar/?${params}`);
    if (!result || !Array.isArray(result.items)) invalid('Assessments returned an incomplete response.');
    return { entries: overlap(nativeCalendarAssessmentEntries(result.items, scope)), partial: false };
  }
  if (category !== 'services' || !scope.includeDining) invalid('This source is not available in the selected Calendar context.');
  const items: DiningAvailabilityPage['items'] = [], warnings: DiningAvailabilityWarning[] = []; let partial = false;
  let totals: string | undefined;
  for (let page = 1; page <= pageLimit; page++) {
    const response = await read<DiningAvailabilityPage>(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/dining/availability?${new URLSearchParams({ from, until, page: String(page) })}`);
    pageMatches(response, page, from, until);
    if (response.timezone !== scope.timeZone || response.warnings !== undefined && !Array.isArray(response.warnings)) invalid('Service changes did not match the selected Calendar context.');
    const currentTotals = `${response.total}:${response.page_size}:${response.total_pages}`;
    if (totals && totals !== currentTotals) partial = true; totals = currentTotals;
    items.push(...response.items); warnings.push(...response.warnings ?? []);
    if (page >= response.total_pages) return { entries: overlap(nativeCalendarServiceEntries(items, warnings, scope)), partial };
  }
  return { entries: overlap(nativeCalendarServiceEntries(items, warnings, scope)), partial: true };
}
