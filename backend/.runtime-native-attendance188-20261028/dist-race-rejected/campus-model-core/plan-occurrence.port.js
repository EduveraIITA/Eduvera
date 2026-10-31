import { z } from "zod";
import { campusModelEntitySchema } from "./contracts.js";
/** Domain-expanded plans. Core preserves context; it never interprets recurrence. */
export const PLAN_OCCURRENCE_PORT = Symbol("PLAN_OCCURRENCE_PORT");
const instant = z.string().datetime({ offset: true });
export const planOccurrenceSchema = z.object({
    occurrence_key: z.string().trim().min(1).max(240),
    occurrence: campusModelEntitySchema,
    local_date: z.iso.date(),
    starts_at: instant,
    ends_at: instant,
    time_zone: z.string().min(1).max(80).refine((zone) => {
        try {
            new Intl.DateTimeFormat("en", { timeZone: zone });
            return true;
        }
        catch {
            return false;
        }
    }, "Use a valid IANA timezone."),
    /** Omitted legacy callers retain exclusive scheduling semantics. */
    claim_kind: z.enum(["exclusive", "availability"]).optional(),
    context: campusModelEntitySchema.nullable(),
    participants: z.array(z.object({
        person: campusModelEntitySchema,
        role: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        required: z.boolean(),
        source_ref: z.string().min(1).max(240),
        source_revision: z.number().int().positive(),
    }).strict()).max(2000),
    resources: z.array(campusModelEntitySchema).max(100),
    state: z.enum(["expected", "cancelled", "superseded"]),
}).strict().superRefine((value, context) => {
    if (Date.parse(value.ends_at) <= Date.parse(value.starts_at)) {
        context.addIssue({ code: "custom", path: ["ends_at"], message: "Occurrence end must follow its start." });
    }
    const participants = value.participants.map((item) => `${item.person.domain}:${item.person.domain_id}:${item.role}`);
    if (value.claim_kind === "availability" && value.participants.length) {
        context.addIssue({ code: "custom", path: ["participants"], message: "Availability cannot assign people or attendance." });
    }
    if (new Set(participants).size !== participants.length) {
        context.addIssue({ code: "custom", path: ["participants"], message: "A participant role must appear only once." });
    }
});
const planOccurrenceProjectionBase = z.object({
    school_id: z.string().uuid(),
    actor_user_id: z.string().uuid(),
    plan: campusModelEntitySchema,
    source_revision: z.number().int().positive(),
    event_type: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.-]{1,100}$/),
    occurred_at: instant,
    correlation_id: z.string().uuid(),
    causation_event_id: z.string().uuid().nullable(),
    horizon: z.object({ from: instant, until: instant }).strict(),
    supersedes_plan: z.object({
        domain: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), domain_id: z.string().min(1).max(160),
        source_revision: z.number().int().positive(),
    }).strict().optional(),
    occurrences: z.array(planOccurrenceSchema).max(4000),
}).strict();
function validatePlanProjection(value, context) {
    if (Date.parse(value.horizon.until) <= Date.parse(value.horizon.from)) {
        context.addIssue({ code: "custom", path: ["horizon"], message: "Projection horizon must have positive duration." });
    }
    if (value.plan.source_revision !== value.source_revision) {
        context.addIssue({ code: "custom", path: ["source_revision"], message: "Plan and publication revisions must match." });
    }
    if (!value.event_type.startsWith(`${value.plan.domain}.`)) {
        context.addIssue({ code: "custom", path: ["event_type"], message: "Plan event must belong to its owning domain." });
    }
    if (value.supersedes_plan && (value.supersedes_plan.domain !== value.plan.domain
        || value.supersedes_plan.domain_id === value.plan.domain_id)) {
        context.addIssue({ code: "custom", path: ["supersedes_plan"], message: "A supersession must name a different plan in the same owning domain." });
    }
    const keys = new Set();
    for (const [index, occurrence] of value.occurrences.entries()) {
        if (keys.has(occurrence.occurrence_key))
            context.addIssue({ code: "custom", path: ["occurrences", index], message: "Occurrence keys must be unique." });
        keys.add(occurrence.occurrence_key);
        if (Date.parse(occurrence.starts_at) < Date.parse(value.horizon.from)
            || Date.parse(occurrence.starts_at) >= Date.parse(value.horizon.until)) {
            context.addIssue({ code: "custom", path: ["occurrences", index], message: "Occurrence start lies outside the declared horizon." });
        }
    }
}
export const planOccurrenceProjectionSchema = planOccurrenceProjectionBase.superRefine(validatePlanProjection);
export const planOccurrenceExtensionSchema = planOccurrenceProjectionBase.omit({ actor_user_id: true })
    .extend({ basis_event_id: z.string().uuid() }).superRefine((value, context) => {
    validatePlanProjection(value, context);
    if (value.supersedes_plan || value.event_type !== `${value.plan.domain}.occurrences_materialized`
        || value.occurrences.some(occurrence => occurrence.state !== "expected")) {
        context.addIssue({ code: "custom", message: "Materialization may only extend an accepted plan; it cannot revise or cancel it." });
    }
});
//# sourceMappingURL=plan-occurrence.port.js.map