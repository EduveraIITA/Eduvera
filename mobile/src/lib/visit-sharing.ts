import type { ArrangedVisit, VisitOptions, VisitPerson } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import type { VisitSharing } from '../../../packages/contracts/src/wire/features/gate/visitSharingApi';
import type { GateCommandInput } from './gate-command';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function readVisitSharing(value: unknown): VisitSharing {
  const data = row(value), current = data.current;
  if (!Number.isSafeInteger(data.visit_revision) || Number(data.visit_revision) < 1 || !Number.isSafeInteger(data.share_revision) || Number(data.share_revision) < 0 || typeof data.can_share !== 'boolean' || typeof data.can_open_shared !== 'boolean') throw new Error('Current visit sharing could not be verified.');
  if (current !== null) {
    const share = row(current), person = row(share.organiser), owner = row(share.owner), invite = row(share.invitation);
    if (!uuid(share.id) || !uuid(share.root_id) || share.revision !== data.share_revision || !uuid(person.id) || typeof person.label !== 'string' || !Number.isSafeInteger(person.revision) || Number(person.revision) < 1 || typeof person.has_app_access !== 'boolean'
      || !uuid(owner.id) || typeof owner.label !== 'string' || typeof owner.available !== 'boolean' || !instant(share.starts_at) || !instant(share.ends_at) || typeof share.directions !== 'string' || share.directions.length > 1000
      || !['active', 'expired', 'revoked', 'party_changed'].includes(String(share.state)) || ['can_renew', 'can_revoke', 'can_takeover'].some(key => typeof share[key] !== 'boolean')
      || share.invitation !== null && (!uuid(invite.id) || typeof invite.email !== 'string' || !instant(invite.expires_at))) throw new Error('The current sharing recipient and access could not be verified.');
  } else if (data.share_revision !== 0 || data.can_open_shared) throw new Error('Current visit sharing has inconsistent access.');
  return value as VisitSharing;
}
export function assertVisitSharingSource(reviewed: VisitSharing, current: VisitSharing, visit: ArrangedVisit) {
  if (!current.can_share || current.visit_revision !== visit.revision || current.visit_revision !== reviewed.visit_revision || current.share_revision !== reviewed.share_revision || current.current?.id !== reviewed.current?.id || current.current?.root_id !== reviewed.current?.root_id) throw new Error('This visit or sharing changed. Your entries are kept; review its current details.');
}
export function visitShareCommand(root: string, visit: ArrangedVisit, source: VisitSharing, person: VisitPerson, options: VisitOptions, endsAt: string, directions: string, key: string, now: string): GateCommandInput {
  if (!source.can_share || source.visit_revision !== visit.revision || source.current && !source.current.can_renew || !uuid(key) || !instant(endsAt) || !instant(now) || Date.parse(endsAt) <= Date.parse(now) || directions.trim().length > 1000) throw new Error('Choose current sharing access, a future end time and directions of at most 1,000 characters.');
  const selected = options.people.find(candidate => candidate.id === person.id);
  if (!selected || selected.revision !== person.revision || typeof selected.has_app_access !== 'boolean') throw new Error('Select the organiser’s current campus identity again.');
  const same = source.current?.organiser.id === selected.id && source.current.state !== 'party_changed';
  return { path: `${root}/${visit.id}/shares/`, commandId: key, visitId: visit.id, label: 'Visit sharing confirmed.', shareMutation: { previousShareId: source.current?.id ?? null, shareRootId: same ? source.current!.root_id : key, action: same ? 'renewed' : 'shared' }, body: JSON.stringify({ command_id: key, expected_revision: source.share_revision, expected_visit_revision: source.visit_revision, organiser_person_id: selected.id, organiser_person_revision: selected.revision, ends_at: endsAt, directions: directions.trim() }) };
}
export function visitShareAction(root: string, visitId: string, source: VisitSharing, action: 'revoke' | 'takeover', key: string): GateCommandInput {
  const current = source.current;
  if (!source.can_share || !current || !uuid(key) || !(action === 'revoke' ? current.can_revoke : current.can_takeover)) throw new Error('This sharing action is no longer available. Review current access.');
  return { path: `${root}/${visitId}/shares/${current.id}/${action}/`, commandId: key, visitId, label: action === 'revoke' ? 'Visit sharing stopped.' : 'Question ownership confirmed.', shareMutation: { previousShareId: current.id, shareRootId: current.root_id, action: action === 'revoke' ? 'revoked' : 'taken_over' }, body: JSON.stringify({ command_id: key, expected_revision: source.share_revision }) };
}
