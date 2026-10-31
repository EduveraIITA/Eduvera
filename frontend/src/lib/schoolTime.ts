import { applicationNow } from "../features/simulation/applicationTime";
export const schoolTimeZone = "Asia/Kolkata";

export interface SchoolClock {
  date: string;
  weekday: number;
  minutes: number;
}

function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

export function schoolClock(now = applicationNow()): SchoolClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: schoolTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minutes: value("hour") * 60 + value("minute"),
  };
}

export function schoolDateToday(now = applicationNow()) {
  return schoolClock(now).date;
}

export function shiftSchoolDate(days: number, from = schoolDateToday()) {
  const value = calendarDate(from);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

