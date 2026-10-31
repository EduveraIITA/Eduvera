import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceDraftKey, parseStoredAttendanceDraft, validateAttendanceDraft, type AttendanceDraft, type AttendanceDraftScope } from '../src/lib/attendance-draft';
const scope: AttendanceDraftScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const draft: AttendanceDraft = { version: 1, scope, registerId: 'register', revision: 7, records: [{ person_id: 'person', status: 'late', remarks: 'Reported at desk' }], reason: '', updatedAt: '2026-10-27T00:00:00Z', pending: { key: 'stable-key', action: 'save', expectedRevision: 7, body: JSON.stringify({ expected_revision: 7, records: [{ person_id: 'person', status: 'late', remarks: 'Reported at desk' }] }) } };
test('draft identity isolates actor, campus, live and each simulation namespace', () => {
  const key = attendanceDraftKey(scope, 'register');
  for (const other of [{ ...scope, origin: 'https://other-campus.example' }, { ...scope, actorId: 'other' }, { ...scope, schoolId: 'other' }, { ...scope, mode: 'simulation', namespaceId: 'world-a' }, { ...scope, mode: 'simulation', namespaceId: 'world-b' }]) {
    assert.notEqual(attendanceDraftKey(other, 'register'), key);
    assert.equal(validateAttendanceDraft(draft, other, 'register'), null);
  }
  assert.throws(() => attendanceDraftKey({ ...scope, mode: 'simulation' }, 'register'));
});
test('an uncertain command preserves its exact key, body and expected revision', () => {
  assert.deepEqual(validateAttendanceDraft(JSON.parse(JSON.stringify(draft)), scope, 'register')?.pending, draft.pending);
  assert.equal(validateAttendanceDraft({ ...draft, pending: { ...draft.pending, expectedRevision: 8 } }, scope, 'register'), null);
  assert.equal(validateAttendanceDraft({ ...draft, pending: { ...draft.pending, body: '{' } }, scope, 'register'), null);
});
test('malformed or wrong register drafts fail closed without inferring attendance', () => {
  assert.equal(validateAttendanceDraft(draft, scope, 'other'), null);
  assert.equal(validateAttendanceDraft({ ...draft, records: [{ person_id: 'person', status: 'unknown', remarks: '' }] }, scope, 'register'), null);
  assert.equal(validateAttendanceDraft({ ...draft, records: [...draft.records, ...draft.records] }, scope, 'register'), null);
  assert.ok(validateAttendanceDraft({ ...draft, records: [{ person_id: 'person', status: null, remarks: '' }] }, scope, 'register'));
});

test('unreadable retained bytes are distinct from an empty store and cannot be silently replaced', () => {
  assert.equal(parseStoredAttendanceDraft(null, scope, 'register'), null);
  for (const raw of ['{', '{}', JSON.stringify({ ...draft, registerId: 'other' }), JSON.stringify({ ...draft, pending: { ...draft.pending, phase: 'discarded' } })]) assert.throws(() => parseStoredAttendanceDraft(raw, scope, 'register'), /bytes were kept/);
});
test('v1 no-phase pending requests remain valid and accepted phases cannot be forged as a new phase', () => {
  assert.ok(parseStoredAttendanceDraft(JSON.stringify(draft), scope, 'register')?.pending);
  for (const phase of ['prepared', 'unknown', 'accepted']) assert.equal(parseStoredAttendanceDraft(JSON.stringify({ ...draft, pending: { ...draft.pending, phase } }), scope, 'register')?.pending?.phase, phase);
});
