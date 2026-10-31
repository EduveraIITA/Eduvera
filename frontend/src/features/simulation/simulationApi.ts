import { apiFetch } from "../../lib/api";

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

export interface SimulationRunResponse {
  schema_version: 1;
  run: SimulationRunView;
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

export interface CreateSimulationRunInput {
  kind: SimulationRunKind;
  name?: string;
  speed: number;
  end_at?: string | null;
  idempotency_key: string;
}

export interface UpdateSimulationDraftInput {
  name?: string;
  speed?: number;
  end_at?: string | null;
}

export interface StartSimulationRunInput {
  speed?: number;
  end_at?: string | null;
}

export interface ResumeSimulationRunInput {
  speed?: number;
}

export interface DuplicateSimulationRunInput {
  name?: string;
  kind?: SimulationRunKind;
  speed?: number;
  end_at?: string | null;
  idempotency_key: string;
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

function simulationRoot(schoolId: string) {
  return `/api/v1/schools/${encodeURIComponent(schoolId)}/simulation`;
}

function runRoot(schoolId: string, runId: string) {
  return `${simulationRoot(schoolId)}/runs/${encodeURIComponent(runId)}`;
}

export function createSimulationRun(schoolId: string, input: CreateSimulationRunInput) {
  return apiFetch<SimulationRunResponse>(`${simulationRoot(schoolId)}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listSimulationRuns(schoolId: string, limit = 10, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(limit) });
  return apiFetch<SimulationRunsResponse>(`${simulationRoot(schoolId)}/runs?${query.toString()}`, { signal });
}

export function listRetainedSimulationRuns(schoolId: string, page = 1, signal?: AbortSignal) {
  const query = new URLSearchParams({ view: "retained", page: String(page) });
  return apiFetch<RetainedSimulationRunsResponse>(`${simulationRoot(schoolId)}/runs?${query.toString()}`, { signal });
}

export function removeSimulationRun(schoolId: string, runId: string, input: { expected_revision: number }) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/remove`, {
    method: "POST", body: JSON.stringify(input),
  });
}

export function getSimulationRun(schoolId: string, runId: string, signal?: AbortSignal) {
  return apiFetch<SimulationRunResponse>(runRoot(schoolId, runId), { signal });
}

export function getSimulationRunResources(
  schoolId: string,
  runId: string,
  page = 1,
  pageSize = 5,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return apiFetch<SimulationRunResourcesResponse>(`${runRoot(schoolId, runId)}/resources?${query.toString()}`, { signal });
}

export function updateSimulationDraft(
  schoolId: string,
  runId: string,
  input: UpdateSimulationDraftInput,
) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/draft`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function configureSimulationBehaviour(
  schoolId: string,
  runId: string,
  input: ConfigureSimulationBehaviourInput,
) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/behaviour`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function startSimulationRun(
  schoolId: string,
  runId: string,
  input: StartSimulationRunInput = {},
) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/start`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function pauseSimulationRun(schoolId: string, runId: string) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/pause`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function resumeSimulationRun(
  schoolId: string,
  runId: string,
  input: ResumeSimulationRunInput = {},
) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/resume`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function stopSimulationRun(schoolId: string, runId: string, input: { expected_revision: number; expected_status: "draft" } | Record<string, never> = {}) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/stop`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function pinSimulationRun(schoolId: string, runId: string) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/pin`, { method: "POST" });
}

export function unpinSimulationRun(schoolId: string, runId: string) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/unpin`, { method: "POST" });
}

export function duplicateSimulationRun(
  schoolId: string,
  runId: string,
  input: DuplicateSimulationRunInput,
) {
  return apiFetch<SimulationRunResponse>(`${runRoot(schoolId, runId)}/duplicate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function compareSimulationRuns(
  schoolId: string,
  input: { run_ids: string[]; duration_ms?: number },
) {
  return apiFetch<SimulationComparisonResponse>(`${simulationRoot(schoolId)}/compare`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
