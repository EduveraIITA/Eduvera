import type { NativePendingAction } from '../lib/native-pending-action';
import { confirmedSimulationRun } from '../lib/simulation-policy';
import { simulationBehaviourMatches } from './SimulationBehaviourPolicy';
export function simulationControlResultPath(schoolId: string, value: unknown, action: NativePendingAction) {
    const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/simulation`;
    const suffix = action.endpoint.startsWith(`${root}/runs/`) ? action.endpoint.slice(`${root}/runs/`.length) : '';
    if (action.scope.schoolId !== schoolId || action.endpoint !== `${root}/runs` && !/^[0-9a-f-]{36}\/(?:draft|behaviour|start|pause|resume|stop|duplicate|pin|unpin)$/i.test(suffix) || action.method !== (action.endpoint.endsWith('/draft') ? 'PATCH' : action.endpoint.endsWith('/behaviour') ? 'PUT' : 'POST')) throw new Error('This action does not match the exact Simulation owner endpoint.');
    const original = /\/runs\/([0-9a-f-]{36})\//i.exec(action.endpoint)?.[1], duplicate = action.endpoint.endsWith('/duplicate'), capture = action.endpoint === `${root}/runs`, result = confirmedSimulationRun(value, duplicate || capture ? undefined : original);
    if (action.payload.kind !== 'json') throw new Error('Simulation control requires its retained exact JSON request.');
    const body = JSON.parse(action.payload.body) as Record<string, unknown>, operation = action.endpoint.split('/').at(-1);
    if (capture || duplicate) { if (duplicate && result.id === original || body.kind && result.kind !== body.kind || body.name && result.name !== body.name || body.speed !== undefined && result.speed !== body.speed || body.end_at !== undefined && result.clock.end_at !== body.end_at) throw new Error('The captured run did not match the exact reviewed request.'); }
    if (operation === 'draft' && (result.status !== 'draft' || Object.entries(body).some(([key, expected]) => key === 'end_at' ? result.clock.end_at !== expected : (result as unknown as Record<string, unknown>)[key] !== expected))) throw new Error('The draft settings response did not match the reviewed content.');
    if (operation === 'behaviour' && !simulationBehaviourMatches(body as unknown as Parameters<typeof simulationBehaviourMatches>[0], result.behaviour)) throw new Error('The approved activity policy did not match the exact reviewed assumptions.');
    if (operation === 'pause' && result.status !== 'paused' || operation === 'stop' && result.status !== 'stopped' || ['start', 'resume'].includes(operation ?? '') && (!['running', 'completed'].includes(result.status) || body.speed !== undefined && result.speed !== body.speed || body.end_at !== undefined && result.clock.end_at !== body.end_at) || operation === 'pin' && !result.retention.pinned || operation === 'unpin' && result.retention.pinned) throw new Error('The lifecycle response did not confirm the exact requested state.');
    if (action.source?.fingerprint) { const proof = JSON.parse(action.source.fingerprint) as { namespace?: string; snapshot?: string }; if (!capture && !duplicate && proof.namespace && result.namespace_id !== proof.namespace || duplicate && proof.snapshot && result.snapshot?.hash !== proof.snapshot) throw new Error('The Simulation source did not match its retained world or original snapshot.'); }
    return `${root}/runs/${result.id}`;
  }
