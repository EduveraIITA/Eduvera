import { apiFetch } from "../../lib/api";
import { campusDate } from "../activities/activityExperience";
import type { CampusEventDto, CampusEventListResponse, CampusEventStatus } from "../campus-events/types";
import type { ApiSchoolCalendarDay } from "../school/api";
import { diningAvailabilityNotice, type DiningAvailabilityPage } from "./diningAvailability";
import type { PublishedCampusDate } from "./campusPublishedDates";

export type CalendarCategory = "milestones" | "dates" | "events" | "assessments" | "services";
export interface CalendarEntry {
  id: string;
  category: CalendarCategory;
  title: string;
  startsOn: string;
  endsOn: string;
  startsAt?: string;
  endsAt?: string;
  allDay: boolean;
  location?: string;
  status?: string;
  summary?: string;
  href?: string;
  sourceId: string;
  revision?: number;
  publication?: PublishedCampusDate;
  categoryLabel?: string;
}
export interface CalendarSourceState {
  key: CalendarCategory;
  label: string;
  status: "loading" | "ready" | "partial" | "error";
  retry: () => void;
  message?: string;
}
export interface CampusCalendarScope {
  schoolId: string;
  timeZone: string;
  surfaceKey: string;
  studentId?: string;
  eventHref?: string;
  assessmentHref?: string;
  includeDining: boolean;
}
export interface CalendarSourceResult {
  entries: CalendarEntry[];
  partial: boolean;
}
export interface CalendarAssessmentDate {
  id: string;
  title: string;
  date: string;
  scheduled_at: string;
  duration_minutes: number | null;
  venue: string;
  subject_name: string;
  class_name: string;
}

const dayMilliseconds = 86_400_000;
const pageLimit = 10;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function calendarNextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + dayMilliseconds).toISOString().slice(0, 10);
}

function validateRange(from: string, until: string) {
  if (![from, until].every(value => dateOnly.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
    || until < from || Date.parse(until) - Date.parse(from) > 30 * dayMilliseconds) {
    throw new Error("Choose a calendar range of up to 31 days.");
  }
}

/** First real instant of the campus-local date, including a skipped midnight. */
function dateStart(date: string, timeZone: string) {
  const approximate = Date.parse(`${date}T00:00:00Z`);
  let lower = approximate - 36 * 3_600_000;
  let upper = approximate + 36 * 3_600_000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (campusDate(new Date(middle), timeZone) < date) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

/** Owner event filters are inclusive ISO instants, not device-local dates. */
export function calendarInstantRange(from: string, until: string, timeZone: string) {
  validateRange(from, until);
  return {
    from: new Date(dateStart(from, timeZone)).toISOString(),
    to: new Date(dateStart(calendarNextDate(until), timeZone) - 1).toISOString(),
  };
}

function entryDates(startsAt: string, endsAt: string, timeZone: string) {
  const start = Date.parse(startsAt), end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("A calendar source returned invalid dates.");
  return { startsOn: campusDate(new Date(start), timeZone), endsOn: campusDate(new Date(Math.max(start, end - 1)), timeZone) };
}

function sourceHref(base: string | undefined, kind: "events" | "assessments", id: string) {
  if (!base) return undefined;
  const target = new URL(base, "https://thatcampus.invalid");
  if (target.origin !== "https://thatcampus.invalid") return undefined;
  if (kind === "events") {
    if (!/^\/areas\/events\/(?:manage|assigned|calendar)\/?$/.test(target.pathname)) return undefined;
    target.pathname = `${target.pathname.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
  } else {
    // Family results are not an assessment-details route. Do not invent one.
    if (!/^\/areas\/assessments\/(?:manage|assigned)\/?$/.test(target.pathname)) return undefined;
    target.searchParams.set("assessment", id);
  }
  return `${target.pathname}${target.search}`;
}

export function calendarDateEntries(days: ApiSchoolCalendarDay[]): CalendarEntry[] {
  return days.map(day => ({
    id: `dates:${day.id}`, category: "dates", sourceId: day.id,
    title: day.label.trim() || "Academic date", startsOn: day.date, endsOn: day.date, allDay: true,
    revision: day.revision, summary: day.reason?.trim() || undefined,
    status: day.kind === "public_holiday" || day.kind === "local_holiday" ? "Holiday"
      : day.kind === "emergency_closure" ? "Closure"
        : day.kind === "instructional_override" ? "Teaching day changed" : undefined,
  }));
}

export async function loadCalendarDays(scope: CampusCalendarScope, from: string, until: string, signal?: AbortSignal) {
  validateRange(from, until);
  return apiFetch<{ results: ApiSchoolCalendarDay[] }>(`/api/v1/calendar/days/?${new URLSearchParams({ school_id: scope.schoolId, from, to: until })}`, { signal });
}

export async function loadCalendarEvents(scope: CampusCalendarScope, from: string, until: string, signal?: AbortSignal): Promise<CalendarSourceResult> {
  const range = calendarInstantRange(from, until, scope.timeZone);
  const statuses: CampusEventStatus[] = ["published", "completed", "cancelled"];
  const pages = await Promise.all(statuses.map(async status => {
    const items: CampusEventDto[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < pageLimit; page += 1) {
      const query = new URLSearchParams({ school_id: scope.schoolId, ...range, status, limit: "100" });
      if (scope.studentId) query.set("student_id", scope.studentId);
      if (cursor) query.set("cursor", cursor);
      const response = await apiFetch<CampusEventListResponse>(`/api/v1/campus-events?${query}`, { signal });
      items.push(...response.items.filter(item => item.status !== "draft"));
      cursor = response.next_cursor;
      if (!cursor) return { items, partial: false };
      if (seen.has(cursor)) return { items, partial: true };
      seen.add(cursor);
    }
    return { items, partial: true };
  }));
  const unique = new Map<string, CampusEventDto>();
  for (const event of pages.flatMap(page => page.items)) {
    if ((unique.get(event.id)?.revision ?? -1) <= event.revision) unique.set(event.id, event);
  }
  const entries: CalendarEntry[] = [...unique.values()].map(event => ({
    id: `events:${event.id}`, category: "events", sourceId: event.id, revision: event.revision,
    title: event.title, ...entryDates(event.starts_at, event.ends_at, scope.timeZone),
    startsAt: event.starts_at, endsAt: event.ends_at, allDay: false,
    location: event.venue || undefined, status: event.status === "cancelled" ? "Cancelled" : event.status === "completed" ? "Completed" : undefined,
    summary: event.status === "cancelled" ? event.cancellation_reason || undefined : undefined,
    href: sourceHref(scope.eventHref, "events", event.id),
  }));
  return { entries: entries.filter(entry => entry.startsOn <= until && entry.endsOn >= from), partial: pages.some(page => page.partial) };
}

export async function loadCalendarAssessments(scope: CampusCalendarScope, from: string, until: string, signal?: AbortSignal): Promise<CalendarSourceResult> {
  validateRange(from, until);
  const query = new URLSearchParams({ from, to: until });
  if (scope.studentId) query.set("student_id", scope.studentId);
  const result = await apiFetch<{ items: CalendarAssessmentDate[] }>(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/assessments/calendar/?${query}`, { signal });
  return { partial: false, entries: result.items.map(item => {
    const endsAt = new Date(Date.parse(item.scheduled_at) + Math.max(0, item.duration_minutes ?? 0) * 60_000).toISOString();
    return { id: `assessments:${item.id}`, category: "assessments", sourceId: item.id, title: item.title,
      ...entryDates(item.scheduled_at, endsAt, scope.timeZone), startsAt: item.scheduled_at,
      ...(item.duration_minutes ? { endsAt } : {}), allDay: false,
      location: item.venue || undefined, summary: [item.subject_name, item.class_name].filter(Boolean).join(" · ") || undefined,
      href: sourceHref(scope.assessmentHref, "assessments", item.id) };
  }) };
}

export async function loadCalendarServices(scope: CampusCalendarScope, from: string, until: string, signal?: AbortSignal): Promise<CalendarSourceResult> {
  validateRange(from, until);
  const items: DiningAvailabilityPage["items"] = [], warnings: NonNullable<DiningAvailabilityPage["warnings"]> = [];
  let partial = false;
  for (let page = 1; page <= pageLimit; page += 1) {
    const query = new URLSearchParams({ from, until, page: String(page) });
    const response = await apiFetch<DiningAvailabilityPage>(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/dining/availability?${query}`, { signal });
    items.push(...response.items);
    warnings.push(...response.warnings ?? []);
    if (page >= response.total_pages) break;
    if (page === pageLimit) partial = true;
  }
  const entries: CalendarEntry[] = items.filter(item => item.changed_for_date || item.state === "cancelled" || item.state === "paused").map(item => ({
    id: `services:${item.id}`, category: "services", sourceId: item.source_id, revision: item.source_revision,
    title: `${item.service_name} · ${item.label}`, ...entryDates(item.starts_at, item.ends_at, scope.timeZone),
    startsAt: item.starts_at, endsAt: item.ends_at, allDay: false, location: item.space_label || undefined,
    status: item.state === "cancelled" ? "Cancelled" : item.state === "paused" ? "Paused" : "Changed for this date",
    href: item.href,
  }));
  for (const warning of warnings) {
    if (items.some(item => item.plan_id === warning.plan_id && item.local_date === warning.local_date)) continue;
    entries.push({ id: `services:warning:${warning.plan_version_id}:${warning.local_date}:${warning.reason}`,
      category: "services", sourceId: warning.plan_id,
      title: warning.reason === "cancelled_for_date" ? "Dining cancelled" : "Dining hours need review",
      startsOn: warning.local_date, endsOn: warning.local_date, allDay: true,
      status: warning.reason === "cancelled_for_date" ? "Cancelled" : "Needs review",
      summary: diningAvailabilityNotice[warning.reason], href: warning.href });
  }
  const unique = new Map<string, CalendarEntry>();
  for (const entry of entries) if ((unique.get(entry.id)?.revision ?? -1) <= (entry.revision ?? -1)) unique.set(entry.id, entry);
  return { entries: [...unique.values()].filter(entry => entry.startsOn <= until && entry.endsOn >= from), partial };
}
