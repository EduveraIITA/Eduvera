import { z } from "zod";

export const CAMPUS_KPI_SCHEMA_VERSION = 1 as const;
export const CAMPUS_KPI_CATALOGUE_VERSION = "2026-10-17.v1" as const;

export const campusKpiPages = [
  "overview",
  "teaching",
  "movement",
  "spaces",
  "coordination",
  "data_health",
] as const;

export const campusKpiRanges = ["today", "7d", "30d", "90d", "1y"] as const;

export const campusKpiQuerySchema = z.object({
  school_id: z.string().uuid(),
  campus_id: z.string().uuid().optional(),
  page: z.enum(campusKpiPages).default("overview"),
  range: z.enum(campusKpiRanges).default("today"),
  at: z.string().datetime({ offset: true }).optional(),
}).strict();

export type CampusKpiPage = typeof campusKpiPages[number];
export type CampusKpiRange = typeof campusKpiRanges[number];
export type CampusKpiGrain = "15_minute" | "hour" | "day";
export type CampusKpiEvidenceClass = "expected" | "observed" | "accepted" | "mixed";
export type CampusKpiAvailability = "available" | "partial" | "unavailable";
export type CampusKpiUnit = "count" | "minutes" | "percent" | "people" | "spaces" | "sessions" | "records";

export interface CampusKpiDefinition {
  key: string;
  page: Exclude<CampusKpiPage, "overview">;
  label: string;
  description: string;
  unit: CampusKpiUnit;
  evidence_class: CampusKpiEvidenceClass;
  input_dimensions: readonly Exclude<CampusKpiEvidenceClass, "mixed">[];
  source_label: string;
  source_tables: readonly string[];
  direction: "higher_is_better" | "lower_is_better" | "context_only";
}

/**
 * Versioned operational catalogue. These definitions describe what a metric
 * means; they do not imply that its source is currently instrumented. Runtime
 * availability is reported separately and missing evidence always remains null.
 */
export const CAMPUS_KPI_CATALOGUE = [
  {
    key: "teaching.sessions_planned", page: "teaching", label: "Planned sessions",
    description: "Effective class and activity sessions scheduled in the bucket.", unit: "sessions",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable occurrences",
    source_tables: ["campus_model_schedule_occurrences"], direction: "context_only",
  },
  {
    key: "teaching.minutes_planned", page: "teaching", label: "Planned teaching minutes",
    description: "Minutes of effective class and activity schedule overlapping the bucket.", unit: "minutes",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable occurrences",
    source_tables: ["campus_model_schedule_occurrences"], direction: "context_only",
  },
  {
    key: "teaching.learner_places_planned", page: "teaching", label: "Learner places planned",
    description: "Effective enrolled learners attached to scheduled sessions; this is not room occupancy.", unit: "people",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable and enrollment roster",
    source_tables: ["campus_model_schedule_occurrences", "enrollments"], direction: "context_only",
  },
  {
    key: "teaching.teacher_assignment_rate", page: "teaching", label: "Teacher assignment",
    description: "Scheduled class and activity sessions with a projected responsible human agent.", unit: "percent",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable responsibility",
    source_tables: ["campus_model_schedule_occurrences", "campus_model_agents"], direction: "higher_is_better",
  },
  {
    key: "attendance.register_completion_rate", page: "teaching", label: "Register completion",
    description: "Submitted or locked scheduled-session registers divided by expected registers past the current configured deadline; missing registers remain explicit unknowns.", unit: "percent",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Effective timetable, current attendance rule and authoritative registers",
    source_tables: ["institution_operating_rules", "attendance_session_registers"], direction: "higher_is_better",
  },
  {
    key: "attendance.recording_coverage", page: "teaching", label: "Attendance recording coverage",
    description: "Learners with an authoritative attendance entry divided by the effective enrolled roster.", unit: "percent",
    evidence_class: "mixed", input_dimensions: ["expected", "accepted"], source_label: "Attendance entries and effective enrollment roster",
    source_tables: ["attendance_session_registers", "attendance_session_entries", "enrollments"], direction: "higher_is_better",
  },
  {
    key: "attendance.participation_rate", page: "teaching", label: "Recorded participation",
    description: "Present or late attendance entries divided by recorded entries; unrecorded learners remain unknown.", unit: "percent",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Authoritative attendance entries",
    source_tables: ["attendance_session_entries"], direction: "context_only",
  },
  {
    key: "attendance.late_rate", page: "teaching", label: "Recorded late rate",
    description: "Late attendance entries divided by recorded entries; unrecorded learners remain unknown.", unit: "percent",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Authoritative attendance entries",
    source_tables: ["attendance_session_entries"], direction: "lower_is_better",
  },
  {
    key: "attendance.evidence_review_backlog", page: "teaching", label: "Attendance evidence awaiting review",
    description: "Pending attendance evidence requiring a domain decision at the current as-of time.", unit: "count",
    evidence_class: "observed", input_dimensions: ["observed"], source_label: "Attendance evidence review queue",
    source_tables: ["attendance_session_evidence"], direction: "lower_is_better",
  },
  {
    key: "spaces.planned_active", page: "spaces", label: "Spaces planned active",
    description: "Distinct mapped campus spaces with an effective scheduled session in the bucket.", unit: "spaces",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable space assignments",
    source_tables: ["campus_model_schedule_occurrences", "campus_spaces"], direction: "context_only",
  },
  {
    key: "spaces.planned_use_rate", page: "spaces", label: "Planned space use",
    description: "Unioned scheduled minutes in active bookable leaf spaces divided by their minutes inside the campus instructional envelope.", unit: "percent",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable and campus topology",
    source_tables: ["campus_model_schedule_occurrences", "campus_spaces"], direction: "context_only",
  },
  {
    key: "spaces.planned_seat_load_rate", page: "spaces", label: "Planned seat load",
    description: "Planned learner-place minutes divided by known room-capacity minutes; not physical occupancy.", unit: "percent",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable, roster and recorded capacity",
    source_tables: ["campus_model_schedule_occurrences", "enrollments", "campus_spaces"], direction: "context_only",
  },
  {
    key: "spaces.over_capacity_sessions", page: "spaces", label: "Sessions over recorded capacity",
    description: "Scheduled sessions whose effective roster exceeds the room capacity recorded now.", unit: "sessions",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable, roster and recorded capacity",
    source_tables: ["campus_model_schedule_occurrences", "enrollments", "campus_spaces"], direction: "lower_is_better",
  },
  {
    key: "spaces.double_booking_conflicts", page: "spaces", label: "Space conflicts",
    description: "Distinct effective scheduled sessions overlapping another session in the same mapped space.", unit: "sessions",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable space assignments",
    source_tables: ["campus_model_schedule_occurrences"], direction: "lower_is_better",
  },
  {
    key: "spaces.missing_canonical_space", page: "spaces", label: "Unmapped physical sessions",
    description: "Physical class or activity sessions without a canonical active campus space.", unit: "sessions",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable canonical-space lineage",
    source_tables: ["campus_model_schedule_occurrences", "campus_model_entities", "campus_spaces"], direction: "lower_is_better",
  },
  {
    key: "people.teachers_expected", page: "movement", label: "Teachers expected",
    description: "Distinct responsible teachers on effective campus sessions in the bucket; not proof of presence.", unit: "people",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable responsibility",
    source_tables: ["campus_model_schedule_occurrences", "campus_model_agents"], direction: "context_only",
  },
  {
    key: "people.teacher_schedule_conflicts", page: "movement", label: "Teacher schedule conflicts",
    description: "Distinct effective sessions whose responsible teacher is double-booked.", unit: "sessions",
    evidence_class: "expected", input_dimensions: ["expected"], source_label: "Effective timetable responsibility",
    source_tables: ["campus_model_schedule_occurrences"], direction: "lower_is_better",
  },
  {
    key: "access.gate_entries_recorded", page: "movement", label: "Recorded gate entries",
    description: "Accepted entry observations at gates exactly mapped to the selected campus.", unit: "count",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Accepted gate observations",
    source_tables: ["campus_model_observations", "campus_spaces"], direction: "context_only",
  },
  {
    key: "access.gate_exits_recorded", page: "movement", label: "Recorded gate exits",
    description: "Accepted exit observations at gates exactly mapped to the selected campus.", unit: "count",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Accepted gate observations",
    source_tables: ["campus_model_observations", "campus_spaces"], direction: "context_only",
  },
  {
    key: "access.people_observed_distinct", page: "movement", label: "People with gate evidence",
    description: "Distinct subjects with accepted gate observations; this is not a current-presence count.", unit: "people",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Accepted gate observations",
    source_tables: ["campus_model_observations", "campus_spaces"], direction: "context_only",
  },
  {
    key: "access.visitors_inside", page: "movement", label: "Visitors checked in",
    description: "Institution visitor records currently inside; campus attribution is not yet recorded.", unit: "people",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Institution visitor register",
    source_tables: ["gate_visitors"], direction: "context_only",
  },
  {
    key: "coordination.work_open", page: "coordination", label: "Open actionable work",
    description: "Request, task and offer messages awaiting a terminal response.", unit: "count",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Operational message protocol",
    source_tables: ["campus_model_operational_messages"], direction: "lower_is_better",
  },
  {
    key: "coordination.work_overdue", page: "coordination", label: "Overdue actionable work",
    description: "Open actionable messages whose configured response due time has passed.", unit: "count",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Operational message protocol",
    source_tables: ["campus_model_operational_messages"], direction: "lower_is_better",
  },
  {
    key: "coordination.response_rate", page: "coordination", label: "Response SLA attainment",
    description: "Response-required messages answered by their configured due time.", unit: "percent",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Operational message protocol",
    source_tables: ["campus_model_operational_messages"], direction: "higher_is_better",
  },
  {
    key: "coordination.median_response_minutes", page: "coordination", label: "Latest interval median response time",
    description: "Median elapsed minutes from queueing to a recorded response in the latest interval with response evidence.", unit: "minutes",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Operational message protocol",
    source_tables: ["campus_model_operational_messages"], direction: "lower_is_better",
  },
  {
    key: "coordination.failure_rate", page: "coordination", label: "Expiry and delivery failure rate",
    description: "Expired or dead-letter messages divided by terminal message outcomes.", unit: "percent",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Operational message protocol",
    source_tables: ["campus_model_operational_messages"], direction: "lower_is_better",
  },
  {
    key: "coordination.exceptions_open", page: "coordination", label: "Routing exceptions open",
    description: "Configuration or recipient-resolution exceptions still open.", unit: "count",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Coordination exception register",
    source_tables: ["campus_model_coordination_exceptions"], direction: "lower_is_better",
  },
  {
    key: "evidence.observations_accepted", page: "data_health", label: "Accepted observations",
    description: "Observations received in the bucket and accepted by the evidence pipeline.", unit: "count",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Model observation evidence pipeline",
    source_tables: ["campus_model_observations"], direction: "context_only",
  },
  {
    key: "evidence.observations_waiting", page: "data_health", label: "Observations awaiting review",
    description: "Pending or quarantined observations at the current as-of time.", unit: "count",
    evidence_class: "observed", input_dimensions: ["observed"], source_label: "Model observation evidence pipeline",
    source_tables: ["campus_model_observations"], direction: "lower_is_better",
  },
  {
    key: "evidence.command_conflict_failure_rate", page: "data_health", label: "Command conflict and failure rate",
    description: "Commands ending conflicted or failed divided by terminal commands in the bucket.", unit: "percent",
    evidence_class: "accepted", input_dimensions: ["accepted"], source_label: "Model command outcomes",
    source_tables: ["campus_model_commands"], direction: "lower_is_better",
  },
] as const satisfies readonly CampusKpiDefinition[];

export function catalogueForPage(page: CampusKpiPage): readonly CampusKpiDefinition[] {
  if (page === "overview") return CAMPUS_KPI_CATALOGUE;
  return CAMPUS_KPI_CATALOGUE.filter((definition) => definition.page === page);
}
