import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest } from '../../packages/contracts/src/workspace';
import type { NativeScheduleAccess } from '../src/lib/schedule-access';
import { acknowledgeCalendarAttention, nativeCalendarAttention } from '../src/lib/calendar-attention';
import { calendarAttentionKeys, nativeCalendarChangeHref, nativeCalendarDateReturnHref, nativeCalendarExactContextHref, nativeCalendarLocation } from '../src/lib/calendar-route';

const id = '11111111-1111-4111-8111-111111111111', notificationId = '22222222-2222-4222-8222-222222222222', childId = '33333333-3333-4333-8333-333333333333';
const selected: NativeScheduleAccess = { kind: 'assigned', area: { key: 'calendar', surfaces: [] }, surface: { key: 'assigned', label: 'Campus dates', href: '/areas/calendar?surface=assigned', scopes: [], capabilities: [] } } as unknown as NativeScheduleAccess;
const day = { id, date: '2026-10-14', is_instructional: false, label: 'Local observance', revision: 3 };
const source = { loaded: true, from: '2026-10-01', until: '2026-10-31', days: [day] };
function href(patch: Record<string, string> = {}) {
  return `/areas/calendar?${new URLSearchParams({ surface: 'assigned', date: day.date, calendar_change_id: id, calendar_change_kind: 'created', calendar_revision: '4', calendar_record_revision: '3', attention_notification_id: notificationId, ...patch })}`;
}
const proof = () => nativeCalendarAttention(href(), selected, source).proof!;

test('Calendar created attention requires the exact current non-instructional source identity and revision', () => {
  assert.equal(nativeCalendarAttention(href(), selected, source).resolution, 'exact');
  for (const change of [{ id: childId }, { revision: 4 }, { date: '2026-10-15' }, { is_instructional: true }]) {
    const result = nativeCalendarAttention(href(), selected, { ...source, days: [{ ...day, ...change }] });
    assert.equal(result.resolution, 'stale'); assert.equal(result.proof, null);
  }
  assert.equal(nativeCalendarAttention(href(), selected, { ...source, from: '2026-10-15' }).proof, null);
  assert.equal(nativeCalendarAttention(href(), selected, { ...source, until: '2026-10-13' }).proof, null);
  assert.equal(nativeCalendarAttention(href(), selected, { ...source, days: [day, { ...day, id: childId }] }).proof, null);
});

test('a removal requires a complete loaded exact-date absence and rejects any replacement override', () => {
  const removed = href({ calendar_change_kind: 'removed' });
  assert.equal(nativeCalendarAttention(removed, selected, { ...source, days: [] }).resolution, 'exact');
  assert.equal(nativeCalendarAttention(removed, selected, { ...source, days: [{ ...day, id: childId }] }).resolution, 'stale');
  assert.equal(nativeCalendarAttention(removed, selected, { ...source, days: [{ ...day, is_instructional: true }] }).resolution, 'stale');
  const pending = nativeCalendarAttention(removed, selected, { ...source, loaded: false, days: [] });
  assert.equal(pending.resolution, 'loading'); assert.equal(pending.proof, null);
});

test('duplicate, partial, invalid and conflicting producer selectors never request acknowledgement', () => {
  for (const key of ['date', ...calendarAttentionKeys]) {
    const duplicate = `${href()}&${key}=${new URL(href(), 'https://test.invalid').searchParams.get(key)}`;
    assert.equal(nativeCalendarAttention(duplicate, selected, source).proof, null, key);
    const incomplete = new URL(href(), 'https://test.invalid'); incomplete.searchParams.delete(key);
    assert.equal(nativeCalendarAttention(`${incomplete.pathname}${incomplete.search}`, selected, source).proof, null, key);
  }
  const invalidQueries: Record<string, string>[] = [{ date: '2026-02-30' }, { calendar_revision: '9007199254740992' }, { calendar_record_revision: '0' }, { calendar_change_kind: 'updated' }, { attention_notification_id: 'copied-id' }, { calendar_change_id: '../other' }, { scope: 'dependent', student_id: childId }, { surface: 'manage' }];
  for (const patch of invalidQueries) {
    assert.equal(nativeCalendarAttention(href(patch), selected, source).proof, null, JSON.stringify(patch));
  }
  assert.equal(nativeCalendarAttention(href() + '&calendar_action=publish', selected, source).resolution, 'none');
  assert.equal(nativeCalendarAttention(href().replace('/areas/calendar', '/areas/timetable'), selected, source).proof, null);
});

test('exact relationship context is retained and another learner or mixed campus surface cannot clear its update', () => {
  const family: NativeScheduleAccess = { ...selected, kind: 'dependent', studentId: childId, surface: { ...selected.surface, key: `calendar:dependent:${childId}`, href: `/areas/calendar?scope=dependent&student_id=${childId}`, scopes: [{ kind: 'dependent', id: childId }] } };
  const route = new URL(href(), 'https://test.invalid'); route.searchParams.delete('surface'); route.searchParams.set('scope', 'dependent'); route.searchParams.set('student_id', childId);
  const exact = `${route.pathname}${route.search}`;
  assert.equal(nativeCalendarAttention(exact, family, source).resolution, 'exact');
  for (const invalid of [exact.replace(childId, id), exact + '&surface=assigned', exact + '&student_id=' + childId, exact.replace('scope=dependent', 'scope=self')]) assert.equal(nativeCalendarAttention(invalid, family, source).proof, null);
  assert.equal(nativeCalendarAttention(exact, { ...family, surface: { ...family.surface, scopes: [] } }, source).proof, null);
});

test('opening keeps the complete current query and anchor while the server proof excludes the fragment', () => {
  const route = href({ view: 'list', q: 'winter break', type: 'dates', calendar_page: '2', entry: `dates:${id}` }) + '#day-detail';
  const result = nativeCalendarAttention(route, selected, source).proof!;
  assert.equal(result.openedTarget, route.split('#')[0]);
  const clean = nativeCalendarLocation(result.cleanHref);
  assert.equal(clean.hash, '#day-detail'); assert.equal(clean.params.get('attention_notification_id'), null);
  for (const [key, value] of nativeCalendarLocation(route).params) if (key !== 'attention_notification_id') assert.deepEqual(clean.params.getAll(key), nativeCalendarLocation(route).params.getAll(key));
  assert.equal(nativeCalendarAttention(result.cleanHref, selected, source).resolution, 'none');
});

test('query presentation changes preserve exact context; date movement drops old attention and detail', () => {
  const route = href({ q: 'break', type: 'dates', view: 'list', calendar_page: '3', entry: `dates:${id}`, dining_page: '4' }) + '#day-detail';
  const shown = nativeCalendarLocation(nativeCalendarChangeHref(route, { entry: `dates:${childId}`, calendar_page: '3' }));
  assert.equal(shown.params.get('q'), 'break'); assert.equal(shown.params.get('type'), 'dates'); assert.equal(shown.params.get('surface'), 'assigned'); assert.equal(shown.params.get('calendar_page'), '3'); assert.equal(shown.params.get('attention_notification_id'), notificationId); assert.equal(shown.hash, '#day-detail'); assert.equal(shown.params.has('dining_page'), false);
  const moved = nativeCalendarLocation(nativeCalendarChangeHref(route, { date: '2026-11-14' }, true));
  assert.equal(moved.params.get('date'), '2026-11-14'); assert.equal(moved.params.get('q'), 'break'); assert.equal(moved.params.get('surface'), 'assigned');
  for (const key of [...calendarAttentionKeys, 'calendar_page', 'entry']) assert.equal(moved.params.has(key), false, key);
  assert.equal(moved.hash, '');
});

test('a sole contributed learner is canonicalized without losing query or attention and foreign selection fails closed', () => {
  const family: NativeScheduleAccess = { ...selected, kind: 'dependent', studentId: childId, surface: { ...selected.surface, key: `calendar:dependent:${childId}`, href: `/areas/calendar?scope=dependent&student_id=${childId}`, scopes: [{ kind: 'dependent', id: childId }] } };
  const manifest = { areas: [{ ...selected.area, surfaces: [family.surface] }] } as unknown as WorkspaceManifest;
  const incoming = href({ view: 'list', q: 'winter' }).replace('surface=assigned&', 'scope=dependent&') + '#day-detail';
  const exact = nativeCalendarExactContextHref(manifest, family, incoming)!;
  assert.equal(nativeCalendarLocation(exact).params.get('student_id'), childId); assert.equal(nativeCalendarLocation(exact).params.get('attention_notification_id'), notificationId); assert.equal(nativeCalendarLocation(exact).params.get('q'), 'winter'); assert.equal(nativeCalendarLocation(exact).hash, '#day-detail');
  assert.equal(nativeCalendarExactContextHref(manifest, family, exact), exact);
  assert.equal(nativeCalendarExactContextHref(manifest, family, exact.replace('#', '&student_id=' + id + '#')), null);
  assert.equal(nativeCalendarExactContextHref(manifest, family, exact.replace(childId, id)), null);
});

test('date editor cancellation retains the original view and accepted completion selects only its saved publication', () => {
  const route = href({ view: 'list', q: 'window', type: 'milestones', calendar_action: 'correct', calendar_date_id: childId, calendar_page: '2' }) + '#day-detail';
  const cancelled = nativeCalendarLocation(nativeCalendarDateReturnHref(route));
  assert.equal(cancelled.params.get('calendar_action'), null); assert.equal(cancelled.params.get('calendar_date_id'), null); assert.equal(cancelled.params.get('attention_notification_id'), notificationId); assert.equal(cancelled.params.get('calendar_page'), '2'); assert.equal(cancelled.hash, '#day-detail');
  const saved = nativeCalendarLocation(nativeCalendarDateReturnHref(route, { id: childId, starts_on: '2026-11-02' }));
  assert.equal(saved.params.get('entry'), `milestones:${childId}`); assert.equal(saved.params.get('date'), '2026-11-02'); assert.equal(saved.params.get('q'), 'window'); assert.equal(saved.params.get('view'), 'list'); assert.equal(saved.params.get('surface'), 'assigned');
  for (const key of [...calendarAttentionKeys, 'calendar_action', 'calendar_date_id', 'calendar_page']) assert.equal(saved.params.has(key), false, key);
  assert.equal(saved.hash, '');
});

test('acknowledgement sends the original complete target and requires its exact idempotent owner receipt', async () => {
  const exact = proof(); let confirmations = 0;
  const send = async (path: string, body: string) => { assert.equal(path, `/api/v1/notifications/${notificationId}/read/`); assert.deepEqual(JSON.parse(body), { opened_target: exact.openedTarget }); return { id: notificationId, read_at: '2026-10-14T08:00:00Z' }; };
  const options = { capture: () => ({ assertCurrent() {} }), isCurrent: () => true, send, confirmed: (cleanHref: string) => { assert.equal(cleanHref, exact.cleanHref); confirmations++; } };
  await acknowledgeCalendarAttention(exact, options); await acknowledgeCalendarAttention(exact, options);
  assert.equal(confirmations, 2); // Same notification/target, no generated mutation intent.
  for (const receipt of [null, { id, read_at: '2026-10-14T08:00:00Z' }, { id: notificationId, read_at: 'invalid' }, { id: notificationId }]) {
    await assert.rejects(acknowledgeCalendarAttention(exact, { ...options, send: async () => receipt }), /not confirmed/);
  }
  assert.equal(confirmations, 2);
});

test('blur, background, source/query or transport drift blocks dispatch or suppresses a stale acknowledgement callback', async () => {
  let visible = false, writes = 0, confirmed = false;
  const options = { capture: () => ({ assertCurrent() {} }), isCurrent: () => visible, send: async () => { writes++; visible = false; return { id: notificationId, read_at: '2026-10-14T08:00:00Z' }; }, confirmed: () => { confirmed = true; } };
  await assert.rejects(acknowledgeCalendarAttention(proof(), options), /no longer visible/); assert.equal(writes, 0);
  visible = true; await assert.rejects(acknowledgeCalendarAttention(proof(), options), /no longer visible/); assert.equal(writes, 1); assert.equal(confirmed, false);
  visible = true; let current = true;
  await assert.rejects(acknowledgeCalendarAttention(proof(), { ...options, capture: () => ({ assertCurrent() { if (!current) throw new Error('World changed'); } }), send: async () => { current = false; return { id: notificationId, read_at: '2026-10-14T08:00:00Z' }; } }), /World changed/);
  assert.equal(confirmed, false);
});
