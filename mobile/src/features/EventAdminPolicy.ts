export type EventAdminKind = 'discard' | 'grant' | 'revoke' | 'rules';
export interface EventAdminIntent { version: 1; scope: string; schoolId: string; kind: EventAdminKind; targetId: string; studentId?: string; authorityId?: string; ownerHref: string; body: Record<string, unknown>; accepted?: unknown }
export interface EventRules { category: 'events'; workflow: { revision: number; event_entry_hours_before: number; event_staff_hours_after: number }; domain: { revision: number; observation_hours_before: number; observation_hours_after: number } }
export const eventAdminUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const day = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length >= 3 && value.length <= max;
export function eventAdminPath(intent: Pick<EventAdminIntent, 'schoolId' | 'kind' | 'targetId'>) {
  return intent.kind === 'rules' ? `/api/v1/operating-rules/${encodeURIComponent(intent.schoolId)}/categories/events` : intent.kind === 'discard' ? `/api/v1/campus-events/${encodeURIComponent(intent.targetId)}/discard` : `/api/v1/campus-events/consent-authorities/${encodeURIComponent(intent.targetId)}/${intent.kind}`;
}
export function eventAdminIntentValid(value: unknown, scope: string, schoolId: string): value is EventAdminIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as EventAdminIntent, body = intent.body;
  if (intent.version !== 1 || intent.scope !== scope || intent.schoolId !== schoolId || !eventAdminUuid(schoolId) || !eventAdminUuid(intent.targetId) || !body || typeof body !== 'object' || !['discard', 'grant', 'revoke', 'rules'].includes(intent.kind) || !/^\/areas\/events(?:\/|\?)/.test(intent.ownerHref) || intent.ownerHref.includes('..') || intent.ownerHref.includes('\\')) return false;
  if (intent.kind === 'rules') return intent.targetId === schoolId && revision(body.expected_workflow_revision) && revision(body.expected_domain_revision) && eventRuleFields.every(([key, , maximum]) => Number.isSafeInteger(body[key]) && Number(body[key]) >= 0 && Number(body[key]) <= maximum) && Object.keys(body).length === 6;
  if (body.school_id !== schoolId || !eventAdminUuid(body.idempotency_key) || !revision(body.expected_revision)) return false;
  if (intent.kind === 'discard') return Number(body.expected_revision) > 0 && Object.keys(body).length === 3;
  if (!eventAdminUuid(intent.studentId)) return false;
  return intent.kind === 'revoke' ? eventAdminUuid(intent.authorityId) && Number(body.expected_revision) > 0 && text(body.reason, 500) && Object.keys(body).length === 4 : day(body.valid_from) && (body.valid_until === null || day(body.valid_until) && body.valid_until >= body.valid_from) && text(body.provenance, 500) && body.verified === true && Object.keys(body).length === 7;
}
export const eventRuleFields = [['event_entry_hours_before', 'Open register before session (hours)', 168], ['event_staff_hours_after', 'Staff access after session (hours)', 720], ['observation_hours_before', 'Observation before session (hours)', 168], ['observation_hours_after', 'Observation after session (hours)', 168]] as const;
export function eventRulesValid(value: unknown): value is EventRules {
  const rules = value as EventRules | null;
  return !!rules && rules.category === 'events' && revision(rules.workflow?.revision) && revision(rules.domain?.revision) && eventRuleFields.every(([key, , maximum]) => { const number = key.startsWith('event_') ? rules.workflow[key as 'event_entry_hours_before'] : rules.domain[key as 'observation_hours_before']; return Number.isSafeInteger(number) && number >= 0 && number <= maximum; });
}
export function eventAdminReceiptMatches(intent: EventAdminIntent, value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (intent.kind === 'discard') return result.id === intent.targetId && result.discarded === true;
  if (intent.kind === 'rules') return eventRulesValid(value) && value.workflow.revision === Number(intent.body.expected_workflow_revision) + 1 && value.domain.revision === Number(intent.body.expected_domain_revision) + 1 && eventRuleFields.every(([key]) => (key.startsWith('event_') ? value.workflow[key as 'event_entry_hours_before'] : value.domain[key as 'observation_hours_before']) === intent.body[key]);
  return eventAdminUuid(result.id) && result.relationship_id === intent.targetId && result.student_id === intent.studentId && result.revision === Number(intent.body.expected_revision) + 1 && result.status === (intent.kind === 'grant' ? 'active' : 'revoked') && (intent.kind === 'revoke' ? result.id === intent.authorityId : result.valid_from === intent.body.valid_from && result.valid_until === intent.body.valid_until && result.provenance === intent.body.provenance);
}

export function exactEventAttention(event: Pick<import('../lib/event-policy').NativeEvent, 'revision' | 'status'>, href: string, studentId: string | null, finance?: import('../lib/event-policy').EventFinance) {
  const query = new URLSearchParams(href.split('?')[1] ?? ''), withdrawal = query.get('withdrawal_id'), refund = query.get('refund_id');
  if (!eventAdminUuid(query.get('attention_notification_id'))) return false;
  if ((!studentId || query.get('scope') === 'dependent') && query.get('focus') === 'status' && event.status === 'cancelled' && event.revision === Number(query.get('event_revision'))) return true;
  return !!studentId && query.get('scope') === 'dependent' && !!finance?.items.some(item => item.student_id === studentId && (eventAdminUuid(withdrawal) && item.withdrawal_id === withdrawal || eventAdminUuid(refund) && item.refunds.some(value => value.id === refund)));
}
