import type { PublishedPolicy } from '../../../packages/contracts/src/wire/features/governance/api';

export interface PolicyAttentionProof { notificationId: string; openedTarget: string; cleanHref: string; key: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Opening a different publication or a changed revision cannot clear attention. */
export function policyAttentionProof(href: string, policies: readonly PublishedPolicy[]): PolicyAttentionProof | null {
  const [target, hash = ''] = href.split('#'), [path, search = ''] = target!.split('?');
  if (path !== '/more/policies') return null;
  const query = new URLSearchParams(search);
  if (['policy', 'policy_revision', 'attention_notification_id'].some(key => query.getAll(key).length !== 1)) return null;
  const id = query.get('policy')!, revision = query.get('policy_revision')!, notificationId = query.get('attention_notification_id')!;
  if (!uuid.test(id) || !uuid.test(notificationId) || !/^[1-9][0-9]*$/.test(revision) || !Number.isSafeInteger(Number(revision)) || !policies.some(policy => policy.id === id && policy.revision === Number(revision))) return null;
  query.delete('attention_notification_id');
  return { notificationId, openedTarget: target!, cleanHref: `${path}?${query}${hash ? `#${hash}` : ''}`, key: JSON.stringify([target, id, Number(revision)]) };
}

export function policyAcknowledgementMatches(value: unknown, policy: Pick<PublishedPolicy, 'id'>, actorId: string, schoolId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && uuid.test(record.id) && record.policy_version_id === policy.id && record.user_id === actorId && record.school_id === schoolId && typeof record.acknowledged_at === 'string' && Number.isFinite(Date.parse(record.acknowledged_at));
}
