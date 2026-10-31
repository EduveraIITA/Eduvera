/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface CampusPersonInvitation { id: string; expires_at: string; state: "pending" | "expired" }

export interface CampusParticipant {
  id: string; label: string; affiliations: string[]; has_account: boolean;
  account_state?: "active" | "inactive" | "not_linked"; is_you?: boolean;
  pending_invitation?: CampusPersonInvitation;
}

export interface ParticipantPage {
  results: CampusParticipant[]; page: number; page_size: number; total: number;
  capabilities?: { can_invite: boolean; can_manage_enrollment?: boolean };
}

export interface PersonSourceProfile { kind: "learning" | "work" | "guardian"; id: string; label: string; href: string }

export interface PersonCapabilities { can_correct_name?: boolean; can_edit_profile?: boolean; can_manage_connections?: boolean; can_manage_groups?: boolean; can_invite?: boolean; can_enroll?: boolean; can_add_work_profile?: boolean; can_link_guardian?: boolean }

export interface ParticipantDetail extends Partial<CampusParticipant> {
  id: string; label: string; first_name: string; last_name: string; revision: number;
  affiliation_sources: Array<{ affiliation: string; source: string }>;
  profile?: { contact_email: string; contact_phone: string };
  source_profiles?: PersonSourceProfile[]; capabilities?: PersonCapabilities;
}
