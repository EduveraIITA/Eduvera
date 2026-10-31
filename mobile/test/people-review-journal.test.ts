import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';

const scope: NativePendingScope = { actorId: 'actor', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const review = '00000000-0000-4000-8000-000000000002', client = '00000000-0000-4000-8000-000000000001';
const base: NativePendingAction = { version: 1, domain: 'people', scope, clientId: client, ownerHref: '/areas/people/participants?person_id=person&edit=enrollment_record', endpoint: `/api/v1/people/enrollment-reviews/${review}/commit`, refreshPath: '/api/v1/schools/campus/people/participants/person', method: 'POST', payload: { kind: 'json', body: '{}' }, source: { kind: 'enrollment_review', sourceId: review, revision: 0, fingerprint: 'a'.repeat(64) }, phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-10-27T00:00:00Z' };

test('only the exact immutable reviewed enrollment URL can replay an empty commit', () => {
  assert.equal(validateNativePendingAction(base, scope, 'people'), true);
  for (const patch of [
    { endpoint: `/api/v1/people/enrollment-reviews/${client}/commit` },
    { method: 'PATCH' }, { payload: { kind: 'json', body: '{"school_id":"campus"}' } },
    { source: undefined }, { source: { ...base.source, fingerprint: '' } },
    { source: { ...base.source, revision: 1 } }, { source: { ...base.source, kind: 'person' } },
    { refreshPath: '/api/v1/schools/other/people/participants/person' },
    { endpoint: `/api/v1/people/enrollment-reviews/${review}/other` },
  ]) assert.equal(validateNativePendingAction({ ...base, ...patch }, scope, 'people'), false);
  assert.equal(validateNativePendingAction({ ...base, endpoint: `/api/v1/people/enrollment-change-reviews/${review}/commit`, source: { ...base.source!, kind: 'enrollment_change_review' } }, scope, 'people'), true);
});

test('review URL retries preserve the exact empty request after response loss', async () => {
  let raw: string | null = null; const sent: NativePendingAction[] = [];
  const make = (lost: boolean) => new NativePendingActionJournal({ scope, domain: 'people', randomId: () => client,
    storage: { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } },
    send: async action => { sent.push(action); if (lost) throw new Error('Response lost'); return { student_id: 'student' }; }, read: async () => ({ id: 'person' }),
  });
  const context = { ownerHref: base.ownerHref, refreshPath: base.refreshPath, assertActive() {} };
  const first = make(true); await first.hydrate();
  await first.run({ endpoint: base.endpoint, body: {}, source: base.source, serverKey: 'review_id' }, context);
  assert.equal(sent[0]?.payload.kind === 'json' && sent[0].payload.body, '{}');
  const resumed = make(false); await resumed.hydrate(); assert.equal(await resumed.recover(context), true);
  assert.equal(sent.length, 2); assert.equal(sent[0]?.endpoint, sent[1]?.endpoint); assert.deepEqual(sent[0]?.payload, sent[1]?.payload); assert.equal(raw, null);
});

test('guardian authority stays bound to its exact source and explicit campus read', () => {
  const endpoint = `/api/v1/people/guardian-relationships/${review}/leave-authority`;
  const current = { ...base, endpoint, refreshPath: `${endpoint}?school_id=campus`, payload: { kind: 'json' as const, body: JSON.stringify({ school_id: 'campus', idempotency_key: client }) } };
  assert.equal(validateNativePendingAction(current, scope, 'people'), true);
  for (const refreshPath of [`${endpoint}?school_id=other`, `${endpoint}?school_id=campus&school_id=other`, `${endpoint}?school_id=campus&student_id=other`, `/api/v1/people/guardian-relationships/${client}/leave-authority?school_id=campus`]) assert.equal(validateNativePendingAction({ ...current, refreshPath }, scope, 'people'), false);
  assert.equal(validateNativePendingAction({ ...current, payload: { kind: 'json', body: JSON.stringify({ school_id: 'other', idempotency_key: client }) } }, scope, 'people'), false);
});

test('work profile writes can refresh only the current campus staff workspace', () => {
  const current = { ...base, endpoint: '/api/v1/schools/campus/staff/profiles/', refreshPath: '/api/v1/schools/campus/staff/workspace/', payload: { kind: 'json' as const, body: '{}' }, replayPolicy: 'inspect_only' as const };
  assert.equal(validateNativePendingAction(current, scope, 'people'), true);
  assert.equal(validateNativePendingAction({ ...current, endpoint: `/api/v1/schools/campus/staff/profiles/${review}/onboarding/`, method: 'PATCH' }, scope, 'people'), true);
  assert.equal(validateNativePendingAction({ ...current, endpoint: '/api/v1/schools/campus/staff/balance-adjustments/' }, scope, 'people'), false);
  assert.equal(validateNativePendingAction({ ...current, refreshPath: '/api/v1/schools/other/staff/workspace/' }, scope, 'people'), false);
});
