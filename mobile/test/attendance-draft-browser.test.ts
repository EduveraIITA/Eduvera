import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserDeviceStorage } from '../src/lib/device-storage-browser';
import { createBrowserAttendanceDraftStorage } from '../src/lib/attendance-draft-browser';
import { attendanceDraftKey, type AttendanceDraft, type AttendanceDraftScope } from '../src/lib/attendance-draft-policy';
import { newAttendanceCommand } from '../src/lib/attendance-draft.web';

const crypto = webcrypto as unknown as Crypto;
const scope: AttendanceDraftScope = { actorId: 'actor', schoolId: 'school', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
function draft(): AttendanceDraft { return { version: 1, scope: { ...scope }, registerId: 'register', revision: 7, records: [{ person_id: 'person', status: 'late', remarks: 'Observed at the desk' }], reason: 'Original reason', updatedAt: '2026-10-29T08:00:00Z', pending: { key: '11111111-1111-4111-8111-111111111111', action: 'submit', expectedRevision: 7, body: '{"expected_revision":7,"records":[{"person_id":"person","status":"late","remarks":"Observed at the desk"}]}', phase: 'unknown' } }; }
function fixture() { const indexedDB = new IDBFactory(), journal = createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }); return { indexedDB, journal, drafts: createBrowserAttendanceDraftStorage(journal, () => crypto) }; }
async function key(value: AttendanceDraft) { return `thatcampus.attendance-draft.${Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attendanceDraftKey(value.scope, value.registerId)))).toString('hex')}`; }

test('browser attendance reload preserves exact pending command bytes and all local marks', async () => {
  const { indexedDB, drafts } = fixture(), original = draft(); await drafts.writeAttendanceDraft(original);
  const reloaded = createBrowserAttendanceDraftStorage(createBrowserDeviceStorage({ indexedDB: () => indexedDB, crypto: () => crypto }), () => crypto);
  assert.deepEqual(await reloaded.readAttendanceDraft(scope, 'register'), original);
  assert.equal((await reloaded.readAttendanceDraft(scope, 'register'))?.pending?.body, original.pending?.body);
});

test('attendance browser drafts remain isolated by actor, campus, world, origin and exact register', async () => {
  const { drafts } = fixture(); await drafts.writeAttendanceDraft(draft());
  for (const patch of [{ actorId: 'other' }, { schoolId: 'other' }, { mode: 'simulation', namespaceId: 'run-a' }, { origin: 'https://other.example' }]) assert.equal(await drafts.readAttendanceDraft({ ...scope, ...patch }, 'register'), null);
  assert.equal(await drafts.readAttendanceDraft(scope, 'another-register'), null);
  await assert.rejects(drafts.readAttendanceDraft({ ...scope, mode: 'simulation', namespaceId: null }, 'register'), /confirmed account/);
  assert.ok(await drafts.readAttendanceDraft(scope, 'register'));
});

test('corrupt scoped draft is preserved and never treated as an empty draft', async () => {
  const { journal, drafts } = fixture(), original = draft(), slot = await key(original);
  await journal.setItemAsync(slot, '{'); await assert.rejects(drafts.readAttendanceDraft(scope, 'register'), /bytes were kept/);
  assert.equal(await journal.getItemAsync(slot), '{');
  await journal.setItemAsync(slot, JSON.stringify({ ...original, registerId: 'foreign' }));
  await assert.rejects(drafts.readAttendanceDraft(scope, 'register'), /bytes were kept/);
  assert.equal(JSON.parse((await journal.getItemAsync(slot))!).registerId, 'foreign');
});

test('draft writes snapshot entries before asynchronous storage and serialize deletion after writes', async () => {
  const { drafts } = fixture(), original = draft(), expected = structuredClone(original);
  const writing = drafts.writeAttendanceDraft(original); original.reason = 'later local edit'; original.records[0]!.remarks = 'later changed mark';
  await writing; assert.deepEqual(await drafts.readAttendanceDraft(scope, 'register'), expected);
  await Promise.all([drafts.writeAttendanceDraft({ ...expected, reason: 'first' }), drafts.writeAttendanceDraft({ ...expected, reason: 'second' }), drafts.removeAttendanceDraft(scope, 'register')]);
  assert.equal(await drafts.readAttendanceDraft(scope, 'register'), null);
});

test('failed browser persistence retains the old draft and never confirms the replacement', async () => {
  const { journal, drafts } = fixture(), original = draft(); await drafts.writeAttendanceDraft(original);
  let deny = true;
  const guarded = createBrowserAttendanceDraftStorage({ ...journal, setItemAsync: async (...args) => { if (deny) throw new Error('quota denied'); return journal.setItemAsync(...args); } }, () => crypto);
  await assert.rejects(guarded.writeAttendanceDraft({ ...original, reason: 'must not be accepted' }), /quota denied/);
  assert.deepEqual(await drafts.readAttendanceDraft(scope, 'register'), original);
  deny = false; await guarded.writeAttendanceDraft({ ...original, reason: 'explicit retry' });
  assert.equal((await drafts.readAttendanceDraft(scope, 'register'))?.reason, 'explicit retry');
});

test('unavailable browser cryptography and invalid drafts block storage', async () => {
  const { journal, drafts } = fixture();
  await assert.rejects(createBrowserAttendanceDraftStorage(journal, () => undefined).writeAttendanceDraft(draft()), /unavailable/);
  await assert.rejects(drafts.writeAttendanceDraft({ ...draft(), revision: -1 }), /safely retained/);
  assert.equal(await drafts.readAttendanceDraft(scope, 'register'), null);
});

test('browser attendance command construction preserves native action/body semantics', async () => {
  const records = draft().records;
  for (const action of ['save', 'submit', 'finalize', 'reopen'] as const) {
    const command = await newAttendanceCommand(action, 7, records, '  Reviewed reason  ');
    assert.match(command.key, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal(command.action, action); assert.equal(command.expectedRevision, 7);
    assert.deepEqual(JSON.parse(command.body), { expected_revision: 7, ...(['save', 'submit'].includes(action) ? { records } : {}), reason: 'Reviewed reason' });
  }
});
