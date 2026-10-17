import { z } from "zod";
import type {
  ScenarioBehaviourPolicy,
  ScenarioConfigurationRef,
  ScenarioIdentityMapping,
  ScenarioQuantileRange,
} from "../campus-model-core/scenarios/contracts.js";

export const campusScenarioInterventionTypes = ["teacher_unavailable", "space_unavailable"] as const;
export type CampusScenarioInterventionType = typeof campusScenarioInterventionTypes[number];

const interventionSchema = z.object({
  type: z.enum(campusScenarioInterventionTypes),
  target_id: z.string().uuid(),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
}).strict();

const calibrationWindowSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
}).strict().refine((window) => Date.parse(window.from) < Date.parse(window.to), {
  message: "Calibration window end must follow its start.",
});

export const scenarioPolicyConfigurationSchema = z.object({
  scenario_policy: z.object({
    calibration: z.object({
      method: z.enum(["institution_supplied", "historical_coverage_reviewed"]),
      calibrated_at: z.iso.datetime({ offset: true }),
      sample_size: z.number().int().min(1).max(1_000_000).nullable(),
      window: calibrationWindowSchema.nullable(),
    }).strict(),
    parameters: z.object({
      acceptance_probability: z.number().min(0).max(1),
      relocation_probability: z.number().min(0).max(1),
      response_minutes_mean: z.number().min(0).max(10_080),
      response_minutes_standard_deviation: z.number().min(0).max(10_080),
    }).strict(),
    sample_count: z.number().int().min(20).max(100).default(100),
  }).strict().superRefine((policy, context) => {
    const calibration = policy.calibration;
    if (calibration.window
      && Date.parse(calibration.window.to) > Date.parse(calibration.calibrated_at)) {
      context.addIssue({
        code: "custom",
        path: ["calibration", "window", "to"],
        message: "Calibration evidence window cannot end after calibrated_at.",
      });
    }
    if (calibration.method === "historical_coverage_reviewed") {
      if (calibration.sample_size === null || calibration.sample_size < 20) {
        context.addIssue({
          code: "custom",
          path: ["calibration", "sample_size"],
          message: "Reviewed historical calibration requires at least 20 observations.",
        });
      }
      if (calibration.window === null) {
        context.addIssue({
          code: "custom",
          path: ["calibration", "window"],
          message: "Reviewed historical calibration requires an evidence window.",
        });
      }
    }
  }),
}).passthrough();

export const createCampusScenarioSchema = z.object({
  campus_id: z.string().uuid().optional(),
  horizon_days: z.number().int().min(7).max(30),
  intervention: interventionSchema,
  behaviour_policy_version_id: z.string().uuid().optional(),
}).strict();

export const campusScenarioTargetsQuerySchema = z.object({
  campus_id: z.string().uuid().optional(),
  horizon_days: z.coerce.number().int().min(7).max(30).default(30),
}).strict();

export type CreateCampusScenarioInput = z.infer<typeof createCampusScenarioSchema>;
export type CampusScenarioInterventionInput = z.infer<typeof interventionSchema>;

export interface CampusScenarioTarget {
  id: string;
  label: string;
  type: CampusScenarioInterventionType;
  effective_ref: string;
  user_id: string | null;
  person_id: string | null;
  revision: number;
}

export interface CampusScenarioSession {
  occurrence_key: string;
  occurrence_date: string;
  starts_at: string;
  ends_at: string;
  class_section_id: string;
  teacher_agent_id: string | null;
  teacher_person_id: string | null;
  teacher_assignment_present: boolean;
  space_id: string | null;
  space_capacity: number | null;
  expected_count: number;
  source_kind: string;
  source_revision: number;
  source_version: number | null;
}

export interface CampusScenarioCoverageEvidence {
  offered_count: number;
  responded_count: number;
  accepted_count: number;
  median_response_minutes: number | null;
  source_max_at: string | null;
  evidence_hash: string | null;
}

export interface CampusScenarioSnapshot {
  kind: "campus_operations_snapshot";
  version: 1;
  school_id: string;
  campus_id: string;
  timezone: string;
  captured_at: string;
  horizon: { from: string; to: string };
  sessions: CampusScenarioSession[];
  coverage_evidence: CampusScenarioCoverageEvidence;
}

export interface CampusScenarioRepositorySnapshot {
  snapshot: CampusScenarioSnapshot;
  target: CampusScenarioTarget;
  configuration_snapshot: ScenarioConfigurationRef[];
  identities: ScenarioIdentityMapping[];
  source_revisions: Record<string, string>;
  approved_behaviour_policy: {
    id: string;
    behaviour_key: string;
    version: number;
    configuration: unknown;
    configuration_schema_version: number;
    configuration_hash: string;
    effective_from: string;
    effective_until: string | null;
    approved_at: string;
  } | null;
  counts: {
    sessions: number;
    spaces: number;
    teachers: number;
    agents: number;
    agent_kinds: {
      human: number;
      team: number;
      device: number;
      integration: number;
      software: number;
    };
    enrolments: number;
  };
}

export type CampusScenarioMetricInterval = ScenarioQuantileRange;

export interface CampusScenarioMetricView {
  key: string;
  label: string;
  unit: "sessions" | "learner_places" | "conflicts" | "percent" | "minutes";
  direction: "higher" | "lower" | "neutral";
  baseline: CampusScenarioMetricInterval;
  scenario: CampusScenarioMetricInterval;
  availability: "available" | "partial" | "unavailable";
  unavailable_reason: string | null;
  explanation: string;
}

export interface CampusScenarioRunView {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  snapshot_at: string;
  expires_at: string;
  horizon_days: number;
  intervention: CampusScenarioInterventionInput & { target_label: string };
  assumptions: string[];
  unsupported_domains: string[];
  metrics: CampusScenarioMetricView[];
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
    application_parity: false;
    supported: Array<"campus_performance">;
    unsupported: Array<"today" | "timetable" | "attendance" | "requests" | "notifications" | "campus_view">;
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
    counts: CampusScenarioRepositorySnapshot["counts"];
    captured_at: string;
    consistency: "repeatable_read_transaction";
  };
  uncertainty_status: "deterministic" | "calibrated_ensemble";
  execution_provenance: {
    deterministic_seed: string;
    executor: { id: string; version: string };
    ensemble_sample_count: number;
  };
  stochastic_policy: ScenarioBehaviourPolicy | null;
}

export interface CampusScenarioResponse {
  schema_version: 1;
  evidence_mode: "simulation";
  run: CampusScenarioRunView;
}

export interface CampusScenarioTargetsResponse {
  schema_version: 1;
  evidence_mode: "simulation";
  campus_id: string;
  horizon_days: number;
  horizon: { from: string; to: string };
  teachers: Array<{
    id: string;
    label: string;
    session_dates: string[];
    session_windows: Array<{ date: string; starts_at: string; ends_at: string }>;
    date_windows: Array<{ date: string; starts_at: string; ends_at: string }>;
    suggested_date: string | null;
    suggested_window: { starts_at: string; ends_at: string } | null;
  }>;
  spaces: Array<{
    id: string;
    label: string;
    kind: string;
    capacity: number | null;
    session_dates: string[];
    session_windows: Array<{ date: string; starts_at: string; ends_at: string }>;
    date_windows: Array<{ date: string; starts_at: string; ends_at: string }>;
    suggested_date: string | null;
    suggested_window: { starts_at: string; ends_at: string } | null;
  }>;
}
