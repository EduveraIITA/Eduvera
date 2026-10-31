import { z } from "zod";

export const financeId = z.uuid();
const command = z.object({ command_id: financeId, expected_revision: z.number().int().min(0) });
const shortText = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\0"));
export const instalmentSchedule = z.array(z.object({ amount_paise: z.number().int().min(1).max(100_000_000), due_on: z.iso.date() }).strict()).min(1).max(12)
  .superRefine((rows, context) => {
    rows.forEach((row, index) => {
      if (index && row.due_on <= rows[index - 1]!.due_on) context.addIssue({ code: "custom", path: [index, "due_on"], message: "Use a later date for each instalment." });
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
export type ArrangementCommand = z.infer<typeof command>;
export type Instalment = z.infer<typeof instalmentSchedule>[number];
export const financeArrangementResult = z.object({ id: financeId, invoice_id: financeId, revision: z.number().int().positive(), replayed: z.boolean(),
  request_id: financeId.optional(), decision: z.enum(["approved", "rejected"]).optional(),
  retained_message_state: z.enum(["queued", "delivered", "acknowledged", "responded", "expired", "cancelled", "dead_letter"]).optional(),
  already_terminal: z.boolean().optional() }).strict();
export interface FinanceLedgerBasis {
  invoice_id: string; student_id?: string; context_kind?: "person"; person_id?: string; basis_version?: 2 | 3; amount_paise: number; credited_paise: number; paid_paise: number; refunded_paise: number;
  balance_paise: number; credits: Array<{ id: string; amount_paise: number }>; payments: Array<{ id: string; amount_paise: number }>;
  refunds: Array<{ id: string; amount_paise: number }>;
  amendments?: Array<{ id: string; revision: number; amount_paise: number; description: string; due_on: string; charge_state: string }>;
  reversals?: Array<{ id: string; payment_id: string; replacement_payment_id: string | null }>;
  recorded_payment_count?: number;
}
export interface FinanceInvoice {
  id: string; school_id: string; student_id: string | null; context_kind: "student" | "person"; person_id: string; user_id: string | null; student_label: string;
  reference: string; description: string; due_on: string; amount_paise: number; created_at: Date | string; original_due_on?: string; original_amount_paise?: number;
}
export interface FinanceInstalmentRequest {
  id: string; school_id: string; invoice_id: string; student_id: string | null; beneficiary_person_id: string | null; submitted_by: string; submitter_person_id: string;
  submitter_relationship: "self" | "guardian"; entitlement_id: string | null; note: string; schedule: Instalment[]; ledger_basis: FinanceLedgerBasis;
  basis_hash: string; reviewer_user_id: string; reviewer_person_id: string; authority_receipt: unknown; coordination_receipt: unknown;
  stream_revision: number; command_id: string; correlation_id: string; created_at: Date | string;
}
