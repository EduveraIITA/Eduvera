import { z } from "zod";
export const CONFIGURED_COMMAND_PORT = Symbol("CONFIGURED_COMMAND_PORT");
export const configuredSoftwareActorSchema = z.object({
    school_id: z.string().uuid(), approved_by_user_id: z.string().uuid(),
    source_domain: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), source_record_id: z.string().min(1).max(160),
    source_revision: z.number().int().positive(), configuration_hash: z.string().regex(/^(?:sha256:)?[0-9a-f]{64}$/),
    operating_rule_ref: z.string().min(1).max(240), allowed_commands: z.array(z.string().min(3).max(120)).min(1).max(30),
    approved_at: z.string().datetime({ offset: true }), effective_from: z.string().datetime({ offset: true }),
    label: z.string().trim().min(1).max(200),
}).strict().superRefine((value, context) => {
    if (new Set(value.allowed_commands).size !== value.allowed_commands.length
        || value.allowed_commands.some((command) => !command.startsWith(`${value.source_domain}.`))) {
        context.addIssue({ code: "custom", path: ["allowed_commands"], message: "Configured commands must be unique and belong to the approving domain." });
    }
});
//# sourceMappingURL=configured-command.port.js.map