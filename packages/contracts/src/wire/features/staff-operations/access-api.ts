/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
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
