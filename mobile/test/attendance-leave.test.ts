import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest, WorkspaceAreaSurface } from '../../packages/contracts/src/workspace';
import { leaveAttentionProof, leaveDuration, leaveFileType, leaveListPath, leaveMayAct, leaveOptions, leaveReviewItems, leaveSourceFingerprint, newLeaveBody, resolveLeaveSelection, type LeaveFile, type LeaveRecord, type LeaveSelection } from '../src/lib/attendance-leave-policy';
import { LeaveIntentJournal, LeaveSourceChanged, acceptedLeaveResponse, validLeaveIntent, type LeaveIntent, type LeaveIntentInput } from '../src/lib/attendance-leave-journal';
const student = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000002', leave = '30000000-0000-4000-8000-000000000003', localId = '40000000-0000-4000-8000-000000000004', documentId = '50000000-0000-4000-8000-000000000005';
const scopeKey = '["https://campus.example","actor","campus","simulation","world"]', ownerHref = `/areas/attendance/leave?scope=dependent&student_id=${student}&tab=apply`;
const body = { student_id: student, category: 'medical', starts_on: '2026-10-27', ends_on: '2026-10-28', reason: 'Recovering with family care.' };
const record = (patch: Partial<LeaveRecord> = {}): LeaveRecord => ({ id: leave, student_id: student, category: 'medical', category_label: 'Medical', starts_on: body.starts_on, ends_on: body.ends_on, duration_days: 2, reason: body.reason, status: 'pending_guardian', status_label: 'Awaiting guardian', requested_by_name: 'Requester', submitted_at: '2026-10-27T03:00:00Z', guardian_authorized_at: null, guardian_authorized_by_name: null, decided_at: null, decided_by_name: null, documents: [], audit_log: [], ...patch });
const file: LeaveFile = { uri: 'file:///private/thatcampus-leave-pending/exact-document', name: 'medical.pdf', type: 'application/pdf', size: 5, hash: 'a'.repeat(64) };
const input: LeaveIntentInput = { kind: 'create', studentId: student, leaveId: null, action: null, sourceFingerprint: null, body };
const selection = (relationship: 'self' | 'dependent', id: string): LeaveSelection => ({ relationship, studentId: id, label: id, surface: { key: `leave:${relationship}:${id}`, label: id, href: `/areas/attendance/leave?scope=${relationship}&student_id=${id}`, capabilities: ['read'], scopes: [{ kind: relationship, id }] } });
const manifest = (surfaces: WorkspaceAreaSurface[], items: unknown[] = []): WorkspaceManifest => ({ areas: [{ key: 'attendance', surfaces }], work: { items } }) as unknown as WorkspaceManifest;
function harness(options: { initial?: string; send?: (intent: LeaveIntent) => Promise<unknown>; read?: (intent: LeaveIntent) => Promise<unknown>; preflight?: () => Promise<void>; stage?: () => Promise<LeaveFile>; failStorage?: boolean; onWrite?: (value: string) => void; onClear?: () => void } = {}) {
  let raw: string | null = options.initial ?? null, sends = 0, reads = 0, current = true, visible = true; const sent: LeaveIntent[] = [];
  const store = { read: async () => raw, write: async (value: string) => { if (options.failStorage) throw new Error('Secure storage locked'); raw = value; options.onWrite?.(value); }, clear: async () => { raw = null; options.onClear?.(); } };
  const make = () => new LeaveIntentJournal({ scopeKey, storage: store, capture: () => ({ assertCurrent() { if (!current) throw new Error('Context changed'); } }), randomId: () => localId, stage: options.stage ?? (async () => file), preflight: options.preflight ?? (async () => {}), send: async intent => { sends++; sent.push(intent); return options.send ? options.send(intent) : record(); }, read: async intent => { reads++; return options.read ? options.read(intent) : record(); }, cleanup: async () => {} });
  const context = { ownerHref, assertVisible() { if (!visible) throw new Error('Original leave view lost focus'); }, accepted(_value: LeaveRecord) {} };
  return { make, context, sent, get raw() { return raw; }, get sends() { return sends; }, get reads() { return reads; }, hide() { visible = false; }, changeContext() { current = false; } };
}
test('self/dependent leave selects exact manifest evidence and never another learner', () => {
  const a = selection('dependent', student), b = selection('dependent', other), source = manifest([a.surface, b.surface]);
  assert.equal(resolveLeaveSelection(source, '/areas/attendance/leave?scope=dependent').state, 'choose');
  for (const suffix of [`scope=self&student_id=${student}`, `scope=dependent&student_id=${leave}`, `scope=dependent&student_id=${student}&student_id=${other}`, 'scope=dependent&student_id=', 'scope=other']) assert.equal(resolveLeaveSelection(source, `/areas/attendance/leave?${suffix}`).state, 'invalid');
  assert.equal(leaveListPath(student), `/api/v1/leave-requests/?student_id=${student}`);
  assert.equal(leaveOptions(manifest([{ ...a.surface, scopes: [{ kind: 'dependent', id: other }] }])).length, 0);
});
test('school review uses only exact current Work request links', () => {
  const source = manifest([], [{ href: `/areas/attendance/leave/review?request=${leave}`, title: 'Review' }, { href: `/areas/attendance/leave?request=${leave}`, title: 'Current owning Work adapter' }, { href: '/areas/responsibilities/leave?request=other', title: 'Staff leave' }, { href: `/areas/attendance/leave/review?request=${leave}&request=${other}`, title: 'Ambiguous' }]);
  assert.deepEqual(leaveReviewItems(source).map(item => item.id), [leave]);
  assert.equal(leaveReviewItems(source)[0]!.href, `/areas/attendance/leave/review?request=${leave}`);
});
test('leave dates, evidence policy and reasons validate without inventing parent requirements', () => {
  assert.equal(leaveDuration('2028-02-28', '2028-03-01'), 3); assert.throws(() => leaveDuration('2027-02-29', '2027-03-01')); assert.throws(() => leaveDuration('2026-10-28', '2026-10-27'));
  const value = { studentId: student, category: 'medical' as const, start: body.starts_on, end: body.ends_on, reason: body.reason, file: null };
  assert.deepEqual(newLeaveBody(value), body);
  assert.throws(() => newLeaveBody({ ...value, constraints: { max_duration_days: 31, medical_document_after_days: 1, accepted_documents: ['application/pdf'], max_document_size_bytes: 10 } }), /supporting document/);
  assert.throws(() => newLeaveBody({ ...value, end: '2026-12-01' })); assert.throws(() => newLeaveBody({ ...value, reason: 'Hi' }));
});
test('supporting uploads verify file bytes, suffix, nonempty size and current maximum', () => {
  assert.equal(leaveFileType('medical.PDF', new TextEncoder().encode('%PDF-')), 'application/pdf');
  assert.equal(leaveFileType('photo.jpg', new Uint8Array([255, 216, 255])), 'image/jpeg');
  assert.equal(leaveFileType('photo.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
  assert.throws(() => leaveFileType('photo.pdf', new Uint8Array([255, 216, 255]))); assert.throws(() => leaveFileType('empty.pdf', new Uint8Array())); assert.throws(() => leaveFileType('medical.pdf', new TextEncoder().encode('%PDF-'), 4));
});
test('a source fingerprint detects same-status clarification or document history changes', () => {
  const original = record(), fingerprint = leaveSourceFingerprint(original);
  assert.notEqual(leaveSourceFingerprint(record({ audit_log: [{ id: documentId, action: 'clarification_requested', action_label: 'Clarification', from_status: 'pending_guardian', to_status: 'pending_guardian', note: 'Please clarify', actor_name: 'Guardian', created_at: '2026-10-27T04:00:00Z' }] })), fingerprint);
  assert.notEqual(leaveSourceFingerprint(record({ documents: [{ id: documentId, original_name: file.name, content_type: file.type, size_bytes: 5, created_at: '2026-10-27T04:00:00Z' }] })), fingerprint);
});
test('review actions require exact guardian authority or current school review work', () => {
  assert.equal(leaveMayAct(record(), 'authorize', { relationship: 'dependent', canAuthorize: true, schoolReview: false }), true);
  assert.equal(leaveMayAct(record(), 'authorize', { relationship: 'dependent', canAuthorize: false, schoolReview: false }), false);
  assert.equal(leaveMayAct(record({ status: 'authorized' }), 'approve', { canAuthorize: false, schoolReview: true }), true);
  assert.equal(leaveMayAct(record({ status: 'authorized' }), 'approve', { relationship: 'self', canAuthorize: true, schoolReview: false }), false);
  assert.equal(leaveMayAct(record({ status: 'school_approved' }), 'withdraw', { relationship: 'dependent', canAuthorize: true, schoolReview: false }), false);
});
test('lost create response remains inspect-only after relaunch even if matching records appear', async () => {
  const h = harness({ send: async () => { throw new Error('Lost response'); }, read: async () => ({ results: [record()] }) }), first = h.make(); await first.hydrate(); await first.run(input, h.context); assert.equal(h.sends, 1);
  const resumed = h.make(); await resumed.hydrate(); assert.equal(await resumed.recover(h.context), false); assert.equal(h.sends, 1); assert.equal(h.reads, 1); assert.ok(h.raw); assert.equal(resumed.snapshot().pending?.phase, 'unknown');
});
test('unknown leave inspections cannot clear intent on a later 403 or 404', async () => {
  for (const status of [400, 403, 404, 409]) {
    const h = harness({ send: async () => { throw new Error('Lost response'); }, read: async () => { throw { status }; } }), first = h.make(); await first.hydrate(); await first.run(input, h.context); const resumed = h.make(); await resumed.hydrate(); await resumed.recover(h.context); assert.ok(h.raw); assert.equal(resumed.snapshot().pending?.phase, 'unknown'); assert.equal(h.sends, 1);
  }
});
test('accepted create with a failed refresh recovers only by reading its exact learner and ID', async () => {
  let offline = true; const h = harness({ read: async () => { if (offline) throw new Error('Read offline'); return record(); } }), first = h.make(); await first.hydrate(); await first.run(input, h.context); assert.equal(first.snapshot().pending?.phase, 'accepted'); offline = false;
  const resumed = h.make(); await resumed.hydrate(); assert.equal(await resumed.recover(h.context), true); assert.equal(h.sends, 1); assert.equal(h.raw, null);
});
test('fresh definite refusal releases intent; stale preflight never dispatches', async () => {
  const refused = harness({ send: async () => { throw { status: 400 }; } }), journal = refused.make(); await journal.hydrate(); await journal.run(input, refused.context); assert.equal(refused.raw, null);
  const stale = harness({ preflight: async () => { throw new LeaveSourceChanged('Saved source changed'); } }), before = stale.make(); await before.hydrate(); await before.run(input, stale.context); assert.equal(stale.sends, 0); assert.equal(stale.raw, null);
});
test('secure staging failure and context changes prevent dispatch', async () => {
  const locked = harness({ failStorage: true }), journal = locked.make(); await journal.hydrate(); await journal.run(input, locked.context); assert.equal(locked.sends, 0);
  let finish!: (value: LeaveFile) => void; const staged = new Promise<LeaveFile>(yes => { finish = yes; }), h = harness({ stage: () => staged }), changed = h.make(); await changed.hydrate(); const request = changed.run({ ...input, file }, h.context); h.changeContext(); finish(file); await request; assert.equal(h.sends, 0);
});
test('wrong learner response cannot confirm acceptance or release an unknown request', async () => {
  const h = harness({ send: async () => record({ student_id: other }) }), journal = h.make(); await journal.hydrate(); await journal.run(input, h.context); assert.equal(journal.snapshot().pending?.phase, 'unknown'); assert.ok(h.raw);
});
test('retained intent binds source scope and document bytes; unsupported replay keys are never injected', async () => {
  const h = harness({ send: async () => { throw new Error('Lost'); } }), journal = h.make(); await journal.hydrate(); await journal.run({ ...input, file }, h.context); const intent = JSON.parse(h.raw!) as LeaveIntent;
  assert.equal(validLeaveIntent(intent, scopeKey), true); assert.equal(validLeaveIntent(intent, 'another origin/world'), false); assert.equal(validLeaveIntent({ ...intent, file: { ...file, hash: 'wrong' } }, scopeKey), false);
  assert.equal(JSON.parse(intent.body).command_id, undefined); assert.equal(JSON.parse(intent.body).idempotency_key, undefined); assert.equal(intent.file?.hash, file.hash);
  assert.equal(acceptedLeaveResponse({ ...intent, kind: 'document', leaveId: leave }, { id: documentId, original_name: 'different.pdf', content_type: file.type, size_bytes: file.size }), null);
});
test('leave attention requires exact learner and terminal decision or exact current authority change', () => {
  const selected = selection('dependent', student), href = `/areas/attendance/leave?scope=dependent&student_id=${student}&leave_id=${leave}&attention_notification_id=${localId}`;
  assert.ok(leaveAttentionProof(href, selected, record({ status: 'school_approved' }))); assert.equal(leaveAttentionProof(href, selected, record()), null); assert.equal(leaveAttentionProof(href, selected, record({ student_id: other, status: 'school_approved' })), null); assert.equal(leaveAttentionProof(`${href}&leave_id=${other}`, selected, record({ status: 'school_approved' })), null);
  const authorityHref = `/areas/attendance/leave?scope=dependent&student_id=${student}&authority_change_id=${documentId}&authority_revision=3&attention_notification_id=${localId}`;
  assert.ok(leaveAttentionProof(authorityHref, selected, undefined, { student_id: student, latest_change_id: documentId, revision: 3 })); assert.equal(leaveAttentionProof(authorityHref, selected, undefined, { student_id: student, latest_change_id: documentId, revision: 4 }), null);
});

test('an unknown action remains inspect-only when current status happens to match the requested outcome', async () => {
  const h = harness({ send: async () => { throw new Error('Lost withdrawal response'); }, read: async () => record({ status: 'withdrawn' }) }), journal = h.make(); await journal.hydrate();
  await journal.run({ kind: 'action', studentId: student, leaveId: leave, action: 'withdraw', sourceFingerprint: leaveSourceFingerprint(record()), body: { note: 'Travel plan changed' } }, h.context);
  const resumed = h.make(); await resumed.hydrate(); assert.equal(await resumed.recover(h.context), false); assert.equal(h.sends, 1); assert.equal(resumed.snapshot().pending?.phase, 'unknown');
});
test('accepted document upload verifies exact metadata and confirms its retained document ID by a read', async () => {
  const document = { id: documentId, original_name: file.name, content_type: file.type, size_bytes: file.size, created_at: '2026-10-27T04:00:00Z' };
  const h = harness({ send: async () => document, read: async () => record({ documents: [document] }) }), journal = h.make(); await journal.hydrate();
  assert.equal(await journal.run({ kind: 'document', studentId: student, leaveId: leave, action: null, sourceFingerprint: leaveSourceFingerprint(record()), body: {}, file }, h.context), true); assert.equal(h.sends, 1); assert.equal(h.raw, null);
});
test('a malformed encrypted leave intent blocks replacement and keeps its bytes', async () => {
  const h = harness({ initial: '{broken' }), journal = h.make(); await journal.hydrate(); assert.equal(journal.snapshot().blocked, true); assert.equal(await journal.run(input, h.context), false); assert.equal(h.raw, '{broken'); assert.equal(h.sends, 0);
});
test('a retained source must be recovered from its exact original screen', async () => {
  const h = harness({ send: async () => { throw new Error('Lost'); } }), journal = h.make(); await journal.hydrate(); await journal.run(input, h.context);
  const resumed = h.make(); await resumed.hydrate(); await resumed.recover({ ...h.context, ownerHref: `/areas/attendance/leave?scope=dependent&student_id=${other}` }); assert.equal(h.sends, 1); assert.equal(h.reads, 0); assert.ok(h.raw);
});
test('leave body is captured before asynchronous private-file staging', async () => {
  let resolve!: (value: LeaveFile) => void; const staged = new Promise<LeaveFile>(yes => { resolve = yes; }), h = harness({ stage: () => staged, send: async () => { throw new Error('Lost'); } }), journal = h.make(); await journal.hydrate();
  const mutable = { ...input, body: { ...body }, file }, request = journal.run(mutable, h.context); mutable.body.reason = 'Different reason after staging began'; mutable.studentId = other; resolve(file); await request;
  assert.equal(h.sent[0]?.studentId, student); assert.equal(JSON.parse(h.sent[0]!.body).reason, body.reason);
});

test('leave multipart retains verified byte parts above 5 MiB without unsupported command fields', async () => {
  const { nativePendingUploadForm } = await import('../src/lib/native-pending-action');
  const bytes = new Uint8Array(6 * 1024 * 1024); bytes.set(new TextEncoder().encode('%PDF-'));
  const entries: Array<[string, unknown]> = [], form = { append(name: string, value: unknown) { entries.push([name, value]); } } as unknown as FormData;
  nativePendingUploadForm({ kind: 'multipart', fields: { ...body }, file: { ...file, size: bytes.byteLength } }, bytes, () => form);
  const part = entries.find(([key]) => key === 'file')![1] as { size: number; bytes(): Promise<Uint8Array> };
  bytes.fill(0); const retained = await part.bytes(); assert.equal(part.size, 6 * 1024 * 1024); assert.equal(new TextDecoder().decode(retained.slice(0, 5)), '%PDF-');
  assert.equal(entries.some(([key]) => ['command_id', 'client_id', 'idempotency_key'].includes(key)), false);
});


test('leave focused-view loss during prepared retention prevents dispatch without a transport rebind', async () => {
  const h = harness({ onWrite(value) { if (JSON.parse(value).phase === 'prepared') h.hide(); } }), journal = h.make(); await journal.hydrate();
  assert.equal(await journal.run(input, h.context), false); assert.equal(h.sends, 0); assert.equal(journal.snapshot().pending?.phase, 'prepared'); assert.ok(h.raw);
});
test('leave committed clear never resurrects an accepted intent or calls a closed-view continuation', async () => {
  const h = harness({ onClear() { h.hide(); } }), journal = h.make(); await journal.hydrate(); let callbacks = 0;
  assert.equal(await journal.run(input, { ...h.context, accepted() { callbacks++; } }), false);
  assert.equal(h.sends, 1); assert.equal(h.raw, null); assert.equal(journal.snapshot().pending, null); assert.equal(callbacks, 0);
  assert.equal(await journal.recover(h.context), false); assert.equal(h.sends, 1);
});
