import { z } from "zod";

const uuid = z.string().uuid();
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine((value) => !value.includes("\0"), "Unsupported character.");

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

export type EventFinanceState =
  | "not_required"
  | "not_invoiced"
  | "collectible"
  | "paid"
  | "credited"
  | "refund_due"
  | "partially_refunded"
  | "refunded";

export interface EventFinanceParticipantDto {
  student_id: string;
  student_name: string;
  admission_number: string;
  avatar_url: string | null;
  participation_state: "pending" | "accepted" | "declined" | "withdrawn";
  withdrawn_at: string | null;
  can_withdraw: boolean;
  finance_state: EventFinanceState;
  currency: "INR";
  invoice_id: string | null;
  invoice_amount_paise: number;
  credited_paise: number;
  paid_paise: number;
  refunded_paise: number;
  collectible_balance_paise: number;
  refund_due_paise: number;
  refunds: Array<{
    id: string;
    amount_paise: number;
    method: "cash" | "bank_transfer" | "cheque";
    reference: string;
    reason: string;
    recorded_at: string;
  }>;
}

export interface EventFinanceResponse {
  event: { id: string; title: string; status: "draft" | "published" | "cancelled" | "completed" };
  items: EventFinanceParticipantDto[];
  counts: { reconciliation_required: number; withdrawn: number };
  permissions: { can_view_finance_details: boolean; can_record_refund: boolean };
}
