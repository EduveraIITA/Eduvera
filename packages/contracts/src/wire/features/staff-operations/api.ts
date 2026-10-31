/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { AccessRole, RoleAssignment, RoleOptions } from './access-api';

export interface StaffProfile {
  id: string; user_id: string | null; person_id?: string | null; staff_code: string; first_name: string; last_name: string;
  email: string; phone: string; staff_kind: "teaching" | "non_teaching"; designation: string;
  department: string; employment_type: "unspecified" | "full_time" | "part_time" | "contract"; joined_on: string | null;
  status: "onboarding" | "active" | "inactive"; revision: number; avatar_url?: string;
  onboarding_total?: number; onboarding_complete?: number; pending_requests?: number;
}

export interface OnboardingItem { id: string; staff_profile_id: string; item_key: string; label: string; required: boolean; completed_at: string | null; note: string }

export interface LeavePolicy { id: string; academic_year: string; code: string; name: string; annual_allowance: string; carry_forward_limit: string; requires_document_after_days: string | null; is_paid: boolean; is_statutory: boolean; is_active: boolean; revision: number }

export interface LeaveBalance { staff_profile_id?: string; policy_id: string; code: string; name: string; annual_allowance: string; adjustments: string; used: string; pending: string; carry_forward_limit?: string; requires_document_after_days?: string | null; is_paid?: boolean; is_statutory?: boolean; academic_year?: string }

export interface LeaveReviewer { user_id: string; name: string }

export interface LeaveReviewReadiness {
  state: "ready" | "needs_configuration" | "unavailable";
  reason: string | null;
  reviewer: LeaveReviewer | null;
  can_configure: boolean;
}

export interface LeaveReviewRoute {
  state: "current" | "needs_reassignment" | "unavailable";
  reviewer: LeaveReviewer | null;
  current_reviewer: LeaveReviewer | null;
  can_reroute: boolean;
}

export interface ReviewRouteBasis {
  rule: { id: string; revision: number };
  office: { id: string; revision: number };
  appointment: { id: string; revision: number };
  person: { id: string; revision: number };
  sources: Array<{ id: string; revision: number }>;
}

export interface LeaveReviewRouting extends LeaveReviewReadiness { expected: ReviewRouteBasis | null }

export interface StaffLeaveImpactInput {
  policy_id: string;
  starts_on: string;
  ends_on: string;
  portion: "full_day" | "first_half" | "second_half";
}

export interface StaffLeaveImpact {
  state: "ready" | "empty";
  as_of: string;
  time_zone: string;
  starts_on: string;
  ends_on: string;
  portion: StaffLeaveImpactInput["portion"];
  items: Array<{
    id: string;
    kind: "class" | "duty";
    date: string;
    starts_at: string | null;
    ends_at: string | null;
    title: string;
    location: string;
    source: { kind: string; id: string; revision: number | null; version: number | null };
    class_label: string | null;
  }>;
  total: number;
  truncated: boolean;
  scope: "published_timetable_and_dated_responsibilities";
  limitations: string[];
  staff_profile_revision: number;
  policy_revision: number;
}

export interface StaffLeaveRequest { id: string; staff_profile_id: string; policy_id: string; policy_name: string; policy_code: string; first_name: string; last_name: string; staff_code: string; designation: string; starts_on: string; ends_on: string; portion: "full_day" | "first_half" | "second_half"; requested_days: string; reason: string; handover_note: string; status: "submitted" | "approved" | "rejected" | "withdrawn"; revision: number; decision_note: string; submitted_at: string; affected_periods: number; coverage_tasks?: number; coverage_open?: number; coverage_fallback?: number; coverage_filled?: number; coverage_expired?: number; coverage_fallback_labels?: string; review_route?: LeaveReviewRoute; affected_work?: StaffLeaveImpact }

export interface WorkType { id: string; code: string; name: string; category: "academic" | "student_support" | "event" | "examination" | "operations" | "governance"; scope_kind: "school" | "class_section" | "event" | "scheduled_duty"; workflow_family: string; source_kind: "system" | "institute"; cloned_from_type_id: string | null; description: string; access_summary: string; requires_acceptance: boolean; restricted: boolean; is_active: boolean; revision: number; active_assignment_count?: number }

export type ResponsibilityType = WorkType;

export interface ResponsibilityAssignment {
  id: string; responsibility_type_id: string; staff_profile_id: string; type_code: string; type_name: string;
  category: ResponsibilityType["category"]; scope_kind: ResponsibilityType["scope_kind"];
  first_name: string; last_name: string; staff_code: string; designation: string; user_id: string | null; avatar_url?: string;
  class_section_id: string | null; subject_id: string | null; event_id: string | null;
  class_name: string | null; subject_name: string | null; event_title: string | null; scope_label: string; location: string;
  starts_on: string; ends_on: string | null; starts_at: string | null; ends_at: string | null;
  status: "offered" | "active" | "declined" | "completed" | "revoked"; notes: string; response_note: string; revocation_reason?: string;
  access_summary: string; restricted: boolean; revision: number;
}

export interface CoverageTask {
  id: string; leave_request_id: string; absent_staff_profile_id: string; replacement_staff_profile_id: string | null;
  absent_first_name: string; absent_last_name: string; absent_designation: string;
  replacement_first_name: string | null; replacement_last_name: string | null; replacement_user_id: string | null;
  class_name: string; subject_name: string | null; duty_date: string; period_number: number | null;
  starts_at: string | null; ends_at: string | null; title: string; location: string;
  status: "open" | "offered" | "accepted" | "declined" | "completed" | "cancelled" | "fallback_applied" | "expired_unconfirmed";
  handover_note: string; response_note: string; revision: number;
  fallback_kind?: "independent_study" | "physical_activity" | "library_period" | "merge_class" | "cancelled_period" | "unconfirmed" | null;
  fallback_label?: string; fallback_supervisor_staff_profile_id?: string | null;
  fallback_supervisor_first_name?: string | null; fallback_supervisor_last_name?: string | null;
  resolution_policy_revision?: number | null; resolved_at?: string | null;
}

export interface CoveragePolicy {
  school_id: string; enabled: boolean; deadline_minutes_before: number;
  fallback_kind: "independent_study" | "physical_activity" | "library_period" | "merge_class" | "cancelled_period";
  fallback_label: string; supervisor_staff_profile_id: string | null;
  supervisor_first_name: string | null; supervisor_last_name: string | null; revision: number;
}

export interface ResponsibilityWorkspace { access_roles?: AccessRole[]; role_assignments?: RoleAssignment[]; role_options?: RoleOptions; can_review_staff_leave?: boolean; leave_review_readiness?: LeaveReviewReadiness; work_types: WorkType[]; responsibility_types: WorkType[]; assignments: ResponsibilityAssignment[]; coverage_tasks: CoverageTask[]; coverage_policy?: CoveragePolicy }

export interface AdminStaffWorkspace extends ResponsibilityWorkspace { mode: "admin"; academic_year: string; profiles: StaffProfile[]; onboarding_items: OnboardingItem[]; policies: LeavePolicy[]; balances: LeaveBalance[]; requests: StaffLeaveRequest[]; references: { classes: { id: string; name: string }[]; subjects: { id: string; name: string }[]; events: { id: string; title: string; starts_at: string; ends_at: string }[] } }

export interface TeacherStaffWorkspace extends ResponsibilityWorkspace { mode: "staff"; academic_year: string; profile: StaffProfile; policies: LeavePolicy[]; balances: LeaveBalance[]; requests: StaffLeaveRequest[] }

export type StaffWorkspace = AdminStaffWorkspace | TeacherStaffWorkspace;
