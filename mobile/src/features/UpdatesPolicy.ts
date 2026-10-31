import type { NoticeDetail, NoticeRecipient } from '../../../packages/contracts/src/wire/features/notices/api';

export type UpdateCommandKind = 'create' | 'save' | 'publish' | 'cancel' | 'assisted' | 'delivery';
export interface UpdateCommandResult { id: string; revision?: number; status?: string; recipient_count?: number; recipient_id?: string; recipient_revision?: number; response_value?: string | null; delivery_attempt_id?: string }
export interface UpdateCommand { path: string; method: 'POST' | 'PATCH'; kind: UpdateCommandKind; body: Record<string, unknown>; accepted?: UpdateCommandResult }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: unknown, minimum = 1): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
export function updateCommandAllowed(command: UpdateCommand, id: string | undefined, schoolId: string | null) {
  if (!command || !command.body || !uuid(command.body.idempotency_key)) return false;
  if (!id) return command.kind === 'create' && command.method === 'POST' && command.path === '/api/v1/notices' && command.body.school_id === schoolId;
  const root = `/api/v1/notices/${encodeURIComponent(id)}`;
  if (command.kind === 'save') return command.method === 'PATCH' && command.path === root && revision(command.body.expected_revision);
  const suffix = { publish: 'publish', cancel: 'cancel', assisted: 'assisted-responses', delivery: 'deliveries' }[command.kind as Exclude<UpdateCommandKind, 'create' | 'save'>];
  return !!suffix && command.method === 'POST' && command.path === `${root}/${suffix}`
    && (command.kind === 'delivery' ? uuid(command.body.recipient_id) : revision(command.body.expected_revision))
    && (command.kind !== 'assisted' || uuid(command.body.recipient_id));
}
export function updateReceiptMatches(command: UpdateCommand, value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const result = value as UpdateCommandResult, id = command.kind === 'create' ? null : command.path.split('/')[4];
  if (!uuid(result.id) || id && result.id !== id) return false;
  if (command.kind === 'delivery') return result.recipient_id === command.body.recipient_id && uuid(result.delivery_attempt_id) && result.status === command.body.status;
  if (command.kind === 'assisted') return result.recipient_id === command.body.recipient_id && revision(result.recipient_revision)
    && result.recipient_revision > Number(command.body.expected_revision)
    && (command.body.response_value === undefined ? result.response_value === 'acknowledged' : result.response_value === command.body.response_value);
  return revision(result.revision) && result.revision > Number(command.body.expected_revision ?? 0)
    && result.status === (command.kind === 'publish' ? 'published' : command.kind === 'cancel' ? 'cancelled' : 'draft');
}
export function updateRecipientNeedsFollowUp(notice: Pick<NoticeDetail, 'response_mode'>, recipient: NoticeRecipient) {
  return recipient.deliveries[0]?.status === 'failed' || !recipient.responded_at && notice.response_mode !== 'information';
}
export function updateRecipientScore(notice: Pick<NoticeDetail, 'response_mode' | 'due_at'>, recipient: NoticeRecipient, now: number) {
  if (recipient.deliveries[0]?.status === 'failed') return 0;
  if (!recipient.responded_at && notice.response_mode !== 'information') return notice.due_at && Date.parse(notice.due_at) < now ? 1 : 2;
  return recipient.opened_at ? 4 : 3;
}
export function updateObservedAt(value: string, notice: Pick<NoticeDetail, 'published_at'>, now: number) {
  const instant = Date.parse(value), published = notice.published_at ? Date.parse(notice.published_at) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(instant) || !Number.isFinite(published) || instant < published || instant > now) throw new Error('Choose the actual observation time, after publication and no later than the selected campus clock.');
  return new Date(instant).toISOString();
}
