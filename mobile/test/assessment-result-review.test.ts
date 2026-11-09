import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { assertResultReviewReceipt, definitiveResultReviewRefusal, resultReviewActionAllowed, resultReviewRefreshPath, resultReviewRoot } from '../src/lib/assessment-result-review';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';

const scope: NativePendingScope = { actorId: randomUUID(), schoolId: randomUUID(), mode: 'live', namespaceId: null, origin: 'https://app.example.test' };
const assessment = randomUUID(), publication = randomUUID(), reviewId = randomUUID(), reviewer = randomUUID(), learner = randomUUID(), key = randomUUID();
const root = resultReviewRoot(scope.schoolId), note = 'Please check the recorded result.';

function submission(kind: 'person' | 'student'): NativePendingAction {
  const field = kind === 'person' ? 'person_id' : 'student_id', routeScope = kind === 'person' ? 'mine' : 'self';
  const endpoint = `${root}/mine/${assessment}/${publication}/`;
  return {
    version: 1, domain: 'assessments', scope, clientId: key,
    ownerHref: `/areas/assessments/results?scope=${routeScope}&${field}=${learner}&assessment_id=${assessment}&publication_id=${publication}`,
    endpoint, refreshPath: `${endpoint}?${field}=${learner}`, method: 'POST', phase: 'prepared',
    source: { kind: 'result_review_submit', sourceId: publication, revision: 0, fingerprint: assessment },
    payload: { kind: 'json', body: JSON.stringify({ [field]: learner, reviewer_user_id: reviewer, note, idempotency_key: key }) },
    replayPolicy: 'same_request', createdAt: new Date().toISOString(),
  };
}
const receipt = {
  client_key: key, accepted_revision: 1, accepted_reviewer_user_id: reviewer, action: 'submit',
  review: { id: reviewId, school_id: scope.schoolId, assessment_id: assessment, publication_id: publication, revision: 1, request_note: note },
};

test('assessment review journal binds school and course learner routes and refuses substituted identities', () => {
  for (const kind of ['person', 'student'] as const) {
    const item = submission(kind);
    assert.equal(validateNativePendingAction(item, scope, 'assessments'), true);
    assert.equal(validateNativePendingAction(item, { ...scope, actorId: randomUUID() }, 'assessments'), false);
    assert.equal(validateNativePendingAction(item, { ...scope, mode: 'simulation', namespaceId: randomUUID() }, 'assessments'), false);
    assert.equal(resultReviewActionAllowed({ ...item, ownerHref: item.ownerHref.replace(/scope=[^&]+/, 'scope=dependent') }, scope), false);
    assert.equal(resultReviewActionAllowed({ ...item, ownerHref: `${item.ownerHref}&publication_id=${publication}` }, scope), false);
    assert.throws(() => assertResultReviewReceipt({ ...receipt, review: { ...receipt.review, publication_id: randomUUID() } }, item), /exact/);
    assert.throws(() => assertResultReviewReceipt({ ...receipt, accepted_reviewer_user_id: randomUUID() }, item), /exact/);
    assert.equal(resultReviewRefreshPath(receipt, item), `${root}/receipts/${key}/`);
  }
});

test('a failed exact receipt read recovers by read alone after relaunch', async () => {
  const item = submission('person');
  let retained: string | null = null, reads = 0, writes = 0;
  const journal = () => new NativePendingActionJournal({ scope, domain: 'assessments', randomId: () => key,
    storage: { read: async () => retained, write: async value => { retained = value; }, clear: async () => { retained = null; } },
    send: async () => { writes++; return receipt; }, read: async () => { if (++reads === 1) throw new Error('Network interrupted'); return receipt; } });
  const context = { ownerHref: item.ownerHref, refreshPath: item.refreshPath, assertActive() {}, resolveRefreshPath: resultReviewRefreshPath,
    accepted(value: unknown, _check: () => void, action: NativePendingAction) { assertResultReviewReceipt(value, action); } };
  const initial = journal(); await initial.hydrate();
  assert.equal(await initial.run({ endpoint: item.endpoint, serverKey: 'idempotency_key', source: item.source!,
    body: { person_id: learner, reviewer_user_id: reviewer, note } }, context), false);
  assert.equal(initial.snapshot().action?.phase, 'accepted');
  const restarted = journal(); await restarted.hydrate();
  assert.equal(await restarted.recover(context), true);
  assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(retained, null);
});

test('a stale refusal can clear only its exact scoped request', () => {
  const item = submission('person');
  const fields = { idempotency_key: key, school_id: scope.schoolId, actor_user_id: scope.actorId, source_id: publication };
  const error = (value: unknown) => ({ status: 409, details: { error: { code: 'result_review_stale', fields: value } } });
  assert.equal(definitiveResultReviewRefusal(error(fields), item), true);
  assert.equal(definitiveResultReviewRefusal(error({ ...fields, source_id: randomUUID() }), item), false);
  assert.equal(definitiveResultReviewRefusal(error({ ...fields, actor_user_id: randomUUID() }), item), false);
});
