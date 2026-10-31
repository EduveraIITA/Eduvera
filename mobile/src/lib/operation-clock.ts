import { assertWorkspaceManifestContext } from '../../../packages/contracts/src/workspace-normalizer';
import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
export interface OperationClockContext { actorId: string; schoolId: string; mode: 'live' | 'simulation'; namespaceId: string | null; unavailable?: boolean }
export function operationWorkspaceInstant(value: unknown, context: OperationClockContext) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The selected campus clock could not be verified.');
  const manifest = value as WorkspaceManifest;
  assertWorkspaceManifestContext(manifest, { actorUserId: context.actorId, institutionId: context.schoolId, environment: { mode: context.mode, namespace_id: context.namespaceId, unavailable: context.unavailable } });
  const environment = manifest.context.environment;
  if (context.mode !== 'simulation' || environment.kind !== 'simulation' || !Number.isFinite(Date.parse(environment.virtual_now))) throw new Error('The selected Simulation clock is unavailable. Refresh its workspace before choosing a time.');
  return environment.virtual_now;
}
export async function readOperationNow(context: OperationClockContext, fetcher: (path: string) => Promise<unknown>, liveNow = () => new Date().toISOString()) {
  if (!context.actorId || !context.schoolId || context.unavailable) throw new Error('Confirm the current account, campus and world before choosing a time.');
  if (context.mode === 'live') return liveNow();
  if (!context.namespaceId) throw new Error('The selected Simulation clock is unavailable.');
  return operationWorkspaceInstant(await fetcher('/api/v1/workspace'), context);
}
