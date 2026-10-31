import { apiFetch } from "../../lib/api";
import { validateInvitationContinuation } from "../../../../packages/contracts/src/invitation-continuation";
export { invitationContinuationPath, validateInvitationContinuation, type InvitationContinuation } from "../../../../packages/contracts/src/invitation-continuation";

export async function getInvitationContinuation(schoolId: string, invitationId: string) {
  const result = await apiFetch<unknown>(`/api/v1/schools/${encodeURIComponent(schoolId)}/invitations/${encodeURIComponent(invitationId)}/continuation/`);
  return validateInvitationContinuation(result, schoolId, invitationId);
}
