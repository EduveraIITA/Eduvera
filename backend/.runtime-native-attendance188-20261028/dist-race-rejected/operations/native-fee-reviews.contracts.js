import { z } from "zod";
const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const command = z.object({ command_id: id, expected_revision: z.number().int().nonnegative() });
const note = z.string().trim().max(1000).refine(value => !value.includes("\0"));
const reportBase = command.extend({ review_id: id, basis_hash: hash, basis_revision: z.number().int().nonnegative(),
    reviewer: z.object({ user_id: id, person_id: id, eligibility_hash: hash }).strict() });
export const nativeFeeReport = z.discriminatedUnion("kind", [
    reportBase.extend({ kind: z.literal("payment"), amount_paise: z.number().int().min(1).max(100_000_000),
        method: z.enum(["cash", "bank_transfer", "cheque"]), reference: z.string().trim().min(3).max(120), note: note.default(""), payment_made: z.literal(true) }).strict(),
    reportBase.extend({ kind: z.literal("charge"), note: note.refine(value => value.length >= 3) }).strict(),
]);
export const nativeFeeDecision = command.extend({ outcome: z.enum(["verified", "rejected", "answered"]), response: note.refine(value => value.length >= 3),
    verified_funds: z.boolean().default(false) }).strict();
export const nativeFeeWithdraw = command.strict();
export const nativeFeeResult = z.object({ id, invoice_id: id, revision: z.number().int().positive(), replayed: z.boolean(),
    payment_id: id.nullable().optional(), outcome: z.enum(["verified", "rejected", "answered", "withdrawn"]).optional() }).strict();
//# sourceMappingURL=native-fee-reviews.contracts.js.map