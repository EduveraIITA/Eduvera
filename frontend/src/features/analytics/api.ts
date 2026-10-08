import { apiFetch } from "../../lib/api";
import type { Portal } from "../auth/AuthContext";
import type { ApiStudent } from "../school/api";

export type AnalyticsPeriod = "term" | "30" | "90";
export interface AttendanceMetric {
  present: number; late: number; half_day: number; absent: number; excused: number;
  recorded: number; denominator: number; attended: number; percentage: number | null;
}
export interface InstitutionSnapshot {
  as_of: string; enrollment_as_of: string; students: number; configured_classes: number; populated_classes: number;
  average_class_size: number | null; teaching_staff: number; non_teaching_staff: number; students_per_teacher: number | null;
  classes: Array<{ id: string; name: string; students: number }>;
}
export interface RegisterSubmission {
  expected: number; submitted: number; locked: number; outstanding: number; percentage: number | null;
  unscheduled_classes: number;
  classes: Array<{ id: string; name: string; expected: number; submitted: number; locked: number; outstanding: number; percentage: number | null; latest_unsubmitted: string | null }>;
}
export interface AnalyticsOverview {
  portal: Portal; generated_at: string; student: ApiStudent | null;
  term: { id: string; name: string; starts_on: string; ends_on: string; attendance_threshold: number };
  range: { period: AnalyticsPeriod; from: string; to: string; capped: boolean };
  scope_label: string;
  selected_class_id?: string | null;
  classes: Array<{ id: string; name: string }>;
  institution: InstitutionSnapshot | null;
  registers: RegisterSubmission | null;
  attendance: (AttendanceMetric & {
    trend: Array<AttendanceMetric & { date: string; end: string }>;
    classes: Array<AttendanceMetric & { id: string; name: string }>;
    subjects: Array<{ id: string; name: string; held: number; attended: number; excused: number; counted: number; percentage: number | null }>;
  }) | null;
  assessments: {
    overall: { scored: number; other: number; average: number | null; assessments: number; distribution: number[] };
    subjects: Array<{ id: string; name: string; scored: number; other: number; average: number | null; assessments: number }>;
    classes: Array<{ id: string; name: string; scored: number; other: number; average: number | null; assessments: number }>;
    pipeline: Array<{ status: string; count: number }>;
  } | null;
}

export function getAnalytics(schoolId: string, portal: Portal, period: AnalyticsPeriod, studentId?: string, classId?: string) {
  const params = new URLSearchParams({ period });
  if (studentId) params.set("student_id", studentId);
  if (classId) params.set("class_id", classId);
  return apiFetch<AnalyticsOverview>(`/api/v1/schools/${encodeURIComponent(schoolId)}/analytics/${portal}/?${params}`);
}
