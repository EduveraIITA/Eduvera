import { apiFetch } from "../../lib/api";

export type InstitutionKind = "school" | "college" | "coaching" | "hybrid";
export type PolicyStatus = "draft" | "in_review" | "published" | "retired";

export interface RegulatoryProfile {
  school_id: string; institution_kind: InstitutionKind; country_code: string; state_code: string; district: string;
  management_kind: "government" | "government_aided" | "private_unaided" | "trust_society" | "corporate" | "other";
  delivery_mode: "in_person" | "online" | "hybrid"; education_levels: string[]; regulator_codes: string[];
  capability_packs: string[]; recognition_reference: string; affiliation_reference: string;
  residential: boolean; transport_provided: boolean; minors_enrolled: boolean;
  staff_count_band: "0_9" | "10_49" | "50_99" | "100_249" | "250_plus";
  reviewed_on: string | null; review_note: string; revision: number; updated_at: string;
}

export interface PolicyFamily {
  id: string; code: string; title: string; category: string; capability_pack: string;
  applicable_institution_kinds: string[]; source_references: Array<{ label: string; url: string }>;
  default_audiences: string[]; default_requires_acknowledgement: boolean; risk_level: "standard" | "high";
  guidance: string; applicable: boolean;
  current_version_id: string | null; current_version: number | null; current_status: PolicyStatus | null;
  current_summary: string | null; current_effective_on: string | null; current_review_due_on: string | null;
  current_requires_acknowledgement: boolean | null; current_revision: number | null;
  work_version_id: string | null; work_version: number | null; work_status: PolicyStatus | null;
  work_title: string | null; work_summary: string | null; work_body_markdown: string | null;
  work_audience_roles: string[] | null; work_requires_acknowledgement: boolean | null;
  work_effective_on: string | null; work_review_due_on: string | null; work_source_note: string | null;
  work_revision: number | null; work_created_by: string | null; work_submitted_by: string | null;
}

export interface GovernanceWorkspace {
  profile: RegulatoryProfile; families: PolicyFamily[];
  metrics: { applicable: number; published: number; in_review: number; review_due: number };
  audits: Array<{ id: string; action: string; target_type: string; metadata: Record<string, unknown>; created_at: string; first_name: string; last_name: string }>;
  authority: AuthorityWorkspace;
}

export interface AuthorityWorkspace {
  sources: Array<{ id: string; code: string; title: string; source_kind: string; issuer: string; jurisdiction: string; reference: string; provision: string; evidence_reference: string; verification_state: "draft" | "recorded" | "self_attested" | "verified" | "superseded"; effective_from: string | null; effective_until: string | null; revision: number }>;
  offices: Array<{ id: string; code: string; title: string; purpose: string; status: string; revision: number; first_name: string | null; last_name: string | null; appointment_id: string | null; appointment_status: string | null; starts_on: string | null; ends_on: string | null; linked_user_id: string | null }>;
  bodies: Array<{ id: string; code: string; title: string; purpose: string; status: string; collective_authority: boolean; seat_count: number; filled_seats: number }>;
  rules: Array<{ id: string; code: string; title: string; category: string; initiation_summary: string; review_summary: string; decision_summary: string; execution_summary: string; decision_mode: string; conditions_summary: string; material_fields: string[]; status: "suggested" | "confirmed" | "retired"; effective_from: string | null; effective_until: string | null; decision_office_title: string | null; decision_body_title: string | null; mandate_title: string | null; mandate_status: string | null }>;
  issues: Array<{ code: string; label: string; count: number }>;
  metrics: { sources: number; active_appointments: number; confirmed_rules: number; needs_review: number };
}

export interface PublishedPolicy {
  id: string; code: string; category: string; title: string; summary: string; body_markdown: string;
  audience_roles: string[]; requires_acknowledgement: boolean; version: number; effective_on: string;
  review_due_on: string | null; source_note: string; source_references: Array<{ label: string; url: string }>;
  acknowledgement_id: string | null; acknowledged_at: string | null; guidance: string;
}

const root = (schoolId: string, path: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/governance/${path}/`;
export const getGovernanceWorkspace = (schoolId: string) => apiFetch<GovernanceWorkspace>(root(schoolId, "workspace"));
export const prepareAuthorityDraft = (schoolId: string, input: { legal_operator_name: string; lead_officeholder_name: string; lead_is_current_user: boolean; authority_basis_title: string; authority_reference: string }) => apiFetch<AuthorityWorkspace>(root(schoolId, "authority/draft"), { method: "POST", body: JSON.stringify(input) });
export const updateRegulatoryProfile = (schoolId: string, input: Record<string, unknown>) => apiFetch<RegulatoryProfile>(root(schoolId, "profile"), { method: "PATCH", body: JSON.stringify(input) });
export const savePolicyDraft = (schoolId: string, code: string, input: Record<string, unknown>) => apiFetch(root(schoolId, `policies/${code}/draft`), { method: "POST", body: JSON.stringify(input) });
export const submitPolicy = (schoolId: string, versionId: string, expectedRevision: number) => apiFetch(root(schoolId, `policy-versions/${versionId}/submit`), { method: "POST", body: JSON.stringify({ expected_revision: expectedRevision }) });
export const reviewPolicy = (schoolId: string, versionId: string, input: { decision: "publish" | "reject"; expected_revision: number; note: string; override_reason: string }) => apiFetch(root(schoolId, `policy-versions/${versionId}/review`), { method: "POST", body: JSON.stringify(input) });
export const getPublishedPolicies = (schoolId: string) => apiFetch<{ policies: PublishedPolicy[]; membership_roles: string[] }>(root(schoolId, "policies"));
export const acknowledgePolicy = (schoolId: string, versionId: string, acknowledgementText: string) => apiFetch(root(schoolId, `policy-versions/${versionId}/acknowledgements`), { method: "POST", body: JSON.stringify({ acknowledgement_text: acknowledgementText }) });
