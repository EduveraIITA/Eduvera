import { invitationContinuationPath, validateInvitationContinuation } from '../../../packages/contracts/src/invitation-continuation';
export { invitationContinuationPath, validateInvitationContinuation };
export const invitationUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const invitationToken = /^(?:[0-9]{6}|[A-Za-z0-9_-]{40,100})$/;
export interface InvitationProof { invitation_id?: string; campus: { id: string; name: string }; verification_required: boolean; delivery: 'email_accepted' | 'cooldown' | 'unavailable' | 'not_required' | 'failed'; retry_after_seconds?: number }
export interface AcceptedInvitation { school_id: string; role: string; accepted_user_id: string; continuation?: import('../../../packages/contracts/src/invitation-continuation').InvitationContinuation | null }
export function invitationFromFragment(fragment: string | undefined) {
  const query = new URLSearchParams(fragment?.replace(/^#/, '') ?? ''), email = query.get('email') ?? '', token = query.get('token') ?? '';
  return invitationToken.test(token) && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, token } : { email: '', token: '' };
}
export function checkedInvitationProof(value: unknown): InvitationProof {
  const proof = value as InvitationProof | undefined;
  if (!proof || !invitationUuid.test(proof.campus?.id ?? '') || !proof.campus.name?.trim() || typeof proof.verification_required !== 'boolean' || !['email_accepted','cooldown','unavailable','not_required','failed'].includes(proof.delivery)
    || proof.invitation_id !== undefined && !invitationUuid.test(proof.invitation_id)
    || proof.retry_after_seconds !== undefined && (!Number.isSafeInteger(proof.retry_after_seconds) || proof.retry_after_seconds < 0 || proof.retry_after_seconds > 86400)) throw new Error('The invitation details could not be confirmed. Open the original invitation again.');
  return proof;
}
export function checkedAcceptedInvitation(value: unknown, proof: InvitationProof): AcceptedInvitation {
  const accepted = value as AcceptedInvitation | undefined;
  if (!accepted || accepted.school_id !== proof.campus.id || !invitationUuid.test(accepted.accepted_user_id ?? '') || !['member','admin','principal','staff','teacher','student','parent','guardian'].includes(accepted.role)) throw new Error('The joining result could not be confirmed. Check the result before repeating it.');
  if (accepted.continuation) validateInvitationContinuation(accepted.continuation, proof.campus.id, proof.invitation_id);
  return accepted;
}
