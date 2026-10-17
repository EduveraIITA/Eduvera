/**
 * An environment clock is injected so environment-aware code never infers its
 * time source from a date, request header, or process wall clock.
 */
export interface ExecutionClock {
  now(): Date;
  nowIso(): string;
}

/** A simulation clock may move only through the isolated runtime that owns it. */
export interface SimulationVirtualClock extends ExecutionClock {
  advanceBy(milliseconds: number): string;
  advanceTo(instant: string): string;
}

/**
 * These flags describe which categories of infrastructure may be wired into an
 * execution environment. They do not grant domain authority to an actor.
 */
export interface LiveExecutionCapabilities {
  readonly mode: "production_ports";
  readonly production_domain_commands: true;
  readonly production_operational_messages: true;
  readonly external_notifications: true;
  readonly connector_calls: true;
  readonly production_evidence_writes: true;
  readonly production_authority_lookups: true;
  readonly scenario_event_sink: false;
  readonly scenario_message_sink: false;
  readonly scenario_artifact_sink: false;
}

export interface SimulationExecutionCapabilities {
  readonly mode: "sink_only";
  readonly production_domain_commands: false;
  readonly production_operational_messages: false;
  readonly external_notifications: false;
  readonly connector_calls: false;
  readonly production_evidence_writes: false;
  readonly production_authority_lookups: false;
  readonly scenario_event_sink: true;
  readonly scenario_message_sink: true;
  readonly scenario_artifact_sink: true;
}

export interface LiveExecutionEnvironment {
  readonly kind: "live";
  readonly truth_mode: "authoritative_real";
  readonly lifecycle: "persistent";
  readonly institution_id: string;
  readonly namespace_id: `live:${string}`;
  readonly clock: ExecutionClock;
  readonly capabilities: LiveExecutionCapabilities;
  readonly scenario_id?: never;
  readonly run_id?: never;
  readonly virtual_clock?: never;
  readonly source_snapshot_ref?: never;
  readonly source_live_namespace_id?: never;
  readonly coverage_gate?: never;
  readonly expires_at?: never;
}

export interface SimulationCoverageGate {
  readonly status: "passed";
  readonly manifest_ref: string;
  readonly checked_at: string;
}

export interface SimulationExecutionEnvironment {
  readonly kind: "simulation";
  readonly truth_mode: "transient_virtual";
  readonly lifecycle: "transient_virtual_fork";
  readonly institution_id: string;
  readonly scenario_id: string;
  readonly run_id: string;
  readonly namespace_id: `scenario:${string}:run:${string}`;
  readonly source_live_namespace_id: `live:${string}`;
  readonly virtual_clock: SimulationVirtualClock;
  readonly source_snapshot_ref: string;
  readonly coverage_gate: SimulationCoverageGate;
  readonly expires_at: string;
  readonly capabilities: SimulationExecutionCapabilities;
  readonly clock?: never;
}

export type ExecutionEnvironment =
  | LiveExecutionEnvironment
  | SimulationExecutionEnvironment;

/**
 * Domains expose the same domain-native command and projection contracts in both
 * environments. The selected environment determines which isolated adapter set is
 * bound; callers do not switch to a separate simulation product model.
 */
export interface ExecutionEnvironmentPortBinding<
  TDomainPorts,
  TProjectionPorts,
> {
  readonly environment: ExecutionEnvironment;
  readonly namespace_id: ExecutionEnvironment["namespace_id"];
  readonly domain_ports: TDomainPorts;
  readonly projection_ports: TProjectionPorts;
}

/**
 * The server resolves this from an authenticated session bound either to Live or
 * to one verified transient Simulation run. It is intentionally a port rather than
 * a wire-header contract: clients cannot self-assert an execution environment.
 */
export interface ServerAuthoritativeExecutionEnvironmentResolver<TServerRequestContext> {
  resolve(requestContext: TServerRequestContext): Promise<ExecutionEnvironment>;
}

export interface ExecutionDataPlaneAdapter<
  TUnitOfWork,
  TDomainPorts,
  TProjectionPorts,
> {
  readonly unit_of_work: TUnitOfWork;
  readonly domain_ports: TDomainPorts;
  readonly projection_ports: TProjectionPorts;
}

export interface LiveExecutionContext<
  TUnitOfWork,
  TDomainPorts,
  TProjectionPorts,
> extends ExecutionEnvironmentPortBinding<TDomainPorts, TProjectionPorts> {
  readonly environment: LiveExecutionEnvironment;
  readonly storage_mode: "authoritative_live_unit_of_work";
  readonly effects_mode: "production_ports";
  readonly unit_of_work: TUnitOfWork;
}

export interface SimulationExecutionContext<
  TUnitOfWork,
  TDomainPorts,
  TProjectionPorts,
> extends ExecutionEnvironmentPortBinding<TDomainPorts, TProjectionPorts> {
  readonly environment: SimulationExecutionEnvironment;
  readonly storage_mode: "isolated_copy_on_write";
  readonly effects_mode: "sink_only";
  readonly unit_of_work: TUnitOfWork;
}

/**
 * A domain service receives one of these contexts and continues to use the same
 * domain and projection interfaces. Only the backing data plane, clock and effects
 * differ. Domain invariants and response contracts therefore stay shared.
 */
export type ModelCoreExecutionContext<
  TUnitOfWork,
  TDomainPorts,
  TProjectionPorts,
> =
  | LiveExecutionContext<TUnitOfWork, TDomainPorts, TProjectionPorts>
  | SimulationExecutionContext<TUnitOfWork, TDomainPorts, TProjectionPorts>;

export interface ExecutionDataPlaneAdapters<
  TUnitOfWork,
  TDomainPorts,
  TProjectionPorts,
> {
  live(
    environment: LiveExecutionEnvironment,
  ): ExecutionDataPlaneAdapter<TUnitOfWork, TDomainPorts, TProjectionPorts>;
  simulation(
    environment: SimulationExecutionEnvironment,
  ): ExecutionDataPlaneAdapter<TUnitOfWork, TDomainPorts, TProjectionPorts>;
}
