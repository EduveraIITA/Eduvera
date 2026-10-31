import type { NativePendingAction, NativePendingScope } from './native-pending-action';

export const campusInvitationRoles = ['staff', 'student', 'guardian', 'admin'] as const;
export type CampusInvitationRole = typeof campusInvitationRoles[number];
export const campusInvitationStatuses = ['Pending', 'Accepted', 'Expired', 'Revoked', 'All'] as const;
const deliveries = ['manual', 'queued', 'sending', 'email_accepted', 'failed', 'unknown', 'cancelled'];
const object = (v: unknown): Record<string, unknown> | null => !!v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
export const invitationUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const email = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const optionalId = (v: unknown) => v == null || invitationUuid(v);
export interface CampusInvitation {
  id: string; school_id: string; email: string; role: CampusInvitationRole | 'member'; expires_at: string;
  accepted_at: string | null; revoked_at: string | null; delivery: string | null; delivery_job_id: string | null;
  person_id: string | null; access_scope: string | null; work_source_kind: string | null;
  work_source_id: string | null; work_access_id: string | null; work_visit_access_id: string | null;
}
export interface InvitationPerson { id: string; name: string; email: string | null; reference: string }
export interface CampusInvitationWorkspace { invitations: CampusInvitation[]; staff: InvitationPerson[]; students: InvitationPerson[]; guardians: InvitationPerson[]; can_invite_admin: boolean }
export const campusInvitationsRoot = (school: string) => `/api/v1/schools/${encodeURIComponent(school)}/invitations/`;
export function parseCampusInvitation(value: unknown, school: string, expectedId?: string, detail = false): CampusInvitation {
  const row = object(value);
  if (!invitationUuid(school) || !row || !invitationUuid(row.id) || expectedId && row.id !== expectedId || (detail || row.school_id !== undefined) && row.school_id !== school || !email(row.email) || ![...campusInvitationRoles, 'member'].includes(String(row.role)) || !instant(row.expires_at) || row.accepted_at !== null && !instant(row.accepted_at) || row.revoked_at !== null && !instant(row.revoked_at) || row.delivery != null && !deliveries.includes(String(row.delivery)) || !optionalId(row.delivery_job_id) || !optionalId(row.person_id) || !optionalId(row.work_source_id) || !optionalId(row.work_access_id) || !optionalId(row.work_visit_access_id) || row.access_scope != null && (typeof row.access_scope !== 'string' || row.access_scope.length > 40) || row.work_source_kind != null && !['facility_repair', 'visit_arrangement'].includes(String(row.work_source_kind))) throw new Error('The exact campus invitation could not be verified.');
  return { id: row.id, school_id: school, email: row.email.toLowerCase(), role: row.role as CampusInvitation['role'], expires_at: row.expires_at, accepted_at: row.accepted_at as string | null, revoked_at: row.revoked_at as string | null, delivery: row.delivery as string ?? null, delivery_job_id: row.delivery_job_id as string ?? null, person_id: row.person_id as string ?? null, access_scope: row.access_scope as string ?? null, work_source_kind: row.work_source_kind as string ?? null, work_source_id: row.work_source_id as string ?? null, work_access_id: row.work_access_id as string ?? null, work_visit_access_id: row.work_visit_access_id as string ?? null };
}
export function parseCampusInvitationWorkspace(value: unknown, school: string): CampusInvitationWorkspace {
  const row = object(value); if (!row || typeof row.can_invite_admin !== 'boolean' || !Array.isArray(row.invitations)) throw new Error('Current invitation access could not be verified.');
  const people = (key: 'staff' | 'students' | 'guardians') => {
    if (!Array.isArray(row[key])) throw new Error('Current invitation recipients could not be verified.');
    const result = row[key].map(value => { const p = object(value); if (!p || !invitationUuid(p.id) || typeof p.name !== 'string' || p.name.length > 400 || p.email !== null && !email(p.email)) throw new Error('An invitation recipient is malformed.'); return { id: p.id, name: p.name, email: p.email as string | null, reference: String(p.staff_code ?? p.admission_number ?? '') }; });
    if (new Set(result.map(p => p.id)).size !== result.length) throw new Error('Duplicate invitation recipient identities were returned.'); return result;
  };
  const invitations = row.invitations.map(value => parseCampusInvitation(value, school));
  if (new Set(invitations.map(i => i.id)).size !== invitations.length) throw new Error('Duplicate invitation identities were returned.');
  return { invitations, staff: people('staff'), students: people('students'), guardians: people('guardians'), can_invite_admin: row.can_invite_admin };
}
export function campusInvitationBody(role: CampusInvitationRole, target: string, recipient: string, source: CampusInvitationWorkspace) {
  const address = recipient.trim().toLowerCase(); if (!campusInvitationRoles.includes(role) || !email(address) || role === 'admin' && !source.can_invite_admin) throw new Error('Choose a permitted account type and valid recipient email.');
  const choices = role === 'staff' ? source.staff : role === 'student' ? source.students : source.guardians;
  if ((role === 'staff' || role === 'student') && !target || target && (role === 'admin' || !choices.some(p => p.id === target))) throw new Error('Choose the exact current campus person before inviting access.');
  return { email: address, role, ...(role === 'staff' ? { person_id: target } : role === 'student' ? { student_id: target } : role === 'guardian' && target ? { guardian_id: target } : {}) };
}
export function campusInvitationStatus(row: CampusInvitation, now = Date.now()) { return row.accepted_at ? 'Accepted' : row.revoked_at ? 'Revoked' : Date.parse(row.expires_at) > now ? 'Pending' : 'Expired'; }
export const campusInvitationDeliveryPending = (value: unknown) => value === 'queued' || value === 'sending';
export function campusInvitationIdentity(row: CampusInvitation) { return JSON.stringify([row.school_id, row.id, row.email, row.role, row.person_id, row.access_scope, row.work_source_kind, row.work_source_id, row.work_access_id, row.work_visit_access_id]); }
/** Directory rows omit private target fields. Do not invent those fields before
 * the exact authority-checked detail read establishes the management source. */
export function campusInvitationListIdentity(row: CampusInvitation) { return JSON.stringify([row.school_id, row.id, row.email, row.role, row.expires_at, row.accepted_at, row.revoked_at, row.delivery_job_id]); }
export function campusInvitationSource(row: CampusInvitation) { return { kind: 'campus_invitation', sourceId: row.id, revision: 0, fingerprint: JSON.stringify(row) }; }
function mutation(record: NativePendingAction) {
  if (record.payload.kind !== 'json' || !record.source) throw new Error('The original invitation action is unavailable.');
  const body = object(JSON.parse(record.payload.body)); if (!body) throw new Error('The original invitation action is invalid.');
  const root = campusInvitationsRoot(record.scope.schoolId), create = record.source.kind === 'campus_invitation_creation';
  if (create) return { root, create, body, previous: null, action: 'create' };
  const previous = parseCampusInvitation(JSON.parse(record.source.fingerprint ?? ''), record.scope.schoolId, record.source.sourceId, true);
  return { root, create, body, previous, action: record.endpoint.endsWith('/revoke/') ? 'revoke' : 'resend' };
}
export function resolveCampusInvitationRefresh(value: unknown, record: NativePendingAction) {
  const { root, create, body, previous, action } = mutation(record), result = object(value);
  if (action === 'revoke') { if (result?.revoked !== true) throw new Error('Invitation revocation was not acknowledged. Inspect the current invitation.'); return `${root}${previous!.id}/`; }
  if (!result || !invitationUuid(result.id) || !email(result.email) || result.email.toLowerCase() !== (create ? body.email : previous!.email) || !instant(result.expires_at) || previous && result.id !== previous.id) throw new Error('The exact invitation acknowledgement is unavailable. Its original request remains retained.');
  return `${root}${result.id}/`;
}
export function acceptedCampusInvitation(value: unknown, record: NativePendingAction) {
  const { root, create, body, previous, action } = mutation(record), id = record.refreshPath.slice(root.length).replace(/\/$/, '');
  const current = parseCampusInvitation(value, record.scope.schoolId, id, true);
  if (create ? current.email !== body.email || current.role !== body.role || body.person_id !== undefined && current.person_id !== body.person_id : campusInvitationIdentity(current) !== campusInvitationIdentity(previous!)) throw new Error('The saved invitation does not match the originally reviewed recipient and access source.');
  if (action === 'revoke' && !current.revoked_at) throw new Error('The acknowledged invitation revocation is not visible yet. Refresh this exact invitation.');
  // The legacy detail wire does not return student_id/guardian_id. Those targets
  // are checked against the fresh owning workspace before sending, not inferred
  // from a matching name or an email after the command.
  return current;
}
/** Narrow legacy invitation subtype. No token, command key or replay is allowed. */
export function campusInvitationActionAllowed(record: NativePendingAction, scope: NativePendingScope) {
  try {
    if (scope.mode !== 'live' || record.domain !== 'people' || record.replayPolicy !== 'inspect_only' || record.method !== 'POST' || record.scope.schoolId !== scope.schoolId || record.source?.revision !== 0 || !['campus_invitation_creation', 'campus_invitation'].includes(record.source.kind) || !invitationUuid(scope.schoolId)) return false;
    const owner = new URL(record.ownerHref, 'https://thatcampus.invalid'); if (owner.pathname !== '/more/setup/people/invitations' || owner.searchParams.getAll('school').length > 1 || owner.searchParams.has('school') && owner.searchParams.get('school') !== scope.schoolId) return false;
    const { root, create, body, previous } = mutation(record);
    if (create) {
      if (record.endpoint !== root || record.source.sourceId !== scope.schoolId || JSON.stringify(body) !== record.source.fingerprint || !campusInvitationRoles.includes(body.role as CampusInvitationRole) || !email(body.email) || body.email !== body.email.toLowerCase()) return false;
      const target = body.role === 'staff' ? 'person_id' : body.role === 'student' ? 'student_id' : body.role === 'guardian' ? 'guardian_id' : null;
      if (Object.keys(body).some(key => !['role', 'email', ...(target ? [target] : [])].includes(key)) || (body.role === 'staff' || body.role === 'student') && !invitationUuid(body[target!]) || target && body[target] !== undefined && !invitationUuid(body[target])) return false;
    } else if (!previous || JSON.stringify(previous) !== record.source.fingerprint || Object.keys(body).length || record.source.sourceId !== previous.id || ![`${root}${previous.id}/resend/`, `${root}${previous.id}/revoke/`].includes(record.endpoint)) return false;
    const savedId = record.refreshPath.startsWith(root) && record.refreshPath.endsWith('/') ? record.refreshPath.slice(root.length, -1) : null;
    return record.phase === 'accepted' ? invitationUuid(savedId) && (create || savedId === previous!.id) : record.refreshPath === (create ? `${root}workspace/` : `${root}${previous!.id}/`);
  } catch { return false; }
}
