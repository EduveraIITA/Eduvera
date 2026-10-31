import { z } from "zod";
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const chargeCorrectionSelection = z.object({ invoice_ids: z.array(id).min(1).max(500), batch_id: id.optional() }).strict()
    .refine(value => new Set(value.invoice_ids).size === value.invoice_ids.length, "Choose each posted invoice once.");
export const chargeCorrectionChange = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("amend"), amount_paise: z.number().int().min(1).max(100_000_000).optional(),
        description: z.string().trim().min(1).max(200).optional(), due_on: z.iso.date().optional() }).strict()
        .refine(value => value.amount_paise !== undefined || value.description !== undefined || value.due_on !== undefined, "Choose a field to correct."),
    z.object({ kind: z.literal("cancel") }).strict(),
]);
export const chargeCorrectionPreview = z.object({ selection: chargeCorrectionSelection, change: chargeCorrectionChange }).strict();
export const chargeCorrectionApply = chargeCorrectionPreview.extend({ command_id: id, correction_id: id, snapshot_hash: hash,
    reason: z.string().trim().min(3).max(1000), attested_recording_error: z.literal(true) }).strict();
const replacement = z.object({ amount_paise: z.number().int().min(1).max(100_000_000), method: z.enum(["cash", "bank_transfer", "cheque"]),
    reference: z.string().trim().min(3).max(120) }).strict();
export const paymentCorrectionPreview = z.discriminatedUnion("action", [z.object({ action: z.literal("reverse") }).strict(),
    z.object({ action: z.literal("replace"), replacement }).strict()]);
export const paymentCorrectionApply = z.discriminatedUnion("action", [
    z.object({ action: z.literal("reverse"), command_id: id, correction_id: id, snapshot_hash: hash,
        reason: z.string().trim().min(3).max(1000), attested_recording_error: z.literal(true) }).strict(),
    z.object({ action: z.literal("replace"), replacement, command_id: id, correction_id: id, snapshot_hash: hash,
        reason: z.string().trim().min(3).max(1000), attested_recording_error: z.literal(true), verified_funds: z.literal(true) }).strict(),
]);
//# sourceMappingURL=fee-corrections.contracts.js.map