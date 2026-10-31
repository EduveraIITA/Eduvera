import { confirmedSimulationRun, simulationRemoved, simulationStoppedDraft } from '../lib/simulation-policy';
export interface SimulationRemovalIntent { version: 1; scope: string; schoolId: string; runId: string; scenarioId: string; name: string; draft: boolean; reviewedRevision: number; removalRevision: number | null; phase: 'ready' | 'reconcile' | 'remove' | 'accepted'; submitted: boolean }
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function simulationRemovalIntentValid(value: unknown, scope: string, schoolId: string): value is SimulationRemovalIntent { const intent = value as SimulationRemovalIntent; return !!intent && intent.version === 1 && intent.scope === scope && intent.schoolId === schoolId && uuid(intent.runId) && uuid(intent.scenarioId) && typeof intent.name === 'string' && intent.name.length <= 120 && typeof intent.draft === 'boolean' && Number.isSafeInteger(intent.reviewedRevision) && intent.reviewedRevision > 0 && (intent.removalRevision === null ? intent.draft && ['ready', 'reconcile'].includes(intent.phase) : Number.isSafeInteger(intent.removalRevision) && intent.removalRevision === intent.reviewedRevision + (intent.draft ? 1 : 0)) && ['ready', 'reconcile', 'remove', 'accepted'].includes(intent.phase) && typeof intent.submitted === 'boolean' && (intent.phase === 'ready' ? intent.submitted === false : intent.submitted === true); }
export interface SimulationRemovalPorts {
  assertCurrent(): void;
  persist(intent: SimulationRemovalIntent): Promise<void>;
  read(runId: string): Promise<unknown>;
  stop(runId: string, body: { expected_revision: number; expected_status: 'draft' }): Promise<unknown>;
  remove(runId: string, body: { expected_revision: number }): Promise<unknown>;
}
/** Persist each request boundary before sending. A retained conditional Stop is
 * inspected; only owner-receipted removal replays its unchanged reviewed revision. */
export async function advanceSimulationRemoval(original: SimulationRemovalIntent, ports: SimulationRemovalPorts) {
  let intent = { ...original };
  const persist = async () => { await ports.persist({ ...intent }); ports.assertCurrent(); };
  ports.assertCurrent();
  if (intent.phase === 'accepted') return intent;
  intent.submitted = true;
  if (intent.draft && intent.removalRevision === null) {
    const reconcile = intent.phase === 'reconcile'; intent.phase = 'reconcile'; await persist();
    const response = reconcile ? await ports.read(intent.runId) : await ports.stop(intent.runId, { expected_revision: intent.reviewedRevision, expected_status: 'draft' }); ports.assertCurrent();
    const stopped = confirmedSimulationRun(response, intent.runId);
    if (stopped.scenario_id !== intent.scenarioId || !simulationStoppedDraft(stopped, intent.reviewedRevision)) throw new Error('This draft changed or has not stopped. The exact conditional Stop remains unconfirmed; it will not be resent or rebased onto another revision.');
    intent.phase = 'remove'; intent.removalRevision = stopped.revision!; await persist();
  }
  intent.phase = 'remove'; await persist();
  const removed = confirmedSimulationRun(await ports.remove(intent.runId, { expected_revision: intent.removalRevision! }), intent.runId); ports.assertCurrent();
  if (removed.scenario_id !== intent.scenarioId || !simulationRemoved(removed)) throw new Error('The response did not prove this exact isolated world was removed. Its original reviewed revision is retained for the same removal request.');
  intent.phase = 'accepted'; await persist(); return intent;
}
