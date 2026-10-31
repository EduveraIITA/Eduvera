import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceCommandRefused, attendanceResultMatches } from '../src/lib/attendance-command-policy';
import { AttendanceEvidenceJournal, attendanceEvidencePath, validateAttendanceEvidenceCommand, type AttendanceEvidenceCommand } from '../src/lib/attendance-evidence';
const registerId = '11111111-1111-4111-8111-111111111111', personId = '22222222-2222-4222-8222-222222222222', commandId = '33333333-3333-4333-8333-333333333333';
const body = { person_id: personId, claimed_status: 'late', capture_channel: 'offline_paper', observed_at: '2026-10-27T03:00:00.000Z', source_reference: 'Paper sheet 3', note: 'Recorder signed paper sheet' };
const input = { registerId, expectedRevision: 7, body }, result = (id = registerId, revision = 8) => ({ register: { id, revision } });
function harness(options: { send?: (command: AttendanceEvidenceCommand) => Promise<unknown>; read?: () => Promise<unknown>; failWrite?: () => boolean; onClear?: () => void; raw?: string } = {}) {
  let saved: string | null = options.raw ?? null, sends = 0, reads = 0, active = true;
  const storage = { read: async () => saved, write: async (value: string) => { if (options.failWrite?.()) throw new Error('Encrypted store locked'); saved = value; }, clear: async () => { saved = null; options.onClear?.(); } };
  const make = () => new AttendanceEvidenceJournal({ scopeKey: 'origin/actor/campus/world', storage, randomId: () => commandId, send: async command => { sends++; return options.send ? options.send(command) : result(); }, read: async () => { reads++; return options.read ? options.read() : result(); } });
  const context = { assertCurrent() { if (!active) throw new Error('Scope changed'); }, accepted() {} };
  return { make, context, get saved() { return saved; }, get sends() { return sends; }, get reads() { return reads; }, changeScope() { active = false; } };
}
test('encrypted intent failure prevents dispatch and keeps the original request', async () => {
  const h = harness({ failWrite: () => true }), journal = h.make(); await journal.hydrate(); assert.equal(await journal.run(input, h.context), false); assert.equal(h.sends, 0); assert.equal(journal.snapshot().pending?.key, commandId);
});
test('lost response survives relaunch; replay 403 keeps unchanged key and body', async () => {
  const sent: AttendanceEvidenceCommand[] = []; let attempt = 0;
  const h = harness({ send: async command => { sent.push(command); if (++attempt === 1) throw new Error('Response lost'); if (attempt === 2) throw { status: 403 }; return result(); } });
  const initial = h.make(); await initial.hydrate(); await initial.run(input, h.context); const retained = initial.snapshot().pending!;
  const restored = h.make(); await restored.hydrate(); await restored.recover(h.context); assert.equal(restored.snapshot().pending?.phase, 'unknown'); assert.ok(h.saved); assert.equal(sent[1]!.key, retained.key); assert.equal(sent[1]!.body, retained.body);
  assert.equal(await restored.recover(h.context), true); assert.equal(sent[2]!.key, retained.key); assert.equal(h.saved, null);
});
test('fresh definite refusal releases intent; uncertain 4xx and fresh conflict keep it', async () => {
  const h = harness({ send: async () => { throw { status: 400 }; } }), journal = h.make(); await journal.hydrate(); await journal.run(input, h.context); assert.equal(journal.snapshot().pending, null);
  assert.equal(attendanceCommandRefused({ status: 400 }, false), true);
  for (const status of [400, 401, 403, 404, 408, 409, 422, 429]) assert.equal(attendanceCommandRefused({ status }, true), false);
  for (const status of [408, 409, 429]) assert.equal(attendanceCommandRefused({ status }, false), false);
});
test('saved action with failed refresh recovers through reads without another write', async () => {
  let fail = true; const h = harness({ read: async () => { if (fail) throw new Error('Refresh disconnected'); return result(); } }), initial = h.make(); await initial.hydrate(); await initial.run(input, h.context); assert.equal(initial.snapshot().pending?.phase, 'accepted'); assert.equal(h.sends, 1);
  fail = false; const restored = h.make(); await restored.hydrate(); assert.equal(await restored.recover(h.context), true); assert.equal(h.sends, 1); assert.equal(h.reads, 2);
});
test('wrong register or nonexact acceptance revision cannot confirm an unknown report', async () => {
  const h = harness({ send: async () => result(personId) }), journal = h.make(); await journal.hydrate(); await journal.run(input, h.context); assert.equal(journal.snapshot().pending?.phase, 'unknown'); assert.ok(h.saved);
  assert.equal(attendanceResultMatches(result(registerId, 9), registerId, 7), false); assert.equal(attendanceResultMatches(result(registerId, 9), registerId, 7, true), true);
});
test('scope change before staging prevents any dispatch', async () => {
  const h = harness(), journal = h.make(); await journal.hydrate(); h.changeScope(); assert.equal(await journal.run(input, h.context), false); assert.equal(h.sends, 0);
});
test('retained request validation binds scope, exact source and revision', () => {
  const command: AttendanceEvidenceCommand = { version: 1, scopeKey: 'one', registerId, key: commandId, expectedRevision: 7, evidenceId: null, body: JSON.stringify({ ...body, expected_revision: 7 }), phase: 'unknown' };
  assert.equal(validateAttendanceEvidenceCommand(command, 'one'), true); assert.equal(validateAttendanceEvidenceCommand(command, 'another'), false); assert.equal(validateAttendanceEvidenceCommand({ ...command, expectedRevision: 8 }, 'one'), false); assert.equal(validateAttendanceEvidenceCommand({ ...command, registerId: '../other' }, 'one'), false);
  assert.equal(attendanceEvidencePath('/api/v1/schools/campus/activities/registers', command), `/api/v1/schools/campus/activities/registers/${registerId}/evidence`);
});

test('a scope change during encrypted staging stops transmission and leaves exact intent recoverable', async () => {
  let writes = 0; const h = harness({ failWrite: () => { if (++writes === 1) h.changeScope(); return false; } }), journal = h.make(); await journal.hydrate(); await journal.run(input, h.context); assert.equal(h.sends, 0); assert.ok(h.saved); assert.equal(JSON.parse(h.saved!).key, commandId);
});
test('unreadable encrypted evidence blocks replacement and preserves bytes', async () => {
  const h = harness({ raw: '{invalid' }), journal = h.make(); await journal.hydrate(); assert.equal(journal.snapshot().blocked, true); assert.equal(await journal.run(input, h.context), false); assert.equal(h.saved, '{invalid'); assert.equal(h.sends, 0);
});
test('evidence decision retains its exact evidence identity and review reason', () => {
  const command: AttendanceEvidenceCommand = { version: 1, scopeKey: 'review', registerId, key: commandId, expectedRevision: 7, evidenceId: personId, body: JSON.stringify({ expected_revision: 7, decision: 'rejected', reason: 'Original source could not be confirmed' }), phase: 'prepared' };
  assert.equal(validateAttendanceEvidenceCommand(command, 'review'), true); assert.ok(attendanceEvidencePath('/api/v1/schools/campus/activities/registers', command).endsWith(`/evidence/${personId}/decision`));
});


test('evidence clear records factual completion but denies accepted callbacks after the captured view closes', async () => {
  const h = harness({ onClear() { h.changeScope(); } }), journal = h.make(); await journal.hydrate(); let callbacks = 0;
  assert.equal(await journal.run(input, { ...h.context, accepted() { callbacks++; } }), false);
  assert.equal(h.sends, 1); assert.equal(h.saved, null); assert.equal(journal.snapshot().pending, null); assert.equal(callbacks, 0);
  assert.equal(await journal.recover(h.context), false); assert.equal(h.sends, 1);
});
