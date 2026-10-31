import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePendingScopeKey, type NativePendingScope } from '../src/lib/native-pending-action';
import { normalizeAcademicAttendanceDetail, type AcademicAttendanceDetail } from '../src/lib/academic-attendance';
import { AcademicSessionCommandJournal, academicSessionBody, academicSessionIdentity, acceptedAcademicSessionSubmit, sharedAcademicSessionJournal, validAcademicSessionCommand, type AcademicSessionCommand, type AcademicSessionMark, type AcademicSessionOperation } from '../src/lib/academic-session-command';

const school = '11111111-1111-4111-8111-111111111111', classId = '22222222-2222-4222-8222-222222222222', term = '33333333-3333-4333-8333-333333333333', sessionId = '44444444-4444-4444-8444-444444444444', learner = '55555555-5555-4555-8555-555555555555', other = '66666666-6666-4666-8666-666666666666', key = '77777777-7777-4777-8777-777777777777';
const scope: NativePendingScope = { actorId: 'actor', schoolId: school, mode: 'simulation', namespaceId: 'world-a', origin: 'https://campus.example' };
const surface = { key: 'registers', label: 'Registers', href: '/areas/attendance/registers', capabilities: ['attendance.view'], scopes: [{ kind: 'institution' as const, id: school }] };
function wire(revision = 2, state = 'draft', status: string | null = null) { return { attendance_scope: 'scheduled_session', date: '2026-10-27', session: { id: sessionId, subject_name: 'Maths', starts_at: '09:00:00', ends_at: '09:45:00' }, class: { id: classId, school_id: school, term_id: term, name: 'Class 7A' }, register: { id: sessionId, revision, state }, availability: { can_mark: true, reason: null }, roster: [{ id: learner, name: 'Learner', status, remarks: '' }], pending_evidence: [], continuity_snapshot: { roster_fingerprint: 'a'.repeat(64), roster_count: 1, captured_at: '2026-10-27T03:00:00.000Z', expires_at: '2026-10-27T03:00:00.000Z', token: '' } }; }
const source = { kind: 'scheduled_session' as const, sessionId, date: '2026-10-27' };
const detail = (value: unknown = wire()) => normalizeAcademicAttendanceDetail(value, source, school, surface);
const marks: AcademicSessionMark[] = [{ student_id: learner, status: 'present', remarks: '' }];
const command = (): AcademicSessionCommand => ({ version: 1, scopeKey: nativePendingScopeKey(scope), key, identity: academicSessionIdentity(detail()), expectedRevision: 2, body: academicSessionBody(detail(), marks, ''), phase: 'unknown', acceptedRevision: null });
function setup() {
  let stored: string | null = null, sendCount = 0, readCount = 0, clearCount = 0, visible = true, captured = false;
  const requests: Array<{ key: string; body: string }> = [], phases: string[] = [];
  const controls = { failWrite: '', failRead: false, send: async (_value: AcademicSessionCommand): Promise<unknown> => wire(3, 'submitted', 'present'), createKey: async () => key };
  const options = { scope, sessionId, capture: () => { captured = true; return { assertCurrent() { if (!visible) throw new Error('scope changed'); } }; }, createKey: () => controls.createKey(),
    storage: { read: async () => stored, write: async (raw: string) => { assert.equal(captured, true, 'transport captured before storage await'); const value = JSON.parse(raw) as AcademicSessionCommand; phases.push(value.phase); if (controls.failWrite === value.phase) throw new Error('secure write failed'); stored = raw; }, clear: async () => { clearCount++; stored = null; } },
    send: async (value: AcademicSessionCommand) => { sendCount++; requests.push({ key: value.key, body: value.body }); return controls.send(value); },
    read: async () => { readCount++; if (controls.failRead) throw new Error('read unavailable'); return wire(3, 'submitted', 'present'); },
  };
  const accepted: AcademicAttendanceDetail[] = [];
  const operation: AcademicSessionOperation = { assertActive() { if (!visible) throw new Error('screen closed'); }, acceptCurrent(value, raw) { const result = detail(raw); assert.equal(result.classId, value.identity.classId); assert.equal(result.termId, value.identity.termId); return result; }, accepted(value) { accepted.push(value); } };
  return { journal: new AcademicSessionCommandJournal(options), options, controls, operation, accepted, requests, phases, counts: () => ({ sendCount, readCount, clearCount }), stored: () => stored, setStored: (value: string | null) => { stored = value; }, changeScope: () => { visible = false; } };
}

test('session body requires actual authority, complete exact roster, supported observations and correction reason', () => {
  const basis = detail(); assert.equal(JSON.parse(academicSessionBody(basis, marks, '')).expected_revision, 2);
  for (const value of [[{ ...marks[0]!, status: null }], [{ ...marks[0]!, status: 'half_day' }], [{ ...marks[0]!, student_id: other }], [marks[0]!, marks[0]!], [{ ...marks[0]!, remarks: 'x'.repeat(501) }]]) assert.throws(() => academicSessionBody(basis, value as AcademicSessionMark[], ''));
  assert.throws(() => academicSessionBody({ ...basis, availability: { canMark: false, reason: '' } }, marks, ''));
  assert.throws(() => academicSessionBody(detail(wire(2, 'submitted')), marks, ''), /reason/);
  assert.equal(JSON.parse(academicSessionBody(detail(wire(2, 'submitted')), marks, 'Observed late correction')).reason, 'Observed late correction');
  assert.throws(() => academicSessionBody({ ...basis, session: null }, marks, ''), /teaching-session/);
});
test('retained body/source/revision/scope/phase must be structurally valid', () => {
  const value = command(), scopeKey = nativePendingScopeKey(scope); assert.equal(validAcademicSessionCommand(value, scopeKey, sessionId), true);
  for (const patch of [{ scopeKey: nativePendingScopeKey({ ...scope, namespaceId: 'world-b' }) }, { identity: { ...value.identity, schoolId: other } }, { identity: { ...value.identity, date: '2026-02-30' } }, { expectedRevision: 3 }, { phase: 'sent' }, { phase: 'accepted', acceptedRevision: 99 }, { body: JSON.stringify({ ...JSON.parse(value.body), idempotency_key: key }) }]) assert.equal(validAcademicSessionCommand({ ...value, ...patch }, scopeKey, sessionId), false);
});
test('only exact keyed submit response with requested source/revision/marks proves acceptance', () => {
  const value = command(), result = wire(3, 'submitted', 'present'); assert.equal(acceptedAcademicSessionSubmit(value, result), true);
  for (const patch of [{ date: '2026-10-28' }, { class: { ...result.class, school_id: other } }, { class: { ...result.class, id: other } }, { class: { ...result.class, term_id: other } }, { session: { ...result.session, id: other } }, { register: { ...result.register, revision: 4 } }, { register: { ...result.register, id: other } }, { roster: [{ ...result.roster[0], status: 'absent' }] }, { roster: [{ ...result.roster[0], remarks: 'Different note' }] }, { roster: [result.roster[0], result.roster[0]] }, { roster: [{ ...result.roster[0], id: other }] }]) assert.equal(acceptedAcademicSessionSubmit(value, { ...result, ...patch }), false);
});
test('durable prepared and unknown intent precede POST; exact accepted proof precedes read/clear', async () => {
  const f = setup(); await f.journal.hydrate(); assert.equal(await f.journal.run(detail(), marks, '', f.operation), true);
  assert.deepEqual(f.phases, ['prepared', 'unknown', 'accepted']); assert.deepEqual(f.counts(), { sendCount: 1, readCount: 1, clearCount: 1 }); assert.equal(f.accepted[0]?.register.revision, 3); assert.equal(f.stored(), null);
});
test('initial secure retention failure prevents dispatch; retry retains the original key/body', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.failWrite = 'prepared'; await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.counts().sendCount, 0); assert.equal(f.journal.snapshot().pending?.phase, 'prepared'); const original = f.journal.snapshot().pending!;
  f.controls.failWrite = ''; await f.journal.recover(f.operation); assert.deepEqual(f.requests, [{ key: original.key, body: original.body }]);
});
test('unknown secure-phase write failure prevents POST without clearing original prepared intent', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.failWrite = 'unknown'; await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.counts().sendCount, 0); assert.equal(f.journal.snapshot().pending?.phase, 'prepared'); assert.equal(f.counts().clearCount, 0);
});
test('lost response remains unknown; latest GET cannot resolve it; explicit retry uses original POST', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.send = async () => { throw new Error('connection interrupted'); };
  await f.journal.run(detail(), marks, '', f.operation); assert.equal(f.journal.snapshot().pending?.phase, 'unknown'); assert.equal(f.counts().readCount, 0); assert.equal(f.counts().clearCount, 0);
  f.controls.send = async () => wire(3, 'submitted', 'present'); await f.journal.recover(f.operation);
  assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[0], f.requests[1]); assert.equal(f.journal.snapshot().pending, null);
});
test('all dispatch refusals including generic4xx and stale revision preserve unknown intent', async () => {
  for (const status of [400, 403, 409, 422, 429, 500]) { const f = setup(); await f.journal.hydrate(); f.controls.send = async () => { throw Object.assign(new Error('refused'), { status }); }; await f.journal.run(detail(), marks, '', f.operation); assert.equal(f.journal.snapshot().pending?.phase, 'unknown', String(status)); assert.equal(f.counts().clearCount, 0); }
});
test('malformed or wrong-source keyed response remains unknown with original request preserved', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.send = async () => wire(3, 'submitted', 'absent'); await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.journal.snapshot().pending?.phase, 'unknown'); assert.equal(f.counts().readCount, 0); assert.equal(f.counts().clearCount, 0);
});
test('accepted refresh failure recovers by GET only and does not repeat POST', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.failRead = true; await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.journal.snapshot().pending?.phase, 'accepted'); f.controls.failRead = false; await f.journal.recover(f.operation);
  assert.equal(f.counts().sendCount, 1); assert.equal(f.counts().readCount, 2); assert.equal(f.journal.snapshot().pending, null);
});
test('accepted secure write failure retains accepted memory proof and recovery does not POST', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.failWrite = 'accepted'; await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.journal.snapshot().pending?.phase, 'accepted'); assert.equal(JSON.parse(f.stored()!).phase, 'unknown'); f.controls.failWrite = ''; await f.journal.recover(f.operation); assert.equal(f.counts().sendCount, 1);
});
test('cold restart unknown recovery replays unchanged original request, not current GET state', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.send = async () => { throw new Error('lost'); }; await f.journal.run(detail(), marks, '', f.operation); const original = f.requests[0];
  f.controls.send = async () => wire(3, 'submitted', 'present'); const cold = new AcademicSessionCommandJournal(f.options); await cold.hydrate(); await cold.recover(f.operation); assert.deepEqual(f.requests[1], original);
});
test('corrupted encrypted command fails closed and preserves bytes', async () => {
  const f = setup(); f.setStored('{broken'); await f.journal.hydrate(); assert.equal(f.journal.snapshot().storageBlocked, true); assert.equal(f.stored(), '{broken'); await f.journal.run(detail(), marks, '', f.operation); assert.equal(f.counts().sendCount, 0); assert.equal(f.counts().clearCount, 0);
});
test('context drift during key creation prevents persistence/dispatch and always clears busy', async () => {
  const f = setup(); await f.journal.hydrate(); f.controls.createKey = async () => { f.changeScope(); return key; }; await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.counts().sendCount, 0); assert.equal(f.stored(), null); assert.equal(f.journal.snapshot().busy, false);
});
test('retained native mounts serialize before first asynchronous key creation', async () => {
  const f = setup(); await f.journal.hydrate(); let release!: () => void; f.controls.createKey = () => new Promise<string>(resolve => { release = () => resolve(key); });
  const first = f.journal.run(detail(), marks, '', f.operation); const second = await f.journal.run(detail(), marks, '', f.operation); assert.equal(second, false); release(); await first; assert.equal(f.counts().sendCount, 1);
  const unique = { ...scope, actorId: 'shared-registry-proof' }; const shared = sharedAcademicSessionJournal(unique, sessionId, () => f.journal); assert.equal(sharedAcademicSessionJournal(unique, sessionId, () => { throw new Error('second journal created'); }), shared);
});
test('scope drift after durable prepared storage prevents dispatch and preserves the original scope', async () => {
  const f = setup(); await f.journal.hydrate(); const write = f.options.storage.write;
  f.options.storage.write = async raw => { await write(raw); if (JSON.parse(raw).phase === 'prepared') f.changeScope(); };
  await f.journal.run(detail(), marks, '', f.operation);
  assert.equal(f.counts().sendCount, 0); assert.equal(JSON.parse(f.stored()!).scopeKey, nativePendingScopeKey(scope)); assert.equal(f.journal.snapshot().busy, false);
});
test('marks and revision are snapshotted before asynchronous command identity creation', async () => {
  const f = setup(); await f.journal.hydrate(); const basis = detail(), edited = marks.map(row => ({ ...row })); let release!: () => void;
  f.controls.createKey = () => new Promise(resolve => { release = () => resolve(key); });
  const operation = f.journal.run(basis, edited, '', f.operation); edited[0]!.status = 'absent'; basis.register.revision = 99; release(); await operation;
  const sent = JSON.parse(f.requests[0]!.body); assert.equal(sent.expected_revision, 2); assert.equal(sent.records[0].status, 'present');
});
test('accepted cleanup failure retains proof and explicit recovery performs GET only', async () => {
  const f = setup(); await f.journal.hydrate(); const clear = f.options.storage.clear; f.options.storage.clear = async () => { throw new Error('cleanup failed'); };
  await f.journal.run(detail(), marks, '', f.operation); assert.equal(f.journal.snapshot().pending?.phase, 'accepted');
  f.options.storage.clear = clear; await f.journal.recover(f.operation); assert.equal(f.counts().sendCount, 1); assert.equal(f.journal.snapshot().pending, null);
});
test('known accepted proof may refresh newer corrected state; unknown acceptance is never inferred from it', async () => {
  const f = setup(); await f.journal.hydrate(); f.options.read = async () => wire(5, 'submitted', 'absent');
  await f.journal.run(detail(), marks, '', f.operation); assert.equal(f.accepted[0]?.register.revision, 5); assert.equal(f.accepted[0]?.roster[0]?.status, 'absent'); assert.equal(f.counts().sendCount, 1); assert.equal(f.journal.snapshot().pending, null);
});
test('wrong-campus accepted refresh remains retained and does not cause a second POST', async () => {
  const f = setup(); await f.journal.hydrate(); const read = f.options.read; f.options.read = async () => ({ ...wire(3, 'submitted', 'present'), class: { ...wire().class, school_id: other } });
  await f.journal.run(detail(), marks, '', f.operation); assert.equal(f.journal.snapshot().pending?.phase, 'accepted'); assert.equal(f.counts().clearCount, 0);
  f.options.read = read; await f.journal.recover(f.operation); assert.equal(f.counts().sendCount, 1);
});


test('focused-view loss during prepared storage prevents POST without rebinding the API', async () => {
  const f = setup(); await f.journal.hydrate(); let focused = true;
  const operation = { ...f.operation, assertActive() { if (!focused) throw new Error('Original view lost focus'); } };
  const write = f.options.storage.write;
  f.options.storage.write = async raw => { await write(raw); if (JSON.parse(raw).phase === 'prepared') focused = false; };
  assert.equal(await f.journal.run(detail(), marks, '', operation), false);
  assert.equal(f.counts().sendCount, 0); assert.equal(f.journal.snapshot().pending?.phase, 'prepared'); assert.ok(f.stored());
});
test('focused-view loss during committed clear never reports success or resurrects accepted session intent', async () => {
  const f = setup(); await f.journal.hydrate(); let focused = true;
  const operation = { ...f.operation, assertActive() { if (!focused) throw new Error('Original view lost focus'); } };
  const clear = f.options.storage.clear;
  f.options.storage.clear = async () => { await clear(); focused = false; };
  assert.equal(await f.journal.run(detail(), marks, '', operation), false);
  assert.equal(f.counts().sendCount, 1); assert.equal(f.stored(), null); assert.equal(f.journal.snapshot().pending, null);
  assert.deepEqual(f.accepted, []); assert.equal(await f.journal.recover(operation), false);
});
