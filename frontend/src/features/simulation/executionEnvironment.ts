export type ExecutionEnvironmentMode = "live" | "simulation";

export interface SimulationVirtualClock {
  readonly now: string;
  readonly timeZone: string;
}

export interface LiveExecutionEnvironment {
  readonly mode: "live";
  readonly namespaceId?: string;
  readonly institutionId?: string;
  readonly runId?: never;
  readonly scenarioId?: never;
  readonly virtualClock?: never;
}

export interface SimulationExecutionEnvironment {
  readonly mode: "simulation";
  readonly unavailable?: never;
  readonly unavailableReason?: never;
  readonly namespaceId: string;
  readonly runId: string;
  readonly scenarioId?: string;
  readonly institutionId?: string;
  readonly virtualClock: SimulationVirtualClock;
  readonly sourceSnapshotAt?: string;
  readonly expiresAt?: string;
}

export type UnavailableSimulationReason =
  | "binding_invalid"
  | "expired"
  | "run_unavailable"
  | "authorization_lost"
  | "runtime_unavailable"
  | "data_plane_unavailable";

export interface UnavailableSimulationExecutionEnvironment {
  readonly mode: "simulation";
  readonly unavailable: true;
  readonly unavailableReason: UnavailableSimulationReason;
  readonly namespaceId: string;
  readonly runId: string;
  readonly scenarioId?: string;
  readonly institutionId?: string;
  readonly expiresAt?: string;
  readonly virtualClock?: never;
  readonly sourceSnapshotAt?: never;
}

export type ExecutionEnvironment =
  | LiveExecutionEnvironment
  | SimulationExecutionEnvironment
  | UnavailableSimulationExecutionEnvironment;

export type SimulationExecutionEnvironmentInput = Omit<
  SimulationExecutionEnvironment,
  "mode"
>;

export type ExecutionEnvironmentWireDescriptor =
  | {
    readonly mode: "live";
    readonly namespace_id?: string | null;
    readonly institution_id?: string | null;
  }
  | {
    readonly mode: "simulation";
    readonly namespace_id: string;
    readonly run_id: string;
    readonly scenario_id?: string;
    readonly institution_id?: string;
    readonly virtual_clock: { readonly now: string; readonly time_zone: string };
    readonly source_snapshot_at?: string;
    readonly expires_at?: string;
    readonly unavailable?: false;
    readonly unavailable_reason?: never;
  }
  | {
    readonly mode: "simulation";
    readonly unavailable: true;
    readonly unavailable_reason: UnavailableSimulationReason;
    readonly namespace_id: string;
    readonly run_id: string;
    readonly scenario_id?: string;
    readonly institution_id?: string;
    readonly expires_at?: string | null;
    readonly virtual_clock?: never;
    readonly source_snapshot_at?: never;
  };

export class ExecutionEnvironmentInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionEnvironmentInvariantError";
  }
}

export const LIVE_EXECUTION_ENVIRONMENT: LiveExecutionEnvironment = Object.freeze({
  mode: "live",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredIdentifier(
  value: Record<string, unknown>,
  key: "namespaceId" | "runId",
) {
  const identifier = value[key];
  if (typeof identifier !== "string" || identifier.trim().length === 0) {
    throw new ExecutionEnvironmentInvariantError(
      `A simulation execution environment requires a non-empty ${key}.`,
    );
  }
  return identifier.trim();
}

function optionalIdentifier(
  value: Record<string, unknown>,
  key: "namespaceId" | "scenarioId" | "institutionId",
) {
  const identifier = value[key];
  if (identifier === undefined) return undefined;
  if (typeof identifier !== "string" || identifier.trim().length === 0) {
    throw new ExecutionEnvironmentInvariantError(
      `An execution environment requires a non-empty ${key} when it is supplied.`,
    );
  }
  return identifier.trim();
}

function normalizeVirtualClock(value: unknown): SimulationVirtualClock {
  if (!isRecord(value)) {
    throw new ExecutionEnvironmentInvariantError(
      "A simulation execution environment requires a virtual clock.",
    );
  }

  const now = value.now;
  if (
    typeof now !== "string" ||
    !now.includes("T") ||
    Number.isNaN(Date.parse(now))
  ) {
    throw new ExecutionEnvironmentInvariantError(
      "The simulation virtual clock requires an ISO date-time in now.",
    );
  }

  const timeZone = value.timeZone;
  if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
    throw new ExecutionEnvironmentInvariantError(
      "The simulation virtual clock requires an IANA time zone.",
    );
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date(now));
  } catch {
    throw new ExecutionEnvironmentInvariantError(
      "The simulation virtual clock requires a valid IANA time zone.",
    );
  }

  return Object.freeze({ now, timeZone: timeZone.trim() });
}

function optionalInstant(value: Record<string, unknown>, key: "sourceSnapshotAt" | "expiresAt") {
  const instant = value[key];
  if (instant === undefined) return undefined;
  if (typeof instant !== "string" || Number.isNaN(Date.parse(instant))) {
    throw new ExecutionEnvironmentInvariantError(
      `The simulation execution environment requires a valid ${key}.`,
    );
  }
  return new Date(instant).toISOString();
}

const unavailableSimulationReasons: readonly UnavailableSimulationReason[] = [
  "binding_invalid",
  "expired",
  "run_unavailable",
  "authorization_lost",
  "runtime_unavailable",
  "data_plane_unavailable",
];

function normalizeUnavailableReason(value: unknown): UnavailableSimulationReason {
  if (typeof value === "string"
    && unavailableSimulationReasons.includes(value as UnavailableSimulationReason)) {
    return value as UnavailableSimulationReason;
  }
  throw new ExecutionEnvironmentInvariantError(
    "An unavailable simulation execution environment requires a supported reason.",
  );
}

/**
 * Validates data crossing an API, URL or persistence boundary before it can select
 * an application execution environment. Extra simulation response fields are
 * deliberately discarded so only the isolation coordinates enter shared context.
 */
export function normalizeExecutionEnvironment(value: unknown): ExecutionEnvironment {
  if (!isRecord(value)) {
    throw new ExecutionEnvironmentInvariantError(
      "An execution environment descriptor is required.",
    );
  }

  if (value.mode === "live") {
    const simulationOnlyFields = ["runId", "scenarioId", "virtualClock", "sourceSnapshotAt", "expiresAt"];
    if (simulationOnlyFields.some((field) => hasOwn(value, field))) {
      throw new ExecutionEnvironmentInvariantError(
        "A live execution environment cannot carry simulation run state.",
      );
    }
    const namespaceId = optionalIdentifier(value, "namespaceId");
    const institutionId = optionalIdentifier(value, "institutionId");
    if (!namespaceId && !institutionId) return LIVE_EXECUTION_ENVIRONMENT;
    return Object.freeze({
      mode: "live",
      ...(namespaceId ? { namespaceId } : {}),
      ...(institutionId ? { institutionId } : {}),
    });
  }

  if (value.mode === "simulation") {
    if (value.unavailable === true) {
      if (hasOwn(value, "virtualClock") || hasOwn(value, "sourceSnapshotAt")) {
        throw new ExecutionEnvironmentInvariantError(
          "An unavailable simulation cannot carry an executable virtual clock or snapshot.",
        );
      }
      const expiresAt = optionalInstant(value, "expiresAt");
      const scenarioId = optionalIdentifier(value, "scenarioId");
      const institutionId = optionalIdentifier(value, "institutionId");
      return Object.freeze({
        mode: "simulation",
        unavailable: true,
        unavailableReason: normalizeUnavailableReason(value.unavailableReason),
        namespaceId: requiredIdentifier(value, "namespaceId"),
        runId: requiredIdentifier(value, "runId"),
        ...(scenarioId ? { scenarioId } : {}),
        ...(institutionId ? { institutionId } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
    }
    const sourceSnapshotAt = optionalInstant(value, "sourceSnapshotAt");
    const expiresAt = optionalInstant(value, "expiresAt");
    const scenarioId = optionalIdentifier(value, "scenarioId");
    const institutionId = optionalIdentifier(value, "institutionId");
    return Object.freeze({
      mode: "simulation",
      namespaceId: requiredIdentifier(value, "namespaceId"),
      runId: requiredIdentifier(value, "runId"),
      ...(scenarioId ? { scenarioId } : {}),
      ...(institutionId ? { institutionId } : {}),
      virtualClock: normalizeVirtualClock(value.virtualClock),
      ...(sourceSnapshotAt ? { sourceSnapshotAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  throw new ExecutionEnvironmentInvariantError(
    "Execution environment mode must be live or simulation.",
  );
}

/**
 * Converts the server-owned, snake-case session descriptor into the application
 * contract. Clients may read this value but never manufacture it to select a data
 * plane; selection is confirmed by the authenticated session endpoint.
 */
export function executionEnvironmentFromWire(value: unknown): ExecutionEnvironment {
  if (!isRecord(value)) {
    throw new ExecutionEnvironmentInvariantError(
      "The server did not provide a valid execution environment descriptor.",
    );
  }

  if (value.mode === "live") {
    return normalizeExecutionEnvironment({
      mode: "live",
      ...(value.namespace_id == null ? {} : { namespaceId: value.namespace_id }),
      ...(value.institution_id == null ? {} : { institutionId: value.institution_id }),
    });
  }

  if (value.mode === "simulation") {
    if (value.unavailable === true) {
      return normalizeExecutionEnvironment({
        mode: "simulation",
        unavailable: true,
        unavailableReason: value.unavailable_reason,
        namespaceId: value.namespace_id,
        runId: value.run_id,
        ...(value.scenario_id === undefined ? {} : { scenarioId: value.scenario_id }),
        ...(value.institution_id === undefined ? {} : { institutionId: value.institution_id }),
        ...(value.expires_at == null ? {} : { expiresAt: value.expires_at }),
      });
    }
    if (!isRecord(value.virtual_clock)) {
      throw new ExecutionEnvironmentInvariantError(
        "A simulation execution environment requires a virtual clock.",
      );
    }
    return normalizeExecutionEnvironment({
      mode: "simulation",
      namespaceId: value.namespace_id,
      runId: value.run_id,
      ...(value.scenario_id === undefined ? {} : { scenarioId: value.scenario_id }),
      ...(value.institution_id === undefined ? {} : { institutionId: value.institution_id }),
      virtualClock: {
        now: value.virtual_clock.now,
        timeZone: value.virtual_clock.time_zone,
      },
      ...(value.source_snapshot_at === undefined ? {} : { sourceSnapshotAt: value.source_snapshot_at }),
      ...(value.expires_at === undefined ? {} : { expiresAt: value.expires_at }),
    });
  }

  throw new ExecutionEnvironmentInvariantError(
    "Execution environment mode must be live or simulation.",
  );
}

export function executionEnvironmentIdentity(environment: ExecutionEnvironment) {
  const normalized = normalizeExecutionEnvironment(environment);
  if (normalized.mode === "live") {
    return `live:${normalized.namespaceId ?? normalized.institutionId ?? "global"}`;
  }
  return normalized.unavailable === true
    ? `simulation-unavailable:${normalized.namespaceId}:${normalized.runId}:${normalized.unavailableReason}`
    : `simulation:${normalized.namespaceId}:${normalized.runId}`;
}

export function createSimulationExecutionEnvironment(
  input: SimulationExecutionEnvironmentInput,
): SimulationExecutionEnvironment {
  return normalizeExecutionEnvironment({ ...input, mode: "simulation" }) as SimulationExecutionEnvironment;
}

export function assertExecutionEnvironment(
  value: unknown,
): asserts value is ExecutionEnvironment {
  normalizeExecutionEnvironment(value);
}

export function isSimulationExecutionEnvironment(
  environment: ExecutionEnvironment,
): environment is SimulationExecutionEnvironment {
  return environment.mode === "simulation" && environment.unavailable !== true;
}

export function isUnavailableSimulationExecutionEnvironment(
  environment: ExecutionEnvironment,
): environment is UnavailableSimulationExecutionEnvironment {
  return environment.mode === "simulation" && environment.unavailable === true;
}
