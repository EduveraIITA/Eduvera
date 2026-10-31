import type { ExecutionClock } from "./execution-environment.contracts.js";

export const EXECUTION_CLOCK_PORT = Symbol("EXECUTION_CLOCK_PORT");

export interface InstitutionClockContext {
  /** The authoritative institution resolved by the owning domain. */
  readonly institution_id: string;
  /** The institution's validated IANA timezone, never a client-selected clock. */
  readonly time_zone: string;
}

export interface InstitutionClockReading {
  readonly environment_kind: "live" | "simulation";
  readonly namespace_id: `live:${string}` | `scenario:${string}:run:${string}` | null;
  readonly institution_id: string;
  readonly instant: Date;
  readonly iso_instant: string;
  readonly time_zone: string;
  readonly local_date: string;
  readonly local_time: string;
}

/**
 * Domain-facing time source. The active execution environment is server-owned and
 * request-scoped; callers may supply institution identity/timezone for validation
 * and presentation, but cannot choose Live versus Simulation.
 */
export interface ExecutionClockPort extends ExecutionClock {
  read(context: InstitutionClockContext): InstitutionClockReading;
  institutionDate(context: InstitutionClockContext): string;
}
