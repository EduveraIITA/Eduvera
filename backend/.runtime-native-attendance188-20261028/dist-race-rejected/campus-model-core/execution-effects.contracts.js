/**
 * Reviewed categories of work that can leave an execution environment. Adding a
 * category is a safety-contract change: every Simulation run must then provide a
 * run-scoped sink for it before effect coverage can pass.
 */
export const EXECUTION_EFFECT_KINDS = Object.freeze([
    "operational_message",
    "external_notification",
    "connector_call",
    "file_write",
    "external_compute_call",
    "webhook_delivery",
    "realtime_publication",
]);
//# sourceMappingURL=execution-effects.contracts.js.map