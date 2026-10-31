/**
 * Merge the bounded domain previews before applying the shared Today limit.
 * Source-owned time warnings remain visible first, followed by known instants.
 * Normal untimed context stays in source order after scheduled context; neither
 * localized labels nor planned dates are used to invent an instant.
 */
export function upcomingWorkspaceRecords(records) {
    const timeWarnings = [];
    const untimed = [];
    const scheduled = [];
    records.forEach((record, index) => {
        const starts = record.starts_at ? Date.parse(record.starts_at) : Number.NaN;
        if (!Number.isFinite(starts)) {
            (record.tone === "attention" || record.tone === "critical" ? timeWarnings : untimed).push(record);
        }
        else
            scheduled.push({ record, starts, index });
    });
    scheduled.sort((left, right) => left.starts - right.starts
        || left.record.id.localeCompare(right.record.id) || left.index - right.index);
    return [...timeWarnings, ...scheduled.map(({ record }) => record), ...untimed];
}
//# sourceMappingURL=upcoming-workspace.projection.js.map