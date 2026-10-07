import { apiFetch } from "../../lib/api";

export type RoleContext = "institution" | "class" | "event" | "assessment" | "trip";
export interface AccessRole {
  id: string; name: string; description: string; context_kind: RoleContext; permissions: string[];
  source_kind: "system" | "institute"; is_active: boolean; revision: number; assignment_count: number;
}
export interface RoleOptions {
  contexts: { code: RoleContext; label: string; permissions: readonly string[] }[];
  permissions: { code: string; group: string; label: string; description: string }[];
  prerequisites: Record<string, string[]>;
}
export interface RoleAssignment {
  source_id: string; source_kind: "assignment" | "class_assignment" | "event_assignment" | "assessment_assignment" | "transport_trip";
  staff_profile_id: string; user_id: string; role_id: string; role_name: string; context_kind: RoleContext;
  scope_id: string; scope_label: string; subject_name: string | null; permissions: string[];
  starts_on: string; ends_on: string | null; status: string; display_status: string; revision: number;
  trip_service_date?: string | null; trip_departure_time?: string | null;
  trip_direction?: "to_institution" | "from_institution" | null;
  trip_state?: "planned" | "boarding" | "in_progress" | "completed" | "cancelled" | null;
  trip_assignment_status?: "pending" | "accepted" | "declined" | null;
  trip_is_backup?: boolean | null;
}
export interface SaveRoleInput {
  name: string; description: string; context_kind: RoleContext; permissions: string[]; template_id?: string | null;
  expected_revision?: number; expected_assignment_count?: number;
}
const root = (school: string, path: string) => `/api/v1/schools/${encodeURIComponent(school)}/staff/${path}/`;
export const saveAccessRole = (school: string, input: SaveRoleInput, id?: string) => apiFetch<AccessRole>(root(school, `access-roles${id ? `/${id}` : ""}`), { method: id ? "PATCH" : "POST", body: JSON.stringify(input) });
export const assignAccessRole = (school: string, input: { role_id: string; staff_profile_id: string; scope_id: string | null; subject_id: string | null; starts_on: string; ends_on: string | null }) => apiFetch(root(school, "role-assignments"), { method: "POST", body: JSON.stringify(input) });
export const endClassRoleAssignment = (school: string, assignment: RoleAssignment, reason: string) => apiFetch(root(school,"role-assignments/end-class"),{method:"POST",body:JSON.stringify({source_id:assignment.source_id,expected_revision:assignment.revision,reason})});
export const changeAssignmentRole = (school: string, assignment: RoleAssignment, roleId: string) => apiFetch(root(school, "role-assignments/change-role"), { method: "POST", body: JSON.stringify({source_kind:assignment.source_kind,source_id:assignment.source_id,user_id:assignment.user_id,role_id:roleId,expected_role_id:assignment.role_id,expected_revision:assignment.revision}) });
