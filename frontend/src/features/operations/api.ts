import { apiFetch } from "../../lib/api";
import { schoolDateToday } from "../../lib/schoolTime";
import type { HomeAction } from "../home-actions/types";

export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "half_day";
export type AttendanceRegisterState = "draft" | "submitted" | "locked";

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
  class: { id: string; name: string; grade: string; section: string; room: string; board: string; term: string };
  periods: Array<{ id: string; period_number: number; starts_at: string; ends_at: string; display_title: string; room: string }>;
  roster: TeacherRosterStudent[];
  register: AttendanceRegister;
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
  classes: Array<{ id: string; name: string; grade: string; section: string; room_number: string }>;
  subjects: Array<{ id: string; code: string; name: string; short_name: string; color: string }>;
  teachers: Array<{ id: string; name: string }>;
  slots: Array<{
    id: string; class_section_id: string; class_name: string; subject_id: string | null; display_title: string;
    teacher_user_id: string | null; teacher_name: string | null; weekday: number; weekday_label: string;
    period_number: number; starts_at: string; ends_at: string; slot_type: "class" | "break" | "activity"; room: string;
  }>;
  conflicts: Array<{ first_slot_id: string; second_slot_id: string; weekday: number; starts_at: string; ends_at: string; type: "teacher" | "room" }>;
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

export function getPrincipalTimetable() {
  return apiFetch<PrincipalTimetableResponse>("/api/v1/screens/principal/timetable/");
}

export interface NewTimetableSlot {
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

export function createTimetableSlot(slot: NewTimetableSlot) {
  return apiFetch("/api/v1/principal/timetable/slots/", { method: "POST", body: JSON.stringify(slot) });
}

export function updateTimetableSlot(id: string, slot: NewTimetableSlot) {
  return apiFetch(`/api/v1/principal/timetable/slots/${id}/`, { method: "PATCH", body: JSON.stringify(slot) });
}

export function deleteTimetableSlot(id: string) {
  return apiFetch<{ deleted: true; id: string }>(`/api/v1/principal/timetable/slots/${id}/`, { method: "DELETE" });
}
