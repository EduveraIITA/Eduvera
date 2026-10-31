/** Bounded, content-free telemetry: never retain SQL, binds, people or tenant IDs. */
const buckets = [5, 20, 50, 100, 250, 500, 1000, 5000, 30000, 60000];
export class DatabaseQueryMetrics {
    counts = buckets.map(() => 0);
    count = 0;
    totalMs = 0;
    failures = 0;
    record(durationMs, failed = false) {
        if (!Number.isFinite(durationMs) || durationMs < 0)
            return;
        this.count++;
        this.totalMs += durationMs;
        if (failed)
            this.failures++;
        for (let index = 0; index < buckets.length; index++)
            if (durationMs <= buckets[index])
                this.counts[index]++;
    }
    prometheus() {
        return ['# HELP thatcampus_database_query_duration_seconds Application SQL execution including selected-world routing.',
            '# TYPE thatcampus_database_query_duration_seconds histogram',
            ...buckets.map((limit, index) => `thatcampus_database_query_duration_seconds_bucket{le="${limit / 1000}"} ${this.counts[index]}`),
            `thatcampus_database_query_duration_seconds_bucket{le="+Inf"} ${this.count}`,
            `thatcampus_database_query_duration_seconds_sum ${this.totalMs / 1000}`,
            `thatcampus_database_query_duration_seconds_count ${this.count}`,
            '# HELP thatcampus_database_query_failures_total Failed application SQL executions.',
            '# TYPE thatcampus_database_query_failures_total counter',
            `thatcampus_database_query_failures_total ${this.failures}`, ''].join('\n');
    }
}
//# sourceMappingURL=query-metrics.js.map