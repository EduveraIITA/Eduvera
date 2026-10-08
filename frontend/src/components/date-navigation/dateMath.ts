export type DateView = 'day' | 'month' | 'year';
export const parseDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);
export const longDateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(parseDate(date));
export const monthDateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDate(date));
export const shortDateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parseDate(date));
export function addDays(date: string, days: number) {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}
export const mondayOffset = (date: string) => (parseDate(date).getUTCDay() + 6) % 7;
export function visibleDates(date: string, view: 'day' | 'month') {
  const start = view === 'day' ? addDays(date, -mondayOffset(date)) : `${date.slice(0, 7)}-01`;
  const count = view === 'day' ? 7 : new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}
export function shiftDatePeriod(date: string, period: 'day' | 'week' | 'month' | 'year', delta: number) {
  if (period === 'day' || period === 'week') return addDays(date, delta * (period === 'week' ? 7 : 1));
  const current = parseDate(date);
  const next = new Date(Date.UTC(current.getUTCFullYear() + (period === 'year' ? delta : 0), current.getUTCMonth() + (period === 'month' ? delta : 0), 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(current.getUTCDate(), lastDay));
  return isoDate(next);
}
