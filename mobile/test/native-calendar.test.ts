import test from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarAssessmentDate, CampusCalendarScope } from '../../packages/contracts/src/wire/features/calendar/campusCalendarSources';
import type { PublishedCampusDate, PublishedCampusDatesPage } from '../../packages/contracts/src/wire/features/calendar/campusPublishedDates';
import type { CampusEventDto } from '../../packages/contracts/src/wire/features/campus-events/types';
import type { DiningAvailabilityItem, DiningAvailabilityPage } from '../../packages/contracts/src/wire/features/calendar/diningAvailability';
import { loadNativeCalendarSource, nativeCalendarAssessmentEntries, nativeCalendarDateEntries, nativeCalendarDay, nativeCalendarEventEntries,
  nativeCalendarInstantRange, nativeCalendarMonthCells, nativeCalendarMonthRange, nativeCalendarServiceEntries, nativeCalendarShiftDay,
  nativeCalendarShiftMonth, nativeCalendarSourceHref, nativeCalendarValidDate, type NativeCalendarFetcher } from '../src/lib/native-calendar';

const from = '2026-10-01', until = '2026-10-31';
const scope: CampusCalendarScope = { schoolId: 'school', timeZone: 'Asia/Kolkata', surfaceKey: 'assigned', includeDining: true,
  eventHref: '/areas/events/assigned', assessmentHref: '/areas/assessments/assigned' };
const mock = (handler: (path: string, options?: { signal?: AbortSignal }) => unknown | Promise<unknown>): NativeCalendarFetcher => async <T>(path: string, options?: { signal?: AbortSignal }) => await handler(path, options) as T;
function publication(patch: Partial<PublishedCampusDate> = {}): PublishedCampusDate {
  return { id: 'date', school_id: scope.schoolId, title: 'Registration window', description: 'Published information', starts_on: '2026-09-28', ends_on: '2026-10-02',
    category_label: 'Registration', state: 'published', revision: 1, academic_term_id: null, provenance: null, ...patch };
}
function publishedPage(items = [publication()], patch: Partial<PublishedCampusDatesPage> = {}): PublishedCampusDatesPage {
  return { items, page: 1, page_size: 20, total: items.length, total_pages: 1, from, until, can_manage: false, ...patch };
}
function event(patch: Partial<CampusEventDto> = {}): CampusEventDto {
  return { id: 'event', school_id: scope.schoolId, title: 'Campus forum', venue: 'Hall', revision: 1, status: 'published',
    starts_at: '2026-10-15T08:00:00Z', ends_at: '2026-10-15T10:00:00Z', cancellation_reason: null, ...patch } as CampusEventDto;
}
function assessment(patch: Partial<CalendarAssessmentDate> = {}): CalendarAssessmentDate {
  return { id: 'assessment', title: 'Review', date: '2026-10-15', scheduled_at: '2026-10-15T08:00:00Z', duration_minutes: null, venue: 'Lab', subject_name: 'Design', class_name: 'Cohort A', ...patch };
}
function meal(patch: Partial<DiningAvailabilityItem> = {}): DiningAvailabilityItem {
  return { id: 'meal', service_id: 'dining', service_name: 'Canteen', source_kind: 'session', source_id: 'meal', source_revision: 2,
    session_id: 'meal', plan_id: null, local_date: '2026-10-15', label: 'Lunch', menu_text: '', starts_at: '2026-10-15T06:30:00Z', ends_at: '2026-10-15T08:30:00Z',
    timezone: scope.timeZone, space_id: null, space_label: 'Dining hall', state: 'published', changed_for_date: false, updated_at: '2026-10-14T12:00:00Z',
    href: '/areas/dining?session_id=meal', availability_only: true, venue_reserved: false, ...patch };
}
function diningPage(items = [meal()], patch: Partial<DiningAvailabilityPage> = {}): DiningAvailabilityPage {
  return { items, total: items.length, page: 1, page_size: 20, total_pages: 1, from, until, timezone: scope.timeZone, warnings: [], ...patch };
}

test('civil date validation and shifts reject rollover and clamp month ends without local-zone arithmetic', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '', null]) assert.equal(nativeCalendarValidDate(value), false);
  assert.equal(nativeCalendarValidDate('2028-02-29'), true);
  assert.deepEqual(nativeCalendarMonthRange('2028-02-20'), { from: '2028-02-01', until: '2028-02-29' });
  assert.equal(nativeCalendarShiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(nativeCalendarShiftMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(nativeCalendarShiftMonth('2028-01-31', 1), '2028-02-29');
  assert.equal(nativeCalendarShiftMonth('2026-01-31', -1), '2025-12-31');
  assert.throws(() => nativeCalendarShiftDay('2026-02-30', 1));
  assert.throws(() => nativeCalendarShiftMonth('2026-01-01', Infinity));
});

test('month cells cover whole Monday-first weeks, including four-, five- and six-week months', () => {
  const feb = nativeCalendarMonthCells('2027-02-15');
  assert.equal(feb.length, 28); assert.deepEqual(feb[0], { date: '2027-02-01', inMonth: true });
  const oct = nativeCalendarMonthCells('2026-10-15');
  assert.equal(oct.length, 35); assert.deepEqual(oct[0], { date: '2026-09-28', inMonth: false });
  assert.deepEqual(oct.at(-1), { date: '2026-11-01', inMonth: false });
  const aug = nativeCalendarMonthCells('2026-08-15'); assert.equal(aug.length, 42);
  assert.equal(aug.filter(cell => cell.inMonth).length, 31);
});

test('campus dates and inclusive instant ranges respect extreme zones and DST', () => {
  assert.equal(nativeCalendarDay('2026-10-01T20:00:00Z', 'Asia/Kolkata'), '2026-10-02');
  assert.equal(nativeCalendarDay('2026-10-01T11:00:00Z', 'Pacific/Kiritimati'), '2026-10-02');
  assert.deepEqual(nativeCalendarInstantRange('2026-03-08', '2026-03-08', 'America/New_York'), { from: '2026-03-08T05:00:00.000Z', to: '2026-03-09T03:59:59.999Z' });
  assert.deepEqual(nativeCalendarInstantRange('2026-11-01', '2026-11-01', 'America/New_York'), { from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T04:59:59.999Z' });
  assert.deepEqual(nativeCalendarInstantRange('2018-11-04', '2018-11-04', 'America/Sao_Paulo'), { from: '2018-11-04T03:00:00.000Z', to: '2018-11-05T01:59:59.999Z' });
  assert.throws(() => nativeCalendarInstantRange(from, '2026-11-01', scope.timeZone), /31 days/);
  assert.throws(() => nativeCalendarDay('bad', scope.timeZone));
  assert.throws(() => nativeCalendarDay(from, 'Invalid/Campus'));
});

test('source links preserve explicit person context and never invent family assessment details', () => {
  assert.equal(nativeCalendarSourceHref('/areas/events/calendar?scope=dependent&student_id=child', 'events', 'event/id'), '/areas/events/calendar/event%2Fid?scope=dependent&student_id=child');
  assert.equal(nativeCalendarSourceHref('/areas/assessments/assigned?offering=offering', 'assessments', 'exam'), '/areas/assessments/assigned?offering=offering&assessment=exam');
  for (const base of [undefined, 'https://outside.example/areas/events/manage', '//outside.example/areas/events/manage', '/areas/events', '/areas/timetable/planning', '/areas/events/manage#other', 'https://user@thatcampus.invalid/areas/events/manage']) assert.equal(nativeCalendarSourceHref(base, 'events', 'id'), undefined);
  assert.equal(nativeCalendarSourceHref('/areas/assessments/results?scope=self&student_id=child', 'assessments', 'exam'), undefined);
});

test('campus day meaning remains source-owned: non-instructional alone is not closure', () => {
  const entries = nativeCalendarDateEntries([{ id: 'day', date: '2026-10-15', label: 'Local observance', is_instructional: false },
    { id: 'closure', date: '2026-10-16', label: 'Closure', is_instructional: false, kind: 'emergency_closure', reason: 'Published decision', revision: 2 }]);
  assert.equal(entries[0]?.status, undefined);
  assert.equal(entries[1]?.status, 'Closure'); assert.equal(entries[1]?.summary, 'Published decision');
});

test('timed event ends at midnight do not spill into the following civil date; cancelled revisions win', () => {
  const entries = nativeCalendarEventEntries([event(), event({ revision: 3, status: 'cancelled', cancellation_reason: 'Rescheduled', ends_at: '2026-10-15T18:30:00Z' }), event({ revision: 2 }), event({ id: 'draft', status: 'draft' })], scope);
  assert.equal(entries.length, 1); assert.equal(entries[0]?.revision, 3);
  assert.equal(entries[0]?.endsOn, '2026-10-15'); assert.equal(entries[0]?.summary, 'Rescheduled');
  assert.equal(entries[0]?.sourceId, 'event'); assert.equal(entries[0]?.status, 'Cancelled');
  assert.throws(() => nativeCalendarEventEntries([event({ school_id: 'foreign' })], scope), /mismatched/);
});

test('assessments never invent duration or family detail routes', () => {
  const family = { ...scope, studentId: 'child', assessmentHref: '/areas/assessments/results?scope=dependent&student_id=child' };
  const entries = nativeCalendarAssessmentEntries([assessment(), assessment({ id: 'timed', duration_minutes: 90 })], family);
  assert.equal(entries[0]?.endsAt, undefined); assert.equal(entries[0]?.href, undefined);
  assert.equal(entries[1]?.endsAt, '2026-10-15T09:30:00.000Z');
  assert.equal(entries[0]?.summary, 'Design · Cohort A');
  assert.throws(() => nativeCalendarAssessmentEntries([assessment({ duration_minutes: Infinity })], family));
});

test('service composition excludes routine meal hours and retains explicit dated warnings and exact links', () => {
  const entries = nativeCalendarServiceEntries([meal(), meal({ id: 'changed', changed_for_date: true }), meal({ id: 'paused', state: 'paused' })], [
    { plan_id: 'plan', plan_version_id: 'version', local_date: '2026-10-16', weekday: 5, reason: 'cancelled_for_date', href: '/areas/dining?date=2026-10-16' },
  ], scope);
  assert.equal(entries.length, 3); assert.equal(entries[0]?.status, 'Changed for this date');
  assert.equal(entries[1]?.status, 'Paused'); assert.equal(entries[2]?.allDay, true);
  assert.equal(entries[2]?.href, '/areas/dining?date=2026-10-16');
  assert.equal(nativeCalendarServiceEntries([meal({ changed_for_date: true, href: 'https://outside.example/' })], [], scope)[0]?.href, undefined);
});

test('published loader reads finite matching month pages, retains overlap and labels duplicate/capped pages partial', async () => {
  const requests: string[] = [];
  const result = await loadNativeCalendarSource('milestones', scope, from, until, mock(path => {
    requests.push(path); const page = Number(new URL(path, 'https://test.invalid').searchParams.get('page'));
    return publishedPage([publication({ revision: page })], { page, total: 2, total_pages: 2 });
  }));
  assert.equal(requests.length, 2); assert.equal(result.partial, true); assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.startsOn, '2026-09-28'); assert.equal(result.entries[0]?.revision, 2);
  let count = 0;
  const capped = await loadNativeCalendarSource('milestones', scope, from, until, mock(() => publishedPage([publication({ id: String(++count) })], { page: count, total: 220, total_pages: 11 })));
  assert.equal(count, 10); assert.equal(capped.partial, true);
});

test('published loader rejects wrong campus, malformed pagination and incorrect month instead of returning stale rows', async () => {
  for (const response of [publishedPage([publication({ school_id: 'foreign' })]), publishedPage([], { page: 2 }), publishedPage([], { total_pages: Infinity }),
    publishedPage([], { from: '2026-09-01' }), publishedPage([], { page_size: 0 })]) {
    await assert.rejects(loadNativeCalendarSource('milestones', scope, from, until, mock(() => response)));
  }
});

test('days API uses the exact campus and date range and retains records for attention verification', async () => {
  const result = await loadNativeCalendarSource('dates', scope, from, until, mock(path => {
    const params = new URL(path, 'https://test.invalid').searchParams;
    assert.equal(params.get('school_id'), scope.schoolId); assert.equal(params.get('from'), from); assert.equal(params.get('to'), until);
    return { results: [{ id: 'day', date: '2026-10-15', label: 'Observance', is_instructional: false, revision: 2 }] };
  }));
  assert.equal(result.campusDays?.[0]?.revision, 2); assert.equal(result.partial, false);
});

test('events request each public lifecycle status, exact learner, campus ISO overlap and bounded cursors', async () => {
  const requests: URL[] = [], family = { ...scope, studentId: 'child', eventHref: '/areas/events/calendar?scope=dependent&student_id=child' };
  const result = await loadNativeCalendarSource('events', family, from, until, mock(path => {
    const url = new URL(path, 'https://test.invalid'); requests.push(url);
    const status = url.searchParams.get('status')!;
    return { items: [event({ status: status as CampusEventDto['status'], revision: status === 'cancelled' ? 3 : 1 })], next_cursor: status === 'published' ? 'repeated' : null };
  }));
  assert.equal(requests.length, 4); assert.equal(result.partial, true); assert.equal(result.entries[0]?.status, 'Cancelled');
  assert.deepEqual(new Set(requests.map(url => url.searchParams.get('status'))), new Set(['published', 'completed', 'cancelled']));
  for (const { searchParams: params } of requests) {
    assert.equal(params.get('school_id'), scope.schoolId); assert.equal(params.get('student_id'), 'child'); assert.equal(params.get('limit'), '100');
    assert.equal(params.get('from'), '2026-09-30T18:30:00.000Z'); assert.equal(params.get('to'), '2026-10-31T18:29:59.999Z');
  }
});

test('a failing lifecycle page rejects the entire Events source; no partial stale success is returned', async () => {
  await assert.rejects(loadNativeCalendarSource('events', scope, from, until, mock(path => {
    if (path.includes('status=cancelled')) throw new Error('revoked');
    return { items: [event()], next_cursor: null };
  })), /revoked/);
});

test('sources with no exact contribution do not issue a request', async () => {
  let reads = 0; const fetcher = mock(() => { reads++; return {}; });
  for (const [category, selected] of [
    ['events', { ...scope, eventHref: undefined }], ['events', { ...scope, studentId: 'other' }],
    ['assessments', { ...scope, assessmentHref: 'https://outside.example/areas/assessments/manage' }], ['services', { ...scope, includeDining: false }],
  ] as const) await assert.rejects(loadNativeCalendarSource(category, selected, from, until, fetcher));
  assert.equal(reads, 0);
});

test('assessment owner query preserves exact learner and does not fetch a timetable or infer extra pages', async () => {
  const family = { ...scope, studentId: 'child', assessmentHref: '/areas/assessments/results?scope=dependent&student_id=child' };
  let reads = 0;
  const result = await loadNativeCalendarSource('assessments', family, from, until, mock(path => {
    reads++; assert.ok(path.startsWith('/api/v1/schools/school/assessments/calendar/?'));
    assert.equal(new URL(path, 'https://test.invalid').searchParams.get('student_id'), 'child'); return { items: [assessment()] };
  }));
  assert.equal(reads, 1); assert.equal(result.partial, false); assert.equal(result.entries[0]?.href, undefined);
});

test('service owner pages are bounded and response context must match', async () => {
  let reads = 0;
  const result = await loadNativeCalendarSource('services', scope, from, until, mock(path => {
    const page = Number(new URL(path, 'https://test.invalid').searchParams.get('page')); reads++;
    return diningPage([meal({ id: String(page), changed_for_date: page === 2 })], { page, total: 2, total_pages: 2 });
  }));
  assert.equal(reads, 2); assert.equal(result.entries.length, 1); assert.equal(result.partial, false);
  await assert.rejects(loadNativeCalendarSource('services', scope, from, until, mock(() => diningPage([], { timezone: 'UTC' }))));
});

test('new Event cursors and Dining pages stop after ten pages with explicit partial coverage', async () => {
  let eventReads = 0;
  const eventResult = await loadNativeCalendarSource('events', scope, from, until, mock(path => {
    const params = new URL(path, 'https://test.invalid').searchParams; eventReads++;
    return { items: [], next_cursor: `${params.get('status')}:${params.get('cursor') ?? 'start'}:next` };
  }));
  assert.equal(eventReads, 30); assert.equal(eventResult.partial, true);
  let serviceReads = 0;
  const serviceResult = await loadNativeCalendarSource('services', scope, from, until, mock(() => diningPage([], { page: ++serviceReads, total: 220, total_pages: 11 })));
  assert.equal(serviceReads, 10); assert.equal(serviceResult.partial, true);
});

test('a service may have its own time zone while dates are projected into the campus zone', () => {
  const entry = nativeCalendarServiceEntries([meal({ timezone: 'Europe/London', changed_for_date: true })], [], scope)[0]!;
  assert.equal(entry.startsOn, '2026-10-15');
  assert.throws(() => nativeCalendarServiceEntries([meal({ changed_for_date: 'false' as unknown as boolean })], [], scope));
});

test('abort is honored before requests and after a fetcher resolves; invalid ranges do not read', async () => {
  const controller = new AbortController(); controller.abort(); let reads = 0;
  await assert.rejects(loadNativeCalendarSource('dates', scope, from, until, mock(() => { reads++; return { results: [] }; }), controller.signal), { name: 'AbortError' });
  assert.equal(reads, 0);
  const later = new AbortController();
  await assert.rejects(loadNativeCalendarSource('dates', scope, from, until, mock((_path, options) => { assert.equal(options?.signal, later.signal); later.abort(); return { results: [] }; }), later.signal), { name: 'AbortError' });
  await assert.rejects(loadNativeCalendarSource('dates', scope, '2026-02-30', until, mock(() => { reads++; return {}; })));
  assert.equal(reads, 0);
});
