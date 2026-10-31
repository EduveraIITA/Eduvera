import assert from 'node:assert/strict';
import test from 'node:test';
import { createCampusApiClient } from '../src/lib/api-client';
import { prepareGuardedAttendanceCommand } from '../src/lib/attendance-command-policy';
import { requiresOwningAttendanceSource } from '../src/lib/attendance-evidence';
import { acknowledgeAttendanceAttention, attendanceAttentionProof } from '../src/lib/attendance-attention';
import type { NativeAttendanceRelationship } from '../src/lib/attendance-access';

const notificationId = '10000000-0000-4000-8000-000000000001', recordId = '20000000-0000-4000-8000-000000000002', studentId = '30000000-0000-4000-8000-000000000003';
const href = `/areas/attendance/records?scope=dependent&student_id=${studentId}&date=2026-10-27&attendance_record_id=${recordId}&attendance_revision=7&attention_notification_id=${notificationId}&filter=retained`;
const selected = { relationship: 'dependent', studentId, label: 'Exact child', surface: { key: `records:dependent:${studentId}`, label: 'Attendance', href, capabilities: ['read'], scopes: [{ kind: 'dependent', id: studentId }] } } as NativeAttendanceRelationship;
const source = { student: { id: studentId }, calendar: [{ id: recordId, revision: 7, date: '2026-10-27' }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
for (const switchContext of ['account', 'campus/world', 'origin'] as const) test(`command identity work retains the original transport across a ${switchContext} switch`, async () => {
  const api = createCampusApiClient({ origin: 'https://campus.example', fetcher: async () => { throw new Error('No request should occur'); } }); api.bindApiSession('one', 'live:campus');
  const identity = deferred<{ key: string; action: 'save'; expectedRevision: number; body: string }>(); let created = false, staged = false;
  const operation = prepareGuardedAttendanceCommand(api.captureApiContext, () => { created = true; return identity.promise; }, () => {}).then(value => { staged = true; return value; });
  assert.equal(created, true);
  if (switchContext === 'account') api.bindApiSession('another', 'live:campus');
  else if (switchContext === 'campus/world') api.bindApiSession('one', 'simulation:another-world');
  else api.setApiOrigin('https://another.example');
  identity.resolve({ key: notificationId, action: 'save', expectedRevision: 7, body: '{"expected_revision":7}' });
  await assert.rejects(operation, /context changed/); assert.equal(staged, false);
});
test('capture failure rejects before generating or staging a command and a later attempt remains usable', async () => {
  let identities = 0;
  const create = async () => { identities++; return { key: notificationId, action: 'save' as const, expectedRevision: 7, body: '{"expected_revision":7}' }; };
  await assert.rejects(prepareGuardedAttendanceCommand(() => { throw new Error('Context unavailable'); }, create, () => {}), /Context unavailable/); assert.equal(identities, 0);
  const prepared = await prepareGuardedAttendanceCommand(() => ({ assertCurrent() {} }), create, () => {}); assert.equal(prepared.command.phase, 'prepared'); assert.equal(identities, 1);
});
test('actual event/examination detail source_kind requires the owning workflow without queue entry_mode', () => {
  for (const source_kind of ['event', 'examination']) assert.equal(requiresOwningAttendanceSource({ source_kind }), true);
  for (const source_kind of ['activity', 'daily_class', 'scheduled_session']) assert.equal(requiresOwningAttendanceSource({ source_kind }), false);
});
test('attendance attention proof binds exact learner, record, revision, date and untouched producer query', () => {
  const proof = attendanceAttentionProof(href, selected, source)!; assert.ok(proof);
  assert.equal(proof.openedTarget, href); assert.equal(proof.cleanHref.includes('attention_notification_id'), false); assert.ok(proof.cleanHref.includes('filter=retained')); assert.ok(proof.cleanHref.includes(`attendance_record_id=${recordId}`));
  for (const other of [href.replace('attendance_revision=7', 'attendance_revision=8'), href.replace('date=2026-10-27', 'date=2026-10-26'), href.replace(`student_id=${studentId}`, `student_id=${recordId}`), `${href}&attendance_revision=7`, `${href}&attention_notification_id=${notificationId}`]) assert.equal(attendanceAttentionProof(other, selected, source), null);
  assert.equal(attendanceAttentionProof(href, selected, { ...source, student: { id: recordId } }), null);
  assert.equal(attendanceAttentionProof(href, { ...selected, relationship: 'self' }, source), null);
  assert.equal(attendanceAttentionProof(href, selected, undefined), null);
});
test('acknowledgement sends the exact owning target and clears only its stable id after confirmation', async () => {
  const proof = attendanceAttentionProof(href, selected, source)!; const sent: unknown[] = []; let clean = '';
  await acknowledgeAttendanceAttention(proof, { capture: () => ({ assertCurrent() {} }), isCurrent: () => true, send: async (path, body) => { sent.push([path, JSON.parse(body)]); return { id: notificationId, read_at: '2026-10-27T05:00:00Z' }; }, confirmed: next => { clean = next; } });
  assert.deepEqual(sent, [[`/api/v1/notifications/${notificationId}/read/`, { opened_target: href }]]); assert.equal(clean, proof.cleanHref);
});
test('a hidden or background attendance view cannot acknowledge attention', async () => {
  const proof = attendanceAttentionProof(href, selected, source)!; let sends = 0;
  await assert.rejects(acknowledgeAttendanceAttention(proof, { capture: () => ({ assertCurrent() {} }), isCurrent: () => false, send: async () => { sends++; }, confirmed() {} }), /no longer visible/); assert.equal(sends, 0);
});
for (const invalidation of ['focus/background', 'exact source', 'transport'] as const) test(`late acknowledgement cannot navigate after ${invalidation} changed`, async () => {
  const proof = attendanceAttentionProof(href, selected, source)!, response = deferred<unknown>(); let current = true, transport = true, navigations = 0;
  const operation = acknowledgeAttendanceAttention(proof, { capture: () => ({ assertCurrent() { if (!transport) throw new Error('Context changed'); } }), isCurrent: () => current, send: () => response.promise, confirmed() { navigations++; } });
  if (invalidation === 'transport') transport = false; else current = false;
  response.resolve({ id: notificationId, read_at: '2026-10-27T05:00:00Z' }); await assert.rejects(operation); assert.equal(navigations, 0);
});
test('failed or foreign acknowledgement receipt keeps the stable attention target retryable', async () => {
  const proof = attendanceAttentionProof(href, selected, source)!; let navigations = 0;
  for (const send of [async () => { throw new Error('offline'); }, async () => ({ id: recordId, read_at: '2026-10-27T05:00:00Z' })]) await assert.rejects(acknowledgeAttendanceAttention(proof, { capture: () => ({ assertCurrent() {} }), isCurrent: () => true, send, confirmed() { navigations++; } }));
  assert.equal(navigations, 0); assert.ok(proof.openedTarget.includes(`attention_notification_id=${notificationId}`));
});
