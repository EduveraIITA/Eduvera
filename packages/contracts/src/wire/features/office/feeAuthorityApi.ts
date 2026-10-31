/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface FeeAuthorityExpected {
  mandate_revision: number;
  office_revision: number;
  appointment_revision: number;
  rule_revision: number;
  source_revisions: { id: string; revision: number }[];
}

export interface FeeAuthorityCandidate {
  mandate_id: string;
  title: string;
  office_title: string;
  holder_name: string;
  max_amount_paise: number | null;
  can_confirm: true;
  expected: FeeAuthorityExpected;
  sources: { id: string; revision: number; title: string; reference: string; provision: string;
    verification_state: string; effective_from: string; effective_until: string | null }[];
}

export interface FeeAuthorityWorkspace {
  school_id: string;
  route: { state: "ready" | "missing" | "unavailable"; reason: string | null; rule_id: string | null;
    revision: number; reviewer: { user_id: string; person_id: string; name: string; office_title: string } | null };
  candidates: FeeAuthorityCandidate[];
  other_holders: { name: string; office_title: string }[];
  reasons: string[];
  confirmation?: { state: "not_found" | "pending" | "accepted" | "not_accepted"; adoption_id?: string; rule_id?: string; revision?: number };
}
