import type { TeacherDaySummary } from "./api";

const dayMs = 86_400_000;

export type TeacherCalendarView = "month" | "year";
export interface TeacherSummaryRange {
  start: string;
  end: string;
}

export function parseSchoolDate(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toSchoolDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function addSchoolDays(value: string, days: number) {
  const date = parseSchoolDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toSchoolDate(date);
}

export function firstOfMonth(value: string) {
  const date = parseSchoolDate(value);
  return toSchoolDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
  );
}

export function lastOfMonth(value: string) {
  const date = parseSchoolDate(value);
  return toSchoolDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
}

export function yearBounds(value: string) {
  const year = parseSchoolDate(value).getUTCFullYear();
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function eachDate(start: string, end: string) {
  const dates: string[] = [];
  const first = parseSchoolDate(start).getTime();
  const last = parseSchoolDate(end).getTime();
  for (let time = first; time <= last; time += dayMs) {
    dates.push(toSchoolDate(new Date(time)));
  }
  return dates;
}

export function visibleStrip(selected: string, radius = 7) {
  return eachDate(
    addSchoolDays(selected, -radius),
    addSchoolDays(selected, radius),
  );
}

export function summaryRange(
  selected: string,
  view: TeacherCalendarView,
): TeacherSummaryRange {
  if (view === "year") return yearBounds(selected);
  const strip = visibleStrip(selected);
  const monthStart = firstOfMonth(selected);
  const monthEnd = lastOfMonth(selected);
  const stripStart = strip[0] ?? monthStart;
  const stripEnd = strip[strip.length - 1] ?? monthEnd;
  return {
    start: stripStart < monthStart ? stripStart : monthStart,
    end: stripEnd > monthEnd ? stripEnd : monthEnd,
  };
}

export function monthDays(selected: string) {
  return eachDate(firstOfMonth(selected), lastOfMonth(selected));
}

export function groupSummaryByMonth(days: TeacherDaySummary["days"]) {
  const months = new Map<
    string,
    {
      month: string;
      periods: number;
      classes: number;
      pending: number;
      cancelled: number;
    }
  >();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const current = months.get(key) ?? {
      month: key,
      periods: 0,
      classes: 0,
      pending: 0,
      cancelled: 0,
    };
    current.periods += day.periods;
    current.classes += day.classes;
    current.pending += day.pending;
    current.cancelled += day.cancelled;
    months.set(key, current);
  }
  return [...months.values()];
}

export function compactDayLabel(value: string) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(parseSchoolDate(value));
  return {
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "",
    day: parts.find((part) => part.type === "day")?.value ?? value.slice(-2),
  };
}

export function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseSchoolDate(value));
}

export function shortMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    timeZone: "UTC",
  }).format(parseSchoolDate(`${value}-01`));
}
