const pad = (value: number, width = 2) => String(value).padStart(width, '0');
export function browserCalendarDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
export function browserLocalDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${date.getMilliseconds() ? '.' + pad(date.getMilliseconds(), 3) : ''}`;
}
/** HTML datetime-local is device-local, just like the existing native pickers. */
export function browserLocalDateTimeIso(value: string, minimum?: Date, maximum?: Date) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match || !browserCalendarDay(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return null;
  const [year, month, day] = match[1]!.split('-').map(Number), hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4] ?? 0), millisecond = Number((match[5] ?? '').padEnd(3, '0'));
  const date = new Date(0); date.setFullYear(year!, month! - 1, day!); date.setHours(hour, minute, second, millisecond);
  if (date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second || minimum && date < minimum || maximum && date > maximum) return null;
  return date.toISOString();
}
