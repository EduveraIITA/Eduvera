import { schoolDateToday } from "../../lib/schoolTime";

export interface MonthCell {
  iso: string;        // YYYY-MM-DD
  day: number;        // 1..31
  weekday: number;    // 1 = Monday … 7 = Sunday (ISO)
  inMonth: boolean;   // false for the padding days of adjacent months
  isToday: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
export const isoWeekday = (iso: string) => { const d = new Date(`${iso}T00:00:00`).getDay(); return d === 0 ? 7 : d; };

/* A Monday-first grid of whole weeks covering the month, padded with the
   neighbouring months' days so the grid is always 6×7 or 5×7. */
export function monthCells(year: number, month0: number, today = schoolDateToday()): MonthCell[] {
  const first = new Date(year, month0, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;                    // Monday = 0
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const cells: MonthCell[] = [];
  for (let i = 0; i < total; i++) {
    const date = new Date(year, month0, 1 - lead + i);
    const iso = isoOf(date.getFullYear(), date.getMonth(), date.getDate());
    cells.push({ iso, day: date.getDate(), weekday: (i % 7) + 1, inMonth: date.getMonth() === month0, isToday: iso === today });
  }
  return cells;
}

export function monthLabel(year: number, month0: number) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(year, month0, 1));
}

export function shiftMonth(year: number, month0: number, delta: number): [number, number] {
  const d = new Date(year, month0 + delta, 1);
  return [d.getFullYear(), d.getMonth()];
}

export function shiftDate(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoOf(date.getFullYear(), date.getMonth(), date.getDate());
}

export function shiftIsoMonth(iso: string, delta: number) {
  const [year, month0] = parseYm(iso);
  const day = Number(iso.slice(8, 10));
  const target = new Date(year, month0 + delta, 1);
  const boundedDay = Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  return isoOf(target.getFullYear(), target.getMonth(), boundedDay);
}

export function parseYm(iso: string): [number, number] {
  const [y, m] = iso.split("-").map(Number);
  return [y ?? 1970, (m ?? 1) - 1];
}

export function longDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T00:00:00`));
}

/* Every ISO date from start to end inclusive (both YYYY-MM-DD). */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  for (let i = 0; cursor <= last && i < 400; i++) {
    out.push(isoOf(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function clockLabel(value: string | null | undefined) {
  if (!value) return "";
  const [h = "0", m = "00"] = value.split(":");
  const n = Number(h);
  return `${n % 12 || 12}:${m} ${n >= 12 ? "PM" : "AM"}`;
}
