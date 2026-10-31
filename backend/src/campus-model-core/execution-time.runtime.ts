import { AsyncLocalStorage } from "node:async_hooks";
import type { ExecutionEnvironment } from "./execution-environment.contracts.js";

/** Shared request/worker scope; virtual time never changes the process clock. */
export const executionEnvironmentStorage = new AsyncLocalStorage<ExecutionEnvironment>();

/** Domain time. Authentication, leases, rate limits and telemetry use wall time. */
export function executionNow(): Date {
  const environment = executionEnvironmentStorage.getStore();
  const clock = environment?.kind === "simulation" ? environment.virtual_clock : environment?.clock;
  return clock ? new Date(clock.now().getTime()) : new Date();
}
