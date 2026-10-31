/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type CareStatus = "open" | "triage" | "active" | "closed";

export type ReportingState = "assessment_required" | "reporting_required" | "reported" | "not_applicable";

export interface CareCaseSummary {
  id: string; student_id: string | null; owner_user_id: string; intake_route: "primary" | "alternate";
  urgency: "urgent" | "priority" | "routine"; concern_category: string; safety_state: string;
  status: CareStatus; reporting_state: ReportingState; opened_at: string; last_activity_at: string;
  revision: number; assignment_role: string; access_level: "intake_only" | "full";
  subject_name: string; owner_name: string;
}

export interface CareRoleAssignment {
  id: string; user_id: string; role_kind: string; route_kind: "primary" | "alternate";
  valid_from: string; valid_until: string | null; status: "active" | "revoked";
  revision: number; member_name: string; email: string; created_at: string;
}

export interface CareWorkspace {
  can_manage_team: boolean; cases: CareCaseSummary[]; team: CareRoleAssignment[];
  candidates: Array<{ id: string; name: string; email: string; role: string }>;
  eligible_students: Array<{ id: string; name: string; admission_number: string }>;
  routes: { primary: number; alternate: number }; legal_notice: string;
}

export interface CareCaseDetail {
  case: CareCaseSummary & { source_kind: string; ordinary_handler_involved: boolean; observed_at: string | null; admission_number: string | null; reporter_name: string };
  access: { assignment_role: string; access_level: "intake_only" | "full" };
  entries: Array<{ id: string; entry_type: string; note: string; created_by: string; created_at: string }>;
  external_reports: Array<{ id: string; authority_type: string; reported_at: string; reference: string; recorded_by: string; created_at: string }>;
  audits: Array<{ id: string; action: string; metadata: Record<string, unknown>; actor_name: string; created_at: string }>;
  handover_candidates: CareHandler[];
  source_content_omitted: boolean;
}

export interface CareHandler { id: string; name: string; role_kind: string }

export interface CareReceipt { id: string; revision: number; receipt_id: string; receipt: string; action?: string }

export interface OrphanedCareCase { id: string; revision: number; intake_route: "primary" | "alternate"; owner_name: string; candidates: CareHandler[] }
