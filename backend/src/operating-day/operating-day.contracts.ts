import type { CampusOperatingDayOccurrence } from "../campus-model-core/temporal-context.port.js";

export type OperatingDaySessionState = "completed" | "in_progress" | "upcoming";
export type OperatingDayRegisterState = "not_started" | "in_progress" | "submitted" | "locked" | "not_required";

export interface OperatingDaySession {
  id: string;
  occurrence_id: string;
  period_number: number;
  class_section_id: string;
  class_label: string;
  subject_label: string | null;
  space_label: string | null;
  teacher: { agent_id: string; label: string } | null;
  title: string;
  slot_type: CampusOperatingDayOccurrence["slot_type"];
  starts_at: string;
  ends_at: string;
  state: OperatingDaySessionState;
  attendance: {
    register_id: string | null;
    state: OperatingDayRegisterState;
    revision: number | null;
    marked_count: number;
    expected_count: number;
    submitted_at: string | null;
  };
  source: {
    domain: CampusOperatingDayOccurrence["source_domain"];
    record_id: string;
    revision: number;
    change_kind: CampusOperatingDayOccurrence["change_kind"];
  };
  target_path: string | null;
}

export interface OperatingDayProjection {
  schema_version: 1;
  environment: {
    kind: "live" | "simulation";
    label: "Live" | "Simulation";
    namespace_id: string | null;
  };
  institution: { id: string; name: string; timezone: string };
  viewer: { role: "admin" | "staff"; agent_id: string | null };
  date: string;
  as_of: string;
  summary: {
    scheduled_sessions: number;
    completed_sessions: number;
    current_sessions: number;
    upcoming_sessions: number;
    registers_expected: number;
    registers_submitted: number;
    registers_in_progress: number;
    registers_not_started: number;
    gate_entries: number;
    gate_exits: number;
  };
  now: OperatingDaySession[];
  next: OperatingDaySession[];
  sessions: OperatingDaySession[];
  contradictions: Array<{
    id: string;
    kind: string;
    student_id: string;
    student_label: string;
    explanation: string;
    gate_observed_at: string;
    expected_from: string;
    expected_until: string;
    attendance_status: string | null;
  }>;
  freshness: {
    schedule: "current";
    attendance: "authoritative";
    gate: "accepted_points";
  };
}
