interface CalendarCell {
  label: string;
}

interface CalendarRow {
  label: string;
  cells: CalendarCell[];
}

const periodStarts = ["08:30", "09:15", "10:00", "10:45", "11:15", "12:00", "12:45", "13:30"];

function calendarEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function stamp(value: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(value);
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  const compact = (part: number, width = 2) => String(part).padStart(width, "0");
  return {
    value: `${compact(date.getFullYear(), 4)}${compact(date.getMonth() + 1)}${compact(date.getDate())}T${compact(date.getHours())}${compact(date.getMinutes())}00`,
    date,
  };
}

function utcStamp(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function downloadWeekCalendar(rows: CalendarRow[], weekOffset: number) {
  const monday = new Date("2026-09-14T00:00:00");
  monday.setDate(monday.getDate() + weekOffset * 7);
  const now = utcStamp(new Date());
  const events = rows.flatMap((row, dayIndex) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + dayIndex);
    return row.cells.flatMap((cell, periodIndex) => {
      const startTime = periodStarts[periodIndex];
      if (!startTime || !cell.label.trim()) return [];
      const start = stamp(day, startTime);
      const endDate = new Date(start.date.getTime() + 40 * 60_000);
      const end = stamp(endDate, `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`);
      return [
        "BEGIN:VEVENT",
        `UID:${start.value}-${periodIndex}@edura.omnischool`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=Asia/Kolkata:${start.value}`,
        `DTEND;TZID=Asia/Kolkata:${end.value}`,
        `SUMMARY:${calendarEscape(cell.label)}`,
        `DESCRIPTION:${calendarEscape(`Class 7A - ${row.label} - Period ${periodIndex + 1}`)}`,
        "END:VEVENT",
      ].join("\r\n");
    });
  });
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ThatCampus//ThatCampus//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ThatCampus Class 7A",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "TZNAME:IST",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `thatcampus-class-7a-week-${12 + weekOffset}.ics`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
