/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "half_day";

export type AttendanceRegisterState = "draft" | "submitted" | "locked";

export type AttendanceCaptureSource = "live_app" | "offline_device" | "paper" | "office";

export interface AttendanceRegister {
  state: AttendanceRegisterState;
  revision: number;
  submitted_by: string | null;
  submitted_at: string | null;
  submitted_by_name?: string | null;
  locked_by: string | null;
  locked_at: string | null;
  reopened_by?: string | null;
  reopened_at?: string | null;
  auto_finalize_at?: string | null;
  finalization_policy_revision?: number | null;
  finalization_source?: "manual" | "automatic" | null;
}

export interface TeacherClassSummary {
  attendance_scope?: "daily_class" | "scheduled_session";
  session_id?: string;
  subject_id?: string;
  subject_name?: string;
  period_number?: number;
  class_section_id: string;
  class_name: string;
  grade: string;
  section: string;
  room_number: string;
  term_name: string;
  academic_year: string;
  starts_at: string | null;
  ends_at: string | null;
  student_count: number;
  marked_count: number;
  attending_count: number;
  absent_count: number;
  subjects: string[] | null;
  submission_status: "not_started" | "in_progress" | "submitted" | "locked";
  periods_today?: number;
  assigned_teachers?: string[];
  assignment_kind?: "regular" | "substitute";
  submitted_by_name?: string | null;
  submitted_at?: string | null;
  auto_finalize_at?: string | null;
  finalization_policy_revision?: number | null;
  finalization_source?: "manual" | "automatic" | null;
  submission_authorized?: boolean;
  instructional?: boolean;
  date_open?: boolean;
  can_mark?: boolean;
  availability_reason?: string | null;
}

export interface AssignedClassesWorkspaceResponse {
  date: string;
  classes: TeacherClassSummary[];
}

export interface TeacherRosterStudent {
  id: string;
  admission_number: string;
  avatar_url: string;
  roll_number: number;
  name: string;
  status: AttendanceStatus | null;
  remarks: string;
  attendance_id: string | null;
  updated_at: string | null;
}

export interface TeacherAttendanceResponse {
  attendance_scope?: "daily_class" | "scheduled_session";
  session?: { id: string; subject_id: string; subject_name: string; period_number: number; starts_at: string; ends_at: string };
  capture_policy?: { channels: string[]; self_check_in_mode: "disabled" | "staff_review" | "automatic" };
  date: string;
  availability?: { can_mark: boolean; reason: string | null };
  class: { id: string; school_id: string; term_id: string; name: string; grade: string; section: string; room: string; board: string; term: string };
  periods: Array<{ id: string; period_number: number; starts_at: string; ends_at: string; display_title: string; room: string }>;
  roster: TeacherRosterStudent[];
  pending_evidence?: Array<{
    id: string;
    student_id: string;
    student_name: string;
    admission_number: string;
    capture_channel: string;
    observed_at: string;
    updated_at: string;
  }>;
  register: AttendanceRegister;
  continuity_snapshot: {
    roster_fingerprint: string;
    roster_count: number;
    captured_at: string;
    expires_at: string;
    token: string;
  };
  latest_capture: {
    id: string;
    source: AttendanceCaptureSource;
    status: "pending" | "accepted" | "quarantined" | "rejected";
    received_at: string;
    roster_expires_at: string;
  } | null;
}

export interface TeacherAttendanceRecordInput {
  student_id: string;
  status: AttendanceStatus;
  remarks: string;
}

export interface TeacherAttendanceSaveInput {
  records: TeacherAttendanceRecordInput[];
  expected_revision: number;
  photo_session_id?: string;
  reason?: string;
  idempotency_key: string;
  source?: AttendanceCaptureSource;
  source_reference?: string;
  device_id?: string | null;
  observed_at?: string;
  roster_fingerprint?: string;
  roster_captured_at?: string;
  roster_expires_at?: string;
  snapshot_token?: string;
}

export interface AttendanceContinuityResult {
  status: "pending" | "accepted" | "quarantined" | "rejected";
  batch: {
    id: string;
    source: AttendanceCaptureSource;
    status: "pending" | "accepted" | "quarantined" | "rejected";
    date: string;
    received_at: string;
    roster_expires_at: string;
  };
  review: null | { id: string; reason_code: string; reason: string; state: "open" | "accepted" | "rejected" };
  register: TeacherAttendanceResponse | null;
}

export interface AttendanceContinuityWorkspace {
  date: string;
  summary: { pending: number; quarantined: number; accepted: number; rejected: number };
  cases: Array<{
    id: string;
    batch_id: string;
    reason_code: string;
    reason: string;
    details: Record<string, unknown>;
    state: "open";
    opened_at: string;
    date: string;
    source: AttendanceCaptureSource;
    source_reference: string;
    observed_at: string;
    received_at: string;
    roster_count: number;
    expected_register_revision: number;
    class_section_id: string;
    class_name: string;
    recorded_by_name: string;
    current_revision: number;
    register_state: AttendanceRegisterState | null;
  }>;
}

export interface PrincipalTimetableResponse {
  terms: Array<{ id: string; academic_year: string; name: string; starts_on: string; ends_on: string; is_active: boolean }>;
  selected_term_id: string | null;
  classes: Array<{ id: string; name: string; grade: string; section: string; room_number: string }>;
  subjects: Array<{ id: string; code: string; name: string; short_name: string; color: string }>;
  teachers: Array<{ id: string; name: string }>;
  slots: Array<{
    id: string; class_section_id: string; class_name: string; subject_id: string | null; display_title: string;
    teacher_user_id: string | null; teacher_name: string | null; weekday: number; weekday_label: string;
    period_number: number; starts_at: string; ends_at: string; slot_type: "class" | "break" | "activity"; room: string;
  }>;
  conflicts: Array<{ first_slot_id: string; second_slot_id: string; weekday: number; starts_at: string; ends_at: string; type: "teacher" | "room" }>;
  coverage: Array<{
    class_section_id: string; subject_id: string; weekly_periods: number; weekly_minutes: number;
    projected_periods: number; projected_minutes: number; target_minutes: number | null; revision: number | null;
  }>;
  calendar_exceptions: Array<{
    id: string; date: string; is_instructional: boolean; label: string;
    kind: "public_holiday" | "local_holiday" | "emergency_closure" | "instructional_override";
    reason: string; revision: number;
  }>;
  school_date: string;
}
