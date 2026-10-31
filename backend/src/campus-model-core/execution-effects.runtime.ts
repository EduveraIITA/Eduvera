import { createHash } from "node:crypto";
import type {
  CapturedSimulationExecutionEffect,
  ExecutionEffectCoverage,
  ExecutionEffectIntent,
  ExecutionEffectKind,
  ExecutionEffectReceipt,
  ExecutionEffectValue,
  LiveExecutionEffectReceipt,
  ProductionExecutionEffectPort,
  SimulationExecutionEffectReceipt,
  SimulationExecutionEffectSink,
} from "./execution-effects.contracts.js";
import { EXECUTION_EFFECT_KINDS } from "./execution-effects.contracts.js";
import type {
  ExecutionEnvironment,
  SimulationExecutionEnvironment,
} from "./execution-environment.contracts.js";
import {
  assertExecutionEnvironment,
  assertSimulationExecutionEnvironment,
} from "./execution-environment.runtime.js";

export type ExecutionEffectBoundaryErrorCode =
  | "invalid_effect_intent"
  | "effect_environment_mismatch"
  | "duplicate_production_port"
  | "production_port_missing"
  | "invalid_simulation_sink_set"
  | "simulation_sink_set_already_bound"
  | "simulation_sink_scope_mismatch"
  | "simulation_sink_set_missing"
  | "simulation_sink_missing"
  | "simulation_sink_discarded"
  | "effect_idempotency_conflict"
  | "invalid_effect_receipt";

export class ExecutionEffectBoundaryError extends Error {
  constructor(
    readonly code: ExecutionEffectBoundaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionEffectBoundaryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      `${label} must be a non-empty trimmed string.`,
    );
  }
}

function assertEffectValue(value: unknown, path = "payload"): asserts value is ExecutionEffectValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      `${path} cannot contain a non-finite number.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertEffectValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (!key.trim()) {
        throw new ExecutionEffectBoundaryError(
          "invalid_effect_intent",
          `${path} cannot contain an empty object key.`,
        );
      }
      assertEffectValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new ExecutionEffectBoundaryError(
    "invalid_effect_intent",
    `${path} must contain only JSON-compatible effect values.`,
  );
}

function isEffectKind(value: unknown): value is ExecutionEffectKind {
  return typeof value === "string"
    && (EXECUTION_EFFECT_KINDS as readonly string[]).includes(value);
}

function assertIsoInstant(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || !Number.isFinite(Date.parse(value))) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      `${label} must be an ISO date-time.`,
    );
  }
}

export function assertExecutionEffectIntent(
  value: unknown,
): asserts value is ExecutionEffectIntent {
  if (!isRecord(value) || !isEffectKind(value.kind)) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      "Effect intent must use a reviewed effect kind.",
    );
  }
  assertNonEmpty(value.effect_id, "Effect ID");
  assertNonEmpty(value.schema_name, "Effect schema name");
  if (!Number.isSafeInteger(value.schema_version) || Number(value.schema_version) < 1) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      "Effect schema version must be a positive whole number.",
    );
  }
  assertNonEmpty(value.institution_id, "Effect institution ID");
  assertNonEmpty(value.namespace_id, "Effect namespace ID");
  assertNonEmpty(value.idempotency_key, "Effect idempotency key");
  assertNonEmpty(value.correlation_id, "Effect correlation ID");
  if (value.causation_id !== null) assertNonEmpty(value.causation_id, "Effect causation ID");
  assertIsoInstant(value.requested_at, "Effect request time");
  assertNonEmpty(value.actor_agent_id, "Effect actor agent ID");
  if (!isRecord(value.logical_target)) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      "Effect intent requires a logical target.",
    );
  }
  assertNonEmpty(value.logical_target.kind, "Effect logical target kind");
  assertNonEmpty(value.logical_target.ref, "Effect logical target reference");
  if (value.privacy_class !== "public"
    && value.privacy_class !== "institution_internal"
    && value.privacy_class !== "restricted_reference_only") {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_intent",
      "Effect privacy class is invalid.",
    );
  }
  assertEffectValue(value.payload);
}

function canonicalize(value: ExecutionEffectValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
}

export function executionEffectDigest(intent: ExecutionEffectIntent): string {
  assertExecutionEffectIntent(intent);
  return createHash("sha256")
    .update(canonicalize(intent as unknown as ExecutionEffectValue))
    .digest("hex");
}

function cloneIntent<TKind extends ExecutionEffectKind>(
  intent: ExecutionEffectIntent<TKind>,
): ExecutionEffectIntent<TKind> {
  return structuredClone(intent);
}

function sortedKinds(kinds: Iterable<ExecutionEffectKind>): ExecutionEffectKind[] {
  const values = new Set(kinds);
  return EXECUTION_EFFECT_KINDS.filter((kind) => values.has(kind));
}

function assertIntentMatchesEnvironment(
  environment: ExecutionEnvironment,
  intent: ExecutionEffectIntent,
): void {
  if (intent.institution_id !== environment.institution_id
    || intent.namespace_id !== environment.namespace_id) {
    throw new ExecutionEffectBoundaryError(
      "effect_environment_mismatch",
      "Effect institution and namespace must match the server-selected execution environment.",
    );
  }
}

function assertLiveReceipt(
  receipt: LiveExecutionEffectReceipt,
  environment: Extract<ExecutionEnvironment, { kind: "live" }>,
  intent: ExecutionEffectIntent,
  port: ProductionExecutionEffectPort,
): void {
  if (receipt.environment_kind !== "live"
    || receipt.effect_kind !== intent.kind
    || receipt.effect_id !== intent.effect_id
    || receipt.idempotency_key !== intent.idempotency_key
    || receipt.namespace_id !== environment.namespace_id
    || receipt.port_id !== port.port_id
    || (receipt.status !== "accepted" && receipt.status !== "deduplicated")
    || !Number.isFinite(Date.parse(receipt.recorded_at))) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_receipt",
      `Production port ${port.port_id} returned a receipt for another effect or environment.`,
    );
  }
}

function assertSimulationReceipt(
  receipt: SimulationExecutionEffectReceipt,
  environment: SimulationExecutionEnvironment,
  intent: ExecutionEffectIntent,
  sink: SimulationExecutionEffectSink,
): void {
  if (receipt.environment_kind !== "simulation"
    || receipt.effect_kind !== intent.kind
    || receipt.effect_id !== intent.effect_id
    || receipt.idempotency_key !== intent.idempotency_key
    || receipt.namespace_id !== environment.namespace_id
    || receipt.scenario_id !== environment.scenario_id
    || receipt.run_id !== environment.run_id
    || receipt.sink_id !== sink.sink_id
    || (receipt.status !== "captured" && receipt.status !== "deduplicated")
    || !receipt.sink_record_id.trim()
    || !Number.isFinite(Date.parse(receipt.recorded_at))) {
    throw new ExecutionEffectBoundaryError(
      "invalid_effect_receipt",
      `Simulation sink ${sink.sink_id} returned a receipt for another effect or environment.`,
    );
  }
}

interface SimulationSinkSet {
  readonly environment: SimulationExecutionEnvironment;
  readonly sinks: ReadonlyMap<ExecutionEffectKind, SimulationExecutionEffectSink>;
}

/**
 * Provider-neutral, environment-aware external-effect boundary. It deliberately
 * keeps Live ports and Simulation sinks in different registries. A missing
 * Simulation binding always fails; lookup never falls through to the Live map.
 */
export class ExecutionEffectRouter {
  private readonly livePorts = new Map<ExecutionEffectKind, ProductionExecutionEffectPort>();
  private readonly simulationSinkSets = new Map<string, SimulationSinkSet>();

  registerProductionPort(port: ProductionExecutionEffectPort): void {
    if (port.mode !== "production" || !isEffectKind(port.kind)) {
      throw new ExecutionEffectBoundaryError(
        "invalid_effect_intent",
        "A Live effect port must declare production mode and a reviewed effect kind.",
      );
    }
    assertNonEmpty(port.port_id, "Production effect port ID");
    if (this.livePorts.has(port.kind)) {
      throw new ExecutionEffectBoundaryError(
        "duplicate_production_port",
        `A production port is already registered for ${port.kind}.`,
      );
    }
    this.livePorts.set(port.kind, port);
  }

  bindSimulationSinks(input: {
    readonly environment: SimulationExecutionEnvironment;
    readonly sinks: readonly SimulationExecutionEffectSink[];
  }): ExecutionEffectCoverage {
    assertSimulationExecutionEnvironment(input.environment);
    if (this.simulationSinkSets.has(input.environment.namespace_id)) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_set_already_bound",
        "A Simulation run's effect sinks are immutable after binding; discard the run before replacing them.",
      );
    }
    const byKind = new Map<ExecutionEffectKind, SimulationExecutionEffectSink>();
    for (const sink of input.sinks) {
      if (sink.mode !== "sink_only" || !isEffectKind(sink.kind)) {
        throw new ExecutionEffectBoundaryError(
          "invalid_simulation_sink_set",
          "Simulation may bind only reviewed sink-only effect ports.",
        );
      }
      assertNonEmpty(sink.sink_id, "Simulation effect sink ID");
      if (byKind.has(sink.kind)) {
        throw new ExecutionEffectBoundaryError(
          "invalid_simulation_sink_set",
          `Simulation sink set contains duplicate ${sink.kind} sinks.`,
        );
      }
      if (sink.namespace_id !== input.environment.namespace_id
        || sink.scenario_id !== input.environment.scenario_id
        || sink.run_id !== input.environment.run_id) {
        throw new ExecutionEffectBoundaryError(
          "simulation_sink_scope_mismatch",
          `Simulation sink ${sink.sink_id} does not belong to the selected run namespace.`,
        );
      }
      byKind.set(sink.kind, sink);
    }

    const missingKinds = EXECUTION_EFFECT_KINDS.filter((kind) => !byKind.has(kind));
    if (missingKinds.length > 0) {
      throw new ExecutionEffectBoundaryError(
        "invalid_simulation_sink_set",
        `Simulation sink set is incomplete: ${missingKinds.join(", ")}.`,
      );
    }
    this.simulationSinkSets.set(input.environment.namespace_id, {
      environment: input.environment,
      sinks: byKind,
    });
    return this.coverage(input.environment);
  }

  discardSimulationSinks(environment: SimulationExecutionEnvironment): boolean {
    assertSimulationExecutionEnvironment(environment);
    const selected = this.simulationSinkSets.get(environment.namespace_id);
    if (!selected) return false;
    if (selected.environment.scenario_id !== environment.scenario_id
      || selected.environment.run_id !== environment.run_id
      || selected.environment.institution_id !== environment.institution_id) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_scope_mismatch",
        "Cannot discard a Simulation sink set through another run identity.",
      );
    }
    this.simulationSinkSets.delete(environment.namespace_id);
    return true;
  }

  coverage(environment: ExecutionEnvironment): ExecutionEffectCoverage {
    assertExecutionEnvironment(environment);
    if (environment.kind === "live") {
      const configuredKinds = sortedKinds(this.livePorts.keys());
      const missingKinds = EXECUTION_EFFECT_KINDS.filter((kind) => !this.livePorts.has(kind));
      return Object.freeze({
        environment_kind: "live" as const,
        namespace_id: environment.namespace_id,
        status: missingKinds.length === 0 ? "ready" as const : "blocked" as const,
        required_kinds: EXECUTION_EFFECT_KINDS,
        configured_kinds: Object.freeze(configuredKinds),
        missing_kinds: Object.freeze(missingKinds),
        production_ports_reachable: true,
      });
    }

    const selected = this.simulationSinkSets.get(environment.namespace_id);
    const configuredKinds = selected ? sortedKinds(selected.sinks.keys()) : [];
    const missingKinds = EXECUTION_EFFECT_KINDS.filter((kind) => !configuredKinds.includes(kind));
    return Object.freeze({
      environment_kind: "simulation" as const,
      namespace_id: environment.namespace_id,
      status: missingKinds.length === 0 ? "ready" as const : "blocked" as const,
      required_kinds: EXECUTION_EFFECT_KINDS,
      configured_kinds: Object.freeze(configuredKinds),
      missing_kinds: Object.freeze(missingKinds),
      production_ports_reachable: false,
    });
  }

  async route<TKind extends ExecutionEffectKind>(
    environment: ExecutionEnvironment,
    intent: ExecutionEffectIntent<TKind>,
  ): Promise<ExecutionEffectReceipt<TKind>> {
    assertExecutionEnvironment(environment);
    assertExecutionEffectIntent(intent);
    assertIntentMatchesEnvironment(environment, intent);

    if (environment.kind === "live") {
      const port = this.livePorts.get(intent.kind) as ProductionExecutionEffectPort<TKind> | undefined;
      if (!port) {
        throw new ExecutionEffectBoundaryError(
          "production_port_missing",
          `No production effect port is registered for ${intent.kind}.`,
        );
      }
      const receipt = await port.execute({ environment, intent: cloneIntent(intent) });
      assertLiveReceipt(receipt, environment, intent, port);
      return receipt;
    }

    const selected = this.simulationSinkSets.get(environment.namespace_id);
    if (!selected) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_set_missing",
        "The selected Simulation run has no run-scoped external-effect sink set.",
      );
    }
    if (selected.environment.institution_id !== environment.institution_id
      || selected.environment.scenario_id !== environment.scenario_id
      || selected.environment.run_id !== environment.run_id) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_scope_mismatch",
        "The selected Simulation effect sink set belongs to another run.",
      );
    }
    const sink = selected.sinks.get(intent.kind) as SimulationExecutionEffectSink<TKind> | undefined;
    if (!sink) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_missing",
        `The selected Simulation run has no sink for ${intent.kind}.`,
      );
    }
    const receipt = await sink.capture({ environment, intent: cloneIntent(intent) });
    assertSimulationReceipt(receipt, environment, intent, sink);
    return receipt;
  }
}

/**
 * A bounded process-local sink suitable for the current transient runtime and
 * tests. It records intent only; it has no filesystem, network, provider or Live
 * port dependency. A shared encrypted TTL implementation can replace this behind
 * the same contract for multi-instance operation.
 */
export class RunScopedInMemoryExecutionEffectSink<TKind extends ExecutionEffectKind>
implements SimulationExecutionEffectSink<TKind> {
  readonly mode = "sink_only" as const;
  readonly namespace_id: SimulationExecutionEnvironment["namespace_id"];
  readonly scenario_id: string;
  readonly run_id: string;
  private readonly capturedByIdempotencyKey = new Map<
    string,
    CapturedSimulationExecutionEffect<TKind>
  >();
  private discarded = false;

  constructor(
    readonly kind: TKind,
    readonly sink_id: string,
    environment: SimulationExecutionEnvironment,
  ) {
    assertSimulationExecutionEnvironment(environment);
    assertNonEmpty(sink_id, "Simulation effect sink ID");
    this.namespace_id = environment.namespace_id;
    this.scenario_id = environment.scenario_id;
    this.run_id = environment.run_id;
  }

  capture(input: {
    readonly environment: SimulationExecutionEnvironment;
    readonly intent: ExecutionEffectIntent<TKind>;
  }): Promise<SimulationExecutionEffectReceipt<TKind>> {
    if (this.discarded) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_discarded",
        `Simulation effect sink ${this.sink_id} has been discarded.`,
      );
    }
    assertSimulationExecutionEnvironment(input.environment);
    assertExecutionEffectIntent(input.intent);
    assertIntentMatchesEnvironment(input.environment, input.intent);
    if (input.intent.kind !== this.kind
      || input.environment.namespace_id !== this.namespace_id
      || input.environment.scenario_id !== this.scenario_id
      || input.environment.run_id !== this.run_id) {
      throw new ExecutionEffectBoundaryError(
        "simulation_sink_scope_mismatch",
        `Simulation effect sink ${this.sink_id} cannot capture this kind or run.`,
      );
    }

    const payloadDigest = executionEffectDigest(input.intent);
    const existing = this.capturedByIdempotencyKey.get(input.intent.idempotency_key);
    if (existing) {
      if (existing.payload_digest !== payloadDigest) {
        throw new ExecutionEffectBoundaryError(
          "effect_idempotency_conflict",
          "An effect idempotency key cannot be reused with a changed envelope or payload.",
        );
      }
      return Promise.resolve(Object.freeze({
        ...existing.receipt,
        status: "deduplicated" as const,
      }));
    }

    const receipt: SimulationExecutionEffectReceipt<TKind> = Object.freeze({
      environment_kind: "simulation",
      effect_kind: this.kind,
      effect_id: input.intent.effect_id,
      idempotency_key: input.intent.idempotency_key,
      namespace_id: this.namespace_id,
      scenario_id: this.scenario_id,
      run_id: this.run_id,
      sink_id: this.sink_id,
      sink_record_id: `sink:${this.kind}:${payloadDigest.slice(0, 24)}`,
      status: "captured",
      recorded_at: input.environment.virtual_clock.nowIso(),
    });
    this.capturedByIdempotencyKey.set(input.intent.idempotency_key, {
      intent: cloneIntent(input.intent),
      receipt,
      payload_digest: payloadDigest,
    });
    return Promise.resolve(receipt);
  }

  records(): readonly CapturedSimulationExecutionEffect<TKind>[] {
    return structuredClone([...this.capturedByIdempotencyKey.values()]);
  }

  discard(): void {
    this.capturedByIdempotencyKey.clear();
    this.discarded = true;
  }
}
