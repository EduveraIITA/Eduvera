import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { InstitutionMembershipRole } from "../common/request.js";

export const GOVERNANCE_DECISION_AUTHORITY_PORT = Symbol("GOVERNANCE_DECISION_AUTHORITY_PORT");

export type GovernanceDecisionMatter = "staff_leave_decision" | "transport_duty_change_decision" | "fee_instalment_decision";
export type GovernanceDecisionMode = "individual" | "delegated";

export interface GovernanceAuthoritySourceReceipt {
  id: string;
  revision: number;
  source_kind: "law_regulation" | "affiliation_rule" | "governing_instrument" | "resolution" | "appointment_order" | "delegation" | "owner_declaration" | "other";
  reference: string;
  provision: string;
  evidence_reference: string;
  verification_state: "self_attested" | "verified";
  effective_from: string;
  effective_until: string | null;
  verified_by: string | null;
  verified_at: string | null;
}

export interface GovernanceDecisionAuthorityReceipt {
  fee_instalment_basis?: { adoption_id: string; mandate_id: string; mandate_revision: number; max_amount_paise: number | null };
  school_id: string;
  matter_code: GovernanceDecisionMatter;
  evaluated_at: string;
  effective_date: string;
  institution_timezone: string;
  decision_mode: GovernanceDecisionMode;
  user_id: string;
  account: {
    id: string;
    is_active: true;
  };
  memberships: Array<{
    id: string;
    role: InstitutionMembershipRole;
    is_active: true;
  }>;
  person: {
    id: string;
    revision: number;
  };
  office: {
    id: string;
    revision: number;
    status: "active";
    authority_source_id: string | null;
  };
  appointment: {
    id: string;
    revision: number;
    status: "active";
    appointment_kind: "appointed" | "elected" | "nominated" | "ex_officio" | "acting";
    starts_on: string;
    ends_on: string | null;
    authority_source_id: string | null;
    evidence_reference: string;
  };
  rule: {
    id: string;
    revision: number;
    status: "confirmed";
    decision_mode: GovernanceDecisionMode;
    effective_from: string;
    effective_until: string | null;
    conditions_summary: string;
    authority_source_ids: string[];
  };
  sources: GovernanceAuthoritySourceReceipt[];
}

export interface GovernanceDecisionAuthorityPort {
  resolveDecisionOwner(
    transaction: Transaction<Database>,
    schoolId: string,
    matterCode: GovernanceDecisionMatter,
    at: Date,
  ): Promise<GovernanceDecisionAuthorityReceipt>;

  assertDecisionAuthority(
    transaction: Transaction<Database>,
    schoolId: string,
    matterCode: GovernanceDecisionMatter,
    userId: string,
    at: Date,
  ): Promise<GovernanceDecisionAuthorityReceipt>;
}
