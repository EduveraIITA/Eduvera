import { z } from "zod";
import type { FinanceLedgerBasis } from "./finance-arrangements.contracts.js";

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
export type NativeFeeCommand = z.infer<typeof command>;
export interface NativeFeeReviewer { user_id: string; person_id: string; label: string; eligibility_hash: string }
export interface NativeFeeRequest {
  route_kind: "named" | "guardian_queue";
  id: string; school_id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null;
  method: "cash" | "bank_transfer" | "cheque" | null; reference: string | null; note: string;
  submitted_by: string; submitter_person_id: string; submitter_relationship: "self" | "guardian" | "assisted"; entitlement_id: string | null;
  reviewer_user_id: string; reviewer_person_id: string; reviewer_basis: { eligibility_hash: string; label: string };
  ledger_basis: FinanceLedgerBasis; basis_hash: string; coordination_receipt: Record<string, unknown>; stream_revision: number; command_id: string; created_at: Date | string;
}
export interface NativeFeeHistory extends NativeFeeRequest {
  status: "pending" | "verified" | "rejected" | "answered" | "withdrawn"; response: string | null; payment_id: string | null; decided_at: Date | string | null;
}
export interface NativeFeeReviewWorkRecord {
  id: string; invoice_id: string; revision: number; kind: "payment" | "charge"; created_at: string; message_id: string | null;
  href: string; title: string; reviewer: { user_id: string; label: string };
  state: "review_needed" | "waiting_for_review" | "needs_reassignment" | "route_unavailable" | "access_ended";
}
