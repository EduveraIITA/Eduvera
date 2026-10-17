import { z } from "zod";

const identifier = z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/);
const catalogueNamespace = z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,119}$/);
const semanticTypeContractRefSchema = z.object({
  namespace: catalogueNamespace,
  type_key: identifier,
  version: z.number().int().positive(),
}).strict();
const protocolContractRefSchema = z.object({
  namespace: catalogueNamespace,
  schema_key: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,119}$/),
  version: z.number().int().positive(),
}).strict();
const capabilityContractRefSchema = z.object({
  namespace: catalogueNamespace,
  capability_key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
  version: z.number().int().positive(),
}).strict();
export const modelObservationContractRefsSchema = z.object({
  subject_type: semanticTypeContractRefSchema,
  context_type: semanticTypeContractRefSchema.nullable().default(null),
  observation_schema: protocolContractRefSchema,
  capability_manifest: capabilityContractRefSchema,
}).strict();
const entityRefSchema = z.object({
  domain: identifier,
  domain_id: z.string().trim().min(1).max(160),
}).strict();

export const campusModelEntitySchema = entityRefSchema.extend({
  kind: identifier,
  label: z.string().trim().min(1).max(200),
  lifecycle_state: z.enum(["planned", "active", "inactive", "retired", "archived"]),
  source_revision: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const campusModelRelationshipSchema = z.object({
  relation_type: identifier,
  source: entityRefSchema,
  target: entityRefSchema.nullable().default(null),
  operation: z.enum(["set", "clear"]).default("set"),
  effective_from: z.string().datetime({ offset: true }),
  effective_until: z.string().datetime({ offset: true }).nullable().default(null),
  source_domain: identifier,
  source_record_id: z.string().trim().min(1).max(160),
  source_revision: z.number().int().positive(),
  replace_current: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.operation === "set" && !value.target) {
    context.addIssue({ code: "custom", path: ["target"], message: "A target is required when setting a relationship." });
  }
  if (value.operation === "clear" && value.target) {
    context.addIssue({ code: "custom", path: ["target"], message: "A cleared relationship cannot include a target." });
  }
  if (value.effective_until && Date.parse(value.effective_until) <= Date.parse(value.effective_from)) {
    context.addIssue({ code: "custom", path: ["effective_until"], message: "Relationship end must be after its start." });
  }
});

export const acceptedCampusModelChangeSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  command_type: z.string().trim().min(3).max(120),
  target: entityRefSchema,
  idempotency_key: z.string().trim().min(8).max(240),
  correlation_id: z.string().uuid(),
  causation_id: z.string().uuid().nullable().default(null),
  expected_revision: z.number().int().nonnegative().nullable().default(null),
  authority_evidence: z.array(z.string().trim().min(1).max(180)).max(20).default([]),
  authority_receipt_id: z.string().uuid().nullable().optional(),
  operating_rule_version_ref: z.string().trim().max(160).nullable().default(null),
  source_domain: identifier,
  safe_context: z.record(z.string(), z.unknown()).default({}),
  entities: z.array(campusModelEntitySchema).min(1).max(24),
  relationships: z.array(campusModelRelationshipSchema).max(24).default([]),
  outcome: z.object({
    code: z.string().trim().min(2).max(80),
    explanation: z.string().trim().min(3).max(500),
    resulting_revision: z.number().int().nonnegative().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  domain_event_id: z.string().uuid().nullable().default(null),
}).strict().superRefine((value, context) => {
  const keys = new Set(value.entities.map((entity) => `${entity.domain}:${entity.domain_id}`));
  const required = [
    value.target,
    ...value.relationships.flatMap((relationship) => relationship.target ? [relationship.source, relationship.target] : [relationship.source]),
  ];
  for (const reference of required) {
    if (!keys.has(`${reference.domain}:${reference.domain_id}`)) {
      context.addIssue({
        code: "custom",
        path: ["entities"],
        message: `Entity snapshot missing for ${reference.domain}:${reference.domain_id}.`,
      });
    }
  }
});

export const campusObservationCaptureAgentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), user_id: z.string().uuid() }).strict(),
  z.object({
    kind: z.literal("device"),
    external_ref: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(200),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  z.object({
    kind: z.literal("integration"),
    external_ref: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(200),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
]);

export const campusModelObservationSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid().optional(),
  captured_by: campusObservationCaptureAgentSchema.optional(),
  kind: z.string().trim().min(3).max(100),
  subject: campusModelEntitySchema,
  context: campusModelEntitySchema.nullable().default(null),
  source_type: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,39}$/),
  source_ref: z.string().trim().min(1).max(200).nullable().default(null),
  source_record_id: z.string().trim().min(1).max(200),
  observed_at: z.string().datetime({ offset: true }),
  received_at: z.string().datetime({ offset: true }),
  evidence_refs: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
  payload: z.record(z.string(), z.unknown()).default({}),
  schema_version: z.number().int().positive().default(1),
  state: z.enum(["pending", "accepted", "rejected", "quarantined", "superseded"]),
  idempotency_key: z.string().trim().min(8).max(240),
  domain_event_id: z.string().uuid().nullable().default(null),
  contract_refs: modelObservationContractRefsSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.actor_user_id && !value.captured_by) {
    context.addIssue({ code: "custom", path: ["captured_by"], message: "Identify the human, device or integration that captured this observation." });
  }
  if (value.actor_user_id && value.captured_by) {
    context.addIssue({ code: "custom", path: ["captured_by"], message: "Use either actor_user_id or captured_by, not both." });
  }
  if (value.contract_refs?.subject_type.type_key !== undefined
    && value.contract_refs.subject_type.type_key !== value.subject.kind) {
    context.addIssue({ code: "custom", path: ["contract_refs", "subject_type"], message: "The subject type contract must match the subject kind." });
  }
  if (value.contract_refs?.context_type && value.context
    && value.contract_refs.context_type.type_key !== value.context.kind) {
    context.addIssue({ code: "custom", path: ["contract_refs", "context_type"], message: "The context type contract must match the context kind." });
  }
  if (value.contract_refs?.context_type && !value.context) {
    context.addIssue({ code: "custom", path: ["context"], message: "The declared context type requires a context entity." });
  }
  if (value.contract_refs && value.contract_refs.observation_schema.schema_key !== value.kind) {
    context.addIssue({ code: "custom", path: ["contract_refs", "observation_schema"], message: "The protocol contract must match the observation kind." });
  }
});

export const campusModelObservationTransitionSchema = z.object({
  school_id: z.string().uuid(),
  source_type: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,39}$/),
  source_ref: z.string().trim().min(1).max(200),
  state: z.enum(["accepted", "rejected", "quarantined", "superseded"]),
}).strict();

const timezoneSchema = z.string().trim().min(1).max(80).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Use a valid IANA timezone.");

export const publishedSchedulePeriodSchema = z.object({
  period_id: z.string().uuid(),
  weekday: z.number().int().min(1).max(7),
  period_number: z.number().int().min(1).max(24),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  title: z.string().trim().min(1).max(120),
  slot_type: z.enum(["class", "break", "activity"]),
  subject: campusModelEntitySchema.nullable().default(null),
  teacher_user_id: z.string().uuid().nullable().default(null),
  space: campusModelEntitySchema.nullable().default(null),
  room_snapshot: z.string().trim().max(80).default(""),
}).strict().refine((value) => value.ends_at > value.starts_at, {
  path: ["ends_at"],
  message: "Period end must follow its start.",
});

export const publishedScheduleProjectionSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  schedule_version_id: z.string().uuid(),
  schedule_revision: z.number().int().positive(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  timezone: timezoneSchema,
  published_at: z.string().datetime({ offset: true }),
  class_section: campusModelEntitySchema,
  periods: z.array(publishedSchedulePeriodSchema).min(1).max(168),
  correlation_id: z.string().uuid(),
  causation_event_id: z.string().uuid().nullable().default(null),
}).strict().refine((value) => value.ends_on >= value.starts_on, {
  path: ["ends_on"],
  message: "Schedule end must not precede its start.",
});

const legacyTimetableSlotSnapshotSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  period_number: z.number().int().min(1).max(24),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  title: z.string().trim().min(1).max(120),
  slot_type: z.enum(["class", "break", "activity"]),
  teacher_user_id: z.string().uuid().nullable().default(null),
  subject: campusModelEntitySchema.nullable().default(null),
  space: campusModelEntitySchema.nullable().default(null),
  room_snapshot: z.string().trim().max(80).default(""),
}).strict().refine((value) => value.ends_at > value.starts_at, {
  path: ["ends_at"],
  message: "Legacy timetable slot end must follow its start.",
});

/**
 * One authoritative legacy-slot mutation. The mutable timetable row and its
 * term remain domain truth; this contract only appends the corresponding
 * recorded-time occurrence revision to the Campus Model Core.
 */
export const legacyTimetableSlotChangeProjectionSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  action: z.enum(["created", "updated", "deleted"]),
  source_record_id: z.string().uuid(),
  source_revision: z.number().int().positive(),
  previous_source_revision: z.number().int().positive().nullable().default(null),
  term_id: z.string().uuid(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  timezone: timezoneSchema,
  occurred_at: z.string().datetime({ offset: true }),
  class_section: campusModelEntitySchema,
  slot: legacyTimetableSlotSnapshotSchema,
  correlation_id: z.string().uuid(),
}).strict().superRefine((value, context) => {
  if (value.ends_on < value.starts_on) {
    context.addIssue({
      code: "custom",
      path: ["ends_on"],
      message: "Legacy timetable term end must not precede its start.",
    });
  }
  if (value.class_section.kind !== "class") {
    context.addIssue({
      code: "custom",
      path: ["class_section"],
      message: "Use a class entity snapshot for a legacy timetable slot.",
    });
  }
  const expectedPrevious = value.source_revision - 1;
  if (value.action === "created" && (
    value.source_revision !== 1 || value.previous_source_revision !== null
  )) {
    context.addIssue({
      code: "custom",
      path: ["source_revision"],
      message: "A newly created legacy timetable slot begins at revision one.",
    });
  }
  if (value.action !== "created" && value.previous_source_revision !== expectedPrevious) {
    context.addIssue({
      code: "custom",
      path: ["previous_source_revision"],
      message: "A changed legacy timetable slot must identify its immediately preceding revision.",
    });
  }
});

export const campusTemporalContextQuerySchema = z.object({
  school_id: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
  recorded_as_of: z.string().datetime({ offset: true }).optional(),
  subject: z.discriminatedUnion("type", [
    z.object({ type: z.literal("entity"), domain: identifier, domain_id: z.string().trim().min(1).max(160) }).strict(),
    z.object({ type: z.literal("human_agent"), user_id: z.string().uuid() }).strict(),
  ]),
}).strict();

export const calendarClosureProjectionSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  institution: campusModelEntitySchema,
  action: z.enum(["created", "removed"]),
  source_record_id: z.string().uuid(),
  source_revision: z.number().int().positive(),
  dates: z.array(z.iso.date()).min(1).max(31),
  timezone: timezoneSchema,
  label: z.string().trim().min(1).max(160),
  closure_kind: z.enum(["public_holiday", "local_holiday", "emergency_closure"]),
  occurred_at: z.string().datetime({ offset: true }),
  correlation_id: z.string().uuid(),
}).strict();

export const publishedDayPlanPeriodSchema = z.object({
  period_id: z.string().uuid(),
  period_number: z.number().int().min(1).max(24),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  title: z.string().trim().min(1).max(120),
  slot_type: z.enum(["class", "break", "activity"]),
  cancelled: z.boolean(),
  subject: campusModelEntitySchema.nullable().default(null),
  teacher_user_id: z.string().uuid().nullable().default(null),
  space: campusModelEntitySchema.nullable().default(null),
  room_snapshot: z.string().trim().max(80).default(""),
}).strict().refine((value) => value.ends_at > value.starts_at, {
  path: ["ends_at"],
  message: "Period end must follow its start.",
});

export const publishedDayPlanProjectionSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  plan_version: z.number().int().positive(),
  plan_revision: z.number().int().positive(),
  date: z.iso.date(),
  timezone: timezoneSchema,
  published_at: z.string().datetime({ offset: true }),
  class_section: campusModelEntitySchema,
  periods: z.array(publishedDayPlanPeriodSchema).max(24),
  correlation_id: z.string().uuid(),
}).strict();

export const acceptedScheduleSubstitutionProjectionSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  substitution_id: z.string().uuid(),
  coverage_task_id: z.string().uuid(),
  coverage_task_revision: z.number().int().positive(),
  source_outbox_event_id: z.string().uuid(),
  occurrence_key: z.string().regex(/^[0-9a-f]{64}$/),
  source_kind: z.enum(["daily_plan", "published_timetable", "legacy_timetable"]),
  source_schedule_id: z.string().uuid(),
  source_record_id: z.string().uuid(),
  source_revision: z.number().int().positive(),
  source_version: z.number().int().positive().nullable().default(null),
  schedule: campusModelEntitySchema,
  period: campusModelEntitySchema,
  class_section: campusModelEntitySchema,
  subject: campusModelEntitySchema.nullable().default(null),
  space: campusModelEntitySchema.nullable().default(null),
  duty_date: z.iso.date(),
  period_number: z.number().int().min(1).max(24),
  starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  title: z.string().trim().min(1).max(120),
  slot_type: z.enum(["class", "break", "activity"]),
  room_snapshot: z.string().trim().max(80).default(""),
  original_teacher_user_id: z.string().uuid(),
  replacement_teacher_user_id: z.string().uuid(),
  accepted_at: z.string().datetime({ offset: true }),
  correlation_id: z.string().uuid(),
}).strict().superRefine((value, context) => {
  if (value.ends_at <= value.starts_at) {
    context.addIssue({ code: "custom", path: ["ends_at"], message: "Cover end must follow its start." });
  }
  if (value.actor_user_id !== value.replacement_teacher_user_id) {
    context.addIssue({
      code: "custom",
      path: ["actor_user_id"],
      message: "The accepted cover actor must be the replacement teacher.",
    });
  }
  if (value.original_teacher_user_id === value.replacement_teacher_user_id) {
    context.addIssue({
      code: "custom",
      path: ["replacement_teacher_user_id"],
      message: "The replacement teacher must differ from the original teacher.",
    });
  }
  if (value.source_kind === "daily_plan" && value.source_version === null) {
    context.addIssue({
      code: "custom",
      path: ["source_version"],
      message: "A dated plan substitution requires its published plan version.",
    });
  }
  if (value.source_kind !== "daily_plan" && value.source_version !== null) {
    context.addIssue({
      code: "custom",
      path: ["source_version"],
      message: "Only a dated plan substitution has a plan version.",
    });
  }
  const dailyPlan = value.source_kind === "daily_plan";
  const expectedScheduleDomainId = dailyPlan
    ? `${value.source_record_id}:${value.source_version}`
    : value.source_kind === "published_timetable"
      ? value.source_record_id
      : `legacy:${value.source_record_id}`;
  const expectedPeriodDomainId = dailyPlan
    ? `${value.source_schedule_id}:${value.source_version}`
    : value.source_schedule_id;
  const expectedDomain = dailyPlan ? "day_plan" : "timetable";
  const entityIssues: Array<[boolean, string, string]> = [
    [value.schedule.kind !== "schedule", "schedule", "Use a schedule entity snapshot."],
    [value.schedule.domain !== expectedDomain || value.schedule.domain_id !== expectedScheduleDomainId,
      "schedule", "The schedule snapshot must identify the accepted source revision."],
    [value.period.kind !== "schedule_period", "period", "Use a schedule-period entity snapshot."],
    [value.period.domain !== expectedDomain || value.period.domain_id !== expectedPeriodDomainId,
      "period", "The period snapshot must identify the accepted source occurrence."],
    [value.class_section.kind !== "class", "class_section", "Use a class entity snapshot."],
    [value.subject !== null && value.subject.kind !== "subject", "subject", "Use a subject entity snapshot."],
    [value.space !== null && value.space.kind !== "space", "space", "Use a space entity snapshot."],
    [value.schedule.source_revision !== value.source_revision,
      "schedule", "The schedule snapshot revision must match the accepted source revision."],
    [value.period.source_revision !== value.source_revision,
      "period", "The period snapshot revision must match the accepted source revision."],
  ];
  for (const [invalid, path, message] of entityIssues) {
    if (invalid) context.addIssue({ code: "custom", path: [path], message });
  }
});

/**
 * A recovery-only projection request for an accepted substitution that already
 * exists in the Staff Operations domain but predates its Campus Model Core
 * projection. The importer is an active operator authorising the repair; it is
 * deliberately distinct from the historical teacher who accepted the cover.
 */
export const importedAcceptedScheduleSubstitutionProjectionSchema =
  acceptedScheduleSubstitutionProjectionSchema.safeExtend({
    imported_by_user_id: z.string().uuid(),
    imported_at: z.string().datetime({ offset: true }),
    import_reason: z.literal("pre_core_projection_backfill"),
  });

/**
 * The authoritative subset of a staff.coverage.accepted outbox payload that
 * permits the temporal projection. Delivery-only fields such as `refresh` are
 * intentionally excluded; every field that identifies the accepted decision
 * and its exact timetable occurrence is retained and compared as typed JSON.
 */
export function acceptedScheduleSubstitutionOutboxEvidence(
  input: z.infer<typeof acceptedScheduleSubstitutionProjectionSchema>,
) {
  return {
    school_id: input.school_id,
    status: "accepted" as const,
    revision: input.coverage_task_revision,
    substitution_id: input.substitution_id,
    effective_timetable: true as const,
    occurrence_key: input.occurrence_key,
    source_kind: input.source_kind,
    source_record_id: input.source_record_id,
    source_revision: input.source_revision,
    source_version: input.source_version,
    source_schedule_id: input.source_schedule_id,
    original_teacher_user_id: input.original_teacher_user_id,
    replacement_teacher_user_id: input.replacement_teacher_user_id,
  };
}

/** Exact, non-notifying staff.coverage.accepted recovery-event payload. */
export function importedAcceptedScheduleSubstitutionOutboxEvidence(
  input: z.infer<typeof importedAcceptedScheduleSubstitutionProjectionSchema>,
) {
  return {
    ...acceptedScheduleSubstitutionOutboxEvidence(input),
    import_reason: input.import_reason,
    imported_at: input.imported_at,
  };
}

export const cancelledScheduleSubstitutionProjectionSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  substitution_id: z.string().uuid(),
  coverage_task_id: z.string().uuid(),
  coverage_task_revision: z.number().int().positive(),
  source_outbox_event_id: z.string().uuid(),
  occurrence_key: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.enum([
    "source_changed",
    "coverage_obligation_changed",
    "replacement_unavailable",
  ]),
  source_kind: z.enum(["daily_plan", "published_timetable", "legacy_timetable"]),
  source_record_id: z.string().uuid(),
  source_revision: z.number().int().positive(),
  source_version: z.number().int().positive().nullable().default(null),
  original_teacher_user_id: z.string().uuid(),
  replacement_teacher_user_id: z.string().uuid(),
  cancelled_at: z.string().datetime({ offset: true }),
  correlation_id: z.string().uuid(),
}).strict().superRefine((value, context) => {
  if (value.original_teacher_user_id === value.replacement_teacher_user_id) {
    context.addIssue({
      code: "custom",
      path: ["replacement_teacher_user_id"],
      message: "The invalidated replacement must differ from the original teacher.",
    });
  }
  if (value.source_kind === "daily_plan" && value.source_version === null) {
    context.addIssue({
      code: "custom",
      path: ["source_version"],
      message: "A dated plan substitution cancellation requires its published plan version.",
    });
  }
  if (value.source_kind !== "daily_plan" && value.source_version !== null) {
    context.addIssue({
      code: "custom",
      path: ["source_version"],
      message: "Only a dated plan substitution cancellation has a plan version.",
    });
  }
});

/** Exact authoritative fields required from staff.coverage.cancelled. */
export function cancelledScheduleSubstitutionOutboxEvidence(
  input: z.infer<typeof cancelledScheduleSubstitutionProjectionSchema>,
) {
  return {
    school_id: input.school_id,
    status: "cancelled" as const,
    revision: input.coverage_task_revision,
    substitution_id: input.substitution_id,
    occurrence_key: input.occurrence_key,
    reason: input.reason,
    source_kind: input.source_kind,
    source_record_id: input.source_record_id,
    source_revision: input.source_revision,
    source_version: input.source_version,
    original_teacher_user_id: input.original_teacher_user_id,
    replacement_teacher_user_id: input.replacement_teacher_user_id,
    effective_timetable: false as const,
  };
}

export function cancelledScheduleSubstitutionSuccessorAssignment(
  reason: z.infer<typeof cancelledScheduleSubstitutionProjectionSchema>["reason"],
): "original_teacher" | "unassigned" | "unchanged_later_source" {
  if (reason === "coverage_obligation_changed") return "original_teacher";
  if (reason === "replacement_unavailable") return "unassigned";
  return "unchanged_later_source";
}

export const coordinationRecipientSelectorConfigSchema = z.object({
  selector_key: identifier,
  mode: z.literal("explicit_authorized_agents"),
  required_capability: z.string().trim().min(3).max(120),
  scope_mode: z.enum(["institution", "event_scope"]),
  min_recipients: z.number().int().min(1).max(100),
  max_recipients: z.number().int().min(1).max(100),
}).strict().refine((value) => value.max_recipients >= value.min_recipients, {
  path: ["max_recipients"],
  message: "Maximum recipients must not be lower than minimum recipients.",
});

export const coordinationRecipientAgentRefSchema = z.discriminatedUnion("agent_kind", [
  z.object({ agent_kind: z.literal("human"), user_id: z.string().uuid() }).strict(),
  z.object({
    // Team queues require dated membership and claim semantics. Keep them out of
    // the public coordination contract until that authority adapter exists.
    agent_kind: z.enum(["device", "integration", "software"]),
    external_ref: z.string().trim().min(1).max(160),
  }).strict(),
]);

export const humanAgentAccountEndpointLinkSchema = z.object({
  school_id: z.string().uuid(),
  person_id: z.string().uuid(),
  user_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  effective_from: z.string().datetime({ offset: true }),
  effective_until: z.string().datetime({ offset: true }).nullable().default(null),
  source_domain: identifier,
  source_record_id: z.string().trim().min(1).max(160),
  source_revision: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.effective_until && Date.parse(value.effective_until) <= Date.parse(value.effective_from)) {
    context.addIssue({
      code: "custom",
      path: ["effective_until"],
      message: "Account endpoint end must be after its start.",
    });
  }
});

export const humanAgentAccountEndpointCloseSchema = z.object({
  school_id: z.string().uuid(),
  endpoint_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  expected_revision: z.number().int().positive(),
  effective_at: z.string().datetime({ offset: true }),
  disposition: z.enum(["ended", "revoked"]),
  reason: z.string().trim().min(3).max(500),
  source_domain: identifier,
  source_record_id: z.string().trim().min(1).max(160),
  source_revision: z.number().int().positive(),
  idempotency_key: z.string().trim().min(8).max(220),
}).strict();

export const humanAgentAccountEndpointReplaceSchema = z.object({
  school_id: z.string().uuid(),
  current_endpoint_id: z.string().uuid(),
  replacement_user_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  current_expected_revision: z.number().int().positive(),
  effective_at: z.string().datetime({ offset: true }),
  current_disposition: z.enum(["ended", "revoked"]).default("ended"),
  reason: z.string().trim().min(3).max(500),
  source_domain: identifier,
  source_record_id: z.string().trim().min(1).max(160),
  source_revision: z.number().int().positive(),
  idempotency_key: z.string().trim().min(8).max(200),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const humanAgentAccountResolutionSchema = z.object({
  school_id: z.string().uuid(),
  user_id: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
}).strict();

export const humanAgentPersonResolutionSchema = z.object({
  school_id: z.string().uuid(),
  person_id: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
}).strict();

export const acceptedCoordinationEventSchema = z.object({
  school_id: z.string().uuid(),
  source_outbox_event_id: z.string().uuid(),
  event_kind: z.literal("domain_event"),
  event_type: z.string().trim().min(3).max(120),
  subject: campusModelEntitySchema,
  context: campusModelEntitySchema.nullable().default(null),
  actor_user_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }),
  effective_from: z.string().datetime({ offset: true }),
  effective_until: z.string().datetime({ offset: true }).nullable().default(null),
  source_domain: identifier,
  source_record_id: z.string().trim().min(1).max(160),
  source_revision: z.number().int().positive(),
  correlation_id: z.string().uuid(),
  causation_event_id: z.string().uuid().nullable().default(null),
  idempotency_key: z.string().trim().min(8).max(240),
  expected_route: z.object({
    behaviour_version_id: z.string().uuid(),
    subscription_id: z.string().uuid(),
  }).strict().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  message: z.object({
    subject: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1_000),
    payload: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  selector_input: z.object({
    selector_key: identifier,
    // user_id/external_ref is a domain-facing endpoint reference. The runtime
    // resolves it to the private, stable Campus Model agent identity.
    recipient_agents: z.array(coordinationRecipientAgentRefSchema).min(1).max(100),
    scope: campusModelEntitySchema.nullable().default(null),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.effective_until && Date.parse(value.effective_until) <= Date.parse(value.effective_from)) {
    context.addIssue({ code: "custom", path: ["effective_until"], message: "Event end must be after its start." });
  }
  const recipientKeys = value.selector_input.recipient_agents.map((recipient) => recipient.agent_kind === "human"
    ? `human:${recipient.user_id}`
    : `${recipient.agent_kind}:${recipient.external_ref}`);
  if (new Set(recipientKeys).size !== recipientKeys.length) {
    context.addIssue({ code: "custom", path: ["selector_input", "recipient_agents"], message: "Recipient agents must be unique." });
  }
});

/**
 * An accepted domain fact that belongs in the immutable campus event journal but
 * does not, by itself, create operational work. In particular, an ordinary chat
 * message is evidence that two campus agents communicated; it is not a Task,
 * Request, command or observation of physical truth.
 */
export const acceptedDomainEventSchema = z.object({
  school_id: z.string().uuid(),
  source_outbox_event_id: z.string().uuid(),
  event_type: z.string().trim().min(3).max(120),
  subject: campusModelEntitySchema,
  context: campusModelEntitySchema.nullable().default(null),
  actor_user_id: z.string().uuid(),
  audience_user_ids: z.array(z.string().uuid()).max(500).default([]),
  occurred_at: z.string().datetime({ offset: true }),
  effective_from: z.string().datetime({ offset: true }),
  effective_until: z.string().datetime({ offset: true }).nullable().default(null),
  source_domain: identifier,
  source_record_id: z.string().trim().min(1).max(160),
  source_revision: z.number().int().positive(),
  correlation_id: z.string().uuid(),
  causation_event_id: z.string().uuid().nullable().default(null),
  idempotency_key: z.string().trim().min(8).max(240),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.effective_until && Date.parse(value.effective_until) <= Date.parse(value.effective_from)) {
    context.addIssue({ code: "custom", path: ["effective_until"], message: "Event end must be after its start." });
  }
  if (new Set(value.audience_user_ids).size !== value.audience_user_ids.length) {
    context.addIssue({ code: "custom", path: ["audience_user_ids"], message: "Event audience members must be unique." });
  }
});

export const operationalMessageStateSchema = z.enum([
  "queued",
  "delivered",
  "acknowledged",
  "responded",
  "expired",
  "cancelled",
  "dead_letter",
]);

export const operationalMessageOutcomeSchema = z.object({
  school_id: z.string().uuid(),
  message_id: z.string().uuid(),
  state: operationalMessageStateSchema.exclude(["queued"]),
  actor: coordinationRecipientAgentRefSchema.nullable().default(null),
  source_outbox_event_id: z.string().uuid().nullable().default(null),
  code: identifier,
  explanation: z.string().trim().min(3).max(500),
  response: z.record(z.string(), z.unknown()).nullable().default(null),
  occurred_at: z.string().datetime({ offset: true }),
  idempotency_key: z.string().trim().min(8).max(240),
}).strict().superRefine((value, context) => {
  if (["acknowledged", "responded"].includes(value.state) && !value.actor) {
    context.addIssue({ code: "custom", path: ["actor"], message: "Identify the agent acknowledging or responding to the work." });
  }
  if (value.state === "responded" && !value.source_outbox_event_id) {
    context.addIssue({ code: "custom", path: ["source_outbox_event_id"], message: "A domain response must retain its source outbox event." });
  }
  if (value.state === "responded" && !value.response) {
    context.addIssue({ code: "custom", path: ["response"], message: "A responded message requires its typed response payload." });
  }
  if (value.state !== "responded" && value.response) {
    context.addIssue({ code: "custom", path: ["response"], message: "Only a responded message can carry a response payload." });
  }
});

export const recipientOperationalMessageResponseSchema = z.object({
  school_id: z.string().uuid(),
  message_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  recipient: coordinationRecipientAgentRefSchema,
  actor: coordinationRecipientAgentRefSchema,
  expected_source_record_id: z.string().uuid(),
  expected_source_revision: z.number().int().positive(),
  source_outbox_event_id: z.string().uuid(),
  code: identifier,
  explanation: z.string().trim().min(3).max(500),
  response: z.record(z.string(), z.unknown()),
  occurred_at: z.string().datetime({ offset: true }),
  idempotency_key: z.string().trim().min(8).max(220),
}).strict();

export type CampusModelEntitySnapshot = z.infer<typeof campusModelEntitySchema>;
export type CampusModelRelationshipSnapshot = z.infer<typeof campusModelRelationshipSchema>;
export type AcceptedCampusModelChange = z.infer<typeof acceptedCampusModelChangeSchema>;
export type AcceptedDomainEvent = z.infer<typeof acceptedDomainEventSchema>;
export type CampusModelObservation = z.infer<typeof campusModelObservationSchema>;
export type ModelObservationContractRefs = z.infer<typeof modelObservationContractRefsSchema>;
export type CampusModelObservationTransition = z.infer<typeof campusModelObservationTransitionSchema>;
export type PublishedScheduleProjection = z.infer<typeof publishedScheduleProjectionSchema>;
export type LegacyTimetableSlotChangeProjection = z.infer<typeof legacyTimetableSlotChangeProjectionSchema>;
export type CampusTemporalContextQuery = z.infer<typeof campusTemporalContextQuerySchema>;
export type CalendarClosureProjection = z.infer<typeof calendarClosureProjectionSchema>;
export type PublishedDayPlanProjection = z.infer<typeof publishedDayPlanProjectionSchema>;
export type AcceptedScheduleSubstitutionProjection = z.infer<typeof acceptedScheduleSubstitutionProjectionSchema>;
export type ImportedAcceptedScheduleSubstitutionProjection = z.infer<typeof importedAcceptedScheduleSubstitutionProjectionSchema>;
export type CancelledScheduleSubstitutionProjection = z.infer<typeof cancelledScheduleSubstitutionProjectionSchema>;
export type CoordinationRecipientSelectorConfig = z.infer<typeof coordinationRecipientSelectorConfigSchema>;
export type CoordinationRecipientAgentRef = z.infer<typeof coordinationRecipientAgentRefSchema>;
export type HumanAgentAccountEndpointLink = z.infer<typeof humanAgentAccountEndpointLinkSchema>;
export type HumanAgentAccountEndpointClose = z.infer<typeof humanAgentAccountEndpointCloseSchema>;
export type HumanAgentAccountEndpointReplace = z.infer<typeof humanAgentAccountEndpointReplaceSchema>;
export type HumanAgentAccountResolution = z.infer<typeof humanAgentAccountResolutionSchema>;
export type HumanAgentPersonResolution = z.infer<typeof humanAgentPersonResolutionSchema>;
export type AcceptedCoordinationEvent = z.infer<typeof acceptedCoordinationEventSchema>;
export type OperationalMessageState = z.infer<typeof operationalMessageStateSchema>;
export type OperationalMessageOutcome = z.infer<typeof operationalMessageOutcomeSchema>;
export type RecipientOperationalMessageResponse = z.infer<typeof recipientOperationalMessageResponseSchema>;
