import { shiftDate } from "../calendar/monthGrid";
import type { ActivityOccurrence, ActivityPlanInput, ActivityPurpose } from "./api";

export const purposeLabels: Record<ActivityPurpose, string> = { teaching: "Lesson", duty: "Duty", training: "Training", meeting: "Meeting", other: "Activity" };
export const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function activityPage(value: string | null) { const page = Number(value); return Number.isSafeInteger(page) && page > 0 ? page : 1; }
export function activityDate(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fallback;
}
export const weekdayOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
export function activityDates(date: string, view: "day" | "week") {
  const start = view === "day" ? date : shiftDate(date, 1 - weekdayOf(date));
  return Array.from({ length: view === "day" ? 1 : 7 }, (_, index) => shiftDate(start, index));
}
export function campusDate(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
/** Open near the first visible time segment, including overnight carryover. */
export function activityCalendarScrollTime(date: string, view: "day" | "week", timeZone: string, occurrences: Pick<ActivityOccurrence, "starts_at" | "ends_at" | "state">[]) {
  const dates = activityDates(date, view);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let firstHour = 24;
  for (const item of occurrences) {
    if (item.state === "cancelled") continue;
    const start = new Date(item.starts_at), end = new Date(item.ends_at);
    const startDate = campusDate(start, timeZone), endDate = campusDate(end, timeZone);
    const endsAtMidnight = clock.format(end) === "00:00:00" && end.getUTCMilliseconds() === 0;
    for (const day of dates) {
      if (day < startDate || day > endDate || (day === endDate && endsAtMidnight)) continue;
      firstHour = Math.min(firstHour, day === startDate ? Number(clock.format(start).slice(0, 2)) : 0);
    }
  }
  return `${String(firstHour === 24 ? 7 : Math.max(0, firstHour - 1)).padStart(2, "0")}:00:00`;
}
export function activityTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
export function activityInterval(start: string, end: string, timeZone: string) {
  const starts = new Date(start), ends = new Date(end);
  const nextDay = campusDate(starts, timeZone) !== campusDate(ends, timeZone);
  return `${activityTime(start, timeZone)}–${activityTime(end, timeZone)}${nextDay ? ` · ends ${new Intl.DateTimeFormat("en", { timeZone, day: "numeric", month: "short" }).format(ends)}` : ""}`;
}
export function initialActivity(date: string, timezone: string, start = "09:00", end = "10:00"): ActivityPlanInput {
  return { title: "", purpose: "other", description: "", timezone, starts_on: date, ends_on: date, recurrence: "once", weekdays: [weekdayOf(date)], starts_at: start, ends_at: end, end_day_offset: 0, space_id: null, person_ids: [], group_ids: [], lead_person_id: null, recorder_person_id: null, reviewer_person_id: null, attendance_mode: "roll_call", class_section_id: null, term_id: null, subject_id: null };
}
export function validateActivity(input: ActivityPlanInput, { publishing = true }: { publishing?: boolean } = {}): string | null {
  if (!input.title.trim()) return "Give this activity a name people will recognize.";
  if (!input.person_ids.length && !input.group_ids.length && !(input.space_id && input.attendance_mode === "none")) return "Choose an existing person or group, or reserve a campus place without attendance.";
  if (!input.starts_on || !input.starts_at || !input.ends_at) return "Choose the date and both times.";
  if (!input.end_day_offset && input.ends_at <= input.starts_at) return "The end time must follow the start, or choose Ends next day.";
  if (input.end_day_offset && input.ends_at > input.starts_at) return "An activity can last up to 24 hours. Adjust the end time.";
  if (input.recurrence === "weekly" && !input.weekdays.length) return "Choose at least one repeat day.";
  if (input.recurrence === "weekly" && input.ends_on === "") return "Choose a last date or leave the repeat open-ended.";
  if (input.ends_on && input.ends_on < input.starts_on) return "The last date cannot be before the first date.";
  if (publishing && input.attendance_mode === "roll_call" && !input.recorder_person_id) return "Choose an authorized attendance recorder before publishing. Go back to Time & place, or save a draft to finish later.";
  if (publishing && input.attendance_mode === "roll_call" && !input.reviewer_person_id) return "Choose the person responsible for reviewing attendance before publishing. Go back to Time & place, or save a draft to finish later.";
  if (Boolean(input.class_section_id) !== Boolean(input.term_id)) return "Choose both the academic group and term, or leave academic context off.";
  if (input.location_kind === "on_campus" && !input.space_id) return "Choose the campus place.";
  if (input.location_kind === "off_site" && !input.location_label?.trim()) return "Name the off-site location.";
  if (input.location_kind === "online" && !input.location_label?.trim() && !input.location_url?.trim()) return "Name the online meeting or add its joining link.";
  if (input.location_url) { try { const url = new URL(input.location_url); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "Use an http or https joining link without embedded credentials."; } catch { return "Use a complete joining link, starting with https://."; } }
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { return "Choose a valid IANA time zone, such as Europe/London."; }
  return null;
}
