import type {
  ExecutionClock,
  ExecutionDataPlaneAdapters,
  ExecutionEnvironment,
  ExecutionEnvironmentPortBinding,
  LiveExecutionCapabilities,
  LiveExecutionEnvironment,
  ModelCoreExecutionContext,
  SimulationExecutionCapabilities,
  SimulationCoverageGate,
  SimulationExecutionEnvironment,
  SimulationVirtualClock,
} from "./execution-environment.contracts.js";

export const LIVE_EXECUTION_CAPABILITIES: LiveExecutionCapabilities = Object.freeze({
  mode: "production_ports",
  production_domain_commands: true,
  production_operational_messages: true,
  external_notifications: true,
  connector_calls: true,
  production_evidence_writes: true,
  production_authority_lookups: true,
  scenario_event_sink: false,
  scenario_message_sink: false,
  scenario_artifact_sink: false,
});

export const SIMULATION_EXECUTION_CAPABILITIES: SimulationExecutionCapabilities = Object.freeze({
  mode: "sink_only",
  production_domain_commands: false,
  production_operational_messages: false,
  external_notifications: false,
  connector_calls: false,
  production_evidence_writes: false,
  production_authority_lookups: false,
  scenario_event_sink: true,
  scenario_message_sink: true,
  scenario_artifact_sink: true,
});

export type ExecutionEnvironmentValidationCode =
  | "invalid_environment_shape"
  | "mixed_environment_fields"
  | "invalid_environment_identifier"
  | "invalid_environment_namespace"
  | "invalid_environment_clock"
  | "invalid_environment_expiry"
  | "invalid_environment_capabilities";

export class ExecutionEnvironmentValidationError extends Error {
  constructor(
    readonly code: ExecutionEnvironmentValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionEnvironmentValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function owns(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.includes(":")) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_identifier",
      `${label} must be a non-empty namespace-safe identifier.`,
    );
  }
}

function assertClock(value: unknown, label: string, virtual: boolean): void {
  if (!isRecord(value)
    || typeof value.now !== "function"
    || typeof value.nowIso !== "function"
    || (virtual && (typeof value.advanceBy !== "function" || typeof value.advanceTo !== "function"))) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_clock",
      `${label} does not implement the required clock contract.`,
    );
  }
}

function assertIsoInstant(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_expiry",
      `${label} must be an ISO date-time.`,
    );
  }
}

function assertSimulationCoverageGate(value: unknown): asserts value is SimulationCoverageGate {
  if (!isRecord(value) || value.status !== "passed") {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_shape",
      "Simulation execution requires a passed server-side coverage gate.",
    );
  }
  if (typeof value.manifest_ref !== "string" || value.manifest_ref.trim().length === 0) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_identifier",
      "Simulation coverage manifest reference must not be empty.",
    );
  }
  assertIsoInstant(value.checked_at, "Simulation coverage check time");
}

function assertNoFields(record: Record<string, unknown>, fields: readonly string[], kind: string): void {
  const mixed = fields.filter((field) => owns(record, field));
  if (mixed.length > 0) {
    throw new ExecutionEnvironmentValidationError(
      "mixed_environment_fields",
      `${kind} execution environment cannot contain ${mixed.join(", ")}.`,
    );
  }
}

function assertExactCapabilities(
  value: unknown,
  expected: LiveExecutionCapabilities | SimulationExecutionCapabilities,
): void {
  if (!isRecord(value)) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_capabilities",
      "Execution environment capabilities are required.",
    );
  }
  const expectedRecord = expected as unknown as Record<string, unknown>;
  const expectedKeys = Object.keys(expectedRecord);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key) => !owns(expectedRecord, key))
    || expectedKeys.some((key) => value[key] !== expectedRecord[key])) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_capabilities",
      `Execution environment must use the exact ${expected.mode} capability set.`,
    );
  }
}

export function liveExecutionNamespace(institutionId: string): `live:${string}` {
  assertIdentifier(institutionId, "Institution ID");
  return `live:${institutionId}`;
}

export function simulationExecutionNamespace(
  scenarioId: string,
  runId: string,
): `scenario:${string}:run:${string}` {
  assertIdentifier(scenarioId, "Scenario ID");
  assertIdentifier(runId, "Run ID");
  return `scenario:${scenarioId}:run:${runId}`;
}

export function assertLiveExecutionEnvironment(
  value: unknown,
): asserts value is LiveExecutionEnvironment {
  if (!isRecord(value) || value.kind !== "live") {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_shape",
      "Expected a live execution environment.",
    );
  }
  assertNoFields(
    value,
    [
      "scenario_id",
      "run_id",
      "virtual_clock",
      "source_snapshot_ref",
      "source_live_namespace_id",
      "coverage_gate",
      "expires_at",
    ],
    "Live",
  );
  if (value.truth_mode !== "authoritative_real" || value.lifecycle !== "persistent") {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_shape",
      "Live is the persistent authoritative real environment.",
    );
  }
  assertIdentifier(value.institution_id, "Institution ID");
  const expectedNamespace = liveExecutionNamespace(value.institution_id);
  if (value.namespace_id !== expectedNamespace) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_namespace",
      `Live namespace must equal ${expectedNamespace}.`,
    );
  }
  assertClock(value.clock, "Live institution clock", false);
  assertExactCapabilities(value.capabilities, LIVE_EXECUTION_CAPABILITIES);
}

export function assertSimulationExecutionEnvironment(
  value: unknown,
): asserts value is SimulationExecutionEnvironment {
  if (!isRecord(value) || value.kind !== "simulation") {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_shape",
      "Expected a simulation execution environment.",
    );
  }
  assertNoFields(value, ["clock"], "Simulation");
  if (value.truth_mode !== "transient_virtual" || value.lifecycle !== "transient_virtual_fork") {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_shape",
      "Simulation must be a transient virtual fork.",
    );
  }
  assertIdentifier(value.institution_id, "Institution ID");
  assertIdentifier(value.scenario_id, "Scenario ID");
  assertIdentifier(value.run_id, "Run ID");
  const expectedNamespace = simulationExecutionNamespace(value.scenario_id, value.run_id);
  if (value.namespace_id !== expectedNamespace) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_namespace",
      `Simulation namespace must equal ${expectedNamespace} and include its run identity.`,
    );
  }
  const expectedSourceNamespace = liveExecutionNamespace(value.institution_id);
  if (value.source_live_namespace_id !== expectedSourceNamespace) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_namespace",
      `Simulation source namespace must equal ${expectedSourceNamespace}.`,
    );
  }
  if (typeof value.source_snapshot_ref !== "string" || value.source_snapshot_ref.trim().length === 0) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_identifier",
      "Simulation source snapshot reference must not be empty.",
    );
  }
  assertIsoInstant(value.expires_at, "Simulation expiry");
  assertSimulationCoverageGate(value.coverage_gate);
  assertClock(value.virtual_clock, "Simulation virtual clock", true);
  assertExactCapabilities(value.capabilities, SIMULATION_EXECUTION_CAPABILITIES);
}

export function assertExecutionEnvironment(value: unknown): asserts value is ExecutionEnvironment {
  if (!isRecord(value)) {
    throw new ExecutionEnvironmentValidationError(
      "invalid_environment_shape",
      "Execution environment must be an object.",
    );
  }
  if (value.kind === "live") return assertLiveExecutionEnvironment(value);
  if (value.kind === "simulation") return assertSimulationExecutionEnvironment(value);
  throw new ExecutionEnvironmentValidationError(
    "invalid_environment_shape",
    "Execution environment kind must be live or simulation.",
  );
}

export function isExecutionEnvironment(value: unknown): value is ExecutionEnvironment {
  try {
    assertExecutionEnvironment(value);
    return true;
  } catch (error) {
    if (error instanceof ExecutionEnvironmentValidationError) return false;
    throw error;
  }
}

export function createLiveExecutionEnvironment(input: {
  institution_id: string;
  clock: ExecutionClock;
}): LiveExecutionEnvironment {
  const environment: LiveExecutionEnvironment = {
    kind: "live",
    truth_mode: "authoritative_real",
    lifecycle: "persistent",
    institution_id: input.institution_id,
    namespace_id: liveExecutionNamespace(input.institution_id),
    clock: input.clock,
    capabilities: LIVE_EXECUTION_CAPABILITIES,
  };
  assertLiveExecutionEnvironment(environment);
  return Object.freeze(environment);
}

export function createSimulationExecutionEnvironment(input: {
  institution_id: string;
  scenario_id: string;
  run_id: string;
  virtual_clock: SimulationVirtualClock;
  source_snapshot_ref: string;
  coverage_gate: SimulationCoverageGate;
  expires_at: string;
}): SimulationExecutionEnvironment {
  const environment: SimulationExecutionEnvironment = {
    kind: "simulation",
    truth_mode: "transient_virtual",
    lifecycle: "transient_virtual_fork",
    institution_id: input.institution_id,
    scenario_id: input.scenario_id,
    run_id: input.run_id,
    namespace_id: simulationExecutionNamespace(input.scenario_id, input.run_id),
    source_live_namespace_id: liveExecutionNamespace(input.institution_id),
    virtual_clock: input.virtual_clock,
    source_snapshot_ref: input.source_snapshot_ref,
    coverage_gate: input.coverage_gate,
    expires_at: input.expires_at,
    capabilities: SIMULATION_EXECUTION_CAPABILITIES,
  };
  assertSimulationExecutionEnvironment(environment);
  return Object.freeze(environment);
}

export function bindExecutionEnvironmentPorts<TDomainPorts, TProjectionPorts>(
  environment: ExecutionEnvironment,
  ports: {
    domain_ports: TDomainPorts;
    projection_ports: TProjectionPorts;
  },
): ExecutionEnvironmentPortBinding<TDomainPorts, TProjectionPorts> {
  assertExecutionEnvironment(environment);
  return Object.freeze({
    environment,
    namespace_id: environment.namespace_id,
    domain_ports: ports.domain_ports,
    projection_ports: ports.projection_ports,
  });
}

/**
 * Selects one server-owned data plane for a request. Both factories must implement
 * the same domain/projection contracts, while the discriminant prevents a
 * Simulation request from receiving Live storage or effect metadata by accident.
 */
export function selectExecutionDataPlane<TUnitOfWork, TDomainPorts, TProjectionPorts>(
  environment: ExecutionEnvironment,
  adapters: ExecutionDataPlaneAdapters<TUnitOfWork, TDomainPorts, TProjectionPorts>,
): ModelCoreExecutionContext<TUnitOfWork, TDomainPorts, TProjectionPorts> {
  assertExecutionEnvironment(environment);
  if (environment.kind === "live") {
    const selected = adapters.live(environment);
    return Object.freeze({
      environment,
      namespace_id: environment.namespace_id,
      storage_mode: "authoritative_live_unit_of_work" as const,
      effects_mode: "production_ports" as const,
      unit_of_work: selected.unit_of_work,
      domain_ports: selected.domain_ports,
      projection_ports: selected.projection_ports,
    });
  }

  const selected = adapters.simulation(environment);
  return Object.freeze({
    environment,
    namespace_id: environment.namespace_id,
    storage_mode: "isolated_copy_on_write" as const,
    effects_mode: "sink_only" as const,
    unit_of_work: selected.unit_of_work,
    domain_ports: selected.domain_ports,
    projection_ports: selected.projection_ports,
  });
}
