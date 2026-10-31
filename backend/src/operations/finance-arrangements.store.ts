import { createHash } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import type { FinanceInvoice, FinanceLedgerBasis, FinanceInstalmentRequest, Instalment } from "./finance-arrangements.contracts.js";
import { effectiveFeeInvoice } from "./fee-corrections.store.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const financeHash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const financeObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function arrangementInvoice(db: Transaction<Database>, schoolId: string, invoiceId: string, lock = false) {
  if (lock) await sql`SELECT id FROM fee_invoices WHERE school_id=${schoolId}::uuid AND id=${invoiceId}::uuid FOR UPDATE`.execute(db);
  const invoice = (await sql<FinanceInvoice>`SELECT invoice.id,invoice.school_id,invoice.student_id,coalesce(invoice.person_id,student.person_id) AS person_id,
    CASE WHEN invoice.person_id IS NULL THEN 'student' ELSE 'person' END AS context_kind,
    CASE WHEN invoice.person_id IS NULL THEN student.user_id ELSE person.account_user_id END AS user_id,
    trim(concat_ws(' ',person.first_name,person.last_name)) AS student_label,invoice.reference,invoice.description,invoice.due_on::text,invoice.amount_paise,invoice.created_at,
    invoice.original_due_on::text,invoice.original_amount_paise
    FROM fee_effective_invoices invoice LEFT JOIN students student ON student.id=invoice.student_id AND student.school_id=invoice.school_id
    JOIN school_people person ON person.id=coalesce(invoice.person_id,student.person_id) AND person.school_id=invoice.school_id
    WHERE invoice.school_id=${schoolId}::uuid AND invoice.id=${invoiceId}::uuid`.execute(db)).rows[0];
  if (!invoice) throw new NotFoundException("This fee account is unavailable.");
  return invoice;
}
export async function arrangementRevision(db: Transaction<Database>, schoolId: string, invoiceId: string) {
  return (await sql<{ revision: number }>`SELECT coalesce(max(stream_revision),0)::int AS revision FROM (
    SELECT stream_revision FROM fee_instalment_requests WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    UNION ALL SELECT stream_revision FROM fee_instalment_decisions WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    UNION ALL SELECT stream_revision FROM fee_instalment_withdrawals WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    UNION ALL SELECT stream_revision FROM fee_invoice_self_payer_entitlements WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    UNION ALL SELECT stream_revision FROM fee_invoice_self_payer_revocations WHERE school_id=${schoolId}::uuid AND invoice_id=${invoiceId}::uuid
    ) revision`.execute(db)).rows[0]!.revision;
}
export async function arrangementBasis(db: Transaction<Database>, invoice: FinanceInvoice): Promise<FinanceLedgerBasis> {
  const entries = (await sql<{ credits: FinanceLedgerBasis["credits"]; payments: FinanceLedgerBasis["payments"]; refunds: FinanceLedgerBasis["refunds"] }>`SELECT
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'amount_paise',amount_paise) ORDER BY id) FROM fee_invoice_credits WHERE school_id=${invoice.school_id}::uuid AND invoice_id=${invoice.id}::uuid),'[]'::jsonb) AS credits,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'amount_paise',amount_paise) ORDER BY id) FROM fee_effective_payments WHERE school_id=${invoice.school_id}::uuid AND invoice_id=${invoice.id}::uuid),'[]'::jsonb) AS payments,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'amount_paise',amount_paise) ORDER BY id) FROM fee_refunds WHERE school_id=${invoice.school_id}::uuid AND invoice_id=${invoice.id}::uuid),'[]'::jsonb) AS refunds`.execute(db)).rows[0]!;
  const total = (rows: Array<{ amount_paise: number }>) => rows.reduce((sum, row) => sum + row.amount_paise, 0);
  const credited = total(entries.credits), paid = total(entries.payments), refunded = total(entries.refunds);
  const state = await effectiveFeeInvoice(db, invoice.school_id, invoice.id), corrected = state.amendments.length + state.reversals.length > 0;
  return { invoice_id: invoice.id, ...(invoice.student_id ? { student_id: invoice.student_id } : { context_kind: "person" as const, person_id: invoice.person_id, basis_version: 2 as const }),
    ...(corrected ? { basis_version: 3 as const, amendments: state.amendments, reversals: state.reversals, recorded_payment_count: state.payments.length } : {}), amount_paise: invoice.amount_paise,
    credited_paise: credited, paid_paise: paid, refunded_paise: refunded,
    balance_paise: Math.max(0, Math.max(0, invoice.amount_paise - credited) - Math.max(0, paid - refunded)), ...entries };
}
export const financeBasisRevision = (basis: FinanceLedgerBasis) => basis.credits.length + (basis.recorded_payment_count ?? basis.payments.length) + basis.refunds.length
  + (basis.amendments?.length ?? 0) + (basis.reversals?.length ?? 0);
export interface ArrangementHistory extends FinanceInstalmentRequest {
  status: "pending" | "approved" | "rejected" | "withdrawn"; decision_response: string | null; decision_at: Date | string | null;
  decision_revision: number | null; withdrawn_at: Date | string | null;
}
export async function arrangementHistory(db: Transaction<Database>, schoolId: string, invoiceId: string) {
  return (await sql<ArrangementHistory>`SELECT request.*,coalesce(decision.decision,CASE WHEN withdrawal.id IS NOT NULL THEN 'withdrawn' ELSE 'pending' END) AS status,
    decision.response AS decision_response,decision.created_at AS decision_at,decision.stream_revision AS decision_revision,withdrawal.created_at AS withdrawn_at
    FROM fee_instalment_requests request LEFT JOIN fee_instalment_decisions decision ON decision.school_id=request.school_id AND decision.request_id=request.id
    LEFT JOIN fee_instalment_withdrawals withdrawal ON withdrawal.school_id=request.school_id AND withdrawal.request_id=request.id
    WHERE request.school_id=${schoolId}::uuid AND request.invoice_id=${invoiceId}::uuid ORDER BY request.stream_revision DESC`.execute(db)).rows;
}
export async function arrangementSource(db: Transaction<Database>, schoolId: string, requestId: string) {
  const source = (await sql<FinanceInstalmentRequest>`SELECT * FROM fee_instalment_requests WHERE school_id=${schoolId}::uuid AND id=${requestId}::uuid`.execute(db)).rows[0];
  if (!source) throw new NotFoundException("This instalment request is unavailable.");
  return source;
}
/** Allocation is a view of already-posted money, never a new ledger entry. */
export function agreedSchedule(request: { schedule: Instalment[]; ledger_basis: FinanceLedgerBasis }, current: FinanceLedgerBasis) {
  const basis = request.ledger_basis;
  const needsReview = basis.amount_paise !== current.amount_paise || financeHash(basis.credits) !== financeHash(current.credits)
    || financeHash(basis.amendments ?? []) !== financeHash(current.amendments ?? []) || financeHash(basis.reversals ?? []) !== financeHash(current.reversals ?? [])
    || financeHash(basis.refunds) !== financeHash(current.refunds)
    || basis.payments.some(payment => !current.payments.some(actual => actual.id === payment.id && actual.amount_paise === payment.amount_paise));
  if (needsReview) return { state: "needs_review" as const, rows: request.schedule.map(row => ({ ...row, allocated_paise: null, remaining_paise: null })), next_due_on: null };
  let received = Math.max(0, current.paid_paise - basis.paid_paise);
  const rows = request.schedule.map(row => {
    const allocated = Math.min(received, row.amount_paise); received -= allocated;
    return { ...row, allocated_paise: allocated, remaining_paise: row.amount_paise - allocated };
  });
  return { state: rows.every(row => !row.remaining_paise) ? "satisfied" as const : "active" as const, rows, next_due_on: rows.find(row => row.remaining_paise > 0)?.due_on ?? null };
}

/** Minimal ledger-list projection. No private request reason or correspondence
 * crosses this boundary. Original invoice fields remain immutable. */
export async function collectionDateProjection(db: Transaction<Database>, schoolId: string, invoiceId: string) {
  const invoice = await arrangementInvoice(db, schoolId, invoiceId), basis = await arrangementBasis(db, invoice);
  const today = (await sql<{ today: string }>`SELECT (${executionNow()}::timestamptz AT TIME ZONE timezone)::date::text AS today FROM schools WHERE id=${schoolId}::uuid`.execute(db)).rows[0]!.today;
  const approved = (await sql<{ schedule: Instalment[]; ledger_basis: FinanceLedgerBasis }>`SELECT request.schedule,request.ledger_basis FROM fee_instalment_requests request
    JOIN fee_instalment_decisions decision ON decision.school_id=request.school_id AND decision.request_id=request.id AND decision.decision='approved'
    WHERE request.school_id=${schoolId}::uuid AND request.invoice_id=${invoiceId}::uuid ORDER BY decision.stream_revision DESC LIMIT 1`.execute(db)).rows[0];
  if (!approved) return { original_due_on: invoice.original_due_on ?? invoice.due_on, collection_due_on: invoice.due_on, collection_due_amount_paise: basis.balance_paise,
    collection_overdue_paise: invoice.due_on < today ? basis.balance_paise : 0, collection_today: today, payment_plan_state: "none" as const };
  const schedule = agreedSchedule(approved, basis);
  return { original_due_on: invoice.original_due_on ?? invoice.due_on, collection_due_on: schedule.next_due_on,
    collection_due_amount_paise: schedule.state === "needs_review" ? null : schedule.rows.find(row => (row.remaining_paise ?? 0) > 0)?.remaining_paise ?? 0,
    collection_overdue_paise: schedule.state === "needs_review" ? null : schedule.rows.filter(row => row.due_on < today).reduce((sum, row) => sum + (row.remaining_paise ?? 0), 0), collection_today: today,
    payment_plan_state: schedule.state };
}
