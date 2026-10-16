import { z } from "zod";

const identifier = z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/);
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

export const campusModelObservationSchema = z.object({
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
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
}).strict();

export const campusModelObservationTransitionSchema = z.object({
  school_id: z.string().uuid(),
  source_type: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,39}$/),
  source_ref: z.string().trim().min(1).max(200),
  state: z.enum(["accepted", "rejected", "quarantined", "superseded"]),
}).strict();

export type CampusModelEntitySnapshot = z.infer<typeof campusModelEntitySchema>;
export type CampusModelRelationshipSnapshot = z.infer<typeof campusModelRelationshipSchema>;
export type AcceptedCampusModelChange = z.infer<typeof acceptedCampusModelChangeSchema>;
export type CampusModelObservation = z.infer<typeof campusModelObservationSchema>;
export type CampusModelObservationTransition = z.infer<typeof campusModelObservationTransitionSchema>;
