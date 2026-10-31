import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDateFields, calendarDateReason, calendarDateRefreshPath, calendarDateRoot, validCalendarDateRecord } from '../src/lib/calendar-date-policy';
import type { NativePendingAction } from '../src/lib/native-pending-action';
import { NativePendingActionJournal, validateNativePendingAction } from '../src/lib/native-pending-action';
import type { PublishedCampusDate } from '../../packages/contracts/src/wire/features/calendar/campusPublishedDates';

const school = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', key = '10000000-0000-4000-8000-000000000003';
const item: PublishedCampusDate = { id, school_id: school, title: 'Registration window', description: 'Information published by campus', starts_on: '2026-10-01', ends_on: '2026-10-08', category_label: 'Registration', academic_term_id: key, provenance: { source_note: 'Existing reviewed source' }, revision: 4, state: 'published' };
const values = { title: item.title, description: item.description, start: item.starts_on, end: item.ends_on, category: item.category_label };
const root = calendarDateRoot(school);
function pending(action: 'publish' | 'correct' | 'cancel', body: Record<string, unknown>): NativePendingAction { return { version: 1, domain: 'calendar', scope: { actorId: 'actor', schoolId: school, mode: 'live', namespaceId: null, origin: 'https://campus.example' }, clientId: key, ownerHref: '/areas/calendar?calendar_action=' + action, endpoint: action === 'publish' ? root : `${root}/${id}/${action}`, refreshPath: action === 'publish' ? root + '?from=2026-10-01&until=2026-10-31&page=1' : `${root}/${id}`, method: 'POST', phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-10-29T00:00:00Z', payload: { kind: 'json', body: JSON.stringify({ ...body, idempotency_key: key }) }, source: { kind: 'campus_date', sourceId: action === 'publish' ? school : id, revision: action === 'publish' ? 0 : 4 } }; }
test('correction preserves canonical academic reference and provenance', () => {
  assert.deepEqual(calendarDateFields({ ...values, title: ' Corrected registration ' }, item), { title: 'Corrected registration', description: item.description, starts_on: item.starts_on, ends_on: item.ends_on, category_label: item.category_label, academic_term_id: key, provenance: item.provenance });
  assert.notEqual(calendarDateFields(values, item).provenance, item.provenance);
});
test('civil window validates range, leap overflow, optional last day and bounded copy', () => {
  assert.equal(calendarDateFields({ ...values, end: '' }).ends_on, item.starts_on);
  assert.throws(() => calendarDateFields({ ...values, start: '2026-02-29' }));
  assert.throws(() => calendarDateFields({ ...values, end: '2027-10-04' }));
  assert.throws(() => calendarDateFields({ ...values, title: 'x' }));
  assert.throws(() => calendarDateFields({ ...values, category: 'x' }));
  assert.equal(calendarDateReason('  Correcting dates  '), 'Correcting dates');
  assert.throws(() => calendarDateReason('x'));
});
test('publish receipt binds exact school and reviewed fields before its new source read', () => {
  const fields = calendarDateFields(values), action = pending('publish', fields), receipt = { ...item, ...fields, revision: 1 };
  assert.equal(calendarDateRefreshPath(receipt, action), `${root}/${id}`);
  assert.throws(() => calendarDateRefreshPath({ ...receipt, school_id: id }, action));
  assert.throws(() => calendarDateRefreshPath({ ...receipt, title: 'Unreviewed title' }, action));
  assert.throws(() => calendarDateRefreshPath({ ...receipt, revision: 2 }, action));
});
test('correction and cancellation receipts match exact source, next revision and reason', () => {
  const fields = calendarDateFields(values, item), correction = pending('correct', { ...fields, expected_revision: 4, reason: 'Date correction' });
  assert.equal(calendarDateRefreshPath({ ...item, ...fields, revision: 5 }, correction), `${root}/${id}`);
  assert.throws(() => calendarDateRefreshPath({ ...item, ...fields, revision: 6 }, correction));
  assert.throws(() => calendarDateRefreshPath({ ...item, ...fields, id: key, revision: 5 }, correction));
  const cancellation = pending('cancel', { expected_revision: 4, reason: 'No longer planned' });
  assert.equal(calendarDateRefreshPath({ ...item, state: 'cancelled', revision: 5, cancellation_reason: 'No longer planned' }, cancellation), `${root}/${id}`);
  assert.throws(() => calendarDateRefreshPath({ ...item, state: 'cancelled', revision: 5, cancellation_reason: 'Different reason' }, cancellation));
  assert.equal(validCalendarDateRecord(item, school, id), true);
  assert.equal(validCalendarDateRecord(item, school, key), false);
});
test('real shared Calendar gate rejects arbitrary methods, paths, revision and world drift', () => {
  const action = pending('correct', { ...calendarDateFields(values, item), expected_revision: 4, reason: 'Reviewed dates' });
  assert.equal(validateNativePendingAction(action, action.scope, 'calendar'), true);
  assert.equal(validateNativePendingAction({ ...action, method: 'DELETE' }, action.scope, 'calendar'), false);
  assert.equal(validateNativePendingAction({ ...action, endpoint: `${root}/${id}/publish-all` }, action.scope, 'calendar'), false);
  assert.equal(validateNativePendingAction({ ...action, source: { kind: 'campus_date', sourceId: id, revision: 5 } }, action.scope, 'calendar'), false);
  assert.equal(validateNativePendingAction({ ...action, refreshPath: `${root}/${key}` }, action.scope, 'calendar'), false);
  assert.equal(validateNativePendingAction(action, { ...action.scope, mode: 'simulation', namespaceId: 'run' }, 'calendar'), false);
  const creation = pending('publish', calendarDateFields(values));
  assert.equal(validateNativePendingAction(creation, creation.scope, 'calendar'), true);
  assert.equal(validateNativePendingAction({ ...creation, phase: 'accepted' }, creation.scope, 'calendar'), false);
  assert.equal(validateNativePendingAction({ ...creation, phase: 'accepted', refreshPath: `${root}/${id}` }, creation.scope, 'calendar'), true);
});
test('accepted Calendar publication recovers exact created source after restart using reads only', async () => {
  let raw: string | null = null, sends = 0;
  const action = pending('publish', calendarDateFields(values)), receipt = { ...item, ...calendarDateFields(values), revision: 1 }, storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } }, context = { ownerHref: action.ownerHref, refreshPath: action.refreshPath, assertActive() {}, resolveRefreshPath: calendarDateRefreshPath };
  const original = new NativePendingActionJournal({ scope: action.scope, domain: 'calendar', storage, randomId: () => key, send: async () => { sends++; return receipt; }, read: async () => { throw new Error('Saved date unavailable'); } });
  await original.hydrate(); assert.equal(await original.run({ endpoint: root, body: calendarDateFields(values), serverKey: 'idempotency_key', source: action.source }, context), false); assert.equal(JSON.parse(raw!).phase, 'accepted');
  const resumed = new NativePendingActionJournal({ scope: action.scope, domain: 'calendar', storage, randomId: () => id, send: async () => { sends++; throw new Error('Do not publish again'); }, read: async retained => { assert.equal(retained.refreshPath, `${root}/${id}`); return { item: receipt, can_manage: true }; } });
  await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1); assert.equal(raw, null);
});
