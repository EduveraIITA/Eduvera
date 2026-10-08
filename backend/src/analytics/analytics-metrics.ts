/** Read-model calculations. Unknown is never zero; projections are not grades. */
export type AttendanceCounts = { present: number; late: number; half_day: number; absent: number; excused: number };
export const emptyCounts = (): AttendanceCounts => ({ present: 0, late: 0, half_day: 0, absent: 0, excused: 0 });
export const round = (value: number) => Math.round(value * 100) / 100;

export function attendanceMetric(counts: AttendanceCounts) {
  const denominator = counts.present + counts.late + counts.half_day + counts.absent;
  const attended = counts.present + counts.late + counts.half_day * 0.5;
  return { ...counts, recorded: denominator + counts.excused, denominator, attended,
    percentage: denominator ? round(attended * 100 / denominator) : null };
}

export function addCounts(target: AttendanceCounts, source: AttendanceCounts) {
  for (const key of Object.keys(target) as Array<keyof AttendanceCounts>) target[key] += Number(source[key]);
}

export function dateOffset(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function attendanceTrend(rows: Array<AttendanceCounts & { date: string }>, from: string, to: string, monthly: boolean) {
  const buckets = new Map<string, { date: string; end: string; counts: AttendanceCounts }>();
  for (let start = from; start <= to;) {
    const next = monthly
      ? new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1)).toISOString().slice(0, 10)
      : dateOffset(start, 7);
    buckets.set(start, { date: start, end: [dateOffset(next, -1), to].sort()[0]!, counts: emptyCounts() });
    start = next;
  }
  for (const row of rows) {
    const bucket = [...buckets.values()].find(item => row.date >= item.date && row.date <= item.end);
    if (bucket) addCounts(bucket.counts, row);
  }
  return [...buckets.values()].map(bucket => ({ date: bucket.date, end: bucket.end, ...attendanceMetric(bucket.counts) }));
}
