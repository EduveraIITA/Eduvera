import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { FinanceLedgerBasis, Instalment } from "./finance-arrangements.contracts.js";
import { agreedSchedule } from "./finance-arrangements.store.js";

export const feeLedgerQuerySchema = z.object({
  cursor: z.uuid().optional(), payment_cursor: z.uuid().optional(), review_cursor: z.uuid().optional(), batch_id: z.uuid().optional(), receipt_id: z.uuid().optional(), review_id: z.uuid().optional(),
  group_collections: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  search: z.string().trim().max(80).default(""), limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FeeLedgerQuery = z.input<typeof feeLedgerQuerySchema>;
type Projection = { id: string; due_on: string; original_due_on: string; amount_paise: number;
  credits: FinanceLedgerBasis["credits"]; payments: FinanceLedgerBasis["payments"]; refunds: FinanceLedgerBasis["refunds"];
  amendments: NonNullable<FinanceLedgerBasis["amendments"]>; reversals: NonNullable<FinanceLedgerBasis["reversals"]>; recorded_payment_count: number;
  schedule: Instalment[] | null; ledger_basis: FinanceLedgerBasis | null; corrections: unknown[] };

/** One bounded round trip for every listed invoice, including original evidence. */
export async function feeLedgerProjections(db: Transaction<Database>, schoolId: string, ids: string[], today: string) {
  if (!ids.length) return new Map();
  const rows = (await sql<Projection>`SELECT i.id,i.due_on::text,i.original_due_on::text,i.amount_paise,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'amount_paise',p.amount_paise) ORDER BY p.id)
      FROM fee_effective_payments p WHERE p.school_id=i.school_id AND p.invoice_id=i.id),'[]'::jsonb) AS payments,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'amount_paise',c.amount_paise) ORDER BY c.id)
      FROM fee_invoice_credits c WHERE c.school_id=i.school_id AND c.invoice_id=i.id),'[]'::jsonb) AS credits,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount_paise',r.amount_paise) ORDER BY r.id)
      FROM fee_refunds r WHERE r.school_id=i.school_id AND r.invoice_id=i.id),'[]'::jsonb) AS refunds,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.correction_id,'revision',c.revision,'amount_paise',c.amount_paise,
      'description',c.description,'due_on',c.due_on::text,'charge_state',c.charge_state) ORDER BY c.revision)
      FROM fee_invoice_correction_items c WHERE c.school_id=i.school_id AND c.invoice_id=i.id),'[]'::jsonb) AS amendments,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'payment_id',c.payment_id,'replacement_payment_id',c.replacement_payment_id) ORDER BY c.id)
      FROM fee_payment_corrections c WHERE c.school_id=i.school_id AND c.invoice_id=i.id),'[]'::jsonb) AS reversals,
    (SELECT count(*)::int FROM fee_payments p WHERE p.school_id=i.school_id AND p.invoice_id=i.id) AS recorded_payment_count,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'revision',c.revision,'reason',h.reason,'created_at',h.created_at,
      'created_by',h.created_by,'actor_person_id',h.actor_person_id,'actor_name',h.actor_name,'created_by_label',h.actor_name,
      'amount_paise',c.amount_paise,'description',c.description,'due_on',c.due_on::text,'charge_state',c.charge_state) ORDER BY c.revision)
      FROM fee_invoice_correction_items c JOIN fee_invoice_corrections h ON h.school_id=c.school_id AND h.id=c.correction_id
      WHERE c.school_id=i.school_id AND c.invoice_id=i.id),'[]'::jsonb) AS corrections,
    approved.schedule,approved.ledger_basis
    FROM fee_effective_invoices i LEFT JOIN LATERAL (
      SELECT r.schedule,r.ledger_basis FROM fee_instalment_requests r JOIN fee_instalment_decisions d ON d.school_id=r.school_id
        AND d.request_id=r.id AND d.decision='approved' WHERE r.school_id=i.school_id AND r.invoice_id=i.id
      ORDER BY d.stream_revision DESC LIMIT 1
    ) approved ON true WHERE i.school_id=${schoolId}::uuid AND i.id=ANY(${ids}::uuid[])`.execute(db)).rows;
  return new Map(rows.map(row => {
    const sum = (entries: Array<{ amount_paise: number }>) => entries.reduce((total, entry) => total + entry.amount_paise, 0);
    const paid = sum(row.payments), credited = sum(row.credits), refunded = sum(row.refunds);
    const basis: FinanceLedgerBasis = { invoice_id: row.id, amount_paise: row.amount_paise,
      credited_paise: credited, paid_paise: paid, refunded_paise: refunded,
      balance_paise: Math.max(0, Math.max(0, row.amount_paise - credited) - Math.max(0, paid - refunded)),
      credits: row.credits, payments: row.payments, refunds: row.refunds,
      ...(row.amendments.length || row.reversals.length ? { basis_version: 3 as const, amendments: row.amendments,
        reversals: row.reversals, recorded_payment_count: row.recorded_payment_count } : {}),
    };
    const agreement = row.schedule && row.ledger_basis ? agreedSchedule({ schedule: row.schedule, ledger_basis: row.ledger_basis }, basis) : null;
    return [row.id, { corrections: row.corrections, original_due_on: row.original_due_on ?? row.due_on, collection_today: today,
      collection_due_on: agreement ? agreement.next_due_on : row.due_on,
      collection_due_amount_paise: agreement ? agreement.state === "needs_review" ? null : agreement.rows.find(item => (item.remaining_paise ?? 0) > 0)?.remaining_paise ?? 0 : basis.balance_paise,
      collection_overdue_paise: agreement ? agreement.state === "needs_review" ? null : agreement.rows.filter(item => item.due_on < today).reduce((total, item) => total + (item.remaining_paise ?? 0), 0)
        : row.due_on < today ? basis.balance_paise : 0,
      payment_plan_state: agreement?.state ?? "none" as const }];
  }));
}
