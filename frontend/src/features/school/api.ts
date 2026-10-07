import { ApiError, apiFetch } from "../../lib/api";
import { schoolDateToday } from "../../lib/schoolTime";
import type {PublishedDayNotice} from '../day-plans/DayPlanNotice';
import type { HomeAction } from "../home-actions/types";

export interface ApiUser {
  id: string | null;
  display_name: string;
}

export interface ApiEnrollment {
  class_name: string;
  grade: string;
  section: string;
  board: string;
  room_number: string;
  roll_number: number;
  term: { name: string; academic_year: string; starts_on: string; ends_on: string };
}

export interface ApiStudent {
  id: string;
  user: ApiUser;
  admission_number: string;
  avatar_url: string;
  current_enrollment: ApiEnrollment;
}

export interface ApiAttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  half_day: number;
  percentage: number;
}

export interface ApiSubjectAttendance {
  id: string;
  subject: { id: string; code: string; name: string; short_name: string; color: string };
  classes_held: number;
  classes_attended: number;
  classes_excused: number;
  percentage: string | number;
  room?: string | null;
  teacher?: { id: string; name: string; designation: string } | null;
  next_class?: { weekday: number; weekday_label: string; starts_at: string } | null;
}

export interface ApiAttendanceRecord {
  id: string;
  date: string;
  status: "present" | "absent" | "late" | "excused" | "half_day";
  check_in_at: string | null;
  check_out_at: string | null;
  remarks: string;
}

export interface ApiGateEvent {
  occurred_at: string;
  direction: "in" | "out";
  gate: string;
  source: string;
}

export interface ApiSchoolCalendarDay {
  date: string;
  is_instructional: boolean;
  label: string;
  kind?: "public_holiday" | "local_holiday" | "emergency_closure" | "instructional_override";
  reason?: string;
  revision?: number;
}

export function getSchoolCalendarDays(schoolId: string, from: string, to: string) {
  return apiFetch<{ results: ApiSchoolCalendarDay[] }>(withQuery("/api/v1/calendar/days/", { school_id: schoolId, from, to }));
}

export interface ApiTimetableSlot {
  cancelled?:boolean; materials?:string[]; day_plan_id?:string|null; plan_version?:number|null; notice?:string;date?:string|null;
  id: string;
  weekday: number;
  weekday_label: string;
  period_number: number;
  starts_at: string;
  ends_at: string;
  display_title: string;
  room: string;
  subject: { id: string; code: string; name: string; short_name: string; color?: string; icon?: string } | null;
  teacher: { id: string; name: string; designation: string } | null;
}

export interface ApiLeaveDocument {
  id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  file_url: string | null;
}

export interface ApiLeaveAudit {
  id: string;
  action: string;
  action_label: string;
  note: string;
  actor_name: string;
  created_at: string;
}

export interface ApiLeaveRequest {
  id: string;
  student_id: string;
  category: "medical" | "family" | "travel" | "personal";
  category_label: string;
  starts_on: string;
  ends_on: string;
  duration_days: number;
  reason: string;
  status: string;
  status_label: string;
  requested_by_name: string;
  submitted_at: string | null;
  guardian_authorized_by_name: string | null;
  guardian_authorized_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  documents: ApiLeaveDocument[];
  audit_log: ApiLeaveAudit[];
}

export interface ApiDiaryItem {
  id: string;
  date: string;
  item_type: "note" | "homework" | "announcement" | "schedule";
  item_type_label: string;
  subject: { id: string; name: string; short_name: string } | null;
  title: string;
  body: string;
  author_name: string;
  due_at: string | null;
  requires_acknowledgement: boolean;
  acknowledged: boolean;
  published_at: string;
  notes: Array<{ id: string; author_name: string; body: string; created_at: string }>;
}

export interface ApiSchoolContact {
  id: string;
  label: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  availability: string;
}

export interface ParentHomeResponse {
  day_plan?:PublishedDayNotice|null;
  student: ApiStudent;
  siblings: ApiStudent[];
  campus_presence: ApiGateEvent | null;
  attendance: ApiAttendanceSummary;
  ranking?: ApiAttendanceRanking;
  action_required: ApiLeaveRequest | null;
  home_actions: HomeAction[];
  more_attention?: Record<string, number>;
  today_schedule: ApiTimetableSlot[];
  diary_preview: ApiDiaryItem[];
  unread_notifications: number;
  homework_items?: Array<{ id: string; title: string; body: string; subject_name: string | null; due_at: string | null; published_at: string; completed_at: string | null }>;
  semester_metrics: {
    attendance_percentage: number;
    attendance_threshold?: number;
    attendance_trend_percent?: number | null;
    attendance_rank?: number | null;
    attendance_cohort_size?: number | null;
    periods_today: number;
    homework_due: number;
    homework_total?: number;
    homework_recent?: number;
    homework_previous?: number;
    dues_status: string;
    dues_status_scope?: string;
  };
  contacts: ApiSchoolContact[];
}

export interface ParentAttendanceResponse {
  student: ApiStudent;
  term: { name: string; academic_year: string; threshold: string | number };
  summary: ApiAttendanceSummary;
  ranking?: ApiAttendanceRanking;
  today: ApiAttendanceRecord | null;
  latest_gate_event: ApiGateEvent | null;
  expected_dismissal_at?: string | null;
  calendar: ApiAttendanceRecord[];
  subjects: ApiSubjectAttendance[];
  contacts?: ApiSchoolContact[];
}

export interface ParentDiaryResponse {
  student: ApiStudent;
  date: string;
  items: ApiDiaryItem[];
  schedule: ApiTimetableSlot[];
  guardian?: { name: string; relationship: string; verified_id: string };
}

export interface StudentDiaryResponse {
  student: ApiStudent;
  date_from: string;
  date_to: string;
  items: ApiDiaryItem[];
}

export interface ParentLeaveResponse {
  student: ApiStudent;
  request: ApiLeaveRequest;
  can_authorize: boolean;
  history: ApiLeaveRequest[];
  constraints: LeaveConstraints;
}

export interface ParentLeaveRouteResponse {
  student: ApiStudent;
  request: ApiLeaveRequest | null;
  can_authorize: boolean;
  history: ApiLeaveRequest[];
  constraints?: LeaveConstraints;
}

export interface ApiAttendanceRanking {
  published: boolean;
  as_of: string;
  cohort_size: number;
  minimum_recorded_days: number;
  methodology: string;
  current_rank: number | null;
  current_streak?: number;
  leaders: Array<{ rank: number; name: string; avatar_url?: string | null; attended: number; held: number; streak?: number; percentage: number }>;
  students?: Array<{ rank: number | null; name: string; avatar_url?: string | null; attended: number; held: number; streak?: number; percentage: number | null; is_current: boolean }>;
}

export interface StudentAttendanceResponse {
  student: ApiStudent;
  term: { name: string; academic_year: string; threshold: string | number };
  summary: ApiAttendanceSummary;
  subjects: ApiSubjectAttendance[];
  ranking?: ApiAttendanceRanking;
  calendar?: ApiAttendanceRecord[];
}

export interface StudentHomeResponse {
  day_plan?:PublishedDayNotice|null;
  student: ApiStudent;
  term: { name: string; academic_year: string; threshold: string | number };
  date: string;
  attendance: ApiAttendanceSummary;
  today_attendance: ApiAttendanceRecord | null;
  campus_presence: ApiGateEvent | null;
  today_schedule: ApiTimetableSlot[];
  diary_preview: ApiDiaryItem[];
  active_leave_count: number;
  unread_notifications: number;
  home_actions: HomeAction[];
  more_attention?: Record<string, number>;
}

export interface StudentEligibilityResponse {
  student: ApiStudent;
  subject: ApiSubjectAttendance;
  projection: {
    additional_missed: number;
    projected_percentage: number;
    eligible: boolean;
    threshold: number;
  };
  policy: { name: string; minimum_percentage: number; text: string };
}

export interface StudentTimetableResponse {
  day_plan?:PublishedDayNotice|null;
  student: ApiStudent;
  mode: "day" | "week";
  selected_date: string;
  class_name: string;
  days: Array<{ weekday: number; weekday_label: string; periods: ApiTimetableSlot[] }>;
}

export interface TimetableSummaryResponse {
  start: string;
  end: string;
  days: Array<{
    date: string;
    periods: number;
    classes: number;
    pending: number;
    accepted: number;
    declined: number;
    cancelled: number;
  }>;
  totals: {
    periods: number;
    classes: number;
    pending: number;
    accepted: number;
    declined: number;
    cancelled: number;
  };
}

export interface StudentLeaveStatusResponse {
  student: ApiStudent;
  active: ApiLeaveRequest[];
  history: ApiLeaveRequest[];
}

export interface StudentLeaveApplyResponse {
  student: ApiStudent;
  categories: Array<{ value: string; label: string }>;
  guardians: Array<{
    id: string;
    relationship: string;
    is_primary: boolean;
    can_authorize_leave: boolean;
    guardian: { id: string; user_id: string | null; name: string; email: string; phone: string };
  }>;
  recent_requests: ApiLeaveRequest[];
  constraints: LeaveConstraints;
}

export interface LeaveConstraints {
  max_duration_days: number;
  medical_document_after_days: number | null;
  accepted_documents: string[];
  max_document_size_bytes: number;
}

function withQuery(path: string, values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function getAccessibleStudents() {
  return apiFetch<{ results: ApiStudent[] }>("/api/v1/students/");
}

export function getParentHome(studentId?: string) {
  return apiFetch<ParentHomeResponse>(withQuery("/api/v1/screens/parent/home/", { student_id: studentId }));
}

export function setHomeworkCompleted(itemId: string, studentId: string, completed: boolean) {
  return apiFetch(`/api/v1/homework/${itemId}/complete/${completed ? "" : `?student_id=${encodeURIComponent(studentId)}`}`, completed
    ? { method: "POST", body: JSON.stringify({ student_id: studentId }) }
    : { method: "DELETE" });
}

export function getParentAttendance(studentId?: string) {
  return Promise.all([
    apiFetch<Omit<ParentAttendanceResponse, "subjects">>(withQuery("/api/v1/screens/parent/attendance/", { student_id: studentId })),
    apiFetch<{ results: ApiSubjectAttendance[] }>(withQuery("/api/v1/students/attendance/subjects/", { student_id: studentId })),
    getParentHome(studentId),
  ]).then(([screen, subjects, home]) => ({
    ...screen,
    subjects: subjects.results,
    contacts: home.contacts,
  }));
}

export function getParentDiary(date?: string, studentId?: string) {
  return apiFetch<ParentDiaryResponse>(withQuery("/api/v1/screens/parent/diary/", {
    date,
    student_id: studentId,
  }));
}

export async function getParentLeave(leaveId?: string, studentId?: string): Promise<ParentLeaveRouteResponse> {
  const [home, requests] = await Promise.all([
    getParentHome(studentId),
    apiFetch<{ results: ApiLeaveRequest[] }>(withQuery("/api/v1/leave-requests/", { student_id: studentId })),
  ]);
  const pendingRequests = requests.results.filter((item) => item.status === "pending_guardian");
  const pending = leaveId
    ? pendingRequests.find((item) => item.id === leaveId)
    : pendingRequests.find((item) => item.id === home.action_required?.id) ?? pendingRequests[0];
  const history = requests.results.filter((item) => item.status !== "pending_guardian");
  if (!pending) {
    return {
      student: home.student,
      request: null,
      can_authorize: false,
      history,
    };
  }
  const screen = await apiFetch<Omit<ParentLeaveResponse, "history">>(
    withQuery(`/api/v1/screens/parent/leave/${pending.id}/`, { student_id: studentId }),
  );
  if (screen.request.status !== "pending_guardian") {
    return {
      student: screen.student,
      request: null,
      can_authorize: false,
      history: requests.results.filter((item) => item.id !== screen.request.id),
      constraints: screen.constraints,
    };
  }
  return { ...screen, history };
}

export function getStudentAttendance() {
  return apiFetch<StudentAttendanceResponse>("/api/v1/screens/student/attendance/");
}

export function getStudentHome() {
  return apiFetch<StudentHomeResponse>("/api/v1/screens/student/home/");
}

export function getStudentDiary(dateFrom?: string, dateTo?: string) {
  return Promise.all([
    getStudentHome(),
    apiFetch<{ results: ApiDiaryItem[] }>(withQuery("/api/v1/diary/", {
      date_from: dateFrom,
      date_to: dateTo,
    })),
  ]).then(([home, diary]) => ({
    student: home.student,
    date_from: dateFrom ?? schoolDateToday(),
    date_to: dateTo ?? schoolDateToday(),
    items: diary.results,
  }));
}

export function getStudentEligibility() {
  return apiFetch<StudentEligibilityResponse>("/api/v1/screens/student/attendance/eligibility/");
}

export function getStudentTimetable(date?: string) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiFetch<StudentTimetableResponse>(`/api/v1/screens/student/timetable/week/${query}`);
}

export async function getParentTimetable(date?: string, studentId?: string): Promise<StudentTimetableResponse> {
  return apiFetch<StudentTimetableResponse>(withQuery('/api/v1/screens/parent/timetable/week/',{date,student_id:studentId}));
}

function timetableDatesBetween(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function timetableWeekStart(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function timetableDateForWeekday(weekStart: string, weekday: number) {
  const value = new Date(`${weekStart}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Math.max(0, Math.min(6, weekday - 1)));
  return value.toISOString().slice(0, 10);
}

/**
 * Older review deployments expose the published week screen but not the newer
 * summary route. Build the same calendar totals from those dated, effective
 * schedules so role portals continue to work during a rolling deployment.
 */
export function buildTimetableSummaryFromWeeklyTimetables(
  timetables: StudentTimetableResponse[],
  start: string,
  end: string,
): TimetableSummaryResponse {
  const days = timetableDatesBetween(start, end).map((date) => ({
    date,
    periods: 0,
    classes: 0,
    pending: 0,
    accepted: 0,
    declined: 0,
    cancelled: 0,
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));

  for (const timetable of timetables) {
    const weekStart = timetableWeekStart(timetable.selected_date);
    for (const day of timetable.days) {
      const datedPeriod = day.periods.find((period) => period.date)?.date;
      const date = datedPeriod ?? timetableDateForWeekday(weekStart, day.weekday);
      const summary = byDate.get(date);
      if (!summary) continue;
      const activePeriods = day.periods.filter((period) => !period.cancelled).length;
      summary.periods = activePeriods;
      summary.classes = activePeriods > 0 ? 1 : 0;
      summary.cancelled = day.periods.length - activePeriods;
    }
  }

  const totals = days.reduce(
    (sum, day) => ({
      periods: sum.periods + day.periods,
      classes: sum.classes + day.classes,
      pending: sum.pending + day.pending,
      accepted: sum.accepted + day.accepted,
      declined: sum.declined + day.declined,
      cancelled: sum.cancelled + day.cancelled,
    }),
    { periods: 0, classes: 0, pending: 0, accepted: 0, declined: 0, cancelled: 0 },
  );
  return { start, end, days, totals };
}

async function legacyTimetableSummary(
  start: string,
  end: string,
  loadWeek: (date: string) => Promise<StudentTimetableResponse>,
) {
  const weekStarts: string[] = [];
  const cursor = new Date(`${timetableWeekStart(start)}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    weekStarts.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  const timetables: StudentTimetableResponse[] = [];
  // Keep a year view bounded instead of sending every compatibility request at once.
  for (let index = 0; index < weekStarts.length; index += 6) {
    const batch = await Promise.all(
      weekStarts.slice(index, index + 6).map(async (weekStart) => {
        try {
          return await loadWeek(weekStart);
        } catch (error) {
          // A week outside the student's enrolled term is legitimately empty.
          if (error instanceof ApiError && error.status === 404) return undefined;
          throw error;
        }
      }),
    );
    timetables.push(...batch.filter((item): item is StudentTimetableResponse => Boolean(item)));
  }
  return buildTimetableSummaryFromWeeklyTimetables(timetables, start, end);
}

async function timetableSummaryWithCompatibility(
  path: string,
  start: string,
  end: string,
  loadWeek: (date: string) => Promise<StudentTimetableResponse>,
) {
  try {
    return await apiFetch<TimetableSummaryResponse>(path);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    return legacyTimetableSummary(start, end, loadWeek);
  }
}

export function getStudentTimetableSummary(start: string, end: string, date?: string) {
  return timetableSummaryWithCompatibility(
    withQuery("/api/v1/screens/student/timetable-summary/", { start, end, date }),
    start,
    end,
    (weekStart) => getStudentTimetable(weekStart),
  );
}

export function getParentTimetableSummary(start: string, end: string, date?: string, studentId?: string) {
  return timetableSummaryWithCompatibility(
    withQuery("/api/v1/screens/parent/timetable-summary/", { start, end, date, student_id: studentId }),
    start,
    end,
    (weekStart) => getParentTimetable(weekStart, studentId),
  );
}

export function getStudentLeaveStatus() {
  return apiFetch<StudentLeaveStatusResponse>("/api/v1/screens/student/leave/status/");
}

export function getStudentLeaveApply() {
  return apiFetch<StudentLeaveApplyResponse>("/api/v1/screens/student/leave/apply/");
}

export async function performLeaveAction(
  leaveId: string,
  action: "authorize" | "clarify" | "decline" | "withdraw",
  note = "",
) {
  return apiFetch<ApiLeaveRequest>(`/api/v1/leave-requests/${leaveId}/${action}/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export interface NewLeavePayload {
  category: "medical" | "family" | "travel" | "personal";
  starts_on: string;
  ends_on: string;
  reason: string;
  file?: File | null;
  student_id?: string;
}

export async function createLeave(payload: NewLeavePayload) {
  if (payload.file) {
    const form = new FormData();
    form.set("category", payload.category);
    form.set("starts_on", payload.starts_on);
    form.set("ends_on", payload.ends_on);
    form.set("reason", payload.reason);
    if (payload.student_id) form.set("student_id", payload.student_id);
    form.set("file", payload.file);
    return apiFetch<ApiLeaveRequest>("/api/v1/leave-requests/", {
      method: "POST",
      body: form,
    });
  }
  return apiFetch<ApiLeaveRequest>("/api/v1/leave-requests/", {
    method: "POST",
    body: JSON.stringify({
      category: payload.category,
      starts_on: payload.starts_on,
      ends_on: payload.ends_on,
      reason: payload.reason,
      ...(payload.student_id ? { student_id: payload.student_id } : {}),
    }),
  });
}

export function uploadLeaveDocument(leaveId: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  return apiFetch<ApiLeaveDocument>(`/api/v1/leave-requests/${leaveId}/documents/`, {
    method: "POST",
    body: form,
  });
}

export function acknowledgeDiary(itemId: string, studentId: string) {
  return apiFetch(`/api/v1/diary/${itemId}/acknowledge/`, {
    method: "POST",
    body: JSON.stringify({ student_id: studentId }),
  });
}

export function addDiaryNote(itemId: string, studentId: string, body: string) {
  return apiFetch(`/api/v1/diary/${itemId}/notes/`, {
    method: "POST",
    body: JSON.stringify({ student_id: studentId, body }),
  });
}
