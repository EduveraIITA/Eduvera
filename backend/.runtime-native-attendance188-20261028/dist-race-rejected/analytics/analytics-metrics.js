export const emptyCounts = () => ({ present: 0, late: 0, half_day: 0, absent: 0, excused: 0 });
export const round = (value) => Math.round(value * 100) / 100;
export function attendanceMetric(counts) {
    const denominator = counts.present + counts.late + counts.half_day + counts.absent;
    const attended = counts.present + counts.late + counts.half_day * 0.5;
    return { ...counts, recorded: denominator + counts.excused, denominator, attended,
        percentage: denominator ? round(attended * 100 / denominator) : null };
}
export function addCounts(target, source) {
    for (const key of Object.keys(target))
        target[key] += Number(source[key]);
}
export function dateOffset(date, days) {
    return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function attendanceTrend(rows, from, to, monthly) {
    const buckets = new Map();
    for (let start = from; start <= to;) {
        const next = monthly
            ? new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1)).toISOString().slice(0, 10)
            : dateOffset(start, 7);
        buckets.set(start, { date: start, end: [dateOffset(next, -1), to].sort()[0], counts: emptyCounts() });
        start = next;
    }
    for (const row of rows) {
        const bucket = [...buckets.values()].find(item => row.date >= item.date && row.date <= item.end);
        if (bucket)
            addCounts(bucket.counts, row);
    }
    return [...buckets.values()].map(bucket => ({ date: bucket.date, end: bucket.end, ...attendanceMetric(bucket.counts) }));
}
//# sourceMappingURL=analytics-metrics.js.map