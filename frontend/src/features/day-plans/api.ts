import { ApiError, apiFetch } from "../../lib/api";
import {
  getPrincipalTimetable,
  type PrincipalTimetableResponse,
} from "../operations/api";
export interface PeriodInput {
  subject_id?: string | null;
  period_number: number;
  starts_at: string;
  ends_at: string;
  title: string;
  slot_type: "class" | "break" | "activity";
  room: string;
  teacher_user_id: string | null;
  cancelled: boolean;
  materials: string[];
}
export interface DayPeriod extends PeriodInput {
  id: string;
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
export interface Command {
  school_id: string;
  idempotency_key: string;
}
const base = "/api/v1/day-plans";
export const getPlanOptions = (schoolId: string, date: string) =>
  apiFetch<PlanOptions>(
    `${base}/options?${new URLSearchParams({ school_id: schoolId, date })}`,
  );
export const getDayPlan = (schoolId: string, id: string) =>
  apiFetch<DayPlan>(`${base}/${id}?school_id=${schoolId}`);
export const getTeacherDay = (schoolId: string, date: string) =>
  apiFetch<TeacherDay>(
    `${base}/teacher?${new URLSearchParams({ school_id: schoolId, date })}`,
  );
export const getTeacherSummary = (
  schoolId: string,
  start: string,
  end: string,
) =>
  apiFetch<TeacherDaySummary>(
    `${base}/teacher/summary?${new URLSearchParams({
      school_id: schoolId,
      start,
      end,
    })}`,
  );
export const getAdminSummary = (
  schoolId: string,
  start: string,
  end: string,
  classSectionId?: string,
) =>
  apiFetch<TeacherDaySummary>(
    `${base}/admin/summary?${new URLSearchParams({
      school_id: schoolId,
      start,
      end,
      ...(classSectionId ? { class_section_id: classSectionId } : {}),
    })}`,
  ).catch(async (error: unknown) => {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    return getAdminSummaryFromPublishedTimetable(start, end, classSectionId);
  });

function datesBetween(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function selectedTerm(data: PrincipalTimetableResponse) {
  return data.terms.find((term) => term.id === data.selected_term_id);
}

export function buildAdminSummaryFromPublishedTimetables(
  timetables: PrincipalTimetableResponse[],
  start: string,
  end: string,
  classSectionId?: string,
): TeacherDaySummary {
  const days = datesBetween(start, end).map((date) => {
    const timetable = timetables.find((candidate) => {
      const term = selectedTerm(candidate);
      return term && date >= term.starts_on && date <= term.ends_on;
    });
    const closed = timetable?.calendar_exceptions.some(
      (item) => item.date === date && !item.is_instructional,
    );
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    const slots = !timetable || closed
      ? []
      : timetable.slots.filter(
          (slot) =>
            slot.weekday === weekday &&
            (!classSectionId || slot.class_section_id === classSectionId),
        );
    return {
      date,
      periods: slots.length,
      classes: new Set(slots.map((slot) => slot.class_section_id)).size,
      pending: slots.filter((slot) => !slot.teacher_user_id).length,
      accepted: 0,
      declined: 0,
      cancelled: 0,
    };
  });
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

async function getAdminSummaryFromPublishedTimetable(
  start: string,
  end: string,
  classSectionId?: string,
) {
  const current = await getPrincipalTimetable();
  const overlappingTerms = current.terms.filter(
    (term) => term.starts_on <= end && term.ends_on >= start,
  );
  const timetables = await Promise.all(
    overlappingTerms.map((term) =>
      term.id === current.selected_term_id
        ? Promise.resolve(current)
        : getPrincipalTimetable(term.id),
    ),
  );
  return buildAdminSummaryFromPublishedTimetables(
    timetables,
    start,
    end,
    classSectionId,
  );
}
const post = <T>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });
export const startDayPlan = (
  body: Command & { class_section_id: string; date: string },
) => post<{ id: string; revision: number }>(base, body);
export const saveDayPlan = (
  id: string,
  body: Command & {
    expected_revision: number;
    notice: string;
    reason: string;
    periods: PeriodInput[];
  },
) => post<{ id: string; revision: number }>(`${base}/${id}/save`, body);
export const publishDayPlan = (
  id: string,
  body: Command & { expected_revision: number },
) =>
  post<{ id: string; revision: number; version: number }>(
    `${base}/${id}/publish`,
    body,
  );
export const discardDayPlan = (
  id: string,
  body: Command & { expected_revision: number },
) => post<{ id: string; revision: number }>(`${base}/${id}/discard`, body);
export const respondCoverage = (
  id: string,
  body: Command & {
    expected_revision: number;
    status: "accepted" | "declined";
    note: string;
    source: "app" | "phone" | "paper" | "in_person";
    received_at?: string;
  },
) =>
  post<{ id: string; status: string; response_revision: number }>(
    `${base}/periods/${id}/respond`,
    body,
  );
export const periodInput = (p: PeriodInput): PeriodInput => ({
  subject_id: p.subject_id ?? null,
  period_number: p.period_number,
  starts_at: p.starts_at.slice(0, 5),
  ends_at: p.ends_at.slice(0, 5),
  title: p.title,
  slot_type: p.slot_type,
  room: p.room,
  teacher_user_id: p.teacher_user_id,
  cancelled: p.cancelled,
  materials: p.materials,
});
/** A first draft does not replace the shared weekly baseline until publication. */
export function sharedDayPeriods(
  plan: DayPlan | undefined,
  schedule: PlanOptions["schedule"],
  classId: string,
) {
  return plan?.published_version
    ? plan.published_periods
    : schedule.filter((period) => period.class_section_id === classId);
}
export function timeLabel(value: string) {
  const [h, m] = value.split(":");
  const hour = Number(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
