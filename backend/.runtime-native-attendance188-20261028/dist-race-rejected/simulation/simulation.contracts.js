import { z } from "zod";
export const simulationRunKinds = ["baseline", "scenario"];
export const simulationRunStatuses = [
    "preparing",
    "draft",
    "running",
    "paused",
    "stopped",
    "completed",
    "failed",
];
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
export const PASSIVE_SIMULATION_OFFER_RESPONSE_BEHAVIOUR = Object.freeze({
    enabled: false,
    accepted: 0,
    declined: 0,
    no_response: 1,
    response_delay_minutes: 10,
});
/** Normalize retained v1 attendance-only policies without adding hidden activity. */
export function normalizeSimulationBehaviourConfiguration(input) {
    if (input.schema_version === 2)
        return input;
    return {
        schema_version: 2,
        attendance: input.attendance,
        coverage_offers: { ...PASSIVE_SIMULATION_OFFER_RESPONSE_BEHAVIOUR },
        invigilation_offers: { ...PASSIVE_SIMULATION_OFFER_RESPONSE_BEHAVIOUR },
    };
}
//# sourceMappingURL=simulation.contracts.js.map