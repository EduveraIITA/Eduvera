import { api, withQuery } from "../lib/api";
import type { AttendanceStatus } from "./staff";

/* Family-side API: guardians and learners. Same endpoints the mobile app uses. */

export interface Student {
  id: string;
  user: { id: string; display_name: string };
  admission_number: string;
  avatar_url: string;
  current_enrollment: { class_name: string; grade: string; section: string; board: string; room_number: string; roll_number: number; term: { name: string; academic_year: string; starts_on: string; ends_on: string } };
}
export interface AttendanceSummary { total: number; present: number; absent: number; late: number; excused: number; half_day: number; percentage: number }
export interface SubjectAttendance {
  id: string; subject: { id: string; code: string; name: string; short_name: string; color: string };
  classes_held: number; classes_attended: number; classes_excused: number; percentage: string | number;
  room?: string | null; teacher?: { id: string; name: string; designation: string } | null;
  next_class?: { weekday: number; weekday_label: string; starts_at: string } | null;
}
export interface AttendanceRecord { id: string; date: string; status: AttendanceStatus; check_in_at: string | null; check_out_at: string | null; remarks: string }
export interface GateEvent { occurred_at: string; direction: "in" | "out" }
export interface Slot {
  id: string; weekday: number; weekday_label: string; period_number: number; starts_at: string; ends_at: string; display_title: string; room: string;
  slot_type?: "class" | "break" | "activity";
  subject: { id: string; code: string; name: string; short_name: string; color?: string | null } | null; teacher: { id: string; name: string; designation: string } | null;
}
export interface Leave {
  id: string; student_id: string; category: string; category_label: string; starts_on: string; ends_on: string; duration_days: number;
  reason: string; status: string; status_label: string; requested_by_name: string; submitted_at: string | null;
  guardian_authorized_by_name: string | null; guardian_authorized_at: string | null; decided_by_name: string | null; decided_at: string | null;
  documents: Array<{ id: string; file_url: string; created_at: string; size_bytes: number }>;
  audit_log: Array<{ id: string; from_status: string | null; to_status?: string; actor_name: string; created_at: string; note?: string }>;
}
export interface DiaryItem {
  id: string; date: string; item_type: "note" | "homework" | "announcement" | "schedule"; item_type_label: string;
  subject: { id: string; name: string; short_name: string } | null; title: string; body: string; author_name: string;
  due_at: string | null; requires_acknowledgement: boolean; acknowledged: boolean; published_at: string;
  notes: Array<{ id: string; author_name: string; body: string; created_at: string }>;
}
export interface Contact { id?: string; name: string; label?: string; role?: string; designation?: string; phone?: string | null; email?: string | null; availability?: string | null }

export interface ParentHome {
  student: Student; siblings: Student[]; campus_presence: GateEvent | null; attendance: AttendanceSummary;
  action_required: Leave | null; today_schedule: Slot[]; diary_preview: DiaryItem[]; unread_notifications: number;
  semester_metrics: { attendance_percentage: number; attendance_threshold?: number; periods_today: number; homework_due: number; dues_status: string };
  contacts: Contact[];
}
export interface ParentAttendance {
  student: Student; term: { name: string; academic_year: string; threshold: string | number }; summary: AttendanceSummary;
  today: AttendanceRecord | null; latest_gate_event: GateEvent | null; expected_dismissal_at?: string | null; calendar: AttendanceRecord[]; contacts?: Contact[];
}
export interface StudentHome {
  student: Student; term: { name: string; academic_year: string; threshold: string | number }; date: string; attendance: AttendanceSummary;
  today_attendance: AttendanceRecord | null; campus_presence: GateEvent | null; today_schedule: Slot[]; diary_preview: DiaryItem[];
  active_leave_count: number; unread_notifications: number;
}
export interface StudentAttendance {
  student: Student; term: { name: string; academic_year: string; threshold: string | number }; summary: AttendanceSummary; subjects: SubjectAttendance[];
  ranking?: { published: boolean; as_of: string; cohort_size: number; current_rank: number | null; current_streak?: number; methodology: string;
    leaders: Array<{ rank: number; name: string; attended: number; held: number; percentage: number }> };
}
export interface WeekTimetable { student: Student; mode: "day" | "week"; selected_date: string; class_name: string; days: Array<{ weekday: number; weekday_label: string; periods: Slot[] }> }
export interface LeaveStatus { student: Student; active: Leave[]; history: Leave[] }

export const familyApi = {
  parentHome: (studentId?: string) => api<ParentHome>(withQuery("/api/v1/screens/parent/home/", { student_id: studentId })),
  parentAttendance: (studentId?: string) => api<ParentAttendance>(withQuery("/api/v1/screens/parent/attendance/", { student_id: studentId })),
  subjectAttendance: (studentId?: string) => api<{ results: SubjectAttendance[] }>(withQuery("/api/v1/students/attendance/subjects/", { student_id: studentId })),
  parentDiary: (date: string, studentId?: string) => api<{ student: Student; date: string; items: DiaryItem[]; schedule: Slot[] }>(withQuery("/api/v1/screens/parent/diary/", { date, student_id: studentId })),
  timetable: (studentId?: string, date?: string) => api<{ results: Slot[] }>(withQuery("/api/v1/students/timetable/", { student_id: studentId, date })),
  studentHome: () => api<StudentHome>("/api/v1/screens/student/home/"),
  studentAttendance: () => api<StudentAttendance>("/api/v1/screens/student/attendance/"),
  studentWeek: (date?: string) => api<WeekTimetable>(withQuery("/api/v1/screens/student/timetable/week/", { date })),
  studentLeaveStatus: () => api<LeaveStatus>("/api/v1/screens/student/leave/status/"),
  diary: (dateFrom?: string, dateTo?: string, studentId?: string) => api<{ results: DiaryItem[] }>(withQuery("/api/v1/diary/", { date_from: dateFrom, date_to: dateTo, student_id: studentId })),
  acknowledge: (itemId: string, studentId: string) => api(`/api/v1/diary/${itemId}/acknowledge/`, { method: "POST", body: JSON.stringify({ student_id: studentId }) }),
  leaves: (studentId?: string) => api<{ results: Leave[] }>(withQuery("/api/v1/leave-requests/", { student_id: studentId })),
  leaveAction: (id: string, action: "authorize" | "clarify" | "decline" | "withdraw", note?: string) =>
    api<Leave>(`/api/v1/leave-requests/${id}/${action}/`, { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
  createLeave: (body: { category: string; starts_on: string; ends_on: string; reason: string; student_id?: string }) =>
    api<Leave>("/api/v1/leave-requests/", { method: "POST", body: JSON.stringify(body) }),
};
