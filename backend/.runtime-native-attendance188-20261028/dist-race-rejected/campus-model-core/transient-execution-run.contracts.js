/**
 * Server-owned catalogue of transient runs that may be selected by an
 * authenticated session. Implementations remain responsible for tenant and actor
 * authorization; the run ID alone never grants access.
 */
export const TRANSIENT_EXECUTION_RUN_CATALOG = Symbol.for("thatcampus.transient-execution-run-catalog");
//# sourceMappingURL=transient-execution-run.contracts.js.map