import { definitiveNativeRefusal, type NativePendingAction } from '../lib/native-pending-action';
import { confirmedSimulationRun, simulationControlFingerprint, type NativeSimulationRun } from '../lib/simulation-policy';

export interface SimulationBaselineIntent {
  version: 1; scope: string; schoolId: string; captureId: string; runId: string; scenarioId: string;
  name: string; speed: number; end_at: string | null; fingerprint: string;
  phase: 'captured' | 'start_submitted' | 'start_accepted';
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function simulationBaselineIntentValid(value: unknown, scope: string, schoolId: string): value is SimulationBaselineIntent {
  const intent = value as SimulationBaselineIntent | null;
  return !!intent && intent.version === 1 && intent.scope === scope && intent.schoolId === schoolId && uuid(intent.captureId) && uuid(intent.runId) && uuid(intent.scenarioId)
    && typeof intent.name === 'string' && intent.name.length <= 120 && typeof intent.fingerprint === 'string' && intent.fingerprint.length > 0 && intent.fingerprint.length < 4096
    && Number.isFinite(intent.speed) && intent.speed >= 1 && intent.speed <= 100 && (intent.end_at === null || typeof intent.end_at === 'string' && Number.isFinite(Date.parse(intent.end_at)))
    && ['captured', 'start_submitted', 'start_accepted'].includes(intent.phase);
}
/** Called before the acknowledged capture journal is cleared. The capture's
 * original bytes, not editable form state, own the follow-up settings. */
export function capturedBaselineIntent(scope: string, schoolId: string, action: NativePendingAction, run: NativeSimulationRun, retained: SimulationBaselineIntent | null): SimulationBaselineIntent | null {
  if (action.endpoint !== `/api/v1/schools/${encodeURIComponent(schoolId)}/simulation/runs` || action.payload.kind !== 'json') return null;
  const body = JSON.parse(action.payload.body) as Record<string, unknown>;
  if (body.kind !== 'baseline') return null;
  if (action.phase !== 'accepted' || action.method !== 'POST' || action.scope.schoolId !== schoolId || action.scope.mode !== 'live' || action.scope.namespaceId !== null || body.idempotency_key !== action.clientId
    || run.kind !== 'baseline' || body.speed !== run.speed || body.end_at !== run.clock.end_at || body.name !== undefined && body.name !== run.name) throw new Error('The captured baseline does not match its original saved request.');
  if (retained) {
    if (retained.captureId !== action.clientId || retained.runId !== run.id || retained.scenarioId !== run.scenario_id || retained.speed !== body.speed || retained.end_at !== body.end_at) throw new Error('Another baseline launch remains retained. Its saved identity was kept.');
    return retained;
  }
  const intent: SimulationBaselineIntent = { version: 1, scope, schoolId, captureId: action.clientId, runId: run.id, scenarioId: run.scenario_id, name: run.name, speed: run.speed, end_at: run.clock.end_at, fingerprint: simulationControlFingerprint(run), phase: 'captured' };
  if (!simulationBaselineIntentValid(intent, scope, schoolId)) throw new Error('The baseline follow-up could not be securely verified.');
  return intent;
}
export interface SimulationBaselinePorts {
  assertCurrent(): void; persist(intent: SimulationBaselineIntent): Promise<void>;
  read(runId: string): Promise<unknown>;
  start(runId: string, body: { speed: number; end_at: string | null }): Promise<unknown>;
}
export function currentBaselineRun(value: unknown, intent: SimulationBaselineIntent) {
  const run = confirmedSimulationRun(value, intent.runId);
  if (run.kind !== 'baseline' || run.scenario_id !== intent.scenarioId) throw new Error('The saved baseline world identity changed. No new run was captured.');
  return run;
}
export function baselineCanEnter(run: NativeSimulationRun) {
  return run.can_open && run.available_actions.includes('open') && run.status !== 'draft' && run.status !== 'preparing' && typeof run.started_at === 'string' && Number.isFinite(Date.parse(run.started_at));
}
/** Start has no replay key. Persist before sending, then never resend it after an
 * uncertain response. A later read offers the current run without proving who
 * started it. Only an actual matching start response becomes start_accepted. */
export async function advanceSimulationBaseline(original: SimulationBaselineIntent, ports: SimulationBaselinePorts) {
  let intent = { ...original }; ports.assertCurrent();
  let run = currentBaselineRun(await ports.read(intent.runId), intent); ports.assertCurrent();
  if (intent.phase === 'captured') {
    if (simulationControlFingerprint(run) !== intent.fingerprint) throw new Error('This captured baseline changed. Review the same saved run before starting it.');
    if (run.status !== 'draft' || !run.available_actions.includes('start')) throw new Error('This baseline is not ready to start. Continue in the same saved run to inspect its current state.');
    intent.phase = 'start_submitted'; await ports.persist({ ...intent }); ports.assertCurrent();
    let response: unknown;
    try { response = await ports.start(intent.runId, { speed: intent.speed, end_at: intent.end_at }); }
    catch (cause) {
      ports.assertCurrent();
      if (definitiveNativeRefusal(cause, false, { domain: 'simulation' })) { intent.phase = 'captured'; await ports.persist({ ...intent }); ports.assertCurrent(); }
      throw cause;
    }
    run = currentBaselineRun(response, intent); ports.assertCurrent();
    if (!['running', 'completed'].includes(run.status) || run.speed !== intent.speed || run.clock.end_at !== intent.end_at || !run.started_at || !Number.isFinite(Date.parse(run.started_at))) throw new Error('The start response did not confirm this exact baseline and its reviewed settings. Start will not be repeated.');
    intent.phase = 'start_accepted'; await ports.persist({ ...intent }); ports.assertCurrent();
  }
  return { intent, run, unconfirmed: intent.phase === 'start_submitted', canEnter: baselineCanEnter(run) };
}
