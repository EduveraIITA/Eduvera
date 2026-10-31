/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type SimulationRunKind = "baseline" | "scenario";

export type SimulationRunStatus =
  | "preparing"
  | "draft"
  | "running"
  | "paused"
  | "stopped"
  | "completed"
  | "failed";

export type SimulationRunAction =
  | "open"
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "duplicate"
  | "compare"
  | "pin"
  | "unpin"
  | "remove";

export interface SimulationSnapshotReference {
  ref: string;
  hash: string;
  captured_at: string;
  source_revisions: Record<string, string>;
}

export interface SimulationRunMetric {
  key: string;
  label?: string;
  unit: string;
  value: number | string | null;
  measured_at: string;
  simulated_elapsed_ms: number;
}

export interface SimulationDraftChange {
  id: string;
  domain: string;
  change_kind: string;
  target_ref: string;
  summary: string;
  recorded_at: string;
  source_revision: string;
}

export interface SimulationRunView {
  id: string;
  /** Control-record revision; older clients/fixtures may not supply it. */
  revision?: number;
  scenario_id: string;
  namespace_id: string;
  kind: SimulationRunKind;
  name: string;
  status: SimulationRunStatus;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  stopped_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  created_by_me: boolean;
  speed: number;
  clock: {
    virtual_now: string;
    time_zone: string;
    simulated_elapsed_ms: number;
    end_at: string | null;
    unbounded: boolean;
  };
  can_open: boolean;
  available_actions: SimulationRunAction[];
  snapshot: SimulationSnapshotReference | null;
  world: {
    ref: string;
    revision: number;
    manifest_ref: string;
    limitations: string[];
  } | null;
  progress: {
    event_count: number;
    checkpoint_count: number;
    last_checkpoint_at: string | null;
    next_wake_at: string | null;
  };
  metrics: SimulationRunMetric[];
  draft_changes: SimulationDraftChange[];
  behaviour: SimulationBehaviourView | null;
  retention: {
    pinned: boolean;
    pinned_at: string | null;
    expires_at: string | null;
    policy_version: number;
    state: "retained" | "deleting" | "deleted" | "failed";
    world_discarded_at: string | null;
  };
  resources: {
    reservation_bytes: number;
    observed_storage_bytes: number;
    measured_at: string | null;
    paused_at: string | null;
    pause_reason: string | null;
    lease_recovery_count: number;
  };
}

export interface SimulationRunsResponse {
  schema_version: 1;
  results: SimulationRunView[];
}

export interface RetainedSimulationRunsResponse extends SimulationRunsResponse {
  page: { number: number; page_size: number; total: number; total_pages: number };
}

export interface SimulationAttendanceBehaviour {
  enabled: boolean;
  present: number;
  late: number;
  absent: number;
  excused: number;
  submission_delay_minutes: number;
}

export interface SimulationOfferResponseBehaviour {
  enabled: boolean;
  accepted: number;
  declined: number;
  no_response: number;
  response_delay_minutes: number;
}

export interface SimulationBehaviourProvenance {
  version_ref: string;
  configuration_hash: string;
  approved_by_agent_id: string;
  configured_at: string;
}

export interface SimulationBehaviourView {
  schema_version: 2;
  attendance: SimulationAttendanceBehaviour & Partial<SimulationBehaviourProvenance>;
  coverage_offers: SimulationOfferResponseBehaviour;
  invigilation_offers: SimulationOfferResponseBehaviour;
  provenance: SimulationBehaviourProvenance;
}

export interface ConfigureSimulationBehaviourInput {
  schema_version: 2;
  attendance: SimulationAttendanceBehaviour;
  coverage_offers: SimulationOfferResponseBehaviour;
  invigilation_offers: SimulationOfferResponseBehaviour;
}

export type SimulationExecutionEffectKind =
  | "operational_message"
  | "external_notification"
  | "connector_call"
  | "file_write"
  | "external_compute_call"
  | "webhook_delivery"
  | "realtime_publication";

export interface SimulationRunEffectReceipt {
  id: string;
  kind: SimulationExecutionEffectKind;
  schema_name: string;
  status: "captured";
  recorded_at: string;
  logical_target: { kind: string; ref: string };
  payload_digest: string;
}

export interface SimulationRunResourcesResponse {
  schema_version: 1;
  run_id: string;
  counts: {
    effects: Partial<Record<SimulationExecutionEffectKind, number>>;
    artifacts: number;
    artifact_bytes: number;
  };
  effects: {
    page: number;
    page_size: number;
    total: number;
    results: SimulationRunEffectReceipt[];
  };
}

export interface SimulationComparisonMetric {
  key: string;
  label?: string;
  unit: string;
  values: Array<{
    run_id: string;
    value: number | string | null;
    measured_at: string;
  }>;
  deltas_from_first: Array<{
    run_id: string;
    delta: number | null;
    delta_percent: number | null;
  }>;
}

export interface SimulationComparison {
  duration_ms: number;
  controlled_snapshot: boolean;
  provenance_warning: string | null;
  runs: Array<{
    run_id: string;
    name: string;
    kind: SimulationRunKind;
    status: SimulationRunStatus;
    snapshot: SimulationSnapshotReference;
    actual_duration_ms: number;
  }>;
  metrics: SimulationComparisonMetric[];
}

export interface SimulationComparisonResponse {
  schema_version: 1;
  comparison: SimulationComparison;
}
