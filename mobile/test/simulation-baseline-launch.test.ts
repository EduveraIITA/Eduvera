import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSimulationBaseline, baselineCanEnter, capturedBaselineIntent, simulationBaselineIntentValid, type SimulationBaselineIntent, type SimulationBaselinePorts } from '../src/features/SimulationBaselinePolicy';
import { NativePendingActionJournal, type NativePendingAction } from '../src/lib/native-pending-action';
import { simulationControlResultPath } from '../src/features/SimulationCommandPolicy';
import type { NativeSimulationRun } from '../src/lib/simulation-policy';
const school = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', scenario = '10000000-0000-4000-8000-000000000003', key = '10000000-0000-4000-8000-000000000004';
const scope = { actorId: 'actor', schoolId: school, origin: 'https://campus.example', mode: 'live' as const, namespaceId: null }, scopeKey = JSON.stringify(scope), root = `/api/v1/schools/${school}/simulation/runs`;
const draft: NativeSimulationRun = { id, revision: 3, scenario_id: scenario, namespace_id: `scenario:${scenario}:run:${id}`, started_at: null, name: 'Baseline', kind: 'baseline', status: 'draft', can_open: true, available_actions: ['open', 'start', 'stop'], speed: 20, failure_reason: null, clock: { virtual_now: '2026-10-29T00:00:00Z', time_zone: 'Asia/Kolkata', end_at: null, simulated_elapsed_ms: 0 }, world: { ref: 'world', revision: 1, limitations: [] }, progress: { event_count: 0, checkpoint_count: 0, last_checkpoint_at: null }, metrics: [], draft_changes: [], retention: { pinned: false, expires_at: null }, resources: { observed_storage_bytes: 0, pause_reason: null } };
const running: NativeSimulationRun = { ...draft, revision: 4, status: 'running', started_at: '2026-10-29T00:01:00Z', available_actions: ['open', 'pause', 'stop'] };
const wrap = (run: NativeSimulationRun) => ({ schema_version: 1, run });
const action: NativePendingAction = { version: 1, domain: 'simulation', scope, clientId: key, endpoint: root, ownerHref: '/more/simulation?step=baseline', refreshPath: `${root}/${id}`, method: 'POST', payload: { kind: 'json', body: JSON.stringify({ kind: 'baseline', speed: 20, end_at: null, idempotency_key: key }) }, phase: 'accepted', replayPolicy: 'same_request', createdAt: '2026-10-29T00:00:00Z' };
const intent = capturedBaselineIntent(scopeKey, school, action, draft, null)!;
function harness(run = draft) {
  let retained = structuredClone(intent), starts = 0, reads = 0; const writes: SimulationBaselineIntent[] = [];
  const ports: SimulationBaselinePorts = { assertCurrent() {}, persist: async value => { retained = structuredClone(value); writes.push(retained); }, read: async runId => { reads++; assert.equal(runId, id); return wrap(run); }, start: async (runId, body) => { starts++; assert.equal(runId, id); assert.deepEqual(body, { speed: 20, end_at: null }); assert.equal(retained.phase, 'start_submitted'); return wrap(running); } };
  return { ports, get retained() { return retained; }, get starts() { return starts; }, get reads() { return reads; }, writes };
}
test('baseline capture acknowledgement retains exact source and settings, never replaces an existing launch', () => {
  assert.equal(simulationBaselineIntentValid(intent, scopeKey, school), true);
  for (const invalid of [{ ...intent, scope: 'other' }, { ...intent, schoolId: id }, { ...intent, runId: 'bad' }, { ...intent, speed: 101 }, { ...intent, phase: 'ready' }]) assert.equal(simulationBaselineIntentValid(invalid, scopeKey, school), false);
  assert.equal(capturedBaselineIntent(scopeKey, school, action, draft, { ...intent, phase: 'start_submitted' })!.phase, 'start_submitted');
  assert.throws(() => capturedBaselineIntent(scopeKey, school, action, draft, { ...intent, runId: scenario }), /Another/);
  assert.throws(() => capturedBaselineIntent(scopeKey, school, { ...action, phase: 'unknown' }, draft, null), /original/);
  assert.throws(() => capturedBaselineIntent(scopeKey, school, action, { ...draft, speed: 50 }, null), /original/);
  assert.equal(capturedBaselineIntent(scopeKey, school, { ...action, payload: { kind: 'json', body: '{"kind":"scenario"}' } }, draft, null), null);
});
test('successful capture follow-up starts the same saved ID once and persists both request boundaries', async () => {
  const h = harness(), result = await advanceSimulationBaseline(intent, h.ports);
  assert.equal(h.starts, 1); assert.equal(h.reads, 1); assert.deepEqual(h.writes.map(value => value.phase), ['start_submitted', 'start_accepted']);
  assert.equal(result.run.id, id); assert.equal(result.canEnter, true); assert.equal(result.unconfirmed, false);
});
test('lost start response survives relaunch and only inspects; a matching GET is not a command receipt', async () => {
  const h = harness(); h.ports.start = async () => { throw new Error('Response lost'); };
  await assert.rejects(advanceSimulationBaseline(intent, h.ports), /lost/); assert.equal(h.retained.phase, 'start_submitted');
  const relaunched = JSON.parse(JSON.stringify(h.retained)) as SimulationBaselineIntent, recovery = harness(running);
  recovery.ports.start = async () => { throw new Error('Must not repeat start'); };
  const result = await advanceSimulationBaseline(relaunched, recovery.ports);
  assert.equal(result.unconfirmed, true); assert.equal(result.canEnter, true); assert.equal(result.intent.phase, 'start_submitted');
  const stillDraft = await advanceSimulationBaseline(relaunched, harness().ports);
  assert.equal(stillDraft.canEnter, false); assert.equal(stillDraft.unconfirmed, true);
});
test('acknowledged start recovery performs only a current read, including temporary unavailable world', async () => {
  const h = harness({ ...running, can_open: false });
  const result = await advanceSimulationBaseline({ ...intent, phase: 'start_accepted' }, h.ports);
  assert.equal(h.starts, 0); assert.equal(h.reads, 1); assert.equal(result.unconfirmed, false); assert.equal(result.canEnter, false);
});
test('fresh source drift or a run not ready to start retains the same capture without submitting', async () => {
  for (const current of [{ ...draft, revision: 4 }, { ...draft, speed: 50 }, { ...draft, available_actions: ['open'] }]) {
    const h = harness(current); await assert.rejects(advanceSimulationBaseline(intent, h.ports), /changed|not ready/); assert.equal(h.starts, 0); assert.equal(h.writes.length, 0);
  }
});
test('a wrong run, world, status or settings cannot become a confirmed start', async () => {
  for (const current of [{ ...running, id: key, namespace_id: `scenario:${scenario}:run:${key}` }, { ...running, scenario_id: key, namespace_id: `scenario:${key}:run:${id}` }, draft, { ...running, speed: 50 }, { ...running, started_at: null }]) {
    const h = harness(); h.ports.start = async () => wrap(current);
    await assert.rejects(advanceSimulationBaseline(intent, h.ports)); assert.equal(h.retained.phase, 'start_submitted');
  }
  assert.equal(baselineCanEnter({ ...running, available_actions: [] }), false);
  assert.equal(baselineCanEnter({ ...running, started_at: null }), false);
});
test('a failed or uncertain persistence boundary sends no start and cannot fall through to an old in-memory phase', async () => {
  const h = harness(); h.ports.persist = async () => { throw new Error('Storage acknowledgement lost'); };
  await assert.rejects(advanceSimulationBaseline(intent, h.ports), /Storage/); assert.equal(h.starts, 0);
});
test('focus or account change during source read blocks start on the fresh lease', async () => {
  const h = harness(); let current = true; h.ports.assertCurrent = () => { if (!current) throw new Error('Source changed'); };
  h.ports.read = async () => { current = false; return wrap(draft); };
  await assert.rejects(advanceSimulationBaseline(intent, h.ports), /Source changed/); assert.equal(h.starts, 0);
});
test('typed first capacity refusal releases only start submission, generic or prior uncertainty stays retained', async () => {
  const capacity = { status: 429, details: { error: { status: 429, code: 'simulation_institution_capacity', resource: 'running_runs', limit: 4 } } };
  const h = harness(); h.ports.start = async () => { throw capacity; };
  await assert.rejects(advanceSimulationBaseline(intent, h.ports)); assert.equal(h.retained.phase, 'captured');
  const generic = harness(); generic.ports.start = async () => { throw { status: 429 }; };
  await assert.rejects(advanceSimulationBaseline(intent, generic.ports)); assert.equal(generic.retained.phase, 'start_submitted');
  const previous = harness(); previous.ports.start = async () => { throw capacity; };
  await advanceSimulationBaseline({ ...intent, phase: 'start_submitted' }, previous.ports); assert.equal(previous.starts, 0); assert.equal(previous.writes.length, 0);
});
test('capture journal cannot clear before durable baseline identity; recovery reuses acknowledged capture and saved ID', async () => {
  let raw: string | null = null, captureCalls = 0, saved: SimulationBaselineIntent | null = null, storageAvailable = false;
  const make = () => new NativePendingActionJournal({ scope, domain: 'simulation', randomId: () => key, storage: { read: async () => raw, write: async value => { raw = value; }, clear: async () => { assert.ok(saved); raw = null; } }, send: async () => { captureCalls++; return wrap(draft); }, read: async () => wrap(draft) });
  const context = { ownerHref: action.ownerHref, refreshPath: root, assertActive() {}, resolveRefreshPath: (value: unknown, request: NativePendingAction) => simulationControlResultPath(school, value, request), accepted: async (_value: unknown, _assert: () => void, request: NativePendingAction) => { if (!storageAvailable) throw new Error('Follow-up storage unavailable'); saved = capturedBaselineIntent(scopeKey, school, request, draft, saved); } };
  const first = make(); await first.hydrate(); assert.equal(await first.run({ endpoint: root, body: { kind: 'baseline', speed: 20, end_at: null }, serverKey: 'idempotency_key' }, context), false);
  assert.equal(first.snapshot().action?.phase, 'accepted'); assert.ok(raw); assert.equal(saved, null);
  storageAvailable = true; const relaunched = make(); await relaunched.hydrate(); assert.equal(await relaunched.recover(context), true);
  assert.equal(captureCalls, 1); assert.equal(saved!.runId, id); assert.equal(raw, null);
});
test('lost capture replay keeps its original key and still starts only the same owner-returned run', async () => {
  let raw: string | null = null, calls = 0, saved: SimulationBaselineIntent | null = null; const keys: string[] = [];
  const make = () => new NativePendingActionJournal({ scope, domain: 'simulation', randomId: () => key, storage: { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } }, send: async request => { calls++; keys.push(JSON.parse((request.payload as { body: string }).body).idempotency_key); if (calls === 1) throw new Error('Capture response lost'); return wrap(draft); }, read: async () => wrap(draft) });
  const context = { ownerHref: action.ownerHref, refreshPath: root, assertActive() {}, resolveRefreshPath: (value: unknown, request: NativePendingAction) => simulationControlResultPath(school, value, request), accepted: async (_value: unknown, _assert: () => void, request: NativePendingAction) => { saved = capturedBaselineIntent(scopeKey, school, request, draft, saved); } };
  const first = make(); await first.hydrate(); await first.run({ endpoint: root, body: { kind: 'baseline', speed: 20, end_at: null }, serverKey: 'idempotency_key' }, context);
  const relaunched = make(); await relaunched.hydrate(); assert.equal(await relaunched.recover(context), true); assert.deepEqual(keys, [key, key]);
  const h = harness(); await advanceSimulationBaseline(saved!, h.ports); assert.equal(h.starts, 1);
});
