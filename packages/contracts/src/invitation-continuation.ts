const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type InvitationContinuation = { invitation_id: string; school_id: string; source_id: string; href: string } & ({ kind: "facility_repair"; label: "Open repair" } | { kind: "visit_arrangement"; label: "Open visit" });
export function validateInvitationContinuation(value: unknown, schoolId: string, invitationId?: string): InvitationContinuation {
  const item = value as Partial<InvitationContinuation> | null;
  const destination = item?.kind === "facility_repair" ? { href: `/areas/facilities?repair_id=${item.source_id}`, label: "Open repair" } : item?.kind === "visit_arrangement" ? { href: `/areas/in-out/visits?visit=${item.source_id}&shared=1`, label: "Open visit" } : null;
  if (!item || !destination || item.school_id !== schoolId || !uuid.test(item.school_id)
    || typeof item.invitation_id !== "string" || !uuid.test(item.invitation_id) || invitationId && item.invitation_id !== invitationId
    || typeof item.source_id !== "string" || !uuid.test(item.source_id) || item.href !== destination.href || item.label !== destination.label)
    throw new Error("This invitation’s destination could not be verified. Ask your campus contact to check the current sharing.");
  return item as InvitationContinuation;
}
export const invitationContinuationPath = (schoolId: string, invitationId?: string) => `/join?campus=${encodeURIComponent(schoolId)}${invitationId ? `&invitation=${encodeURIComponent(invitationId)}` : ""}`;
