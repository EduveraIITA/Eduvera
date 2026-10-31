import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope, type NativePendingStorage } from '../src/lib/native-pending-action';

const scope: NativePendingScope = { actorId: 'owner', schoolId: 'campus', mode: 'live', namespaceId: null, origin: 'https://campus.example' };
const endpoint = '/api/v1/schools/campus/simulation/runs';
const context = { ownerHref: '/more/simulation', refreshPath: `${endpoint}?limit=10`, assertActive() {} };
const key = '00000000-0000-4000-8000-000000000001';

test('a lost capture retains its original name/kind/key across relaunch', async () => {
  let raw: string | null = null;
  const storage: NativePendingStorage = { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } };
  const requests: NativePendingAction[] = [];
  const first = new NativePendingActionJournal({ scope, domain: 'simulation', storage, randomId: () => key, send: async action => { requests.push(action); throw new Error('Response lost'); }, read: async () => ({ results: [] }) });
  await first.hydrate();
  await first.run({ endpoint, serverKey: 'idempotency_key', body: { name: 'Original capture', kind: 'scenario', speed: 20, end_at: null } }, context);
  const resumed = new NativePendingActionJournal({ scope, domain: 'simulation', storage, randomId: () => { throw new Error('Recovery must reuse the original key'); }, send: async action => { requests.push(action); }, read: async () => ({ results: [] }) });
  await resumed.hydrate();
  assert.equal(await resumed.run({ endpoint, body: { kind: 'baseline' } }, context), false);
  assert.equal(await resumed.recover(context), true);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1])), JSON.parse(JSON.stringify(requests[0])));
  assert.equal(raw, null);
});

test('retained Simulation requests cannot target a different campus or API domain', () => {
  const action: NativePendingAction = { version: 1, domain: 'simulation', scope, clientId: key, endpoint, ownerHref: '/more/simulation', refreshPath: context.refreshPath, method: 'POST', payload: { kind: 'json', body: JSON.stringify({ kind: 'baseline', idempotency_key: key }) }, phase: 'unknown', replayPolicy: 'same_request', createdAt: '2026-10-27T00:00:00Z' };
  assert.equal(validateNativePendingAction(action, scope, 'simulation'), true);
  assert.equal(validateNativePendingAction({ ...action, endpoint: '/api/v1/schools/other/simulation/runs' }, scope, 'simulation'), false);
  assert.equal(validateNativePendingAction({ ...action, endpoint: '/api/v1/schools/campus/people/participants' }, scope, 'simulation'), false);
});
