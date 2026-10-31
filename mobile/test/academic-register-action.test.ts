import assert from 'node:assert/strict';
import test from 'node:test';
import { AcademicRegisterActionJournal, academicRegisterActionReceipt, prepareAcademicRegisterAction, validAcademicRegisterAction, type AcademicRegisterAction } from '../src/lib/academic-register-action';
import type { AcademicAttendanceDetail, AcademicAttendanceSource } from '../src/lib/academic-attendance';
import type { NativePendingScope } from '../src/lib/native-pending-action';
const actor = '11111111-1111-4111-8111-111111111111', school = '22222222-2222-4222-8222-222222222222', classId = '33333333-3333-4333-8333-333333333333', term = '44444444-4444-4444-8444-444444444444', student = '55555555-5555-4555-8555-555555555555', register = '66666666-6666-4666-8666-666666666666', key = '77777777-7777-4777-8777-777777777777', batch = '88888888-8888-4888-8888-888888888888', review = '99999999-9999-4999-8999-999999999999';
const scope: NativePendingScope = { actorId: actor,schoolId: school,mode: 'live',namespaceId: null,origin: 'https://campus.example' };
const source: AcademicAttendanceSource = { kind: 'daily_class',classSectionId: classId,date: '2026-10-29' };
function basis(): AcademicAttendanceDetail { return { date: source.date!,schoolId: school,classId,termId: term,className: 'Class A',term: 'Current term',room: '',session: null,register: { id: register,state: 'draft',revision: 2,submittedBy: '',submittedAt: '',lockedAt: '' },availability: { canMark: true,reason: '' },roster: [{ id: student,name: 'Synthetic learner',admissionNumber: '',rollNumber: '',status: null,remarks: '' }],pendingEvidence: 0,evidenceRows: [],continuitySnapshot: { fingerprint: 'a'.repeat(64),count: 1,capturedAt: '2026-10-29T04:00:00Z',expiresAt: '2026-10-30T04:00:00Z',token: 'A'.repeat(43) } }; }
const records = [{ student_id: student,status: 'present' as const,remarks: '' }];
const input = { records,observedAt: '2026-10-29T04:01:00Z' };
const prepare = () => prepareAcademicRegisterAction(scope,key,'daily_capture',source,basis(),input,false);
function wire(revision = 3) { return { date: source.date,class: { id: classId,school_id: school,term_id: term },register: { id: register,revision,state: 'submitted' },roster: [{ id: student,status: 'present',remarks: '' }],pending_evidence: [] }; }
function receipt(status: 'accepted' | 'quarantined' | 'pending' | 'rejected' = 'accepted') { return { status,batch: { id: batch,idempotency_key: key,recorded_by: actor,school_id: school,class_section_id: classId,term_id: term,date: source.date,expected_register_revision: 2,roster_count: 1,source: 'live_app',status },register: status === 'accepted' ? wire() : null,review: status === 'quarantined' ? { id: review,state: 'open' } : null }; }

test('daily observation retains exact server snapshot, reviewed revision, marks and observed time', () => {
  const action = prepare(), body = JSON.parse(action.body);
  assert.equal(action.endpoint,'/api/v1/attendance-continuity/batches/'); assert.equal(body.snapshot_token,'A'.repeat(43));
  assert.equal(body.roster_fingerprint,'a'.repeat(64)); assert.equal(body.observed_at,input.observedAt); assert.equal(body.expected_revision,2); assert.deepEqual(body.records,records);
  assert.equal(validAcademicRegisterAction(action,scope,source),true);
});
test('marking requires an exact full roster and never fills unknown marks from absence defaults', () => {
  for (const marks of [[],[{ ...records[0]!,status: null }],[records[0]!,records[0]!],[{ ...records[0]!,student_id: actor }]]) assert.throws(() => prepareAcademicRegisterAction(scope,key,'daily_capture',source,basis(),{ ...input,records: marks },false));
  assert.throws(() => prepareAcademicRegisterAction(scope,key,'daily_capture',source,{ ...basis(),continuitySnapshot: undefined },input,false),/snapshot/);
});
test('paper/office reports require returned review authority plus source reference', () => {
  assert.throws(() => prepareAcademicRegisterAction(scope,key,'daily_capture',source,basis(),{ ...input,captureSource: 'paper',sourceReference: 'Page 1' },false),/authority/);
  assert.throws(() => prepareAcademicRegisterAction(scope,key,'daily_capture',source,basis(),{ ...input,captureSource: 'paper' },true),/reference/);
  assert.equal(JSON.parse(prepareAcademicRegisterAction(scope,key,'daily_capture',source,basis(),{ ...input,captureSource: 'paper',sourceReference: 'Page 1' },true).body).source_reference,'Page 1');
});
test('accepted receipt proves actor, campus, class, term, date, exact key and every original mark', () => {
  const action = prepare(); assert.equal(academicRegisterActionReceipt(action,receipt(),actor).status,'accepted');
  for (const patch of [{ idempotency_key: actor },{ recorded_by: school },{ school_id: actor },{ class_section_id: term },{ term_id: classId },{ date: '2026-10-28' },{ expected_register_revision: 1 },{ roster_count: 2 }]) assert.throws(() => academicRegisterActionReceipt(action,{ ...receipt(),batch: { ...receipt().batch,...patch } },actor));
  assert.throws(() => academicRegisterActionReceipt(action,{ ...receipt(),register: { ...wire(),roster: [{ id: student,status: 'absent',remarks: '' }] } },actor),/marks/);
});
for (const status of ['pending','quarantined','rejected'] as const) test(`${status} capture receipt is never accepted attendance`, () => {
  const accepted = academicRegisterActionReceipt(prepare(),receipt(status),actor);
  assert.equal(accepted.status,status); assert.equal(accepted.revision,2); assert.ok(!accepted.message.startsWith('Daily attendance accepted'));
});
test('a quarantined observation needs an owning review receipt', () => assert.throws(() => academicRegisterActionReceipt(prepare(),{ ...receipt('quarantined'),review: null },actor),/review receipt/));
test('retained payload corruption, wrong world/source and foreign endpoints fail closed', () => {
  const action = prepare();
  for (const bad of [{ ...action,scopeKey: 'wrong-world' },{ ...action,endpoint: '/api/v1/chat/threads/' },{ ...action,source: { ...source,date: '2026-10-28' } },{ ...action,body: JSON.stringify({ ...JSON.parse(action.body),records: [{ ...records[0],status: 'invented' }] }) },{ ...action,body: JSON.stringify({ ...JSON.parse(action.body),snapshot_token: 'invalid' }) }]) assert.equal(validAcademicRegisterAction(bad,scope,source),false);
});
test('lifecycle controls use owning exact endpoints and require current review capability', () => {
  const submitted = { ...basis(),register: { ...basis().register,state: 'submitted' as const } };
  assert.throws(() => prepareAcademicRegisterAction(scope,key,'finalize',source,submitted,{},false),/review/);
  const action = prepareAcademicRegisterAction(scope,key,'finalize',source,submitted,{},true);
  assert.equal(action.endpoint,`/api/v1/attendance-registers/${classId}/lock/?date=2026-10-29`); assert.equal(action.body,'{}');
  assert.equal(academicRegisterActionReceipt(action,{ ...wire(),register: { ...wire().register,state: 'locked' } },actor).revision,3);
  assert.throws(() => prepareAcademicRegisterAction(scope,key,'finalize',source,{ ...submitted,register: { ...submitted.register,autoFinalizeAt: '2026-10-29T05:00:00Z' } },{},true),/automatic/);
  assert.throws(() => prepareAcademicRegisterAction(scope,key,'reopen',source,{ ...submitted,register: { ...submitted.register,state: 'locked' } },{ reason: 'x' },true),/reason/);
});
function harness(send: (action: AcademicRegisterAction) => Promise<unknown>, options: { readFail?: boolean; clearFail?: boolean; onWrite?: (value: string) => void; onClear?: () => void } = {}) {
  let bytes: string | null = null, epoch = 1, reads = 0, visible = true;
  const journal = new AcademicRegisterActionJournal({ scope,source,createKey: async () => key,capture() { const value = epoch; return { assertCurrent() { if (value !== epoch) throw new Error('Binding changed'); } }; },storage: { read: async () => bytes,write: async value => { bytes = value; options.onWrite?.(value); },clear: async () => { if (options.clearFail) throw new Error('clear failed'); bytes = null; options.onClear?.(); } },send,read: async () => { reads++; if (options.readFail) throw new Error('refresh failed'); return wire(); } });
  const seen: string[] = [];
  const operation = { assertActive() { if (!visible) throw new Error('Original view lost focus'); },acceptCurrent(_action: AcademicRegisterAction,_value: unknown) { return { ...basis(),register: { ...basis().register,state: 'submitted' as const,revision: 3 } }; },accepted(_detail: AcademicAttendanceDetail,value: { status: string }) { seen.push(value.status); } };
  return { journal,operation,seen,bytes: () => bytes,rebind: () => { epoch++; },hide: () => { visible = false; },reads: () => reads };
}
test('unknown transport never regenerates original request/key and identical retry obtains receipt', async () => {
  let first = true; const sent: AcademicRegisterAction[] = [];
  const h = harness(async action => { sent.push(action); if (first) { first = false; throw new Error('network unknown'); } return receipt(); });
  await h.journal.hydrate(); assert.equal(await h.journal.run(() => prepare(),h.operation),false);
  assert.equal(h.journal.snapshot().pending?.phase,'unknown'); assert.equal(await h.journal.recover(h.operation),true);
  assert.equal(sent[0]!.key,sent[1]!.key); assert.equal(sent[0]!.body,sent[1]!.body); assert.equal(h.bytes(),null); assert.deepEqual(h.seen,['accepted']);
});
test('received receipt with failed refresh never resends its already received command', async () => {
  let sends = 0; const h = harness(async () => { sends++; return receipt(); },{ readFail: true });
  await h.journal.hydrate(); await h.journal.run(() => prepare(),h.operation); assert.equal(h.journal.snapshot().pending?.phase,'received');
  await h.journal.recover(h.operation); assert.equal(sends,1); assert.equal(h.reads(),2); assert.ok(h.bytes());
});
test('late response after same-identity API rebind stays uncertain and never clears new context', async () => {
  let finish!: (value: unknown) => void; const waiting = new Promise(resolve => { finish = resolve; });
  const h = harness(async () => waiting); await h.journal.hydrate(); const running = h.journal.run(() => prepare(),h.operation);
  await new Promise(resolve => setTimeout(resolve,0)); h.rebind(); finish(receipt()); assert.equal(await running,false);
  assert.equal(h.journal.snapshot().pending?.phase,'unknown'); assert.equal(h.reads(),0); assert.deepEqual(h.seen,[]); assert.ok(h.bytes());
});
test('failed local cleanup preserves a received receipt and recovery does not duplicate its submission', async () => {
  let sends = 0; const h = harness(async () => { sends++; return receipt(); },{ clearFail: true });
  await h.journal.hydrate(); assert.equal(await h.journal.run(() => prepare(),h.operation),false); assert.equal(h.journal.snapshot().pending?.phase,'received');
  await h.journal.recover(h.operation); assert.equal(sends,1); assert.ok(h.bytes());
});


test('daily action stops after secure staging when its focused source closes while transport stays bound', async () => {
  let sends = 0;
  const h = harness(async () => { sends++; return receipt(); }, { onWrite(value) { if (JSON.parse(value).phase === 'prepared') h.hide(); } });
  await h.journal.hydrate(); assert.equal(await h.journal.run(() => prepare(), h.operation), false);
  assert.equal(sends, 0); assert.equal(h.journal.snapshot().pending?.phase, 'prepared'); assert.ok(h.bytes());
});
test('daily accepted clear cannot return success or resurrect its receipt after focused-source loss', async () => {
  let sends = 0;
  const h = harness(async () => { sends++; return receipt(); }, { onClear() { h.hide(); } });
  await h.journal.hydrate(); assert.equal(await h.journal.run(() => prepare(), h.operation), false);
  assert.equal(sends, 1); assert.equal(h.bytes(), null); assert.equal(h.journal.snapshot().pending, null); assert.deepEqual(h.seen, []);
  assert.equal(await h.journal.recover(h.operation), false); assert.equal(sends, 1);
});
