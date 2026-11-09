import { invitationContinuationPath, validateInvitationContinuation } from '../../../packages/contracts/src/invitation-continuation';
export { invitationContinuationPath, validateInvitationContinuation };
export const invitationUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const invitationToken = /^(?:[0-9]{6}|[A-Za-z0-9_-]{40,100})$/;
export interface InvitationProof { invitation_id?: string; campus: { id: string; name: string }; verification_required: boolean; delivery: 'email_accepted' | 'cooldown' | 'unavailable' | 'not_required' | 'failed'; retry_after_seconds?: number }
export interface AcceptedInvitation { school_id: string; role: string; accepted_user_id: string; continuation?: import('../../../packages/contracts/src/invitation-continuation').InvitationContinuation | null }
export function invitationFromFragment(fragment: string | undefined) {
  // Expo may decode an encoded plus before passing native route parameters.
  const query = new URLSearchParams(fragment?.replace(/^#/, '').replace(/\+/g, '%2B') ?? '');
  const [email = '', ...otherEmails] = query.getAll('email');
  const [token = '', ...otherTokens] = query.getAll('token');
  if (otherEmails.length || otherTokens.length || [...query.keys()].some(key => key !== 'email' && key !== 'token')) return { email: '', token: '' };
  return invitationToken.test(token) && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, token } : { email: '', token: '' };
}

export function scrubBrowserInvitation(browser: Pick<Window, 'location' | 'history'>, fragment: string, route: { campus?: string; invitation?: string }) {
  if (browser.location.pathname !== '/join' || browser.location.hash !== fragment) return;
  const query = new URLSearchParams(fragment.slice(1));
  const proofs = [fragment, ...query.getAll('token'), ...query.getAll('email')];
  let state: unknown = browser.history.state;
  try {
    const serialized = JSON.stringify(state);
    if (proofs.some(value => value && [value, encodeURIComponent(value)].some(proof => serialized?.includes(JSON.stringify(proof).slice(1, -1))))) state = null;
  } catch { state = null; }
  const search = new URLSearchParams(route).toString();
  browser.history.replaceState(state, '', search ? `/join?${search}` : '/join');
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
