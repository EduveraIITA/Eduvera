import { AsyncLocalStorage } from "node:async_hooks";
/** Shared request/worker scope; virtual time never changes the process clock. */
export const executionEnvironmentStorage = new AsyncLocalStorage();
/** Domain time. Authentication, leases, rate limits and telemetry use wall time. */
export function executionNow() {
    const environment = executionEnvironmentStorage.getStore();
    const clock = environment?.kind === "simulation" ? environment.virtual_clock : environment?.clock;
    return clock ? new Date(clock.now().getTime()) : new Date();
}
//# sourceMappingURL=execution-time.runtime.js.map