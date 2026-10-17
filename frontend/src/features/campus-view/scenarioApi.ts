import { apiFetch } from "../../lib/api";

export type CampusScenarioInterventionType = "teacher_unavailable" | "space_unavailable";
export type CampusScenarioStatus = "queued" | "running" | "completed" | "failed";
export type CampusScenarioUnit = "sessions" | "learner_places" | "conflicts" | "percent" | "minutes";

export interface CampusScenarioSessionWindow {
  date: string;
  starts_at: string;
  ends_at: string;
}

export interface CampusScenarioTarget {
  id: string;
  label: string;
  detail?: string;
  session_dates?: string[];
  session_windows?: CampusScenarioSessionWindow[];
  date_windows?: CampusScenarioSessionWindow[];
  suggested_date?: string | null;
  suggested_window?: Omit<CampusScenarioSessionWindow, "date"> | null;
}

export interface CampusScenarioTargetsResponse {
  schema_version: 1;
  evidence_mode: "simulation";
  campus_id: string;
  horizon_days: number;
  horizon: { from: string; to: string };
  teachers: Array<{ id: string; label: string; session_dates: string[]; session_windows: CampusScenarioSessionWindow[]; date_windows: CampusScenarioSessionWindow[]; suggested_date: string | null; suggested_window: Omit<CampusScenarioSessionWindow, "date"> | null }>;
  spaces: Array<{ id: string; label: string; kind: string; capacity: number | null; session_dates: string[]; session_windows: CampusScenarioSessionWindow[]; date_windows: CampusScenarioSessionWindow[]; suggested_date: string | null; suggested_window: Omit<CampusScenarioSessionWindow, "date"> | null }>;
}

export interface CampusScenarioMetricRange {
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface CampusScenarioMetric {
  key: string;
  label: string;
  unit: CampusScenarioUnit;
  direction: "higher" | "lower" | "neutral";
  baseline: CampusScenarioMetricRange;
  scenario: CampusScenarioMetricRange;
  availability: "available" | "partial" | "unavailable";
  unavailable_reason: string | null;
  explanation: string;
}

export interface CampusScenarioRun {
  id: string;
  status: CampusScenarioStatus;
  created_at: string;
  snapshot_at: string;
  expires_at: string;
  horizon_days: number;
  intervention: {
    type: CampusScenarioInterventionType;
    target_id: string;
    target_label: string;
    starts_at: string;
    ends_at: string;
  };
  assumptions: string[];
  unsupported_domains: string[];
  metrics: CampusScenarioMetric[];
  progress: number;
  failure_reason: string | null;
  execution_environment: {
    mode: "simulation";
    namespace_id: string;
    run_id: string;
    virtual_clock: { now: string; time_zone: string };
    source_snapshot_at: string;
    expires_at: string;
  };
  projection_capabilities: {
    application_parity?: boolean;
    supported: string[];
    unsupported: string[];
  };
  side_effect_policy: {
    mode: "sink_only";
    production_writes: false;
    production_messages: false;
    production_connectors: false;
  };
  source_snapshot: {
    hash: string;
    schedule_revision_max: number | null;
    space_revision_max: number | null;
    agent_revision_max: number | null;
    coverage_evidence_revision: string | null;
    counts: { sessions: number; spaces: number; teachers: number; enrolments: number };
    captured_at: string;
    consistency: "repeatable_read_transaction";
  };
  uncertainty_status: "deterministic" | "calibrated_ensemble";
  stochastic_policy: {
    policy_id: string;
    version_id: string;
    configuration_hash: string;
    effective_from: string;
    effective_until: string | null;
    calibration: {
      method: string;
      calibrated_at: string;
      sample_size: number | null;
      window: { from: string; to: string } | null;
    };
    parameters: unknown;
  } | null;
}

export interface CampusScenarioResponse {
  schema_version: 1;
  evidence_mode: "simulation";
  run: CampusScenarioRun;
}

export interface CreateCampusScenarioInput {
  campus_id?: string;
  horizon_days: number;
  intervention: {
    type: CampusScenarioInterventionType;
    target_id: string;
    starts_at: string;
    ends_at: string;
  };
}

function root(schoolId: string) {
  return `/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/scenarios`;
}

export function createCampusScenario(schoolId: string, input: CreateCampusScenarioInput) {
  return apiFetch<CampusScenarioResponse>(root(schoolId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCampusScenarioTargets(schoolId: string, options: { campusId?: string; horizonDays: number }, signal?: AbortSignal) {
  const query = new URLSearchParams({ horizon_days: `${options.horizonDays}` });
  if (options.campusId) query.set("campus_id", options.campusId);
  return apiFetch<CampusScenarioTargetsResponse>(`${root(schoolId)}/targets?${query.toString()}`, { signal });
}

export function getCampusScenario(schoolId: string, runId: string, signal?: AbortSignal) {
  return apiFetch<CampusScenarioResponse>(`${root(schoolId)}/${encodeURIComponent(runId)}`, { signal });
}

export function discardCampusScenario(schoolId: string, runId: string) {
  return apiFetch<{ schema_version: 1; evidence_mode: "simulation"; discarded: boolean; run_id: string }>(`${root(schoolId)}/${encodeURIComponent(runId)}`, { method: "DELETE" });
}
