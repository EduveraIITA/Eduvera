/** Stable metric identities; labels describe the measured grain and window. */
export const SIMULATION_WORLD_METRIC_CATALOGUE = Object.freeze({
    open_work: { key: "open_work", label: "Unresolved work", unit: "items" },
    submitted_registers: { key: "submitted_registers", label: "New attendance submissions since snapshot", unit: "registers" },
    finalized_registers: { key: "finalized_registers", label: "Attendance registers finalized since snapshot", unit: "registers" },
    model_events: { key: "model_events", label: "Digital Twin events since the snapshot", unit: "events" },
    learners: { key: "learners", label: "Learners in this world", unit: "people" },
});
/** Presentation may clarify a label, but never rewrites or invents a sample. */
export function simulationMetricLabel(key, recordedLabel) {
    return Object.hasOwn(SIMULATION_WORLD_METRIC_CATALOGUE, key)
        ? SIMULATION_WORLD_METRIC_CATALOGUE[key].label
        : recordedLabel;
}
//# sourceMappingURL=simulation-metrics.js.map