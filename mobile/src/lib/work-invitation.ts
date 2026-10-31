export interface WorkInvitationContext { kind: 'facility_repair' | 'visit_arrangement'; source_id: string; access_id: string }
export interface WorkInvitation { id: string; person_id: string; school_id: string; email: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; delivery: string | null }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validContext = (context: WorkInvitationContext) => ['facility_repair', 'visit_arrangement'].includes(context.kind) && uuid(context.source_id) && uuid(context.access_id);
export function workInvitationBody(mode: 'live' | 'simulation', context: WorkInvitationContext, personId: string, email: string) {
  const address = email.trim().toLowerCase();
  if (mode !== 'live' || !validContext(context) || !uuid(personId) || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Choose the exact current work recipient and a valid Live invitation email.');
  return { email: address, role: 'member' as const, person_id: personId, work_context: { ...context } };
}
/** Retain only delivery metadata. A one-time returned token never enters state. */
export function parseWorkInvitation(value: unknown, schoolId: string, personId: string, context: WorkInvitationContext, expectedId?: string): WorkInvitation {
  const row = value as Record<string, unknown> | null;
  if (!row || Array.isArray(row) || !validContext(context) || !uuid(row.id) || expectedId && row.id !== expectedId || row.school_id !== schoolId || row.person_id !== personId || row.role !== 'member' || row.access_scope !== 'assigned_work' || row.work_source_kind !== context.kind || row.work_source_id !== context.source_id || (context.kind === 'facility_repair' ? row.work_access_id : row.work_visit_access_id) !== context.access_id || typeof row.email !== 'string' || row.email.length > 254 || !instant(row.expires_at) || row.accepted_at !== null && !instant(row.accepted_at) || row.revoked_at !== null && !instant(row.revoked_at) || row.delivery !== null && !['manual', 'queued', 'sending', 'email_accepted', 'failed', 'unknown', 'cancelled'].includes(String(row.delivery))) throw new Error('This invitation does not match the exact current campus, person and shared work.');
  return { id: row.id, school_id: schoolId, person_id: personId, email: row.email, expires_at: row.expires_at, accepted_at: row.accepted_at as string | null, revoked_at: row.revoked_at as string | null, delivery: row.delivery as string | null };
}
export function workInvitationResultId(value: unknown) { const id = value && typeof value === 'object' ? (value as { id?: unknown }).id : undefined; if (!uuid(id)) throw new Error('The exact saved invitation could not be identified. Its original request was kept.'); return id; }
export function workInvitationStatus(invitation: WorkInvitation, now = Date.now()) { return invitation.accepted_at ? 'Accepted' : invitation.revoked_at ? 'Revoked' : Date.parse(invitation.expires_at) > now ? 'Pending' : 'Expired'; }
export function workInvitationDelivery(value: WorkInvitation['delivery']) { return value === 'queued' || value === 'sending' ? 'Invitation email is being sent.' : value === 'email_accepted' ? 'The email provider accepted the email. Recipient and job acceptance remain separate.' : value === 'failed' ? 'Invitation email failed. Review its address before resending.' : value === 'unknown' ? 'Email delivery is unconfirmed. Check current status and the recipient’s inbox before resending.' : value === 'cancelled' ? 'Invitation email was cancelled.' : 'Email delivery is not confirmed. The invitation still requires recipient acceptance.'; }

export function workInvitationDeliveryAck(value: unknown, expectedEmail: string) {
  const row = value as Record<string, unknown> | null;
  if (!row || Array.isArray(row) || row.email !== expectedEmail || !instant(row.expires_at) || row.delivery !== undefined && !['manual', 'queued', 'sending', 'email_accepted', 'failed', 'unknown', 'cancelled'].includes(String(row.delivery))) throw new Error('This invitation email update is not confirmed. Inspect the current exact invitation.');
  return true;
}
