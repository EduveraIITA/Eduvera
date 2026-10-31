/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
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
  revision: number;
  date: string;
  status: "present" | "absent" | "late" | "excused" | "half_day";
  check_in_at: string | null;
  check_out_at: string | null;
  remarks: string;
}

export interface ApiSchoolCalendarDay {
  id: string;
  date: string;
  is_instructional: boolean;
  label: string;
  kind?: "public_holiday" | "local_holiday" | "emergency_closure" | "instructional_override";
  reason?: string;
  revision?: number;
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
  completed: boolean | null;
  completed_at: string | null;
  published_at: string;
  notes: Array<{ id: string; author_name: string; body: string; created_at: string }>;
}

export interface ParentDiaryResponse {
  student: ApiStudent;
  date: string;
  items: ApiDiaryItem[];
  schedule: ApiTimetableSlot[];
  guardian?: { name: string; relationship: string; verified_id: string };
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
