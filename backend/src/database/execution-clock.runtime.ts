import { Inject, Injectable } from "@nestjs/common";
import type {
  ExecutionClockPort,
  InstitutionClockContext,
  InstitutionClockReading,
} from "../campus-model-core/execution-clock.port.js";
import type { ExecutionClock } from "../campus-model-core/execution-environment.contracts.js";
import { ExecutionDataPlaneScope } from "./execution-data-plane.js";

export const SYSTEM_WALL_CLOCK = Symbol("SYSTEM_WALL_CLOCK");

export class ExecutionClockError extends Error {
  constructor(
    readonly code: "invalid_clock" | "invalid_institution" | "invalid_time_zone",
    message: string,
  ) {
    super(message);
    this.name = "ExecutionClockError";
  }
}

@Injectable()
export class SystemWallClock implements ExecutionClock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

function assertInstitutionContext(
  context: InstitutionClockContext,
): InstitutionClockContext {
  if (!context
    || typeof context.institution_id !== "string"
    || context.institution_id.trim() !== context.institution_id
    || context.institution_id.length === 0) {
    throw new ExecutionClockError(
      "invalid_institution",
      "An authoritative institution identity is required to read institution time.",
    );
  }
  if (typeof context.time_zone !== "string" || context.time_zone.trim() !== context.time_zone) {
    throw new ExecutionClockError(
      "invalid_time_zone",
      "An authoritative IANA institution timezone is required.",
    );
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: context.time_zone }).format();
  } catch {
    throw new ExecutionClockError(
      "invalid_time_zone",
      "The institution timezone must be a valid IANA timezone.",
    );
  }
  return context;
}

function readClockInstant(clock: ExecutionClock): Date {
  const instant = clock.now();
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new ExecutionClockError("invalid_clock", "The selected execution clock returned an invalid instant.");
  }
  // Callers cannot mutate a Date retained by a virtual-clock implementation.
  return new Date(instant.getTime());
}

function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
  };
}

/**
 * Integration adapter between domain time reads and the server-owned request
 * execution scope. No request field is inspected here: Simulation time can only
 * arrive through ExecutionDataPlaneScope after authenticated session resolution.
 */
@Injectable()
export class ScopedExecutionClock implements ExecutionClockPort {
  constructor(
    private readonly scope: ExecutionDataPlaneScope,
    @Inject(SYSTEM_WALL_CLOCK) private readonly wallClock: ExecutionClock,
  ) {}

  now(): Date {
    return readClockInstant(this.selectedClock());
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  read(rawContext: InstitutionClockContext): InstitutionClockReading {
    const context = assertInstitutionContext(rawContext);
    const environment = this.scope.current();
    if (environment && environment.institution_id !== context.institution_id) {
      throw new ExecutionClockError(
        "invalid_institution",
        "The institution clock request does not match the server-selected execution environment.",
      );
    }
    const instant = this.now();
    const local = localParts(instant, context.time_zone);
    return Object.freeze({
      environment_kind: environment?.kind ?? "live",
      namespace_id: environment?.namespace_id ?? null,
      institution_id: context.institution_id,
      instant,
      iso_instant: instant.toISOString(),
      time_zone: context.time_zone,
      local_date: local.date,
      local_time: local.time,
    });
  }

  institutionDate(context: InstitutionClockContext): string {
    return this.read(context).local_date;
  }

  private selectedClock(): ExecutionClock {
    const environment = this.scope.current();
    if (!environment) return this.wallClock;
    return environment.kind === "simulation" ? environment.virtual_clock : environment.clock;
  }
}
