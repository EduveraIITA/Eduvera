import { apiFetch } from "../../lib/api";
import { schoolDateToday } from "../../lib/schoolTime";
import type { HomeAction } from "../home-actions/types";

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
}

export interface TeacherClassSummary {
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
  submission_authorized?: boolean;
  instructional?: boolean;
  date_open?: boolean;
  can_mark?: boolean;
  availability_reason?: string | null;
}

export interface TeacherTimetableSlot {
  id: string;
  weekday: number;
  weekday_label: string;
  period_number: number;
  starts_at: string;
  ends_at: string;
  room: string;
  subject_name: string;
  class_section_id: string;
  class_name: string;
}

export interface TeacherHomeResponse {
  date: string;
  teacher: { id: string; name: string; role: "staff" | "admin" };
  classes: TeacherClassSummary[];
  weekly_timetable: TeacherTimetableSlot[];
  home_actions: HomeAction[];
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
  date: string;
  availability?: { can_mark: boolean; reason: string | null };
  class: { id: string; school_id: string; term_id: string; name: string; grade: string; section: string; room: string; board: string; term: string };
  periods: Array<{ id: string; period_number: number; starts_at: string; ends_at: string; display_title: string; room: string }>;
  roster: TeacherRosterStudent[];
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

export interface AttendanceRegisterHistoryResponse {
  date: string;
  class: TeacherAttendanceResponse["class"];
  register: AttendanceRegister;
  submissions: Array<{
    id: string;
    register_revision: number;
    records_count: number;
    changed_count: number;
    created_at: string;
    submitted_by_name: string;
    capture_source?: AttendanceCaptureSource | "photo";
    observed_at?: string | null;
    source_reference?: string | null;
  }>;
  revisions: Array<{
    id: string;
    student_id: string;
    student_name: string;
    previous_status: AttendanceStatus | null;
    new_status: AttendanceStatus;
    previous_remarks: string | null;
    new_remarks: string;
    reason: string;
    register_revision: number;
    created_at: string;
    changed_by_name: string;
  }>;
}

export interface PrincipalClassSummary extends TeacherClassSummary {
  id: string;
  name: string;
  timetable_slots: number;
  unassigned_slots: number;
  late_count: number;
  attendance_percentage: number;
}

export interface PrincipalHomeResponse {
  date: string;
  principal: { id: string; name: string };
  summary: {
    students: number;
    marked: number;
    attending: number;
    absent: number;
    late: number;
    attendance_percentage: number;
    classes_total: number;
    classes_submitted: number;
  };
  classes: PrincipalClassSummary[];
  exceptions: Array<{ id: string; admission_number: string; name: string; class_section_id: string; class_name: string; recorded_days: number; percentage: number; threshold: number }>;
  home_actions: HomeAction[];
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

function query(path: string, values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return `${path}?${params.toString()}`;
}

export function getTeacherHome(date = schoolDateToday()) {
  return apiFetch<TeacherHomeResponse>(query("/api/v1/screens/teacher/home/", { date }));
}

export function getTeacherAttendance(classSectionId: string, date = schoolDateToday()) {
  return apiFetch<TeacherAttendanceResponse>(query("/api/v1/screens/teacher/attendance/", { class_section_id: classSectionId, date }));
}

export function saveTeacherAttendance(classSectionId: string, date: string, input: TeacherAttendanceSaveInput) {
  return apiFetch<TeacherAttendanceResponse>("/api/v1/teacher/attendance/bulk/", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotency_key },
    body: JSON.stringify({
      class_section_id: classSectionId,
      date,
      records: input.records,
      expected_revision: input.expected_revision,
      photo_session_id: input.photo_session_id,
      reason: input.reason,
    }),
  });
}

export function saveAttendanceContinuityBatch(classSectionId: string, date: string, input: TeacherAttendanceSaveInput) {
  if (!input.roster_fingerprint || !input.roster_expires_at || !input.observed_at) {
    throw new TypeError("Attendance continuity metadata is required.");
  }
  return apiFetch<AttendanceContinuityResult>("/api/v1/attendance-continuity/batches/", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotency_key },
    body: JSON.stringify({
      class_section_id: classSectionId,
      date,
      records: input.records,
      expected_revision: input.expected_revision,
      photo_session_id: input.photo_session_id,
      reason: input.reason,
      source: input.source ?? "live_app",
      source_reference: input.source_reference ?? "",
      device_id: input.device_id ?? null,
      observed_at: input.observed_at,
      roster_fingerprint: input.roster_fingerprint,
      roster_expires_at: input.roster_expires_at,
    }),
  });
}

export function getAttendanceContinuityWorkspace(date = schoolDateToday()) {
  return apiFetch<AttendanceContinuityWorkspace>(query("/api/v1/screens/principal/attendance/continuity/", { date }));
}

export function decideAttendanceReconciliation(caseId: string, input: { decision: "accept" | "reject"; reason: string; expected_revision: number }) {
  return apiFetch<AttendanceContinuityWorkspace>(`/api/v1/attendance-continuity/cases/${encodeURIComponent(caseId)}/decision/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function lockAttendanceRegister(classSectionId: string, date: string) {
  return apiFetch<TeacherAttendanceResponse>(query(`/api/v1/attendance-registers/${encodeURIComponent(classSectionId)}/lock/`, { date }), {
    method: "POST",
  });
}

export function unlockAttendanceRegister(classSectionId: string, date: string, reason: string) {
  return apiFetch<TeacherAttendanceResponse>(query(`/api/v1/attendance-registers/${encodeURIComponent(classSectionId)}/lock/`, { date }), {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function getAttendanceRegisterHistory(classSectionId: string, date: string) {
  return apiFetch<AttendanceRegisterHistoryResponse>(query(`/api/v1/attendance-registers/${encodeURIComponent(classSectionId)}/history/`, { date }));
}

export function getPrincipalHome(date = schoolDateToday()) {
  return apiFetch<PrincipalHomeResponse>(query("/api/v1/screens/principal/home/", { date }));
}

export function getPrincipalTimetable(termId?: string) {
  return apiFetch<PrincipalTimetableResponse>(query("/api/v1/screens/principal/timetable/", { term_id: termId }));
}

export interface NewTimetableSlot {
  term_id?: string;
  class_section_id: string;
  subject_id: string | null;
  teacher_user_id: string | null;
  weekday: number;
  period_number: number;
  starts_at: string;
  ends_at: string;
  slot_type: "class" | "break" | "activity";
  title: string;
  room: string;
  teacher_designation: string;
}

export interface CopyTimetableDayInput {
  term_id: string;
  class_section_id: string;
  source_weekday: number;
  target_weekdays: number[];
  replace: boolean;
  reason: string;
}

export interface CurriculumTargetInput {
  term_id: string;
  class_section_id: string;
  subject_id: string;
  target_minutes: number;
  expected_revision: number;
  reason: string;
}

export interface SchoolClosureInput {
  term_id: string;
  starts_on: string;
  ends_on: string;
  kind: "public_holiday" | "local_holiday" | "emergency_closure";
  label: string;
  reason: string;
}

export function createTimetableSlot(slot: NewTimetableSlot) {
  return apiFetch("/api/v1/principal/timetable/slots/", { method: "POST", body: JSON.stringify(slot) });
}

export function updateTimetableSlot(id: string, slot: NewTimetableSlot) {
  return apiFetch(`/api/v1/principal/timetable/slots/${id}/`, { method: "PATCH", body: JSON.stringify(slot) });
}

export function deleteTimetableSlot(id: string) {
  return apiFetch<{ deleted: true; id: string }>(`/api/v1/principal/timetable/slots/${id}/`, { method: "DELETE" });
}

export function copyTimetableDay(input: CopyTimetableDayInput) {
  return apiFetch<{ copied: true; periods_created: number; target_weekdays: number[] }>("/api/v1/principal/timetable/copy-day/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveCurriculumTarget(input: CurriculumTargetInput) {
  return apiFetch("/api/v1/principal/timetable/targets/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createSchoolClosure(input: SchoolClosureInput) {
  return apiFetch<{ created: true; results: PrincipalTimetableResponse["calendar_exceptions"] }>("/api/v1/principal/calendar/closures/", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteSchoolClosure(date: string, expectedRevision: number, reason: string) {
  return apiFetch<{ deleted: true; date: string }>(`/api/v1/principal/calendar/closures/${encodeURIComponent(date)}/`, {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: expectedRevision, reason }),
  });
}
