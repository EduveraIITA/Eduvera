/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface PeriodInput {
  subject_id?: string | null;
  period_number: number;
  starts_at: string;
  ends_at: string;
  title: string;
  slot_type: "class" | "break" | "activity";
  room: string;
  /** Canonical place identity; a room label alone cannot establish this link. */
  space_id?: string | null;
  teacher_user_id: string | null;
  cancelled: boolean;
  materials: string[];
}

export interface DayPeriod extends PeriodInput {
  id: string;
  /** Server-composed only when this dated session is in the viewer's teaching scope. */
  teaching_session_href?: string;
  teacher_name: string | null;
  coverage_status:
    "not_required" | "unassigned" | "pending" | "accepted" | "declined";
  response_revision: number;
  response_note: string;
  response_source: string | null;
  responded_at: string | null;
}

export interface DayContext {
  today: string;
  local_time: string;
  timezone: string;
  is_instructional: boolean | null;
  label: string | null;
}

export interface PlanOptions {
  classes: Array<{
    id: string;
    name: string;
    room_number: string;
    term_id: string;
    plan_id: string | null;
    revision: number | null;
    draft_version: number | null;
    published_version: number | null;
    unresolved: number;
  }>;
  teachers: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  schedule: Array<DayPeriod & { class_section_id: string }>;
  schedule_sources?: Array<{ id: string; class_section_id: string; term_id: string; revision: number; starts_on: string; ends_on: string }>;
  context: DayContext;
}

export interface PlanVersion {
  version: number;
  state: "draft" | "published" | "superseded" | "discarded";
  notice: string;
  reason: string;
  created_at: string;
  published_at: string | null;
  author: string;
}

export interface DayPlan {
  id: string;
  school_id: string;
  class_section_id: string;
  date: string;
  revision: number;
  draft_version: number | null;
  published_version: number | null;
  selected_version: number | null;
  owner_id: string;
  updated_at: string;
  versions: PlanVersion[];
  periods: DayPeriod[];
  published_periods: DayPeriod[];
  context: DayContext;
  conflicts: Array<{
    period_number: number;
    other_period: number;
    class_name: string;
    type: string;
  }>;
}

export interface TeacherDay {
  date: string;
  context: DayContext;
  schedule_sources?: Array<{
    id: string;
    class_section_id: string;
    term_id: string;
    revision: number;
    starts_on: string;
    ends_on: string;
  }>;
  periods: Array<
    DayPeriod & {
      class_name: string;
      class_section_id: string;
      day_plan_id: string | null;
      plan_version: number | null;
      notice: string;
      owner_name: string | null;
    }
  >;
}

export interface TeacherDaySummary {
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
