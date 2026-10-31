import { z } from "zod";
export const campusScenarioInterventionTypes = ["teacher_unavailable", "space_unavailable"];
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
export const createCampusScenarioSchema = z.union([
    z.object({
        kind: z.literal("baseline_snapshot"),
        campus_id: z.string().uuid().optional(),
        horizon_days: z.number().int().min(7).max(30),
    }).strict(),
    z.object({
        kind: z.literal("intervention").optional(),
        campus_id: z.string().uuid().optional(),
        horizon_days: z.number().int().min(7).max(30),
        intervention: interventionSchema,
        behaviour_policy_version_id: z.string().uuid().optional(),
    }).strict(),
]);
export const campusScenarioTargetsQuerySchema = z.object({
    campus_id: z.string().uuid().optional(),
    horizon_days: z.coerce.number().int().min(7).max(30).default(30),
}).strict();
//# sourceMappingURL=scenario-contracts.js.map