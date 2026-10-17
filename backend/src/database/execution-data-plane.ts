import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  DatabaseConnection,
  Driver,
  QueryCompiler,
  TransactionSettings,
} from "kysely";
import type {
  ExecutionEnvironment,
  SimulationExecutionEnvironment,
} from "../campus-model-core/execution-environment.contracts.js";
import type {
  ExecutionEffectCoverage,
  ExecutionEffectKind,
} from "../campus-model-core/execution-effects.contracts.js";
import {
  EXECUTION_EFFECT_KINDS,
} from "../campus-model-core/execution-effects.contracts.js";
import {
  assertExecutionEnvironment,
  assertSimulationExecutionEnvironment,
} from "../campus-model-core/execution-environment.runtime.js";

export const REQUIRED_APPLICATION_SIMULATION_MODULES = Object.freeze([
  "shell",
  "identity",
  "people",
  "today",
  "timetable",
  "attendance",
  "messages",
  "requests",
  "notifications",
  "campus_view",
  "kpis",
] as const);

export const REQUIRED_MODULE_DATA_PLANE_CAPABILITIES = Object.freeze([
  "snapshot",
  "queries",
  "commands",
  "events",
  "realtime",
] as const);

export type ModuleDataPlaneCapability =
  (typeof REQUIRED_MODULE_DATA_PLANE_CAPABILITIES)[number];

export interface SimulationModuleCoverage {
  readonly module_id: string;
  readonly capabilities: Readonly<Record<ModuleDataPlaneCapability, "supported" | "not_applicable" | "unsupported">>;
}

export interface SimulationApplicationCoverageManifest {
  readonly manifest_ref: string;
  readonly checked_at: string;
  readonly enabled_modules: readonly string[];
  readonly modules: readonly SimulationModuleCoverage[];
  readonly storage_mode: "isolated_copy_on_write" | "unsupported";
  readonly event_outbox_mode: "isolated" | "unsupported";
  readonly operational_message_mode: "sink_only" | "unsupported";
  readonly file_storage_mode: "isolated" | "disabled" | "unsupported";
  readonly external_connector_mode: "disabled" | "sink_only" | "unsupported";
  readonly realtime_mode: "isolated" | "unsupported";
  readonly uncovered_effects: readonly string[];
}

export interface SimulationApplicationCoverageEvaluation {
  readonly application_parity: boolean;
  readonly missing_modules: readonly string[];
  readonly incomplete_capabilities: readonly string[];
  readonly unsafe_effects: readonly string[];
}

export interface SimulationDataPlaneDescriptor {
  readonly institution_id: string;
  readonly scenario_id: string;
  readonly run_id: string;
  readonly namespace_id: SimulationExecutionEnvironment["namespace_id"];
  readonly manifest_ref: string;
  readonly checked_at: string;
  readonly expires_at: string;
  readonly status: "blocked" | "ready";
  readonly application_parity: boolean;
  readonly missing_modules: readonly string[];
  readonly incomplete_capabilities: readonly string[];
  readonly unsafe_effects: readonly string[];
}

export type ExecutionDataPlaneErrorCode =
  | "invalid_coverage_manifest"
  | "invalid_effect_coverage"
  | "application_parity_incomplete"
  | "data_plane_not_found"
  | "data_plane_identity_mismatch"
  | "data_plane_expired"
  | "data_plane_conflict"
  | "live_driver_reuse_forbidden";

export class ExecutionDataPlaneError extends Error {
  constructor(
    readonly code: ExecutionDataPlaneErrorCode,
    message: string,
    readonly descriptor?: SimulationDataPlaneDescriptor,
  ) {
    super(message);
    this.name = "ExecutionDataPlaneError";
  }
}

function normalizeIdentifiers(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function validIsoInstant(value: string): boolean {
  return value.trim() === value && Number.isFinite(Date.parse(value));
}

function normalizeEffectKinds(values: readonly ExecutionEffectKind[]): ExecutionEffectKind[] {
  const selected = new Set(values);
  return EXECUTION_EFFECT_KINDS.filter((kind) => selected.has(kind));
}

function assertEffectKindList(
  values: readonly ExecutionEffectKind[],
  label: string,
): ExecutionEffectKind[] {
  if (!Array.isArray(values)
    || values.some((kind) => !(EXECUTION_EFFECT_KINDS as readonly string[]).includes(kind))
    || new Set(values).size !== values.length) {
    throw new ExecutionDataPlaneError(
      "invalid_effect_coverage",
      `${label} must contain unique reviewed execution-effect kinds.`,
    );
  }
  return normalizeEffectKinds(values);
}

function evaluateSimulationEffectCoverage(
  environment: SimulationExecutionEnvironment,
  coverage: ExecutionEffectCoverage,
): readonly string[] {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    throw new ExecutionDataPlaneError(
      "invalid_effect_coverage",
      "A Simulation data plane requires runtime execution-effect coverage.",
    );
  }
  if (coverage.environment_kind !== "simulation") {
    throw new ExecutionDataPlaneError(
      "invalid_effect_coverage",
      "A Simulation data plane requires Simulation effect coverage.",
    );
  }
  if (coverage.namespace_id !== environment.namespace_id) {
    throw new ExecutionDataPlaneError(
      "invalid_effect_coverage",
      "Execution-effect coverage must belong to the exact Simulation run namespace.",
    );
  }

  const requiredKinds = assertEffectKindList(coverage.required_kinds, "Required effect kinds");
  const configuredKinds = assertEffectKindList(coverage.configured_kinds, "Configured effect kinds");
  const missingKinds = assertEffectKindList(coverage.missing_kinds, "Missing effect kinds");
  const configured = new Set(configuredKinds);
  const reportedMissing = new Set(missingKinds);
  const unsafeEffects: string[] = [];

  for (const kind of EXECUTION_EFFECT_KINDS) {
    if (!requiredKinds.includes(kind)) unsafeEffects.push(`effect_requirement:${kind}`);
    if (!configured.has(kind) || reportedMissing.has(kind)) unsafeEffects.push(`effect_sink:${kind}`);
  }
  if (coverage.status !== "ready") unsafeEffects.push("effect_boundary_not_ready");
  if (coverage.production_ports_reachable !== false) {
    unsafeEffects.push("production_effect_ports_reachable");
  }

  return Object.freeze(normalizeIdentifiers(unsafeEffects));
}

/**
 * Evaluates whole-application parity. A domain that has no command surface may
 * explicitly say `not_applicable`; `unsupported` always blocks activation.
 */
export function evaluateSimulationApplicationCoverage(
  manifest: SimulationApplicationCoverageManifest,
): SimulationApplicationCoverageEvaluation {
  if (!manifest.manifest_ref.trim() || !validIsoInstant(manifest.checked_at)) {
    throw new ExecutionDataPlaneError(
      "invalid_coverage_manifest",
      "Simulation coverage requires a stable manifest reference and ISO check time.",
    );
  }

  const requiredModules = normalizeIdentifiers([
    ...REQUIRED_APPLICATION_SIMULATION_MODULES,
    ...manifest.enabled_modules,
  ]);
  const moduleMap = new Map<string, SimulationModuleCoverage>();
  for (const module of manifest.modules) {
    const moduleId = module.module_id.trim();
    if (!moduleId || moduleMap.has(moduleId)) {
      throw new ExecutionDataPlaneError(
        "invalid_coverage_manifest",
        "Simulation coverage module identifiers must be non-empty and unique.",
      );
    }
    moduleMap.set(moduleId, module);
  }

  const missingModules = requiredModules.filter((moduleId) => !moduleMap.has(moduleId));
  const incompleteCapabilities: string[] = [];
  for (const moduleId of requiredModules) {
    const module = moduleMap.get(moduleId);
    if (!module) continue;
    for (const capability of REQUIRED_MODULE_DATA_PLANE_CAPABILITIES) {
      const value = module.capabilities[capability];
      if (value !== "supported" && value !== "not_applicable") {
        incompleteCapabilities.push(`${moduleId}:${capability}`);
      }
    }
  }

  const unsafeEffects: string[] = [];
  if (manifest.storage_mode !== "isolated_copy_on_write") unsafeEffects.push("database_storage");
  if (manifest.event_outbox_mode !== "isolated") unsafeEffects.push("event_outbox");
  if (manifest.operational_message_mode !== "sink_only") unsafeEffects.push("operational_messages");
  if (manifest.file_storage_mode !== "isolated" && manifest.file_storage_mode !== "disabled") {
    unsafeEffects.push("file_storage");
  }
  if (manifest.external_connector_mode !== "disabled" && manifest.external_connector_mode !== "sink_only") {
    unsafeEffects.push("external_connectors");
  }
  if (manifest.realtime_mode !== "isolated") unsafeEffects.push("realtime");
  unsafeEffects.push(...normalizeIdentifiers(manifest.uncovered_effects));

  const normalizedIncomplete = normalizeIdentifiers(incompleteCapabilities);
  const normalizedUnsafe = normalizeIdentifiers(unsafeEffects);
  return Object.freeze({
    application_parity: missingModules.length === 0
      && normalizedIncomplete.length === 0
      && normalizedUnsafe.length === 0,
    missing_modules: Object.freeze(missingModules),
    incomplete_capabilities: Object.freeze(normalizedIncomplete),
    unsafe_effects: Object.freeze(normalizedUnsafe),
  });
}

/**
 * Request-local execution context. HTTP integration must resolve the environment
 * from the authenticated server session and wrap the complete request lifecycle.
 * A caller-controlled header must never be passed here.
 */
@Injectable()
export class ExecutionDataPlaneScope {
  private readonly storage = new AsyncLocalStorage<ExecutionEnvironment>();

  current(): ExecutionEnvironment | undefined {
    return this.storage.getStore();
  }

  run<T>(environment: ExecutionEnvironment, callback: () => T): T {
    assertExecutionEnvironment(environment);
    return this.storage.run(environment, callback);
  }
}

interface DataPlaneEntry {
  readonly environment: SimulationExecutionEnvironment;
  readonly descriptor: SimulationDataPlaneDescriptor;
  readonly driver?: Driver;
}

export interface PrepareSimulationDataPlaneInput {
  readonly environment: SimulationExecutionEnvironment;
  readonly coverage: SimulationApplicationCoverageManifest;
  /**
   * Runtime evidence from the execution-effect router for this exact run. The
   * application manifest cannot attest its own connector/effect isolation.
   */
  readonly effectCoverage: ExecutionEffectCoverage;
  /**
   * Must address independently isolated storage. A rollback-only transaction on
   * the Live database is forbidden because it can lock Live rows and mutate
   * sequence state even when eventually rolled back.
   */
  readonly driver: Driver;
}

export interface SimulationDataPlaneSelector {
  readonly institutionId: string;
  readonly runId: string;
  readonly namespaceId: SimulationExecutionEnvironment["namespace_id"];
}

/**
 * Process-local registry for independently isolated Simulation data planes.
 * Multi-instance deployment needs a shared lease/registry before this service may
 * advertise application parity across instances.
 */
@Injectable()
export class ExecutionDataPlaneRegistry {
  private readonly entries = new Map<string, DataPlaneEntry>();
  private readonly preparations = new Map<string, Promise<SimulationDataPlaneDescriptor>>();
  private liveDriver?: Driver;

  attachLiveDriver(driver: Driver): void {
    if (this.liveDriver && this.liveDriver !== driver) {
      throw new ExecutionDataPlaneError(
        "data_plane_conflict",
        "The execution data-plane registry is already attached to another Live driver.",
      );
    }
    this.liveDriver = driver;
  }

  async prepare(input: PrepareSimulationDataPlaneInput): Promise<SimulationDataPlaneDescriptor> {
    assertSimulationExecutionEnvironment(input.environment);
    const applicationCoverage = evaluateSimulationApplicationCoverage(input.coverage);
    const effectUnsafe = evaluateSimulationEffectCoverage(input.environment, input.effectCoverage);
    if (input.environment.coverage_gate.manifest_ref !== input.coverage.manifest_ref) {
      throw new ExecutionDataPlaneError(
        "invalid_coverage_manifest",
        "The environment coverage receipt does not match the data-plane manifest.",
      );
    }
    const namespaceId = input.environment.namespace_id;
    const existingPreparation = this.preparations.get(namespaceId);
    if (existingPreparation) {
      if (!applicationCoverage.application_parity || effectUnsafe.length > 0) {
        throw new ExecutionDataPlaneError(
          "application_parity_incomplete",
          "Incomplete application or effect coverage cannot join a ready data-plane preparation.",
        );
      }
      return existingPreparation;
    }

    const preparation = this.prepareOnce(input).finally(() => {
      this.preparations.delete(namespaceId);
    });
    this.preparations.set(namespaceId, preparation);
    return preparation;
  }

  private async prepareOnce(input: PrepareSimulationDataPlaneInput): Promise<SimulationDataPlaneDescriptor> {
    const environment = input.environment;
    const coverage = evaluateSimulationApplicationCoverage(input.coverage);
    const effectUnsafe = evaluateSimulationEffectCoverage(environment, input.effectCoverage);
    if (environment.coverage_gate.manifest_ref !== input.coverage.manifest_ref) {
      throw new ExecutionDataPlaneError(
        "invalid_coverage_manifest",
        "The environment coverage receipt does not match the data-plane manifest.",
      );
    }

    const unsafeEffects = normalizeIdentifiers([
      ...coverage.unsafe_effects,
      ...effectUnsafe,
    ]);
    const applicationParity = coverage.application_parity && effectUnsafe.length === 0;
    const prior = this.entries.get(environment.namespace_id);
    if (prior?.descriptor.status === "ready") {
      if (!applicationParity) {
        throw new ExecutionDataPlaneError(
          "application_parity_incomplete",
          "Incomplete application or effect coverage cannot reuse a ready Simulation data plane.",
          prior.descriptor,
        );
      }
      if (prior.environment.institution_id !== environment.institution_id
        || prior.environment.run_id !== environment.run_id
        || prior.descriptor.manifest_ref !== input.coverage.manifest_ref
        || prior.driver !== input.driver) {
        throw new ExecutionDataPlaneError(
          "data_plane_conflict",
          "A different isolated data plane is already registered for this namespace.",
          prior.descriptor,
        );
      }
      return prior.descriptor;
    }

    const baseDescriptor = {
      institution_id: environment.institution_id,
      scenario_id: environment.scenario_id,
      run_id: environment.run_id,
      namespace_id: environment.namespace_id,
      manifest_ref: input.coverage.manifest_ref,
      checked_at: input.coverage.checked_at,
      expires_at: environment.expires_at,
      application_parity: applicationParity,
      missing_modules: coverage.missing_modules,
      incomplete_capabilities: coverage.incomplete_capabilities,
      unsafe_effects: Object.freeze(unsafeEffects),
    } as const;

    if (!applicationParity) {
      const descriptor: SimulationDataPlaneDescriptor = Object.freeze({
        ...baseDescriptor,
        status: "blocked",
      });
      this.entries.set(environment.namespace_id, { environment, descriptor });
      return descriptor;
    }
    if (Date.parse(environment.expires_at) <= Date.now()) {
      throw new ExecutionDataPlaneError("data_plane_expired", "The Simulation data plane has expired.");
    }
    if (this.liveDriver && input.driver === this.liveDriver) {
      throw new ExecutionDataPlaneError(
        "live_driver_reuse_forbidden",
        "Simulation cannot reuse the Live database driver.",
      );
    }

    await input.driver.init();
    if (Date.parse(environment.expires_at) <= Date.now()) {
      await input.driver.destroy();
      throw new ExecutionDataPlaneError("data_plane_expired", "The Simulation data plane expired while preparing.");
    }
    const descriptor: SimulationDataPlaneDescriptor = Object.freeze({
      ...baseDescriptor,
      status: "ready",
      application_parity: true,
    });
    this.entries.set(environment.namespace_id, { environment, descriptor, driver: input.driver });
    return descriptor;
  }

  descriptor(selector: SimulationDataPlaneSelector): SimulationDataPlaneDescriptor | undefined {
    return this.entries.get(selector.namespaceId)?.descriptor;
  }

  assertReady(selector: SimulationDataPlaneSelector): SimulationDataPlaneDescriptor {
    const entry = this.entries.get(selector.namespaceId);
    if (!entry) {
      throw new ExecutionDataPlaneError(
        "data_plane_not_found",
        "No isolated Simulation data plane is registered for this run.",
      );
    }
    if (entry.environment.institution_id !== selector.institutionId
      || entry.environment.run_id !== selector.runId) {
      throw new ExecutionDataPlaneError(
        "data_plane_identity_mismatch",
        "The Simulation data plane does not belong to this institution and run.",
        entry.descriptor,
      );
    }
    if (Date.parse(entry.environment.expires_at) <= Date.now()) {
      void this.discard(selector.namespaceId);
      throw new ExecutionDataPlaneError(
        "data_plane_expired",
        "The Simulation data plane has expired.",
        entry.descriptor,
      );
    }
    if (entry.descriptor.status !== "ready" || !entry.descriptor.application_parity || !entry.driver) {
      throw new ExecutionDataPlaneError(
        "application_parity_incomplete",
        "The Simulation run does not cover the complete application and cannot be activated.",
        entry.descriptor,
      );
    }
    return entry.descriptor;
  }

  /** Request-bound guard used before any normal domain controller is entered. */
  assertEnvironmentReady(environment: ExecutionEnvironment): SimulationDataPlaneDescriptor | undefined {
    assertExecutionEnvironment(environment);
    if (environment.kind === "live") return undefined;
    return this.assertReady({
      institutionId: environment.institution_id,
      runId: environment.run_id,
      namespaceId: environment.namespace_id,
    });
  }

  driverFor(environment: SimulationExecutionEnvironment): Driver {
    const descriptor = this.assertReady({
      institutionId: environment.institution_id,
      runId: environment.run_id,
      namespaceId: environment.namespace_id,
    });
    const entry = this.entries.get(descriptor.namespace_id);
    if (!entry?.driver) {
      throw new ExecutionDataPlaneError(
        "application_parity_incomplete",
        "The Simulation data plane has no isolated database driver.",
        descriptor,
      );
    }
    return entry.driver;
  }

  async discard(namespaceId: string): Promise<boolean> {
    const entry = this.entries.get(namespaceId);
    if (!entry) return false;
    this.entries.delete(namespaceId);
    if (entry.driver) await entry.driver.destroy();
    return true;
  }

  async discardAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.flatMap((entry) => entry.driver ? [entry.driver.destroy()] : []));
  }
}

interface RoutedConnectionOwner {
  readonly driver: Driver;
  readonly connection: DatabaseConnection;
}

/**
 * Central Kysely driver switch. Query builders and existing domain services stay
 * unchanged, while every connection in a Simulation request comes from the
 * independently isolated registered driver. There is deliberately no Simulation
 * fallback to Live.
 */
export class ExecutionRoutingDriver implements Driver {
  private readonly owners = new WeakMap<DatabaseConnection, RoutedConnectionOwner>();

  constructor(
    private readonly live: Driver,
    private readonly scope: ExecutionDataPlaneScope,
    private readonly registry: ExecutionDataPlaneRegistry,
  ) {}

  async init(): Promise<void> {
    await this.live.init();
    this.registry.attachLiveDriver(this.live);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const environment = this.scope.current();
    const driver = environment?.kind === "simulation"
      ? this.registry.driverFor(environment)
      : this.live;
    const connection = await driver.acquireConnection();
    const routed: DatabaseConnection = {
      executeQuery: (query) => connection.executeQuery(query),
      streamQuery: (query, chunkSize) => connection.streamQuery(query, chunkSize),
    };
    this.owners.set(routed, { driver, connection });
    return routed;
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    const owner = this.owner(connection);
    await owner.driver.beginTransaction(owner.connection, settings);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const owner = this.owner(connection);
    await owner.driver.commitTransaction(owner.connection);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const owner = this.owner(connection);
    await owner.driver.rollbackTransaction(owner.connection);
  }

  async savepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler["compileQuery"],
  ): Promise<void> {
    const owner = this.owner(connection);
    if (!owner.driver.savepoint) throw new Error("The selected data plane does not support savepoints.");
    await owner.driver.savepoint(owner.connection, savepointName, compileQuery);
  }

  async rollbackToSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler["compileQuery"],
  ): Promise<void> {
    const owner = this.owner(connection);
    if (!owner.driver.rollbackToSavepoint) throw new Error("The selected data plane does not support savepoints.");
    await owner.driver.rollbackToSavepoint(owner.connection, savepointName, compileQuery);
  }

  async releaseSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: QueryCompiler["compileQuery"],
  ): Promise<void> {
    const owner = this.owner(connection);
    if (!owner.driver.releaseSavepoint) throw new Error("The selected data plane does not support savepoints.");
    await owner.driver.releaseSavepoint(owner.connection, savepointName, compileQuery);
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    const owner = this.owner(connection);
    this.owners.delete(connection);
    await owner.driver.releaseConnection(owner.connection);
  }

  async destroy(): Promise<void> {
    await this.registry.discardAll();
    await this.live.destroy();
  }

  private owner(connection: DatabaseConnection): RoutedConnectionOwner {
    const owner = this.owners.get(connection);
    if (!owner) throw new Error("The database connection was not acquired by the execution routing driver.");
    return owner;
  }
}
