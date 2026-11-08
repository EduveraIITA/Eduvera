import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentHandoverObsolete, assignmentHandoverRefreshPath } from '../src/lib/assignment-handover-policy';
import { NativePendingActionJournal, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';
const id = '11111111-1111-4111-8111-111111111111', reviewer = '22222222-2222-4222-8222-222222222222', command = '33333333-3333-4333-8333-333333333333';
const path = `/api/v1/learning/assignments/review-handovers/${id}/`, owner = `/areas/messages/assignments?scope=review_handover&assignment=${id}`;
const scope: NativePendingScope = { actorId: '44444444-4444-4444-8444-444444444444', schoolId: '55555555-5555-4555-8555-555555555555', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const body = { command_id: command, expected_revision: 2, reviewer_id: reviewer, preview_hash: 'a'.repeat(64), reason: 'The original reviewer left.' };
const action: NativePendingAction = { version: 1, clientId: command, scope, domain: 'learning', endpoint: path, ownerHref: owner, refreshPath: path, method: 'POST', createdAt: '2026-11-08T00:00:00Z', phase: 'unknown', replayPolicy: 'same_request', source: { kind: 'assignment', sourceId: id, revision: 2 }, payload: { kind: 'json', body: JSON.stringify(body) } };
const receipt = { id, revision: 3, handover_id: command, reviewer_id: reviewer, reviews_reissued: 1 };
test('accepted handover receipt binds exact assignment, command, replacement and revision before read recovery', () => {
  assert.equal(assignmentHandoverRefreshPath(receipt, action), path);
  for (const patch of [{ id: reviewer }, { handover_id: reviewer }, { reviewer_id: id }, { revision: 2 }, { revision: 4 }, { reviews_reissued: -1 }]) assert.throws(() => assignmentHandoverRefreshPath({ ...receipt, ...patch }, action));
  assert.throws(() => assignmentHandoverRefreshPath(receipt, { ...action, refreshPath: path.replace(id, reviewer) }));
});
const proof = { code: 'assignment_handover_preview_obsolete', confirmation: 'permanently_inapplicable', receipt_state: 'absent', handler: 'learning.assignments', source_id: id, command_id: command, expected_revision: 2, reviewed_preview_hash: body.preview_hash, current_preview_hash: 'b'.repeat(64) };
const error = (p: object) => ({ status: 409, details: { error: { fields: { assignment_handover_obsolete: p } } } });
test('only exact receipt-absent preview proof releases a retained handover for fresh review', () => {
  assert.equal(assignmentHandoverObsolete(error(proof), action), true);
  for (const patch of [{ source_id: reviewer }, { command_id: reviewer }, { expected_revision: 1 }, { reviewed_preview_hash: 'c'.repeat(64) }, { current_preview_hash: body.preview_hash }, { current_preview_hash: 'invalid' }, { receipt_state: 'accepted' }, { handler: 'learning.offerings' }]) assert.equal(assignmentHandoverObsolete(error({ ...proof, ...patch }), action), false);
});

function memory(initial: string | null = null) { let raw = initial; return { storage: { read: async () => raw, write: async (value: string) => { raw = value; }, clear: async () => { raw = null; } } satisfies NativePendingStorage, get raw() { return raw; } }; }
const context = { ownerHref: owner, refreshPath: path, assertActive() {}, resolveRefreshPath: assignmentHandoverRefreshPath };
const input = { endpoint: path, body, serverKey: 'command_id' as const, source: action.source };
test('lost handover response relaunch retains exact reviewer, preview and reason and replays the same command', async () => {
  const store = memory(), sent: NativePendingAction[] = [];
  const make = (fails: boolean) => new NativePendingActionJournal({ scope, domain: 'learning', storage: store.storage, randomId: () => command,
    send: async value => { sent.push(value); if (fails) throw new Error('Response lost after possible commit'); return receipt; }, read: async () => ({ id, revision: 3 }), obsolete: assignmentHandoverObsolete });
  const first = make(true); await first.hydrate(); assert.equal(await first.run(input, context), false); assert.ok(store.raw);
  const resumed = make(false); await resumed.hydrate(); assert.equal(await resumed.run({ ...input, body: { ...body, reviewer_id: id } }, context), false);
  assert.equal(await resumed.recover(context), true); assert.equal(store.raw, null); assert.equal(sent.length, 2);
  assert.equal(sent[0]?.clientId, sent[1]?.clientId); assert.deepEqual(sent[0]?.payload, sent[1]?.payload);
});
test('accepted handover with unavailable refresh never repeats the transfer after relaunch', async () => {
  const store = memory(); let sends = 0;
  const first = new NativePendingActionJournal({ scope, domain: 'learning', storage: store.storage, randomId: () => command, send: async () => { sends++; return receipt; }, read: async () => { throw new Error('Read unavailable'); } });
  await first.hydrate(); assert.equal(await first.run(input, context), false); assert.equal(JSON.parse(store.raw!).phase, 'accepted');
  const next = new NativePendingActionJournal({ scope, domain: 'learning', storage: store.storage, randomId: () => command, send: async () => { sends++; return receipt; }, read: async () => ({ id, revision: 3 }) });
  await next.hydrate(); assert.equal(await next.recover(context), true); assert.equal(sends, 1); assert.equal(store.raw, null);
});
test('an uncertain handover is released only by its owning exact preview proof, not a generic conflict', async () => {
  const store = memory(JSON.stringify(action));
  // No domain callback: an older screen may have created the shared learning journal first.
  const make = (failure: unknown) => new NativePendingActionJournal({ scope, domain: 'learning', storage: store.storage, randomId: () => command,
    send: async () => { throw failure; }, read: async () => ({}) });
  const generic = make({ status: 409 }); await generic.hydrate(); assert.equal(await generic.recover(context), false); assert.ok(store.raw);
  const mismatch = make(error({ ...proof, command_id: id })); await mismatch.hydrate(); assert.equal(await mismatch.recover(context), false); assert.ok(store.raw);
  const proved = make(error(proof)); await proved.hydrate(); assert.equal(await proved.recover(context), false); assert.equal(store.raw, null); assert.equal(proved.snapshot().obsolete, true);
});
