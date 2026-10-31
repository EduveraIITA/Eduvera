import { iconForDestination } from '../ui/icon-semantics';
import type { Member } from '../../../packages/contracts/src/institution';
import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
import { invitationUuid } from './campus-invitations';
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const peopleAccessRead = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/administration/`;
export const peopleAccessEndpoint = (schoolId: string, id: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/members/${encodeURIComponent(id)}/`;
export function parseCampusMember(value: unknown): Member {
  const row = object(value);
  if (!row || !invitationUuid(row.id) || !invitationUuid(row.user_id) || typeof row.is_active !== 'boolean' || !['admin', 'staff', 'student', 'guardian', 'member'].includes(String(row.role)) || typeof row.first_name !== 'string' || typeof row.last_name !== 'string' || typeof row.email !== 'string' || row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error('The current campus membership could not be verified.');
  return { id: row.id, user_id: row.user_id, first_name: row.first_name, last_name: row.last_name, email: row.email, role: row.role as string, is_active: row.is_active };
}
export function parsePeopleAccess(value: unknown, schoolId: string) {
  const data = object(value), school = object(data?.school); if (school?.id !== schoolId || typeof school.name !== 'string' || !Array.isArray(data?.members)) throw new Error('Membership records belong to another campus or could not be confirmed.');
  const members = data.members.map(parseCampusMember); if (new Set(members.map(member => member.id)).size !== members.length) throw new Error('Duplicate campus membership identities were returned.');
  return { name: school.name, members };
}
export function campusMemberIdentity(member: Member) { return JSON.stringify([member.id, member.user_id, member.email, member.role]); }
export function campusMembershipInput(member: Member, active: boolean, all: Member[]) {
  const current = all.find(row => row.id === member.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(member) || !['admin', 'staff'].includes(current.role) || typeof active !== 'boolean' || active === current.is_active) throw new Error('Review this current administrator or staff membership before changing it.');
  if (!active && current.role === 'admin' && all.filter(row => row.role === 'admin' && row.is_active).length <= 1) throw new Error('The campus must retain an active administrator.');
  return { is_active: active };
}
export function campusMembershipSource(member: Member) { return { kind: 'campus_membership', sourceId: member.id, revision: 0, fingerprint: JSON.stringify(parseCampusMember(member)) }; }
export function campusMembershipActionAllowed(record: NativePendingAction, scope: NativePendingScope) {
  try {
    if (!invitationUuid(scope.schoolId) || record.domain !== 'people' || record.scope.schoolId !== scope.schoolId || record.method !== 'PATCH' || record.replayPolicy !== 'inspect_only' || record.source?.kind !== 'campus_membership' || record.source.revision !== 0 || record.payload.kind !== 'json') return false;
    const basis = parseCampusMember(JSON.parse(record.source.fingerprint ?? '')), body = object(JSON.parse(record.payload.body)), owner = new URL(record.ownerHref, 'https://thatcampus.invalid');
    return ['admin', 'staff'].includes(basis.role) && JSON.stringify(basis) === record.source.fingerprint && record.source.sourceId === basis.id && record.endpoint === peopleAccessEndpoint(scope.schoolId, basis.id) && record.refreshPath === peopleAccessRead(scope.schoolId) && owner.pathname === '/more/setup/people/access' && owner.searchParams.getAll('school').length <= 1 && (!owner.searchParams.has('school') || owner.searchParams.get('school') === scope.schoolId) && !!body && Object.keys(body).length === 1 && typeof body.is_active === 'boolean' && body.is_active !== basis.is_active;
  } catch { return false; }
}
export function resolveCampusMembershipRefresh(value: unknown, action: NativePendingAction) {
  if (!campusMembershipActionAllowed(action, action.scope)) throw new Error('This retained membership action belongs to another source.');
  const result = object(value); if (result?.id !== action.source!.sourceId || result.updated !== true) throw new Error('The exact membership update was not acknowledged. Inspect current access before another change.');
  return peopleAccessRead(action.scope.schoolId);
}
export function acceptedCampusMembership(value: unknown, action: NativePendingAction) {
  if (!campusMembershipActionAllowed(action, action.scope) || action.payload.kind !== 'json') throw new Error('The original membership action is unavailable.');
  const data = parsePeopleAccess(value, action.scope.schoolId), basis = parseCampusMember(JSON.parse(action.source!.fingerprint!)), current = data.members.find(member => member.id === basis.id), body = JSON.parse(action.payload.body) as { is_active: boolean };
  if (!current || campusMemberIdentity(current) !== campusMemberIdentity(basis) || current.is_active !== body.is_active) throw new Error('The acknowledged membership change could not be confirmed in its exact campus record.');
  return current;
}
export function peopleSetupDestinations(manifest: WorkspaceManifest) {
  const setup = manifest.more.setup, records = manifest.areas.find(area => area.key === 'people')?.surfaces.find(surface => surface.key === 'records');
  if (!setup.some(item => ['people', 'responsibilities', 'invitations'].includes(item.key))) return null;
  const rows = [];
  if (records) rows.push({ key: 'records', label: records.label, href: records.href, detail: 'Add and maintain campus people and their connected records', icon: iconForDestination(records.href, 'people') });
  for (const [key, detail] of [['responsibilities', 'Assign work, scope, dates, cover and fallback'], ['people', 'Manage membership separately from operational responsibility'], ['invitations', 'Give an existing campus person login access and review delivery history']]) {
    const item = setup.find(row => row.key === key); if (item) rows.push({ key: item.key, label: item.label, href: key === 'people' ? '/more/setup/people/access' : item.href, detail, icon: iconForDestination(key === 'people' ? '/more/setup/people/access' : item.href, key === 'invitations' ? 'invitations' : key === 'responsibilities' ? 'responsibilities' : 'security') });
  }
  return rows;
}
