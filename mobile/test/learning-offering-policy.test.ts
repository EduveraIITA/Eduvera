import assert from 'node:assert/strict';
import test from 'node:test';
import { learningOfferingCreation, learningOfferingDay, learningOfferingPeople, learningOfferingRefreshPath, learningOfferingStart } from '../src/lib/learning-offering-policy';
import type { NativePendingAction } from '../src/lib/native-pending-action';
import { NativePendingActionJournal } from '../src/lib/native-pending-action';

const learner = { id: 'learner', name: 'A learner', revision: 3 }, instructor = { id: 'instructor', name: 'An instructor', revision: 5 };
test('creation preserves exact canonical person revisions and does not invent academic setup', () => {
  assert.deepEqual(learningOfferingCreation('group', '  Robotics  ', [learner], instructor, '2026-10-28', '2026-10-29'), { offering_id: 'group', name: 'Robotics', participants: [{ id: 'learner', expected_revision: 3 }], instructor: { id: 'instructor', expected_revision: 5 }, starts_on: '2026-10-28' });
});
test('reviewed learners must be unique, current and separate from the instructor', () => {
  assert.throws(() => learningOfferingPeople([learner, learner]));
  assert.throws(() => learningOfferingPeople([learner], [learner.id]));
  for (const revision of [0, -1, 1.5, NaN]) assert.throws(() => learningOfferingPeople([{ ...learner, revision }]));
  assert.throws(() => learningOfferingCreation('group', 'Group', [instructor], instructor, '2026-10-29', '2026-10-29'));
  assert.throws(() => learningOfferingCreation('group', 'Group', [learner], null, '2026-10-29', '2026-10-29'));
});
test('campus date validates real calendar dates without silently normalizing overflow', () => {
  assert.equal(learningOfferingDay('2024-02-29'), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '2026-10-29T00:00:00Z']) assert.equal(learningOfferingDay(date), false, date);
  assert.equal(learningOfferingStart('2026-10-28', '2026-10-29'), '2026-10-28');
  assert.throws(() => learningOfferingStart('2026-10-30', '2026-10-29'));
});
test('direct learning roster stays bounded and allows passive learners', () => {
  assert.throws(() => learningOfferingPeople([]));
  assert.throws(() => learningOfferingPeople(Array.from({ length: 101 }, (_, index) => ({ ...learner, id: String(index) }))));
  assert.equal(learningOfferingPeople(Array.from({ length: 100 }, (_, index) => ({ ...learner, id: String(index) }))).length, 100);
});

const groupId = '10000000-0000-4000-8000-000000000001', learnerId = '10000000-0000-4000-8000-000000000002', enrollmentId = '10000000-0000-4000-8000-000000000003', appointmentId = '10000000-0000-4000-8000-000000000004';
const root = '/api/v1/learning/offerings/';
function action(endpoint: string, revision: number, body: Record<string, unknown>): NativePendingAction { return { version: 1, domain: 'learning', scope: { actorId: 'actor', schoolId: 'school', mode: 'live', namespaceId: null, origin: 'https://campus.example' }, ownerHref: '/areas/messages/assignments?group_setup=1', endpoint, refreshPath: root + groupId + '/', method: 'POST', clientId: appointmentId, phase: 'unknown', createdAt: '2026-10-29T00:00:00Z', replayPolicy: 'same_request', payload: { kind: 'json', body: JSON.stringify({ command_id: appointmentId, ...body }) }, source: { kind: 'offering', sourceId: groupId, revision } }; }
test('creation receipt confirms original source and exact learner set before accepted read', () => {
  const pending = action(root, 0, { offering_id: groupId, participants: [{ id: learnerId, expected_revision: 4 }] });
  const receipt = { id: groupId, revision: 1, teaching_assignment_id: appointmentId, enrollments: [{ id: enrollmentId, person_id: learnerId, revision: 1 }] };
  assert.equal(learningOfferingRefreshPath(receipt, pending), root + groupId + '/');
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, id: learnerId }, pending));
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, enrollments: [{ id: enrollmentId, person_id: appointmentId, revision: 1 }] }, pending));
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, enrollments: [] }, pending));
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, revision: 2 }, pending));
});
test('end receipt compares exact registration revision rather than group revision', () => {
  const pending = action(`${root}${groupId}/enrollments/${enrollmentId}/end/`, 2, { expected_revision: 2, reason: 'Leaving group' });
  const receipt = { id: groupId, revision: 19, record_id: enrollmentId, record_revision: 3, ends_on: '2026-10-29' };
  assert.equal(learningOfferingRefreshPath(receipt, pending), `${root}${groupId}/`);
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, record_id: appointmentId }, pending));
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, record_revision: 4 }, pending));
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, ends_on: '2026-02-29' }, pending));
});
test('enrollment and appointment receipts require the next exact group revision', () => {
  const enrollment = action(`${root}${groupId}/enrollments/`, 5, { expected_revision: 5, participants: [{ id: learnerId, expected_revision: 4 }] });
  const receipt = { id: groupId, revision: 6, enrollments: [{ id: enrollmentId, person_id: learnerId, revision: 1 }] };
  assert.equal(learningOfferingRefreshPath(receipt, enrollment), `${root}${groupId}/`);
  assert.throws(() => learningOfferingRefreshPath({ ...receipt, revision: 7 }, enrollment));
  const appointment = action(`${root}${groupId}/instructors/`, 6, { expected_revision: 6, instructor: { id: learnerId, expected_revision: 4 } });
  assert.equal(learningOfferingRefreshPath({ id: groupId, revision: 7, teaching_assignment_id: appointmentId }, appointment), `${root}${groupId}/`);
  assert.throws(() => learningOfferingRefreshPath({ id: groupId, revision: 7 }, appointment));
});
test('new group restart recovers exact source and key; accepted refresh failure never creates again', async () => {
  let raw: string | null = null, sends = 0;
  const storage = { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } };
  const original = action(root, 0, { offering_id: groupId, participants: [{ id: learnerId, expected_revision: 4 }] });
  const context = { ownerHref: original.ownerHref, refreshPath: original.refreshPath, assertActive() {}, resolveRefreshPath: learningOfferingRefreshPath };
  const receipt = { id: groupId, revision: 1, teaching_assignment_id: appointmentId, enrollments: [{ id: enrollmentId, person_id: learnerId, revision: 1 }] };
  const first = new NativePendingActionJournal({ scope: original.scope, domain: 'learning', storage, randomId: () => appointmentId, send: async pending => { sends++; assert.equal(pending.source?.sourceId, groupId); return receipt; }, read: async () => { throw new Error('Accepted read unavailable'); } });
  await first.hydrate();
  assert.equal(await first.run({ endpoint: original.endpoint, body: JSON.parse(original.payload.kind === 'json' ? original.payload.body : '{}'), source: original.source, serverKey: 'command_id' }, context), false);
  assert.equal(JSON.parse(raw!).phase, 'accepted');
  let callbacks = 0;
  const resumed = new NativePendingActionJournal({ scope: original.scope, domain: 'learning', storage, randomId: () => learnerId, send: async () => { sends++; throw new Error('Must not create again'); }, read: async pending => { assert.equal(pending.refreshPath, root + groupId + '/'); return { id: groupId, revision: 1 }; } });
  await resumed.hydrate(); assert.equal(await resumed.recover({ ...context, accepted: value => { assert.equal((value as { id: string }).id, groupId); callbacks++; } }), true);
  assert.equal(sends, 1); assert.equal(callbacks, 1); assert.equal(raw, null);
});
