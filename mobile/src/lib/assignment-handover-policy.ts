import type { NativePendingAction } from './native-pending-action';
import { learningAuthoringObsolete } from './learning-authoring-policy';
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function assignmentHandoverRefreshPath(value: unknown, action: NativePendingAction) {
  const result = object(value), source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  if (!result || !source || !body) throw new Error('The handover receipt could not be verified.');
  const path = `/api/v1/learning/assignments/review-handovers/${encodeURIComponent(source.sourceId)}/`;
  if (source.kind !== 'assignment' || action.endpoint !== path || action.refreshPath !== path || action.method !== 'POST'
    || result.id !== source.sourceId || result.handover_id !== action.clientId || result.revision !== source.revision + 1
    || body.expected_revision !== source.revision || result.reviewer_id !== body.reviewer_id
    || !Number.isSafeInteger(result.reviews_reissued) || Number(result.reviews_reissued) < 0) throw new Error('The handover receipt did not match this assignment, reviewer and command.');
  return path;
}
export function assignmentHandoverObsolete(error: unknown, action: NativePendingAction) {
  if (learningAuthoringObsolete(error, action)) return true;
  const outer = object(error), proof = object(object(object(object(outer?.details)?.error)?.fields)?.assignment_handover_obsolete);
  const source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  return !!(source && source.kind === 'assignment' && body && outer?.status === 409 && proof
    && action.endpoint === `/api/v1/learning/assignments/review-handovers/${encodeURIComponent(source.sourceId)}/`
    && proof.code === 'assignment_handover_preview_obsolete' && proof.confirmation === 'permanently_inapplicable'
    && proof.receipt_state === 'absent' && proof.handler === 'learning.assignments' && proof.source_id === source.sourceId
    && proof.command_id === action.clientId && proof.expected_revision === source.revision && body.expected_revision === source.revision
    && proof.reviewed_preview_hash === body.preview_hash && typeof proof.current_preview_hash === 'string'
    && /^[a-f0-9]{64}$/.test(proof.current_preview_hash) && proof.current_preview_hash !== proof.reviewed_preview_hash);
}
