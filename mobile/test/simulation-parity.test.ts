import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSimulationRemoval, simulationRemovalIntentValid, type SimulationRemovalIntent } from '../src/features/SimulationRemovalPolicy';
import { simulationBehaviourBody, simulationBehaviourDraft, simulationBehaviourMatches } from '../src/features/SimulationBehaviourPolicy';
import { simulationControlResultPath } from '../src/features/SimulationCommandPolicy';
import { simulationListPath, simulationPresentation, simulationRemovalUnavailable, simulationView, type NativeSimulationRun } from '../src/lib/simulation-policy';
import type { NativePendingAction } from '../src/lib/native-pending-action';
const school = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', scenario = '10000000-0000-4000-8000-000000000003', actor = '10000000-0000-4000-8000-000000000004';
const draft: NativeSimulationRun = { id, revision: 3, scenario_id: scenario, namespace_id: `scenario:${scenario}:run:${id}`, created_by_me: true, started_at: null, name: 'Reviewed draft', kind: 'scenario', status: 'draft', can_open: true, available_actions: ['open', 'start', 'stop'], speed: 20, failure_reason: null, clock: { virtual_now: '2026-10-29T00:00:00Z', time_zone: 'Asia/Kolkata', end_at: null, simulated_elapsed_ms: 0 }, world: { ref: 'world', revision: 1, limitations: [] }, progress: { event_count: 0, checkpoint_count: 0, last_checkpoint_at: null }, metrics: [], draft_changes: [], retention: { pinned: false, expires_at: null, state: 'retained', world_discarded_at: null }, resources: { observed_storage_bytes: 0, pause_reason: null } };
const stopped: NativeSimulationRun = { ...draft, status: 'stopped', revision: 4, available_actions: ['open', 'remove'] };
const removed: NativeSimulationRun = { ...stopped, revision: 7, can_open: false, available_actions: [], retention: { ...stopped.retention, state: 'deleted', world_discarded_at: '2026-10-29T01:00:00Z' } };
const ready: SimulationRemovalIntent = { version: 1, scope: 'originActorCampusWorld', schoolId: school, runId: id, scenarioId: scenario, name: draft.name, draft: true, reviewedRevision: 3, removalRevision: null, phase: 'ready', submitted: false };
const wrap = (run: NativeSimulationRun) => ({ schema_version: 1, run });
test('canonical selectors resolve the selected session world without choosing execution from URL', () => {
  assert.equal(simulationPresentation('/more/simulation?panel=recent').panel, 'recent');
  assert.equal(simulationPresentation('/more/simulation?step=baseline').baseline, true);
  assert.equal(simulationPresentation('/more/simulation?panel=recent&view=history&page=2').history, true);
  assert.equal(simulationPresentation('/more/simulation?panel=recent&view=history&manage=storage').history, false);
  assert.equal(simulationPresentation('/more/simulation?run=bad', { mode: 'simulation', run_id: id }).runId, id);
  assert.throws(() => simulationPresentation('/more/simulation?run=bad', { mode: 'live' }));
  assert.equal(simulationView(draft, null), 'edit');
  assert.equal(simulationView({ ...draft, kind: 'baseline' }, null), 'settings');
  assert.equal(simulationView(stopped, 'results'), 'results');
  assert.equal(simulationView({ ...draft, status: 'running' }, 'settings'), 'overview');
  assert.equal(simulationListPath(school, true, 3), `/api/v1/schools/${school}/simulation/runs?view=retained&page=3`);
});
test('removal is unavailable for non-owners, active, pinned, removed or unversioned worlds', () => {
  assert.equal(simulationRemovalUnavailable(draft), null);
  assert.match(simulationRemovalUnavailable({ ...draft, created_by_me: false })!, /owner/);
  assert.match(simulationRemovalUnavailable({ ...draft, status: 'running' })!, /Stop/);
  assert.match(simulationRemovalUnavailable({ ...stopped, retention: { ...stopped.retention, pinned: true } })!, /Unpin/);
  assert.match(simulationRemovalUnavailable(removed)!, /removed/);
  assert.match(simulationRemovalUnavailable({ ...stopped, revision: undefined })!, /Refresh/);
});
test('lost conditional Stop is inspected and never resent; removal uses exact returned stopped revision', async () => {
  let retained = ready, stops = 0, reads = 0, removes = 0;
  const ports = { assertCurrent() {}, persist: async (value: SimulationRemovalIntent) => { retained = value; }, read: async () => { reads++; return wrap(stopped); }, stop: async (_id: string, body: { expected_revision: number; expected_status: 'draft' }) => { stops++; assert.deepEqual(body, { expected_revision: 3, expected_status: 'draft' }); throw new Error('Stop response lost'); }, remove: async (_id: string, body: { expected_revision: number }) => { removes++; assert.equal(body.expected_revision, 4); return wrap(removed); } };
  await assert.rejects(advanceSimulationRemoval(ready, ports), /lost/);
  assert.equal(retained.phase, 'reconcile');
  const result = await advanceSimulationRemoval(retained, ports);
  assert.equal(result.phase, 'accepted'); assert.equal(stops, 1); assert.equal(reads, 1); assert.equal(removes, 1);
});
test('discard never adopts a newer or started run after unknown Stop', async () => {
  for (const current of [{ ...stopped, revision: 5 }, { ...stopped, started_at: '2026-10-28T00:00:00Z' }, { ...draft, status: 'running' as const, revision: 4 }]) {
    let writes = 0;
    await assert.rejects(advanceSimulationRemoval({ ...ready, phase: 'reconcile', submitted: true }, { assertCurrent() {}, persist: async () => {}, read: async () => wrap(current), stop: async () => { throw new Error('Must never stop again'); }, remove: async () => { writes++; return wrap(removed); } }), /unconfirmed/);
    assert.equal(writes, 0);
  }
});
test('uncertain removal replays original revision, accepted removal only refreshes afterward', async () => {
  let retained: SimulationRemovalIntent = { ...ready, draft: false, reviewedRevision: 4, removalRevision: 4 }, calls = 0;
  const ports = { assertCurrent() {}, persist: async (value: SimulationRemovalIntent) => { retained = value; }, read: async () => { throw new Error('No adoption of latest revision'); }, stop: async () => { throw new Error('Terminal world is never stopped'); }, remove: async (_id: string, body: { expected_revision: number }) => { calls++; assert.equal(body.expected_revision, 4); if (calls === 1) throw new Error('Removal response lost'); return wrap(removed); } };
  await assert.rejects(advanceSimulationRemoval(retained, ports), /lost/);
  assert.equal(retained.phase, 'remove');
  retained = await advanceSimulationRemoval(retained, ports); assert.equal(retained.phase, 'accepted');
  await advanceSimulationRemoval(retained, ports); assert.equal(calls, 2);
});
test('removal evidence binds exact scope, campus, source and control revisions', () => {
  assert.equal(simulationRemovalIntentValid(ready, ready.scope, school), true);
  assert.equal(simulationRemovalIntentValid(ready, 'anotherWorld', school), false);
  assert.equal(simulationRemovalIntentValid(ready, ready.scope, id), false);
  assert.equal(simulationRemovalIntentValid({ ...ready, phase: 'remove', removalRevision: 5 }, ready.scope, school), false);
  assert.equal(simulationRemovalIntentValid({ ...ready, phase: 'accepted' }, ready.scope, school), false);
});
test('synthetic models default passive and validate every probability and bounded delay', () => {
  const draft = simulationBehaviourDraft(), body = simulationBehaviourBody(draft);
  assert.equal(body.attendance.enabled, false); assert.equal(body.coverage_offers.enabled, false); assert.equal(body.invigilation_offers.enabled, false);
  assert.equal(body.attendance.present, .88);
  assert.throws(() => simulationBehaviourBody({ ...draft, attendance: { ...draft.attendance, values: { ...draft.attendance.values, present: '101' } } }), /100%/);
  assert.throws(() => simulationBehaviourBody({ ...draft, coverage_offers: { ...draft.coverage_offers, delay: '10081' } }), /10080/);
  assert.throws(() => simulationBehaviourBody({ ...draft, attendance: { ...draft.attendance, delay: '-1' } }), /120/);
  const source = { ...body, provenance: { version_ref: 'policy:1', configuration_hash: 'a'.repeat(64), approved_by_agent_id: actor, configured_at: '2026-10-29T00:00:00Z' } };
  assert.equal(simulationBehaviourMatches(body, source), true);
  assert.equal(simulationBehaviourMatches(body, { ...source, coverage_offers: { ...source.coverage_offers, enabled: true } }), false);
});
test('lifecycle direct response proves exact run and desired state without fabricated receipt', () => {
  const action: NativePendingAction = { version: 1, domain: 'simulation', scope: { actorId: actor, schoolId: school, origin: 'https://campus.example', mode: 'live', namespaceId: null }, clientId: id, endpoint: `/api/v1/schools/${school}/simulation/runs/${id}/pause`, ownerHref: '/more/simulation', refreshPath: `/api/v1/schools/${school}/simulation/runs/${id}`, method: 'POST', payload: { kind: 'json', body: '{}' }, phase: 'unknown', replayPolicy: 'inspect_only', createdAt: '2026-10-29T00:00:00Z' };
  assert.equal(simulationControlResultPath(school, wrap({ ...draft, status: 'paused' }), action), action.refreshPath);
  assert.throws(() => simulationControlResultPath(school, wrap(draft), action), /requested state/);
  assert.throws(() => simulationControlResultPath(school, wrap({ ...draft, id: actor, namespace_id: `scenario:${scenario}:run:${actor}`, status: 'paused' }), action), /exact saved/);
});
