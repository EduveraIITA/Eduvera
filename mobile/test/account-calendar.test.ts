import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountConnectionContext } from '../src/lib/account-capabilities';
import { calendarDisconnectPath, calendarExportPath, calendarParameters, parseCalendarStatus, parseCreatedCalendar } from '../src/lib/account-calendar';

const id = '10000000-0000-4000-8000-000000000001', learnerId = '10000000-0000-4000-8000-000000000002';
const otherId = '10000000-0000-4000-8000-000000000003';
const token = 'a'.repeat(43), origin = 'https://api.example.test';
const context: AccountConnectionContext = { key: 'assigned-work', label: 'My assigned work', detail: 'Active work', audience: 'teacher' };
const learner: AccountConnectionContext = { key: `dependent:${learnerId}`, label: 'Linked learner', detail: 'Learning', audience: 'parent', studentId: learnerId };
const row = () => ({ id, token_hint: 'abc123', created_at: '2026-10-29T10:20:30.000Z', last_fetched_at: null, revision: 1 });
const status = (selected = context) => ({ scope: { portal: selected.audience, student_id: selected.studentId ?? null, calendar_name: 'Your campus' }, subscription: row() });
const created = () => ({ id, token_hint: 'abc123', created_at: row().created_at, revision: 1,
  feed_url: `https://public.example.test/api/v1/calendar-connections/subscriptions/${token}/feed.ics`, calendar_name: 'Your campus' });
const simulated = () => ({ ...created(), token_hint: 'simulation', evidence_mode: 'simulation', external_subscription: false,
  feed_url: `/api/v1/calendar-connections/subscriptions/${id}/preview.ics` });

test('calendar parameters use the exact compatibility context without inventing another learner or role', () => {
  assert.equal(calendarParameters(context).toString(), 'portal=teacher');
  assert.equal(calendarParameters(learner).toString(), `portal=parent&student_id=${learnerId}`);
  for (const bad of [{ ...context, studentId: learnerId }, { ...learner, studentId: '' }, { ...context, audience: 'admin' }, { ...learner, studentId: '../other' }]) {
    assert.throws(() => calendarParameters(bad as AccountConnectionContext));
  }
});

test('status checks exact audience and explicit learner, permitting the owning server to resolve self', () => {
  assert.equal(parseCalendarStatus(status(), context, 'live').subscription?.id, id);
  assert.equal(parseCalendarStatus(status(learner), learner, 'live').scope.student_id, learnerId);
  assert.equal(parseCalendarStatus(status(learner), { ...learner, studentId: undefined }, 'live').scope.student_id, learnerId);
  for (const bad of [null, {}, [], { ...status(), scope: { ...status().scope, portal: 'principal' } },
    { ...status(), scope: { ...status().scope, student_id: learnerId } }, { ...status(), scope: { ...status().scope, calendar_name: '' } },
    { scope: status().scope }, { ...status(), subscription: { ...row(), id: '../escape' } }, { ...status(), subscription: { ...row(), revision: 0 } },
    { ...status(), subscription: { ...row(), revision: 1.2 } }, { ...status(), subscription: { ...row(), created_at: '2026-02-30T00:00:00Z' } },
    { ...status(), subscription: { ...row(), last_fetched_at: 'yesterday' } }, { ...status(), subscription: { ...row(), token_hint: 'abc\n123' } }]) {
    assert.throws(() => parseCalendarStatus(bad, context, 'live'));
  }
  assert.throws(() => parseCalendarStatus(status({ ...learner, studentId: otherId }), learner, 'live'));
  assert.throws(() => parseCalendarStatus(status({ ...learner, studentId: undefined }), learner, 'live'));
  assert.equal(parseCalendarStatus({ ...status(), subscription: null }, context, 'live').subscription, null);
});

test('status tolerates actual absent Simulation markers but refuses explicit cross-world evidence', () => {
  assert.equal(parseCalendarStatus(status(), context, 'simulation').subscription?.id, id);
  assert.equal(parseCalendarStatus({ ...status(), evidence_mode: 'simulation', external_subscription: false }, context, 'simulation').evidence_mode, 'simulation');
  assert.equal(parseCalendarStatus({ ...status(), evidence_mode: 'live', external_subscription: true }, context, 'live').external_subscription, true);
  for (const [mode, markers] of [
    ['simulation', { evidence_mode: 'live' }], ['simulation', { external_subscription: true }], ['live', { evidence_mode: 'simulation' }],
    ['live', { external_subscription: false }], ['live', { evidence_mode: undefined }], ['live', { external_subscription: null }],
  ] as const) assert.throws(() => parseCalendarStatus({ ...status(), ...markers }, context, mode));
  assert.throws(() => parseCalendarStatus({ ...status(), subscription: { ...row(), evidence_mode: 'live' } }, context, 'simulation'));
  assert.throws(() => parseCalendarStatus({ ...status(), evidence_mode: 'simulation', external_subscription: false,
    subscription: { ...row(), external_subscription: true } }, context, 'simulation'));
});

test('Live creation retains the one-time feed and public host without requiring the proxy origin', () => {
  const result = parseCreatedCalendar(created(), context, 'live', origin);
  assert.equal(result.feedOrigin, 'https://public.example.test'); assert.equal(result.feed_url, created().feed_url);
  assert.equal('last_fetched_at' in result, false, 'actual create response has no fetch timestamp');
  assert.equal(parseCreatedCalendar({ ...created(), last_fetched_at: null }, context, 'live', origin).last_fetched_at, null);
  assert.equal(parseCreatedCalendar({ ...created(), evidence_mode: 'live', external_subscription: true }, context, 'live', origin).external_subscription, true);
});

test('token feeds reject alternate protocols, authority tricks, query, fragments and non-owning paths', () => {
  const path = `/api/v1/calendar-connections/subscriptions/${token}/feed.ics`;
  for (const feed_url of [`http://public.example.test${path}`, `javascript:alert(1)`, `//public.example.test${path}`, path,
    `https://person:password@public.example.test${path}`, `https://public.example.test:443${path}`, `https://public.example.test:8443${path}`,
    `https://public.example.test${path}?token=${token}`, `https://public.example.test${path}?`, `https://public.example.test${path}#`, `https://public.example.test${path}#private`, `https://public.example.test/other/${token}/feed.ics`,
    `https://public.example.test${path}/extra`, `https://public.example.test${path.replace(token, token.slice(1))}`, `https://public.example.test${path.replace(token, '%61' + token.slice(1))}`,
    ` https://public.example.test${path}`, `https://public.example.test${path}\n`, `https://public.example.test\\@outside.test${path}`, `https://public.example.test/other/..${path}`]) {
    assert.throws(() => parseCreatedCalendar({ ...created(), feed_url }, context, 'live', origin), error => {
      assert.ok(error instanceof Error); assert.equal(error.message.includes(token), false); assert.equal(error.message.includes(feed_url), false); return true;
    });
  }
  assert.throws(() => parseCreatedCalendar(simulated(), context, 'live', origin));
});

test('Simulation creation requires contained evidence and the exact authenticated relative preview', () => {
  const result = parseCreatedCalendar(simulated(), context, 'simulation', origin);
  assert.equal(result.feedOrigin, null); assert.equal(result.external_subscription, false); assert.equal(result.feed_url, simulated().feed_url);
  for (const bad of [created(), { ...simulated(), evidence_mode: undefined }, { ...simulated(), external_subscription: undefined },
    { ...simulated(), external_subscription: true }, { ...simulated(), token_hint: 'abc123' }, { ...simulated(), feed_url: origin + simulated().feed_url },
    { ...simulated(), feed_url: simulated().feed_url + '?run=other' }, { ...simulated(), feed_url: simulated().feed_url.replace(id, otherId) },
    { ...simulated(), feed_url: simulated().feed_url + '#preview' }, { ...simulated(), calendar_name: '' }]) {
    assert.throws(() => parseCreatedCalendar(bad, context, 'simulation', origin));
  }
  assert.throws(() => parseCreatedCalendar(simulated(), context, 'simulation', 'javascript:bad'));
});

test('calendar export uses a bounded civil range with exact context across years and leap days', () => {
  const parameters = new URL(calendarExportPath(learner, '2028-02-29'), origin).searchParams;
  assert.equal(parameters.get('portal'), 'parent'); assert.equal(parameters.get('student_id'), learnerId);
  assert.equal(parameters.get('from'), '2028-02-22'); assert.equal(parameters.get('to'), '2029-02-23');
  assert.equal((Date.parse(parameters.get('to')!) - Date.parse(parameters.get('from')!)) / 86_400_000 + 1, 368);
  assert.equal(calendarExportPath(context, new Date('2026-01-01T23:59:59Z')), '/api/v1/calendar-connections/export.ics?portal=teacher&from=2025-12-25&to=2026-12-27');
  for (const value of ['2026-02-29', '2026-02-30', '2026-2-01', '2026-10-29T00:00:00Z', new Date(NaN), '', '0000-01-01', '9999-12-31']) assert.throws(() => calendarExportPath(context, value));
});

test('disconnect addresses one exact subscription and rejects URL/path substitutions', () => {
  assert.equal(calendarDisconnectPath(id), `/api/v1/calendar-connections/subscriptions/${id}`);
  for (const value of ['', '../other', `${id}?scope=other`, `${id}#private`, encodeURIComponent('../other'), `https://public.example.test/${id}`]) assert.throws(() => calendarDisconnectPath(value));
});
