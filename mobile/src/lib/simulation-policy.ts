export interface NativeSimulationRun {
  revision?: number; created_by_me?: boolean; started_at?: string | null;
  snapshot?: import("../../../packages/contracts/src/wire/features/simulation/simulationApi").SimulationSnapshotReference | null;
  behaviour?: import("../../../packages/contracts/src/wire/features/simulation/simulationApi").SimulationBehaviourView | null;
  id: string; scenario_id: string; namespace_id: string; name: string; kind: 'baseline' | 'scenario';
  status: 'preparing' | 'draft' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  can_open: boolean; available_actions: string[]; speed: number; failure_reason: string | null;
  clock: { virtual_now: string; time_zone: string; end_at: string | null; simulated_elapsed_ms: number };
  world: { ref: string; revision: number; limitations: string[] } | null;
  progress: { event_count: number; checkpoint_count: number; last_checkpoint_at: string | null };
  metrics: Array<{ key: string; label?: string; unit: string; value: number | string | null; measured_at: string }>;
  draft_changes: Array<{ id: string; domain: string; summary: string; recorded_at: string }>;
  retention: { pinned: boolean; expires_at: string | null; state?: 'retained' | 'deleting' | 'deleted' | 'failed'; world_discarded_at?: string | null };
  resources: { observed_storage_bytes: number; pause_reason: string | null; paused_at?: string | null; reservation_bytes?: number; measured_at?: string | null; lease_recovery_count?: number };
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function simulationRunId(value: string | null) { if (value === null) return null; if (!uuid(value)) throw new Error('This simulation link is incomplete. Open a saved simulation from Recent.'); return value; }
export function simulationListPath(schoolId: string, retained = false, page = 1) { return `/api/v1/schools/${encodeURIComponent(schoolId)}/simulation/runs?${retained ? `view=retained&page=${simulationPage(String(page))}` : 'limit=10'}`; }
export function confirmedSimulationRun(value: unknown, expectedId?: string): NativeSimulationRun {
  const response = value as { schema_version?: number; run?: NativeSimulationRun } | null, run = response?.run;
  if (response?.schema_version !== 1 || !run || !uuid(run.id) || !uuid(run.scenario_id) || run.namespace_id !== `scenario:${run.scenario_id}:run:${run.id}` || expectedId && run.id !== expectedId || !['preparing', 'draft', 'running', 'paused', 'stopped', 'completed', 'failed'].includes(run.status) || !Array.isArray(run.available_actions) || !run.available_actions.every(action => typeof action === 'string') || !Number.isFinite(Date.parse(run.clock?.virtual_now)) || typeof run.can_open !== 'boolean') throw new Error('The exact saved simulation could not be confirmed.');
  if (typeof run.name !== 'string' || !['baseline', 'scenario'].includes(run.kind) || !Number.isFinite(run.speed) || run.speed < 1 || run.speed > 100 || !Array.isArray(run.metrics) || !Array.isArray(run.draft_changes) || run.draft_changes.some(change => typeof change.summary !== 'string' || typeof change.domain !== 'string') || typeof run.retention?.pinned !== 'boolean' || !Number.isFinite(run.resources?.observed_storage_bytes) || run.resources.observed_storage_bytes < 0 || !Number.isSafeInteger(run.progress?.event_count) || !Number.isSafeInteger(run.progress?.checkpoint_count) || run.world !== null && (!run.world || !Array.isArray(run.world.limitations) || !run.world.limitations.every(value => typeof value === 'string'))) throw new Error('The saved run details could not be verified.');
  try { new Intl.DateTimeFormat('en-IN', { timeZone: run.clock.time_zone }).format(new Date(run.clock.virtual_now)); } catch { throw new Error('The saved campus clock could not be verified.'); }
  return run;
}
/** This compares reviewed settings, not a server-atomic revision precondition. */
export function simulationControlFingerprint(run: NativeSimulationRun) { return JSON.stringify([run.id, run.namespace_id, run.revision, run.status, run.name, run.speed, run.clock.end_at, run.retention.pinned, run.behaviour?.provenance.configuration_hash]); }
export function simulationSettings(name: string, speed: number, end: Date | null, virtualNow?: string) {
  if (name.trim().length > 120 || !Number.isFinite(speed) || speed < 1 || speed > 100) throw new Error('Use a name of 120 characters or fewer and a speed from 1× to 100×.');
  if (end && (!Number.isFinite(end.getTime()) || virtualNow && end.getTime() <= Date.parse(virtualNow))) throw new Error('Choose an end after this simulation’s current time.');
  return { ...(name.trim() ? { name: name.trim() } : {}), speed, end_at: end?.toISOString() ?? null };
}
export function simulationPage(raw: string | null) { if (!raw || !/^[1-9]\d*$/.test(raw)) return 1; const number = Number(raw); return Number.isSafeInteger(number) ? Math.min(number, 1000000) : 1; }
export function simulationPresentation(href: string, selected?: { mode: string; run_id?: string }) {
  const params = new URLSearchParams(href.split('?')[1] ?? ''), runId = selected?.mode === 'simulation' ? simulationRunId(selected.run_id ?? null) : simulationRunId(params.get('run'));
  const legacy = params.get('view'), panel = params.get('panel') === 'recent' || ['recent', 'history'].includes(legacy ?? '') || params.get('manage') === 'storage' ? 'recent' : 'start';
  return { params, runId, panel, history: legacy === 'history' && params.get('manage') !== 'storage', baseline: params.get('step') === 'baseline' || params.get('kind') === 'baseline', page: simulationPage(params.get('page')), effectsPage: simulationPage(params.get('effectsPage')), changesPage: simulationPage(params.get('changesPage')), comparisonMode: params.get('select') === 'compare', requestedView: legacy };
}
export function simulationView(run: NativeSimulationRun, requested: string | null) { if (run.status === 'draft') return run.kind === 'baseline' || requested === 'settings' ? 'settings' : requested === 'changes' ? 'changes' : 'edit'; return ['results', 'changes', 'resources'].includes(requested ?? '') ? requested! : 'overview'; }
export function simulationRemovalUnavailable(run: NativeSimulationRun) { if (!run.created_by_me) return 'Only its owner can remove this simulation.'; if (run.retention.world_discarded_at || run.retention.state === 'deleted') return 'World removed. Run history is kept.'; if (run.retention.pinned) return 'Unpin this simulation before removing it.'; if (['preparing', 'running', 'paused'].includes(run.status)) return 'Stop this simulation before removing it.'; if (!Number.isSafeInteger(run.revision) || Number(run.revision) < 1) return 'Refresh to check removal availability.'; if (run.status === 'draft') return run.available_actions.includes('stop') ? null : 'This draft is not ready to discard.'; return run.available_actions.includes('remove') ? null : 'This simulation is in use or not ready to remove.'; }
export function simulationStoppedDraft(run: NativeSimulationRun, reviewedRevision: number) { return run.status === 'stopped' && run.started_at === null && run.revision === reviewedRevision + 1; }
export function simulationRemoved(run: NativeSimulationRun) { return ['stopped', 'completed', 'failed'].includes(run.status) && run.retention.state === 'deleted' && typeof run.retention.world_discarded_at === 'string' && Number.isFinite(Date.parse(run.retention.world_discarded_at)) && !run.can_open && !run.available_actions.includes('remove'); }
