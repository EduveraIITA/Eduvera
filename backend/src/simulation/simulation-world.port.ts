import type {
  PersistedSimulationRun,
  SimulationBehaviourConfigurationV2,
  SimulationMetricValue,
  SimulationRunKind,
} from "./simulation.contracts.js";

export const SIMULATION_WORLD_PORT = Symbol.for("thatcampus.simulation-world-port");

export interface SimulationWorldAddress {
  institution_id: string;
  scenario_id: string;
  run_id: string;
  namespace_id: `scenario:${string}:run:${string}`;
  kind: SimulationRunKind;
  deterministic_seed: string;
}

export interface CaptureSimulationWorldInput extends SimulationWorldAddress {
  actor_id: string;
  requested_at: string;
}

export interface CaptureSimulationWorldResult {
  world_ref: string;
  world_revision: number;
  manifest_ref: string;
  manifest_checked_at: string;
  time_zone: string;
  virtual_start_at: string;
  source_snapshot: {
    ref: string;
    hash: string;
    captured_at: string;
    source_revisions: Readonly<Record<string, string>>;
  };
  limitations: readonly string[];
}

export interface ForkSimulationWorldInput extends SimulationWorldAddress {
  actor_id: string;
  requested_at: string;
  source_run: PersistedSimulationRun;
}

/**
 * Reopens a retained run after process restart and ensures its independently
 * isolated data plane is registered before an authenticated session can enter.
 */
export interface OpenSimulationWorldResult {
  manifest_ref: string;
  checked_at: string;
  can_open: boolean;
  limitations: readonly string[];
}

export interface AdvanceSimulationWorldInput extends SimulationWorldAddress {
  world_ref: string;
  world_revision: number;
  checkpoint_ref: string | null;
  virtual_from: string;
  virtual_to: string;
  lease_token: string;
  lease_fence: number;
  lease_until: string;
}

export interface AdvanceSimulationWorldResult {
  world_revision: number;
  checkpoint_ref: string;
  emitted_event_count: number;
  next_event_at: string | null;
  metrics: readonly Omit<SimulationMetricValue, "measured_at" | "simulated_elapsed_ms">[];
}

export interface RecoverSimulationWorldAdvanceInput extends SimulationWorldAddress {
  world_revision: number;
  virtual_from: string;
}

export interface ConfigureSimulationWorldBehaviourInput {
  run: PersistedSimulationRun;
  actor_id: string;
  configured_at: string;
  configuration: SimulationBehaviourConfigurationV2;
}

export interface ConfigureSimulationWorldBehaviourResult {
  version_ref: string;
  configuration_hash: string;
  approved_by_agent_id: string;
  configured_at: string;
}

export interface MeasureSimulationWorldResult {
  /** Bytes unique to this run, including branch relations and run-local artifacts. */
  exclusive_bytes: number;
  /** Immutable snapshot bytes shared by this run and any controlled forks. */
  shared_snapshot_bytes: number;
  measured_at: string;
}

export interface GarbageCollectSimulationWorldInput {
  run: PersistedSimulationRun;
  gc_token: string;
  gc_fence: number;
  requested_at: string;
}

export interface GarbageCollectSimulationWorldResult {
  released_bytes: number;
  retained_shared_snapshot: boolean;
  receipt_ref: string;
}

/**
 * A registered adapter captures Live exactly once, then works only inside the
 * run namespace. It must retain native domain invariants and must never invent
 * human choices; cohort behaviour requires an approved versioned policy.
 */
export interface SimulationWorldPort {
  /** Infrastructure-only preflight before admitting a fresh Live capture. No run writes. */
  assertCaptureReady?(): Promise<void>;
  capture(input: CaptureSimulationWorldInput): Promise<CaptureSimulationWorldResult>;
  fork(input: ForkSimulationWorldInput): Promise<CaptureSimulationWorldResult>;
  open(run: PersistedSimulationRun): Promise<OpenSimulationWorldResult>;
  configureBehaviour?(
    input: ConfigureSimulationWorldBehaviourInput,
  ): Promise<ConfigureSimulationWorldBehaviourResult>;
  advance(input: AdvanceSimulationWorldInput): Promise<AdvanceSimulationWorldResult>;
  /** Reconcile a committed receipt from an older/crashed control-plane claim. */
  recoverAdvance?(input: RecoverSimulationWorldAdvanceInput): Promise<{ virtual_to: string; result: AdvanceSimulationWorldResult } | null>;
  stop(run: PersistedSimulationRun): Promise<void>;
  discard(run: PersistedSimulationRun): Promise<void>;
  measure?(run: PersistedSimulationRun): Promise<MeasureSimulationWorldResult>;
  garbageCollect?(
    input: GarbageCollectSimulationWorldInput,
  ): Promise<GarbageCollectSimulationWorldResult>;
}
