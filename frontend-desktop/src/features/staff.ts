import { api, withQuery } from "../lib/api";

export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "half_day";

export interface ClassSummary {
  class_section_id: string; class_name: string; grade: string; section: string; room_number: string;
  term_name: string; academic_year: string; starts_at: string; ends_at: string;
  student_count: number; marked_count: number; attending_count: number; absent_count: number;
  subjects: string[] | null; submission_status: "not_started" | "in_progress" | "submitted";
}
export interface TimetableSlot {
  id: string; weekday: number; weekday_label: string; period_number: number; starts_at: string; ends_at: string;
  room: string; subject_name: string; class_section_id: string; class_name: string;
}
export interface TeacherHome { date: string; teacher: { id: string; name: string; role: "staff" | "admin" }; classes: ClassSummary[]; weekly_timetable: TimetableSlot[] }

export interface RosterStudent {
  id: string; admission_number: string; avatar_url: string; roll_number: number; name: string;
  status: AttendanceStatus | null; remarks: string; attendance_id: string | null; updated_at: string | null;
}
export interface TeacherAttendance {
  date: string;
  class: { id: string; name: string; grade: string; section: string; room: string; board: string; term: string };
  periods: Array<{ id: string; period_number: number; starts_at: string; ends_at: string; display_title: string; room: string }>;
  roster: RosterStudent[];
}

/* Principal classes carry `id`/`name` (not class_section_id/class_name) and no period times. */
export interface PrincipalClass {
  id: string; name: string; grade: string; section: string; room_number: string; term_name: string; academic_year: string;
  student_count: number; marked_count: number; attending_count: number; absent_count: number; late_count: number;
  timetable_slots: number; unassigned_slots: number; attendance_percentage: number; submission_status: "not_started" | "in_progress" | "submitted";
}
export interface PrincipalHome {
  date: string; principal: { id: string; name: string };
  summary: { students: number; marked: number; attending: number; absent: number; late: number; attendance_percentage: number; classes_total: number; classes_submitted: number };
  classes: PrincipalClass[];
  exceptions: Array<{ id: string; admission_number: string; name: string; class_section_id: string; class_name: string; recorded_days: number; percentage: number; threshold: number }>;
}
export interface PrincipalTimetable {
  classes: Array<{ id: string; name: string; grade: string; section: string; room_number: string }>;
  subjects: Array<{ id: string; code: string; name: string; short_name: string; color: string }>;
  teachers: Array<{ id: string; name: string }>;
  slots: Array<{ id: string; class_section_id: string; class_name: string; subject_id: string | null; display_title: string; teacher_user_id: string | null; teacher_name: string | null; weekday: number; weekday_label: string; period_number: number; starts_at: string; ends_at: string; slot_type: "class" | "break" | "activity"; room: string }>;
  conflicts: Array<{ first_slot_id: string; second_slot_id: string; weekday: number; starts_at: string; ends_at: string; type: "teacher" | "room" }>;
}

export interface LeaveRequest {
  id: string; category: string; category_label?: string; starts_on: string; ends_on?: string; duration_days: number; status: string; status_label?: string;
  reason?: string; submitted_at?: string | null; requested_by_name: string; guardian_authorized_by_name: string | null; guardian_authorized_at: string | null;
  decided_by_name: string | null; decided_at: string | null;
  student?: { id: string; name?: string; display_name?: string; class_name?: string | null; admission_number?: string; avatar_url?: string | null };
  student_name?: string; class_name?: string;
  documents: Array<{ id: string; size_bytes: number; file_url: string; created_at: string }>;
  audit_log: Array<{ id: string; from_status: string | null; to_status?: string; actor_name: string; created_at: string; note?: string }>;
}
export interface Notification { id: string; kind: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }

export const staffApi = {
  teacherHome: (date?: string) => api<TeacherHome>(withQuery("/api/v1/screens/teacher/home/", { date })),
  teacherAttendance: (classSectionId: string, date?: string) =>
    api<TeacherAttendance>(withQuery("/api/v1/screens/teacher/attendance/", { class_section_id: classSectionId, date })),
  bulkAttendance: (body: { class_section_id: string; date: string; records: Array<{ student_id: string; status: AttendanceStatus; remarks?: string }> }) =>
    api<TeacherAttendance>("/api/v1/teacher/attendance/bulk/", { method: "POST", body: JSON.stringify(body) }),
  principalHome: (date?: string) => api<PrincipalHome>(withQuery("/api/v1/screens/principal/home/", { date })),
  principalTimetable: () => api<PrincipalTimetable>("/api/v1/screens/principal/timetable/"),
  leaves: (status?: string) => api<{ results: LeaveRequest[] }>(withQuery("/api/v1/leave-requests/", { status })),
  leaveAction: (id: string, action: "approve" | "reject" | "clarify", note?: string) =>
    api<LeaveRequest>(`/api/v1/leave-requests/${id}/${action}/`, { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
  notifications: () => api<{ results?: Notification[]; notifications?: Notification[] } | Notification[]>("/api/v1/notifications/"),
  markRead: (id: string) => api(`/api/v1/notifications/${id}/read/`, { method: "POST", body: "{}" }),
};

export function normaliseNotifications(v: Awaited<ReturnType<typeof staffApi.notifications>>): Notification[] {
  if (Array.isArray(v)) return v;
  return v.results ?? v.notifications ?? [];
}
