import { apiFetch } from "../../lib/api";
import type { AccessRole, RoleAssignment, RoleOptions } from "./access-api";

export interface StaffProfile {
  id: string; user_id: string | null; staff_code: string; first_name: string; last_name: string;
  email: string; phone: string; staff_kind: "teaching" | "non_teaching"; designation: string;
  department: string; employment_type: "full_time" | "part_time" | "contract"; joined_on: string;
  status: "onboarding" | "active" | "inactive"; revision: number; avatar_url?: string;
  onboarding_total?: number; onboarding_complete?: number; pending_requests?: number;
}
export interface OnboardingItem { id: string; staff_profile_id: string; item_key: string; label: string; required: boolean; completed_at: string | null; note: string }
export interface LeavePolicy { id: string; academic_year: string; code: string; name: string; annual_allowance: string; carry_forward_limit: string; requires_document_after_days: string | null; is_paid: boolean; is_statutory: boolean; is_active: boolean; revision: number }
export interface LeaveBalance { staff_profile_id?: string; policy_id: string; code: string; name: string; annual_allowance: string; adjustments: string; used: string; pending: string; carry_forward_limit?: string; requires_document_after_days?: string | null; is_paid?: boolean; is_statutory?: boolean; academic_year?: string }
export interface StaffLeaveRequest { id: string; staff_profile_id: string; policy_id: string; policy_name: string; policy_code: string; first_name: string; last_name: string; staff_code: string; designation: string; starts_on: string; ends_on: string; portion: "full_day" | "first_half" | "second_half"; requested_days: string; reason: string; handover_note: string; status: "submitted" | "approved" | "rejected" | "withdrawn"; revision: number; decision_note: string; submitted_at: string; affected_periods: number; coverage_tasks?: number; coverage_open?: number }
export interface WorkType { id: string; code: string; name: string; category: "academic" | "student_support" | "event" | "examination" | "operations" | "governance"; scope_kind: "school" | "class_section" | "event" | "scheduled_duty"; workflow_family: string; source_kind: "system" | "institute"; cloned_from_type_id: string | null; description: string; access_summary: string; requires_acceptance: boolean; restricted: boolean; is_active: boolean; revision: number; active_assignment_count?: number }
export type ResponsibilityType = WorkType;
export interface ResponsibilityAssignment {
  id: string; responsibility_type_id: string; staff_profile_id: string; type_code: string; type_name: string;
  category: ResponsibilityType["category"]; scope_kind: ResponsibilityType["scope_kind"];
  first_name: string; last_name: string; staff_code: string; designation: string; user_id: string | null; avatar_url?: string;
  class_section_id: string | null; subject_id: string | null; event_id: string | null;
  class_name: string | null; subject_name: string | null; event_title: string | null; scope_label: string; location: string;
  starts_on: string; ends_on: string | null; starts_at: string | null; ends_at: string | null;
  status: "offered" | "active" | "declined" | "completed" | "revoked"; notes: string; response_note: string;
  access_summary: string; restricted: boolean; revision: number;
}
export interface CoverageTask {
  id: string; leave_request_id: string; absent_staff_profile_id: string; replacement_staff_profile_id: string | null;
  absent_first_name: string; absent_last_name: string; absent_designation: string;
  replacement_first_name: string | null; replacement_last_name: string | null; replacement_user_id: string | null;
  class_name: string; subject_name: string | null; duty_date: string; period_number: number | null;
  starts_at: string | null; ends_at: string | null; title: string; location: string;
  status: "open" | "offered" | "accepted" | "declined" | "completed" | "cancelled";
  handover_note: string; response_note: string; revision: number;
}
interface ResponsibilityWorkspace { access_roles?: AccessRole[]; role_assignments?: RoleAssignment[]; role_options?: RoleOptions; work_types: WorkType[]; responsibility_types: WorkType[]; assignments: ResponsibilityAssignment[]; coverage_tasks: CoverageTask[] }
export interface AdminStaffWorkspace extends ResponsibilityWorkspace { mode: "admin"; academic_year: string; profiles: StaffProfile[]; onboarding_items: OnboardingItem[]; policies: LeavePolicy[]; balances: LeaveBalance[]; requests: StaffLeaveRequest[]; references: { classes: { id: string; name: string }[]; subjects: { id: string; name: string }[]; events: { id: string; title: string; starts_at: string; ends_at: string }[] } }
export interface TeacherStaffWorkspace extends ResponsibilityWorkspace { mode: "staff"; academic_year: string; profile: StaffProfile; policies: LeavePolicy[]; balances: LeaveBalance[]; requests: StaffLeaveRequest[] }
export type StaffWorkspace = AdminStaffWorkspace | TeacherStaffWorkspace;

const root = (schoolId: string, path: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/staff/${path}/`;
export const getStaffWorkspace = (schoolId: string) => apiFetch<StaffWorkspace>(root(schoolId, "workspace"));
export const createStaffProfile = (schoolId: string, input: Record<string, unknown>) => apiFetch<{ profile: StaffProfile; invitation: { token: string; expires_at: string } | null }>(root(schoolId, "profiles"), { method: "POST", body: JSON.stringify(input) });
export const updateStaffOnboarding = (schoolId: string, profileId: string, input: { item_id: string; completed: boolean; note: string; expected_revision: number }) => apiFetch<StaffProfile>(root(schoolId, `profiles/${profileId}/onboarding`), { method: "PATCH", body: JSON.stringify(input) });
export const saveLeavePolicy = (schoolId: string, input: Record<string, unknown>, policyId?: string) => apiFetch<LeavePolicy>(root(schoolId, `leave-policies${policyId ? `/${policyId}` : ""}`), { method: policyId ? "PATCH" : "POST", body: JSON.stringify(input) });
export const adjustStaffBalance = (schoolId: string, input: { staff_profile_id: string; policy_id: string; days: number; reason: string }) => apiFetch(root(schoolId, "balance-adjustments"), { method: "POST", body: JSON.stringify(input) });
export const submitStaffLeave = (schoolId: string, input: Record<string, unknown>) => apiFetch<StaffLeaveRequest>(root(schoolId, "leave-requests"), { method: "POST", body: JSON.stringify(input) });
export const decideStaffLeave = (schoolId: string, requestId: string, input: { decision: "approved" | "rejected"; note: string; expected_revision: number }) => apiFetch<StaffLeaveRequest>(root(schoolId, `leave-requests/${requestId}/decision`), { method: "POST", body: JSON.stringify(input) });
export const withdrawStaffLeave = (schoolId: string, requestId: string, expected_revision: number) => apiFetch<StaffLeaveRequest>(root(schoolId, `leave-requests/${requestId}/withdraw`), { method: "POST", body: JSON.stringify({ expected_revision }) });
export const createResponsibility = (schoolId: string, input: Record<string, unknown>) => apiFetch<ResponsibilityAssignment>(root(schoolId, "responsibilities"), { method: "POST", body: JSON.stringify(input) });
export const respondResponsibility = (schoolId: string, assignmentId: string, input: { decision: "accepted" | "declined"; note: string; expected_revision: number }) => apiFetch(root(schoolId, `responsibilities/${assignmentId}/response`), { method: "POST", body: JSON.stringify(input) });
export const revokeResponsibility = (schoolId: string, assignmentId: string, input: { reason: string; expected_revision: number }) => apiFetch(root(schoolId, `responsibilities/${assignmentId}/revoke`), { method: "POST", body: JSON.stringify(input) });
export const assignCoverage = (schoolId: string, taskId: string, input: { replacement_staff_profile_id: string; note: string; expected_revision: number }) => apiFetch(root(schoolId, `coverage-tasks/${taskId}/assign`), { method: "POST", body: JSON.stringify(input) });
export const respondCoverage = (schoolId: string, taskId: string, input: { decision: "accepted" | "declined"; note: string; expected_revision: number }) => apiFetch(root(schoolId, `coverage-tasks/${taskId}/response`), { method: "POST", body: JSON.stringify(input) });
