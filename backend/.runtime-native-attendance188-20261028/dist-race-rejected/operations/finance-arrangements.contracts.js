import { z } from "zod";
export const financeId = z.uuid();
const command = z.object({ command_id: financeId, expected_revision: z.number().int().min(0) });
const shortText = (max) => z.string().trim().max(max).refine(value => !value.includes("\0"));
export const instalmentSchedule = z.array(z.object({ amount_paise: z.number().int().min(1).max(100_000_000), due_on: z.iso.date() }).strict()).min(1).max(12)
    .superRefine((rows, context) => {
    rows.forEach((row, index) => {
        if (index && row.due_on <= rows[index - 1].due_on)
            context.addIssue({ code: "custom", path: [index, "due_on"], message: "Use a later date for each instalment." });
    });
});
export const requestInstalments = command.extend({ request_id: financeId, basis_hash: z.string().regex(/^[a-f0-9]{64}$/),
    basis_revision: z.number().int().nonnegative(),
    schedule: instalmentSchedule, note: shortText(1000).default("") }).strict();
export const decideInstalments = command.extend({ decision: z.enum(["approved", "rejected"]), response: shortText(1000).default("") }).strict()
    .refine(value => value.decision === "approved" || value.response.length >= 3, { message: "Explain why the proposal cannot be approved.", path: ["response"] });
export const withdrawInstalments = command.strict();
export const enableSelfPayer = command.extend({ entitlement_id: financeId, valid_from: z.iso.date(), valid_until: z.iso.date(),
    attested_adult_self_payer: z.literal(true) }).strict().refine(value => value.valid_until >= value.valid_from, { message: "End date must follow the start date.", path: ["valid_until"] });
export const revokeSelfPayer = command.extend({ entitlement_id: financeId, reason: shortText(500).refine(value => value.length >= 3) }).strict();
export const financeArrangementResult = z.object({ id: financeId, invoice_id: financeId, revision: z.number().int().positive(), replayed: z.boolean(),
    request_id: financeId.optional(), decision: z.enum(["approved", "rejected"]).optional(),
    retained_message_state: z.enum(["queued", "delivered", "acknowledged", "responded", "expired", "cancelled", "dead_letter"]).optional(),
    already_terminal: z.boolean().optional() }).strict();
//# sourceMappingURL=finance-arrangements.contracts.js.map