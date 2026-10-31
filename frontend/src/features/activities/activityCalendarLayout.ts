import type { ActivityOccurrence } from './api';

/** Keep parallel campus calendars readable instead of hiding or squeezing events. */
export function activityCalendarColumnWidth(items: Pick<ActivityOccurrence, 'starts_at' | 'ends_at' | 'state'>[]) {
  const edges = items.filter(item => item.state !== 'cancelled').flatMap<[number, number]>(item => {
    const start = Date.parse(item.starts_at), end = Date.parse(item.ends_at);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, 1], [end, -1]] : [];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0, peak = 1;
  for (const [, change] of edges) { current += change; peak = Math.max(peak, current); }
  return Math.max(200, peak * 144);
}
