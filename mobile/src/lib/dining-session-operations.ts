import type { DiningIssueDetail, DiningRef, DiningSessionDetail } from '../../../packages/contracts/src/wire/features/dining/diningApi';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function reviewedDiningSource<T extends DiningSessionDetail | DiningIssueDetail>(basis: T, current: T, action: string) {
  if (!uuid(basis.id) || current.id !== basis.id || current.revision !== basis.revision || !Number.isSafeInteger(basis.revision) || basis.revision < 1 || !Array.isArray(current.allowed_actions) || !current.allowed_actions.includes(action) || ('recovery_only' in current && current.recovery_only === true) !== ('recovery_only' in basis && basis.recovery_only === true)) throw new Error('The source or responsibility changed. Your entries are kept; review the current record before a new action.');
  return current;
}
export function diningRecoveryBody(source: DiningSessionDetail | DiningIssueDetail, kind: 'session' | 'issue', input: { note: string; operator?: DiningRef | null; coordinator?: DiningRef | null }) {
  if (!source.allowed_actions.includes('reassign') || !uuid(source.id) || !Number.isSafeInteger(source.revision) || source.revision < 1 || input.note.trim().length < 3 || input.note.length > 1000 || kind === 'issue' && !input.operator || kind === 'session' && !input.operator && !input.coordinator || [input.operator, input.coordinator].some(person => person && !uuid(person.id)) || kind === 'issue' && input.coordinator) throw new Error('Choose the exact next responsible person and a reason.');
  return { expected_revision: source.revision, action: 'reassign', note: input.note.trim(), ...(input.operator ? { [kind === 'issue' ? 'handler_person_id' : 'operator_person_id']: input.operator.id } : {}), ...(input.coordinator ? { coordinator_person_id: input.coordinator.id } : {}) };
}
export function diningObservedCount(source: { count_total: number | null; count_receipt_id: string | null }, total: string, observed: string, now: string, correction: boolean) {
  if (!/^\d+$/.test(total) || !Number.isSafeInteger(Number(total)) || Number(total) > 10_000_000 || !Number.isFinite(Date.parse(observed)) || !Number.isFinite(Date.parse(now)) || Date.parse(observed) > Date.parse(now) || !correction && Number(total) < (source.count_total ?? 0)) throw new Error('Review the cumulative count and an actual observation time no later than the confirmed campus clock.');
  return { count_total: Number(total), observed_at: observed, ...(correction && source.count_receipt_id ? { supersedes_receipt_id: source.count_receipt_id } : {}) };
}
export function diningOpeningOutsideHours(starts: string, ends: string, now: string, note: string) {
  if (![starts, ends, now].every(value => Number.isFinite(Date.parse(value)))) throw new Error('Confirm the selected campus clock before opening serving.');
  const outside = Date.parse(now) < Date.parse(starts) || Date.parse(now) >= Date.parse(ends);
  if (outside && note.trim().length < 3) throw new Error('Give a reason for opening outside the published hours.'); return outside;
}
