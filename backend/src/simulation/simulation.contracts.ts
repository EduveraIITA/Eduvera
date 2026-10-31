import { z } from "zod";

export const simulationRunKinds = ["baseline", "scenario"] as const;
export const simulationRunStatuses = [
  "preparing",
  "draft",
  "running",
  "paused",
  "stopped",
  "completed",
  "failed",
] as const;

export type SimulationRunKind = (typeof simulationRunKinds)[number];
export type SimulationRunStatus = (typeof simulationRunStatuses)[number];
export type SimulationRunAction = "open" | "start" | "pause" | "resume" | "stop" | "duplicate" | "compare" | "pin" | "unpin" | "remove";
export type SimulationGarbageCollectionState = "retained" | "deleting" | "deleted" | "failed";

const optionalEndAt = z.iso.datetime({ offset: true }).nullable().optional();
const speed = z.number().finite().min(1).max(100);

export const createSimulationRunSchema = z.object({
  kind: z.enum(simulationRunKinds),
  name: z.string().trim().min(1).max(120).optional(),
  speed: speed.default(20),
  end_at: optionalEndAt,
  idempotency_key: z.string().trim().min(8).max(240),
}).strict();

export const updateSimulationDraftSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  speed: speed.optional(),
  end_at: optionalEndAt,
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one draft field must be supplied.",
});

export const startSimulationRunSchema = z.object({
  speed: speed.optional(),
  end_at: optionalEndAt,
}).strict();

export const resumeSimulationRunSchema = z.object({
  speed: speed.optional(),
}).strict();

export const stopSimulationRunSchema = z.object({
  expected_revision: z.number().int().positive().optional(),
  expected_status: z.literal("draft").optional(),
}).strict().superRefine((value, context) => {
  if ((value.expected_revision === undefined) !== (value.expected_status === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Draft discard requires both its reviewed revision and draft status.",
    });
  }
});

export const listSimulationRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(10),
  view: z.enum(["recent", "retained"]).default("recent"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
}).strict();

export const removeSimulationRunSchema = z.object({
  expected_revision: z.number().int().positive(),
}).strict();

export const compareSimulationRunsSchema = z.object({
  run_ids: z.array(z.string().uuid()).min(2).max(10),
  duration_ms: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.run_ids).size !== value.run_ids.length) {
    context.addIssue({
      code: "custom",
      path: ["run_ids"],
      message: "Comparison run IDs must be unique.",
    });
  }
});

export const recordSimulationDraftChangeSchema = z.object({
  domain: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
  change_kind: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
  target_ref: z.string().trim().min(1).max(240).nullable(),
  summary: z.string().trim().min(1).max(500),
  source_revision: z.string().trim().min(1).max(240),
  idempotency_key: z.string().trim().min(8).max(240),
}).strict();

export const duplicateSimulationRunSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(simulationRunKinds).optional(),
  speed: speed.optional(),
  end_at: optionalEndAt,
  idempotency_key: z.string().trim().min(8).max(240),
}).strict();

const probability = z.number().finite().min(0).max(1);
export const simulationAttendanceBehaviourSchema = z.object({
  enabled: z.boolean(),
  present: probability,
  late: probability,
  absent: probability,
  excused: probability,
  submission_delay_minutes: z.number().int().min(0).max(120),
}).strict().superRefine((value, context) => {
  const total = value.present + value.late + value.absent + value.excused;
  if (Math.abs(total - 1) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Attendance outcome probabilities must sum to 1.",
    });
  }
});

export const simulationOfferResponseBehaviourSchema = z.object({
  enabled: z.boolean(),
  accepted: probability,
  declined: probability,
  no_response: probability,
  response_delay_minutes: z.number().int().min(0).max(10_080),
}).strict().superRefine((value, context) => {
  const total = value.accepted + value.declined + value.no_response;
  if (Math.abs(total - 1) > 1e-9) {
    context.addIssue({
      code: "custom",
      message: "Offer response probabilities must sum to 1.",
    });
  }
});

const configureSimulationBehaviourV1Schema = z.object({
  schema_version: z.literal(1),
  attendance: simulationAttendanceBehaviourSchema,
}).strict();

export const configureSimulationBehaviourV2Schema = z.object({
  schema_version: z.literal(2),
  attendance: simulationAttendanceBehaviourSchema,
  coverage_offers: simulationOfferResponseBehaviourSchema,
  invigilation_offers: simulationOfferResponseBehaviourSchema,
}).strict();

export const configureSimulationBehaviourSchema = z.discriminatedUnion("schema_version", [
  configureSimulationBehaviourV1Schema,
  configureSimulationBehaviourV2Schema,
]);

export type SimulationAttendanceBehaviour = z.infer<typeof simulationAttendanceBehaviourSchema>;
export type SimulationOfferResponseBehaviour = z.infer<typeof simulationOfferResponseBehaviourSchema>;
export type SimulationBehaviourConfigurationV2 = z.infer<typeof configureSimulationBehaviourV2Schema>;

export const PASSIVE_SIMULATION_OFFER_RESPONSE_BEHAVIOUR: Readonly<SimulationOfferResponseBehaviour> = Object.freeze({
  enabled: false,
  accepted: 0,
  declined: 0,
  no_response: 1,
  response_delay_minutes: 10,
});

/** Normalize retained v1 attendance-only policies without adding hidden activity. */
export function normalizeSimulationBehaviourConfiguration(
  input: ConfigureSimulationBehaviourInput,
): SimulationBehaviourConfigurationV2 {
  if (input.schema_version === 2) return input;
  return {
    schema_version: 2,
    attendance: input.attendance,
    coverage_offers: { ...PASSIVE_SIMULATION_OFFER_RESPONSE_BEHAVIOUR },
    invigilation_offers: { ...PASSIVE_SIMULATION_OFFER_RESPONSE_BEHAVIOUR },
  };
}

export type CreateSimulationRunInput = z.infer<typeof createSimulationRunSchema>;
export type UpdateSimulationDraftInput = z.infer<typeof updateSimulationDraftSchema>;
export type StartSimulationRunInput = z.infer<typeof startSimulationRunSchema>;
export type ResumeSimulationRunInput = z.infer<typeof resumeSimulationRunSchema>;
export type CompareSimulationRunsInput = z.infer<typeof compareSimulationRunsSchema>;
export type RecordSimulationDraftChangeInput = z.infer<typeof recordSimulationDraftChangeSchema>;
export type DuplicateSimulationRunInput = z.infer<typeof duplicateSimulationRunSchema>;
export type ConfigureSimulationBehaviourInput = z.infer<typeof configureSimulationBehaviourSchema>;

export interface SimulationBehaviourProvenance {
  version_ref: string;
  configuration_hash: string;
  approved_by_agent_id: string;
  configured_at: string;
}

export interface SimulationBehaviourView extends Omit<SimulationBehaviourConfigurationV2, "attendance"> {
  /** Legacy nested provenance remains readable while clients move to policy-level provenance. */
  attendance: SimulationAttendanceBehaviour & SimulationBehaviourProvenance;
  provenance: SimulationBehaviourProvenance;
}

export interface SimulationSnapshotProvenance {
  ref: string;
  hash: string;
  captured_at: string;
  source_revisions: Readonly<Record<string, string>>;
}

export interface SimulationMetricValue {
  key: string;
  label: string | null;
  unit: string;
  value: number | null;
  measured_at: string;
  simulated_elapsed_ms: number;
}

export interface SimulationDraftChangeView {
  id: string;
  domain: string;
  change_kind: string;
  target_ref: string | null;
  summary: string;
  recorded_at: string;
  source_revision: string;
}

export interface SimulationRunView {
  id: string;
  revision: number;
  scenario_id: string;
  namespace_id: `scenario:${string}:run:${string}`;
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
  snapshot: SimulationSnapshotProvenance | null;
  world: {
    ref: string;
    revision: number;
    manifest_ref: string;
    limitations: readonly string[];
  } | null;
  progress: {
    event_count: number;
    checkpoint_count: number;
    last_checkpoint_at: string | null;
    next_wake_at: string | null;
  };
  metrics: SimulationMetricValue[];
  draft_changes: SimulationDraftChangeView[];
  behaviour: SimulationBehaviourView | null;
  retention: {
    pinned: boolean;
    pinned_at: string | null;
    expires_at: string | null;
    policy_version: number;
    state: SimulationGarbageCollectionState;
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

export interface SimulationRunListResponse {
  schema_version: 1;
  results: SimulationRunView[];
  page?: { number: number; page_size: number; total: number; total_pages: number };
}

export interface SimulationComparisonResponse {
  schema_version: 1;
  comparison: {
    duration_ms: number;
    controlled_snapshot: boolean;
    provenance_warning: string | null;
    runs: Array<{
      run_id: string;
      name: string;
      kind: SimulationRunKind;
      status: SimulationRunStatus;
      snapshot: SimulationSnapshotProvenance;
      actual_duration_ms: number;
    }>;
    metrics: Array<{
      key: string;
      label: string | null;
      unit: string;
      values: Array<{ run_id: string; value: number | null; measured_at: string }>;
      deltas_from_first: Array<{ run_id: string; delta: number | null; delta_percent: number | null }>;
    }>;
  };
}

export interface PersistedSimulationRun {
  id: string;
  school_id: string;
  scenario_id: string;
  namespace_id: `scenario:${string}:run:${string}`;
  created_by_user_id: string;
  kind: SimulationRunKind;
  name: string;
  status: SimulationRunStatus;
  speed: number;
  deterministic_seed: string;
  time_zone: string;
  source_snapshot_ref: string | null;
  source_snapshot_hash: string | null;
  source_snapshot_at: string | null;
  source_revisions: Readonly<Record<string, string>>;
  world_ref: string | null;
  world_revision: number;
  /** Optional only for pre-migration test/adapter records; persisted runs include it. */
  pending_advance?: { virtual_from: string; virtual_to: string; world_revision: number } | null;
  manifest_ref: string | null;
  manifest_checked_at: string | null;
  limitations: readonly string[];
  virtual_started_at: string | null;
  virtual_now: string | null;
  simulated_elapsed_ms: number;
  end_at: string | null;
  retention_expires_at: string | null;
  resource_reservation_bytes: number;
  observed_storage_bytes: number;
  storage_measured_at: string | null;
  resource_paused_at: string | null;
  resource_pause_reason: string | null;
  lease_recovery_count: number;
  retention_policy_version: number;
  retention_started_at: string | null;
  pinned_at: string | null;
  pinned_by_user_id: string | null;
  gc_state: SimulationGarbageCollectionState;
  gc_lease_owner: string | null;
  gc_lease_token: string | null;
  gc_lease_until: string | null;
  gc_lease_fence: number;
  gc_failure_count: number;
  gc_failure_reason: string | null;
  gc_next_attempt_at: string | null;
  world_discarded_at: string | null;
  wall_anchor_at: string | null;
  virtual_anchor_at: string | null;
  next_wake_at: string | null;
  next_event_at: string | null;
  last_checkpoint_at: string | null;
  event_count: number;
  checkpoint_count: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  stopped_at: string | null;
  completed_at: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_until: string | null;
  lease_fence: number;
  failure_count: number;
  revision: number;
}

export interface SimulationAdvanceLease {
  run: PersistedSimulationRun;
  lease_owner: string;
  lease_token: string;
  lease_until: string;
  lease_fence: number;
}

export interface SimulationCheckpointInput {
  virtual_from: string;
  virtual_to: string;
  simulated_elapsed_ms: number;
  world_checkpoint_ref: string;
  world_revision: number;
  emitted_event_count: number;
  lease_fence: number;
  lease_token: string;
  next_event_at: string | null;
  metrics: readonly SimulationMetricValue[];
}

