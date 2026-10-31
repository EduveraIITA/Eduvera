import { campusDate } from "./activityExperience";

/** First-use attendance starts now in the selected world's campus clock. */
export function attendanceStartTime(now: Date, timeZone: string): { date: string; start: string; end: string; endDayOffset: 0 | 1 } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? 0);
  const start = hour * 60 + minute;
  const end = (start + 60) % 1440;
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return { date: campusDate(now, timeZone), start: format(start), end: format(end), endDayOffset: start + 60 >= 1440 ? 1 : 0 };
}
