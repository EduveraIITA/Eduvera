/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface InvigilationInvitationSetup {
  school_id: string;
  policy: {
    state: "unconfigured" | "enabled" | "disabled";
    revision: number;
    enabled: boolean;
    recipient_person_ids: string[];
    response_due_minutes: number | null;
    expires_after_minutes: number | null;
    approved_at: string | null;
    approved_by: { id: string; name: string } | null;
    approval_note: string | null;
  };
  eligible_recipients: Array<{ person_id: string; user_id: string; name: string; designation: string | null }>;
  readiness: { can_create_invitations: boolean; missing_recipient_count: number };
  capabilities: { can_approve: boolean };
}
