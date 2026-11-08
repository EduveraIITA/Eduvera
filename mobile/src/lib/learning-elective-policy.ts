import type { ElectiveChangeReceipt } from '../../../packages/contracts/src/wire/features/learning/electiveChangeApi';
import type { NativePendingAction, NativePendingInput, NativePendingScope } from './native-pending-action';

export type ElectiveAction = ElectiveChangeReceipt['action'];
const root = '/api/v1/learning/elective-changes';
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown, minimum: number, maximum: number) => typeof value === 'string' && value === value.trim() && value.length >= minimum && value.length <= maximum;
const day = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export const electiveChangeRoot = root;
export const electiveChangeRead = (id: string) => `${root}/${encodeURIComponent(id)}`;
export const electiveFinanceRead = (scope: Pick<NativePendingScope, 'schoolId'>, id: string) => `/api/v1/schools/${encodeURIComponent(scope.schoolId)}/fees/elective-reviews/${encodeURIComponent(id)}`;
export function electiveChangeEndpoint(scope: Pick<NativePendingScope, 'schoolId'>, id: string, kind: ElectiveAction) {
  return kind === 'request' ? root : kind === 'finance.classify' ? `${electiveFinanceRead(scope, id)}/decision` : `${electiveChangeRead(id)}/${kind === 'finance.assign' ? 'finance-assignment' : kind}`;
}
export function electiveChangeConfirmationPath(scope: Pick<NativePendingScope, 'schoolId'>, id: string, kind: ElectiveAction, commandId: string) {
  return `${kind === 'finance.classify' ? electiveFinanceRead(scope, id) : electiveChangeRead(id)}/confirmation?${new URLSearchParams({ command_id: commandId, ...(kind === 'finance.classify' ? {} : { action: kind }) })}`;
}
function validBody(body: Record<string, unknown>, id: string, kind: ElectiveAction) {
  if (!uuid(body.command_id) || !revision(body.expected_revision)) return false;
  if (kind === 'apply') return keys(body, ['command_id', 'expected_revision']);
  if (kind === 'withdraw') return keys(body, ['command_id', 'expected_revision', 'reason']) && text(body.reason, 3, 500);
  if (kind === 'finance.classify') return keys(body, ['command_id', 'expected_revision', 'expected_ledger_basis_hash', 'outcome', 'reason'])
    && hash(body.expected_ledger_basis_hash) && ['no_financial_change', 'requires_financial_review'].includes(String(body.outcome)) && text(body.reason, 5, 1000);
  if (kind === 'finance.assign') { const reviewer = object(body.reviewer); return keys(body, ['command_id', 'expected_revision', 'reviewer', 'confirm_delivery'])
    && body.confirm_delivery === true && !!reviewer && keys(reviewer, ['user_id', 'eligibility_hash']) && uuid(reviewer.user_id) && hash(reviewer.eligibility_hash); }
  if (!keys(body, ['command_id', 'expected_revision', 'change_id', 'selection', 'preview_fingerprint', 'reason', 'catch_up', 'finance_reviewer', 'confirm_delivery'])
    || body.expected_revision !== 0 || body.change_id !== id || !hash(body.preview_fingerprint) || !text(body.reason, 3, 500)) return false;
  const selection = object(body.selection), catchUp = object(body.catch_up), reviewer = object(body.finance_reviewer);
  if (!selection || !keys(selection, ['person', 'source_offering', 'source_enrollment', 'destination_offering', 'effective_on']) || !day(selection.effective_on)) return false;
  for (const field of ['person', 'source_offering', 'source_enrollment', 'destination_offering']) { const ref = object(selection[field]); if (!ref || !keys(ref, ['id', 'expected_revision']) || !uuid(ref.id) || !revision(ref.expected_revision)) return false; }
  if (object(selection.source_offering)!.id === object(selection.destination_offering)!.id || !catchUp) return false;
  if (catchUp.kind === 'not_needed' ? !keys(catchUp, ['kind', 'reason']) || !text(catchUp.reason, 3, 500)
    : catchUp.kind !== 'plan' || !keys(catchUp, ['kind', 'summary', 'due_on']) || !text(catchUp.summary, 5, 1000) || catchUp.due_on !== null && !day(catchUp.due_on)) return false;
  return body.finance_reviewer === null ? body.confirm_delivery === false : !!reviewer && body.confirm_delivery === true
    && keys(reviewer, ['user_id', 'eligibility_hash']) && uuid(reviewer.user_id) && hash(reviewer.eligibility_hash);
}
function parts(action: NativePendingAction) {
  try {
    const source = action.source, body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
    if (action.domain !== 'learning' || action.method !== 'POST' || !source || source.kind !== 'elective_change' || !uuid(source.sourceId) || !revision(source.revision)
      || !body || body.command_id !== action.clientId || body.expected_revision !== source.revision || action.replayPolicy !== 'same_request') return null;
    const kinds: ElectiveAction[] = ['request', 'finance.assign', 'finance.classify', 'apply', 'withdraw'];
    const kind = kinds.find(kind => action.endpoint === electiveChangeEndpoint(action.scope, source.sourceId, kind));
    const initialRead = kind === 'finance.classify' ? electiveFinanceRead(action.scope, source.sourceId) : electiveChangeRead(source.sourceId);
    if (!kind || !validBody(body, source.sourceId, kind) || action.refreshPath !== (action.phase === 'accepted'
      ? electiveChangeConfirmationPath(action.scope, source.sourceId, kind, action.clientId) : initialRead)) return null;
    return { source, body, kind };
  } catch { return null; }
}
/** Register only this typed family with the shared learning journal. */
export function nativeLearningElectiveAllowed(action: NativePendingAction, scope: NativePendingScope) {
  return action.scope.actorId === scope.actorId && action.scope.schoolId === scope.schoolId && action.scope.mode === scope.mode
    && action.scope.namespaceId === scope.namespaceId && action.scope.origin === scope.origin && !!parts(action);
}
export function learningElectiveCommand(scope: NativePendingScope, id: string, kind: ElectiveAction, body: Record<string, unknown>): NativePendingInput {
  const reviewed = { ...body, command_id: body.command_id ?? '00000000-0000-4000-8000-000000000000' };
  if (!uuid(id) || !validBody(reviewed, id, kind)) throw new Error('Review the exact elective change, responsibility and expected revision before continuing.');
  return { endpoint: electiveChangeEndpoint(scope, id, kind), method: 'POST', body: reviewed, serverKey: 'command_id', replayPolicy: 'same_request',
    source: { kind: 'elective_change', sourceId: id, revision: Number(body.expected_revision) } };
}
function receipt(value: unknown, action: NativePendingAction) {
  const source = parts(action), result = object(value);
  if (!source || !result || result.id !== source.source.sourceId || result.command_id !== action.clientId || result.action !== source.kind || result.revision !== source.source.revision + 1)
    throw new Error('The elective receipt did not confirm this exact action, command and revision. Its original action remains retained.');
  const expected = source.kind === 'request' ? source.body.finance_reviewer === null ? 'unassigned' : 'waiting_for_finance'
    : source.kind === 'finance.assign' ? 'waiting_for_finance' : source.kind === 'finance.classify' ? source.body.outcome : source.kind === 'apply' ? 'applied' : 'withdrawn';
  if (result.state !== expected || source.kind === 'apply' && (!uuid(result.source_enrollment_id) || !uuid(result.destination_enrollment_id) || result.source_enrollment_id === result.destination_enrollment_id
    || !day(result.effective_on) || !Array.isArray(result.schedule_revisions) || result.schedule_revisions.length > 100 || !result.schedule_revisions.every(value => {
      const row = object(value); return !!row && uuid(row.previous_plan_id) && uuid(row.plan_id) && row.previous_plan_id !== row.plan_id && revision(row.revision) && row.revision > 0 && uuid(row.command_id);
    })))
    throw new Error('This result did not confirm the original elective outcome.');
  return result;
}
export function learningElectiveRefreshPath(value: unknown, action: NativePendingAction) { receipt(value, action); const source = parts(action)!; return electiveChangeConfirmationPath(action.scope, source.source.sourceId, source.kind, action.clientId); }
/** A current detail/ledger GET is not exact command acceptance. */
export function learningElectiveConfirmed(value: unknown, action: NativePendingAction) {
  const envelope = object(value), source = parts(action);
  if (!source || !envelope || envelope.handler !== 'learning.elective_change' || envelope.source_id !== source.source.sourceId || envelope.command_id !== action.clientId
    || envelope.action !== source.kind || envelope.state !== 'accepted') throw new Error('The owning elective command is not yet confirmed. Its exact action stays retained.');
  return receipt(envelope.result, action);
}
/** Only exact monotonic, receipt-absent owner proof releases an obsolete intent.
 * Generic conflicts, transport failures and accepted evidence remain retained. */
export function learningElectiveObsolete(error: unknown, action: NativePendingAction) {
  const source = parts(action), outer = object(error), envelope = object(object(outer?.details)?.error), fields = object(envelope?.fields), proof = object(fields?.elective_change_obsolete);
  const refusal = object(fields?.elective_change_refusal);
  if (source && action.phase !== 'accepted' && outer?.status === 409 && envelope?.code === 'elective_change_refused' && refusal)
    return refusal.confirmation === 'terminal_refusal' && refusal.receipt_state === 'completed' && refusal.terminal_state === 'conflicted'
      && refusal.handler === 'learning.elective_change' && refusal.source_id === source.source.sourceId && refusal.command_id === action.clientId
      && refusal.action === source.kind && refusal.expected_revision === source.source.revision && refusal.school_id === action.scope.schoolId && refusal.actor_user_id === action.scope.actorId
      && refusal.environment_namespace_id === (action.scope.mode === 'live' ? `live:${action.scope.schoolId}` : action.scope.namespaceId)
      && refusal.reason_code === 'elective_review_refused' && hash(refusal.payload_hash) && uuid(refusal.refusal_id)
      && JSON.stringify(canonical(refusal.reviewed_request)) === JSON.stringify(canonical(source.body));
  return !!(source && action.phase !== 'accepted' && outer?.status === 409 && proof && proof.handler === 'learning.elective_change' && proof.source_id === source.source.sourceId
    && proof.command_id === action.clientId && proof.action === source.kind && proof.expected_revision === source.source.revision && revision(proof.current_revision) && proof.current_revision > source.source.revision
    && proof.school_id === action.scope.schoolId && proof.actor_user_id === action.scope.actorId
    && proof.environment_namespace_id === (action.scope.mode === 'live' ? `live:${action.scope.schoolId}` : action.scope.namespaceId)
    && proof.confirmation === 'permanently_inapplicable' && proof.receipt_state === 'absent' && proof.reason === 'review_advanced'
    && JSON.stringify(canonical(proof.reviewed_request)) === JSON.stringify(canonical(source.body)));
}
