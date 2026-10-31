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
export interface CorrectedChargeState {
  amount_paise: number; description: string; due_on: string; charge_state: "active" | "cancelled";
  paid_paise: number; balance_paise: number; credit_paise: number;
}
export interface ChargeCorrectionQuote {
  snapshot_hash: string; today: string; person_count: number;
  items: Array<{ invoice_id: string; person_id: string; student_id: string | null; name: string; reference: string; revision: number;
    before: CorrectedChargeState; after: CorrectedChargeState }>;
  before_total_amount_paise: number; after_total_amount_paise: number; before_balance_paise: number; after_balance_paise: number;
  credit_paise: number;
}
export interface ChargeCorrectionResult { id: string; correction_id: string; invoice_ids: string[]; revision: 1; replayed: boolean }
export interface PaymentCorrectionQuote {
  snapshot_hash: string; today: string; invoice_id: string; payment_id: string; reference: string;
  amount_paise: number; method: string; before: CorrectedChargeState; after: CorrectedChargeState;
  can_reverse: boolean; can_replace: boolean;
}
export interface PaymentCorrectionResult { id: string; correction_id: string; invoice_id: string; payment_id: string;
  replacement_payment_id: string | null; action: "reverse" | "replace"; revision: 1; replayed: boolean }
