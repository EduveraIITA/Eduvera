import { z } from "zod";
const uuid = z.string().uuid();
const text = (maximum) => z.string().trim().min(1).max(maximum).refine((value) => !value.includes("\0"), "Unsupported character.");
export const campusEventFinanceIdSchema = uuid;
export const campusEventFinanceQuerySchema = z.object({
    school_id: uuid,
    student_id: uuid.optional(),
}).strict();
export const withdrawFromPaidEventSchema = z.object({
    school_id: uuid,
    student_id: uuid,
    reason: text(500).min(3),
    idempotency_key: uuid,
}).strict();
export const recordEventRefundSchema = z.object({
    school_id: uuid,
    student_id: uuid,
    amount_paise: z.number().int().positive().max(100_000_000),
    method: z.enum(["cash", "bank_transfer", "cheque"]),
    reference: text(120),
    reason: text(500).min(3),
    idempotency_key: uuid,
}).strict();
//# sourceMappingURL=campus-event-finance.contracts.js.map