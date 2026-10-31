import test from 'node:test';
import assert from 'node:assert/strict';
import { listSimulationRunsSchema } from '../../backend/src/simulation/simulation.contracts';
import { confirmedSimulationRun, simulationControlFingerprint, simulationListPath, simulationRunId, simulationSettings, type NativeSimulationRun } from '../src/lib/simulation-policy';
import { NativePendingActionJournal, type NativePendingAction } from '../src/lib/native-pending-action';
const id = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const run: NativeSimulationRun = { id, scenario_id: other, namespace_id: `scenario:${other}:run:${id}`, name: 'Native scenario', kind: 'scenario', status: 'draft', can_open: true, available_actions: ['open','start','stop'], speed: 20, failure_reason: null, clock: { virtual_now: '2020-01-01T12:00:00Z', time_zone: 'Asia/Kolkata', end_at: null, simulated_elapsed_ms: 0 }, world: { ref: 'world', revision: 2, limitations: [] }, progress: { event_count: 0, checkpoint_count: 0, last_checkpoint_at: null }, metrics: [], draft_changes: [], retention: { pinned: false, expires_at: null }, resources: { observed_storage_bytes: 0, pause_reason: null } };

test('native recent-runs request satisfies the current ordinary server schema', () => {
  const url = new URL(simulationListPath('campus'), 'https://campus.example');
  assert.equal(url.pathname, '/api/v1/schools/campus/simulation/runs');
  assert.deepEqual(listSimulationRunsSchema.parse(Object.fromEntries(url.searchParams)), { limit: 10, view: 'recent', page: 1 });
  assert.equal(listSimulationRunsSchema.safeParse({ limit: 20 }).success, false);
});
test('run controls reject another saved identity or incomplete world response', () => {
  assert.equal(confirmedSimulationRun({ schema_version: 1, run }, id), run);
  assert.throws(() => confirmedSimulationRun({ schema_version: 1, run }, other));
  assert.throws(() => confirmedSimulationRun({ schema_version: 1, run: { ...run, namespace_id: '' } }));
  assert.throws(() => confirmedSimulationRun({ schema_version: 1, run: { ...run, namespace_id: `scenario:${other}:run:${other}` } }));
  assert.throws(() => simulationRunId('../other')); assert.equal(simulationRunId(null), null);
});
test('control preflight notices changed settings without treating a new checkpoint as a new intent', () => {
  assert.notEqual(simulationControlFingerprint(run), simulationControlFingerprint({ ...run, status: 'running' }));
  assert.notEqual(simulationControlFingerprint(run), simulationControlFingerprint({ ...run, speed: 50 }));
  assert.equal(simulationControlFingerprint(run), simulationControlFingerprint({ ...run, clock: { ...run.clock, virtual_now: '2020-01-02T00:00:00Z' }, world: { ...run.world!, revision: 3 } }));
});
test('optional end is relative to retained virtual time rather than wall-clock date', () => {
  assert.deepEqual(simulationSettings('  scenario  ', 20, new Date('2020-01-02T00:00:00Z'), run.clock.virtual_now), { name: 'scenario', speed: 20, end_at: '2020-01-02T00:00:00.000Z' });
  assert.throws(() => simulationSettings('scenario', 20, new Date('2019-12-31'), run.clock.virtual_now));
  assert.throws(() => simulationSettings('scenario', 101, null)); assert.throws(() => simulationSettings('scenario', 1, new Date('invalid')));
});
test('lost lifecycle control is inspected once after relaunch and never silently repeated', async () => {
  let raw: string | null = null, sends = 0, reads = 0;
  const scope = { actorId: 'actor', schoolId: 'campus', origin: 'https://campus.example', mode: 'live' as const, namespaceId: null }, endpoint = `/api/v1/schools/campus/simulation/runs/${id}`;
  const make = () => new NativePendingActionJournal({ scope, domain: 'simulation', randomId: () => other, storage: { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } }, send: async () => { sends++; throw new Error('Response lost'); }, read: async () => { reads++; return { schema_version: 1, run }; } });
  const context = { ownerHref: `/more/simulation?run=${id}&view=overview`, refreshPath: endpoint, assertActive() {} };
  const first = make(); await first.hydrate(); await first.run({ endpoint: `${endpoint}/start`, body: { speed: 20 }, serverKey: null }, context);
  const resumed = make(); await resumed.hydrate(); assert.equal(await resumed.recover(context), false);
  assert.equal(sends, 1); assert.equal(reads, 1); assert.equal(resumed.snapshot().action?.phase, 'unknown'); assert.ok(raw);
});
test('capture acceptance retains exact saved detail instead of relying on the latest-ten list', async () => {
  let raw: string | null = null, failRead = true, sends = 0; const reads: string[] = [];
  const scope = { actorId: 'actor', schoolId: 'campus', origin: 'https://campus.example', mode: 'live' as const, namespaceId: null }, root = '/api/v1/schools/campus/simulation/runs';
  const make = () => new NativePendingActionJournal({ scope, domain: 'simulation', randomId: () => other, storage: { read: async () => raw, write: async value => { raw = value; }, clear: async () => { raw = null; } }, send: async () => { sends++; return { schema_version: 1, run }; }, read: async action => { reads.push(action.refreshPath); if (failRead) throw new Error('Read unavailable'); return { schema_version: 1, run }; } });
  const context = { ownerHref: '/more/simulation?view=start&kind=scenario', refreshPath: simulationListPath('campus'), assertActive() {}, resolveRefreshPath(value: unknown, _action: NativePendingAction) { return `${root}/${confirmedSimulationRun(value).id}`; } };
  const first = make(); await first.hydrate(); await first.run({ endpoint: root, body: { kind: 'scenario', speed: 20 }, serverKey: 'idempotency_key' }, context);
  assert.equal(first.snapshot().action?.phase, 'accepted'); failRead = false;
  const resumed = make(); await resumed.hydrate(); assert.equal(await resumed.recover(context), true); assert.equal(sends, 1); assert.deepEqual(reads, [`${root}/${id}`, `${root}/${id}`]);
});
