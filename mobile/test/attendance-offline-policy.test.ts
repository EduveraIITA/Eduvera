import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { TeacherAttendanceResponse, TeacherAttendanceSaveInput } from '../../packages/contracts/src/wire/features/operations/api';
import type { NativePendingScope } from '../src/lib/native-pending-action';
import { attendanceOfflineBody, attendanceOfflineFallbackAllowed, attendanceOfflineHashInput, attendanceOfflineReceipt, type AttendanceOfflineCapture } from '../src/lib/attendance-offline-policy';
import { AttendanceOfflineQueue, createAttendanceOfflineChunkStore } from '../src/lib/attendance-offline-store';

const school = '10000000-0000-4000-8000-000000000001', classId = '10000000-0000-4000-8000-000000000002', actor = '10000000-0000-4000-8000-000000000003', student = '10000000-0000-4000-8000-000000000004', key = '10000000-0000-4000-8000-000000000005', batchId = '10000000-0000-4000-8000-000000000006', device = '10000000-0000-4000-8000-000000000007', namespace = '10000000-0000-4000-8000-000000000008';
const date = '2026-10-29', now = '2026-10-29T09:00:00.000Z', expires = '2026-10-30T09:00:00.000Z';
const scope: NativePendingScope = { actorId: actor, schoolId: school, mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const screen = { date, attendance_scope: 'daily_class', class: { id: classId, school_id: school, term_id: namespace, name: 'Class 7A' }, register: { state: 'draft', revision: 3 }, availability: { can_mark: true, reason: null }, periods: [], roster: [{ id: student, name: 'Learner', roll_number: 1, admission_number: 'A1', status: null, remarks: '' }], continuity_snapshot: { roster_fingerprint: 'a'.repeat(64), roster_count: 1, captured_at: now, expires_at: expires, token: 'a'.repeat(43) }, latest_capture: null } as unknown as TeacherAttendanceResponse;
const input: TeacherAttendanceSaveInput = { expected_revision: 3, idempotency_key: key, records: [{ student_id: student, status: 'present', remarks: ' In class ' }] };
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function memory(initial: string | null = null) { let raw = initial; return { storage: { read: async () => raw, write: async (value: string) => { raw = value; } }, get raw() { return raw; } }; }
function queue(store: ReturnType<typeof memory>, selected = scope) { return new AttendanceOfflineQueue({ scope: selected, storage: store.storage, randomId: () => device, digest }); }
function sourceRead(capture: AttendanceOfflineCapture, status: 'accepted' | 'quarantined' | 'rejected' = capture.receipt?.status === 'quarantined' ? 'quarantined' : capture.receipt?.status === 'rejected' ? 'rejected' : 'accepted'): TeacherAttendanceResponse { const body = JSON.parse(capture.body); return { ...screen, register: status === 'accepted' ? { ...screen.register, revision: 4, state: 'submitted' } : screen.register, roster: status === 'accepted' ? screen.roster.map(row => ({ ...row, status: body.records.find((mark: { student_id: string }) => mark.student_id === row.id).status, remarks: body.records.find((mark: { student_id: string }) => mark.student_id === row.id).remarks })) : screen.roster, latest_capture: { id: batchId, source: body.source, status, received_at: now, roster_expires_at: body.roster_expires_at } }; }
function received(capture: AttendanceOfflineCapture, status: 'accepted' | 'quarantined' | 'rejected' = 'accepted') { const body = JSON.parse(capture.body); return { status, batch: { id: batchId, school_id: school, class_section_id: classId, recorded_by: actor, idempotency_key: capture.id, request_hash: capture.requestHash, source: body.source, source_reference: body.source_reference, device_id: body.device_id, date, status, received_at: now, roster_expires_at: body.roster_expires_at, roster_captured_at: body.roster_captured_at, observed_at: body.observed_at, roster_fingerprint: body.roster_fingerprint, roster_count: 1, expected_register_revision: 3 }, review: status === 'quarantined' ? { id: namespace, reason_code: 'snapshot_expired', reason: 'Expired roster', state: 'open' } : null, register: status === 'accepted' ? sourceRead(capture, 'accepted') : null }; }

test('offline preparation retains complete signed roster and exact revision without a body key', () => {
  const body = attendanceOfflineBody(scope, screen, input, `native-${device}`, now);
  assert.equal(body.source, 'offline_device'); assert.equal(body.device_id, `native-${device}`); assert.equal('idempotency_key' in body, false); assert.equal(body.records[0].remarks, 'In class');
  assert.throws(() => attendanceOfflineBody(scope, screen, { ...input, expected_revision: 2 }, `native-${device}`, now));
  assert.throws(() => attendanceOfflineBody(scope, screen, { ...input, records: [...input.records, ...input.records] }, `native-${device}`, now));
  assert.throws(() => attendanceOfflineBody(scope, screen, { ...input, roster_fingerprint: 'b'.repeat(64) }, `native-${device}`, now));
  assert.throws(() => attendanceOfflineBody({ ...scope, schoolId: actor }, screen, input, `native-${device}`, now));
});
test('offline capture needs current positive marking permission and a correction reason after submission',()=>{
  assert.throws(()=>attendanceOfflineBody(scope,{...screen,availability:undefined},input,`native-${device}`,now),/recordable/);
  const submitted={...screen,register:{...screen.register,state:'submitted' as const}};
  assert.throws(()=>attendanceOfflineBody(scope,submitted,input,`native-${device}`,now),/reason/);
  assert.equal(attendanceOfflineBody(scope,submitted,{...input,reason:'Observed correction'},`native-${device}`,now).reason,'Observed correction');
});
test('paper and office observations preserve their source and reference without a device substitution', () => {
  for (const source of ['paper', 'office'] as const) { const body = attendanceOfflineBody(scope, screen, { ...input, source, source_reference: ' Paper register page 4 ' }, `native-${device}`, now); assert.equal(body.source, source); assert.equal(body.source_reference, 'Paper register page 4'); assert.equal(body.device_id, null); }
  assert.throws(() => attendanceOfflineBody(scope, screen, { ...input, source: 'paper' }, `native-${device}`, now));
  assert.throws(() => attendanceOfflineBody(scope, screen, { ...input, device_id: `native-${namespace}` }, `native-${device}`, now));
});
test('current authorization refusals beat offline fallback, and their revocation remains remembered', async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) assert.equal(attendanceOfflineFallbackAllowed({ status }), false);
  assert.equal(attendanceOfflineFallbackAllowed({ status: 503 }), true); assert.equal(attendanceOfflineFallbackAllowed(new TypeError('Network failed')), true);
  const store = memory(), current = queue(store); await current.hydrate(); await current.cacheSnapshot(screen, now); assert.equal(current.fallback(classId, date, now)?.offline_snapshot, true);
  await current.deny(classId, date); assert.equal(current.fallback(classId, date, now), null);
  const restarted = queue(store); await restarted.hydrate(); assert.equal(restarted.fallback(classId, date, now), null); await restarted.cacheSnapshot(screen, now); assert.ok(restarted.fallback(classId, date, now));
});
test('signed roster expiry prevents new observations while retaining earlier queued evidence', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.cacheSnapshot(screen, now); await current.prepare(screen, input, now);
  const later = '2026-11-01T09:00:00Z'; assert.equal(current.fallback(classId, date, later), null); assert.equal(current.snapshot().pending.length, 1);
  assert.throws(() => attendanceOfflineBody(scope, screen, input, `native-${device}`, later));
  const restarted = queue(store); await restarted.hydrate(); assert.equal(restarted.snapshot().blocked, false); assert.equal(restarted.snapshot().pending.length, 1);
});
test('another capture cannot overwrite retained class observations or silently change its key', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); const result = await current.prepare(screen, input, now); assert.equal(result.latest_capture?.status, 'pending'); assert.equal(result.register.state, 'draft'); assert.equal(result.local_capture?.id, key);
  await assert.rejects(() => current.prepare(screen, { ...input, idempotency_key: namespace }, now)); assert.equal(current.snapshot().pending[0].id, key);
  const restarted = queue(store); await restarted.hydrate(); assert.deepEqual(await restarted.prepare(screen, input, now), result);
});
test('receipt validation binds actor, source, school, exact header key and canonical request hash', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); const capture = current.snapshot().pending[0], result = received(capture);
  assert.equal(attendanceOfflineReceipt(result, capture).batch.id, batchId);
  for (const change of [{ school_id: actor }, { recorded_by: namespace }, { idempotency_key: namespace }, { request_hash: 'b'.repeat(64) }, { device_id: `native-${namespace}` }, { expected_register_revision: 2 }, { roster_count: 2 }]) assert.throws(() => attendanceOfflineReceipt({ ...result, batch: { ...result.batch, ...change } }, capture));
  assert.equal(await digest(attendanceOfflineHashInput(JSON.parse(capture.body))), capture.requestHash);
});
test('accepted register receipt must prove the exact batch, next revision and applied roster marks', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); const capture = current.snapshot().pending[0], result = received(capture), register = result.register!;
  const invalid = [ { ...register, latest_capture: null }, { ...register, latest_capture: { ...register.latest_capture!, id: namespace } }, { ...register, latest_capture: { ...register.latest_capture!, status: 'quarantined' } }, { ...register, register: { ...register.register, revision: 5 } }, { ...register, register: { ...register.register, state: 'draft' } }, { ...register, roster: register.roster.map(row => ({ ...row, status: 'absent' })) }, { ...register, roster: register.roster.map(row => ({ ...row, remarks: 'Different observation' })) } ];
  for (const value of invalid) assert.throws(() => attendanceOfflineReceipt({ ...result, register: value }, capture));
});
test('stale or differently attributed fresh reads cannot clear accepted evidence or reach UI callback', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0, callbacks = 0;
  await current.flush({ assertCurrent() {}, now: () => now, send: async capture => { sends++; return received(capture); }, read: async () => screen, onConfirmed() { callbacks++; } });
  assert.equal(current.snapshot().pending[0].phase, 'received'); assert.equal(callbacks, 0);
  await current.flush({ assertCurrent() {}, now: () => now, send: async () => { sends++; }, read: async capture => { const value = sourceRead(capture); return { ...value, latest_capture: { ...value.latest_capture!, id: namespace } }; }, onConfirmed() { callbacks++; } });
  assert.equal(current.snapshot().pending[0].phase, 'received'); assert.equal(callbacks, 0);
  await current.flush({ assertCurrent() {}, now: () => now, send: async () => { sends++; }, read: async capture => sourceRead(capture), onConfirmed(value) { callbacks++; assert.equal(value.register.revision, 4); assert.equal(value.latest_capture?.id, batchId); } });
  assert.equal(sends, 1); assert.equal(callbacks, 1); assert.equal(current.snapshot().pending.length, 0);
});
test('accepted receipt is stored before failed source read and restart recovers with reads only', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0, reads = 0;
  await current.flush({ assertCurrent() {}, now: () => now, send: async capture => { sends++; return received(capture); }, read: async () => { reads++; throw new Error('Read failed'); } });
  assert.equal(current.snapshot().pending[0].phase, 'received'); assert.equal(JSON.parse(store.raw!).captures[0].receipt.batch.id, batchId);
  const restarted = queue(store); await restarted.hydrate(); await restarted.flush({ assertCurrent() {}, now: () => now, send: async () => { sends++; throw new Error('Must not resend'); }, read: async capture => { reads++; return sourceRead(capture); } });
  assert.equal(sends, 1); assert.equal(reads, 2); assert.equal(restarted.snapshot().pending.length, 0);
});
test('unknown send after restart replays immutable body and original key even when evidence has expired', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); const sent: AttendanceOfflineCapture[] = [];
  await current.flush({ assertCurrent() {}, now: () => now, send: async capture => { sent.push(capture); throw new TypeError('Response lost'); }, read: async () => screen });
  const restarted = queue(store); await restarted.hydrate(); await restarted.flush({ assertCurrent() {}, now: () => '2026-11-01T09:00:00Z', send: async capture => { sent.push(capture); return received(capture, 'quarantined'); }, read: async capture => sourceRead(capture) });
  assert.equal(sent.length, 2); assert.equal(sent[1].body, sent[0].body); assert.equal(sent[1].id, sent[0].id); assert.equal(restarted.snapshot().pending.length, 0);
});
test('Simulation manual flush stays in its own scope and automatic Live provider cannot replay it', async () => {
  const simulation: NativePendingScope = { ...scope, mode: 'simulation', namespaceId: namespace }, store = memory(), current = queue(store, simulation); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0;
  const context = { assertCurrent() {}, now: () => now, send: async (capture: AttendanceOfflineCapture) => { sends++; assert.equal(capture.scope.namespaceId, namespace); return received(capture); }, read: async (capture: AttendanceOfflineCapture) => sourceRead(capture) };
  await current.flush({ ...context, automatic: true }); assert.equal(sends, 0); await current.flush(context); assert.equal(sends, 1);
  const wrongWorld = queue(store); await wrongWorld.hydrate(); assert.equal(wrongWorld.snapshot().blocked, true);
});
test('context change before flush sends nothing and a new account cannot hydrate another queue', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0;
  await assert.rejects(() => current.flush({ assertCurrent() { throw new Error('World changed'); }, now: () => now, send: async () => { sends++; }, read: async () => screen })); assert.equal(sends, 0); assert.equal(current.snapshot().pending.length, 1);
  for (const changed of [{ ...scope, actorId: namespace }, { ...scope, schoolId: namespace }, { ...scope, origin: 'https://other.example' }]) { const other = queue(store, changed); await other.hydrate(); assert.equal(other.snapshot().blocked, true); }
});
test('scope loss after a terminal receipt keeps its received phase and never resends in later recovery', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0, rebound = false;
  await current.flush({ assertCurrent() { if (rebound) throw new Error('Context changed'); }, now: () => now, send: async capture => { sends++; return received(capture); }, read: async () => { rebound = true; return screen; } });
  assert.equal(current.snapshot().pending[0].phase, 'received');
  const restarted = queue(store); await restarted.hydrate(); await restarted.flush({ assertCurrent() {}, now: () => now, send: async () => { sends++; }, read: async capture => sourceRead(capture) }); assert.equal(sends, 1); assert.equal(restarted.snapshot().pending.length, 0);
});
test('a known source-read refusal retains the exact receipt and disables cached fallback', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0;
  await current.flush({ assertCurrent() {}, now: () => now, send: async capture => { sends++; return received(capture); }, read: async () => { throw { status: 403 }; } });
  assert.equal(current.snapshot().pending[0].phase, 'received'); assert.equal(current.fallback(classId, date, now), null);
  await current.flush({ automatic: true, assertCurrent() {}, now: () => now, send: async () => { sends++; }, read: async () => screen }); assert.equal(sends, 1); assert.equal(current.snapshot().pending.length, 1);
  await current.flush({ assertCurrent() {}, now: () => now, send: async () => { sends++; }, read: async capture => sourceRead(capture) }); assert.equal(sends, 1); assert.equal(current.snapshot().pending.length, 0);
});
test('secure preparation failure never claims a local save and preserves previous committed bytes', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); const old = store.raw; store.storage.write = async () => { throw new Error('Secure store unavailable'); };
  await assert.rejects(() => current.prepare(screen, input, now)); assert.equal(current.snapshot().blocked, true); assert.equal(current.snapshot().pending.length, 0); assert.equal(store.raw, old);
});
test('a terminal receipt whose UI refresh fails remains read-only on the next attempt', async () => {
  const store = memory(), current = queue(store); await current.hydrate(); await current.prepare(screen, input, now); let sends = 0;
  await current.flush({ assertCurrent() {}, now: () => now, send: async capture => { sends++; return received(capture, 'rejected'); }, read: async capture => sourceRead(capture), onConfirmed() { throw new Error('UI refresh interrupted'); } });
  assert.equal(current.snapshot().pending[0].phase, 'received'); await current.flush({ assertCurrent() {}, now: () => now, send: async () => { sends++; }, read: async capture => sourceRead(capture) }); assert.equal(sends, 1); assert.equal(current.snapshot().pending.length, 0);
});
test('offline chunks preserve Unicode and prior manifest when a new chunk write fails', async () => {
  const values = new Map<string, string>(); let sequence = 0, fail = false; const prefix = 'thatcampus.attendance-offline.' + 'a'.repeat(64), adapter = { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { if (fail && key.endsWith('.1')) throw new Error('Chunk interrupted'); values.set(key, value); }, remove: async (key: string) => { values.delete(key); }, randomId: () => `20000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, digest };
  const storage = createAttendanceOfflineChunkStore(adapter, prefix), original = JSON.stringify({ name: 'अभिषेक 🎓'.repeat(100) }); await storage.write(original); assert.equal(await storage.read(), original); const previousManifest = values.get(prefix + '.manifest'); fail = true; await assert.rejects(() => storage.write('new '.repeat(1000))); assert.equal(values.get(prefix + '.manifest'), previousManifest); assert.equal(await storage.read(), original);
  assert.ok([...values.keys()].every(key => key.startsWith(prefix))); assert.ok([...values.keys()].every(key => !key.includes('attendance-draft')));
});
