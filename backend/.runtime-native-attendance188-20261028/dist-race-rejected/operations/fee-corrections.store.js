import { BadRequestException, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
export async function effectiveFeeInvoice(db, schoolId, invoiceId, lock = false, ordinary = false) {
    if (lock)
        await sql `SELECT id FROM fee_invoices WHERE school_id=${schoolId}::uuid AND id=${invoiceId}::uuid FOR UPDATE`.execute(db);
    if (ordinary && (await sql `SELECT 1 FROM campus_event_participants WHERE school_id=${schoolId}::uuid AND fee_invoice_id=${invoiceId}::uuid`.execute(db)).rows.length)
        throw new BadRequestException("This event charge must be corrected through its event reconciliation.");
    const row = (await sql `SELECT i.id,i.school_id,i.student_id,coalesce(i.person_id,s.person_id) AS person_id,
    trim(concat_ws(' ',p.first_name,p.last_name)) AS name,i.reference,i.amount_paise,i.description,i.due_on::text,
    i.original_amount_paise,i.original_description,i.original_due_on::text,i.charge_state,i.correction_revision,
    coalesce((SELECT sum(amount_paise) FROM fee_effective_payments WHERE school_id=i.school_id AND invoice_id=i.id),0)::bigint AS paid_paise,
    coalesce((SELECT sum(amount_paise) FROM fee_invoice_credits WHERE school_id=i.school_id AND invoice_id=i.id),0)::bigint AS credited_paise,
    coalesce((SELECT sum(amount_paise) FROM fee_refunds WHERE school_id=i.school_id AND invoice_id=i.id),0)::bigint AS refunded_paise,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.correction_id,'revision',c.revision,'amount_paise',c.amount_paise,'description',c.description,'due_on',c.due_on::text,'charge_state',c.charge_state) ORDER BY c.revision)
      FROM fee_invoice_correction_items c WHERE c.school_id=i.school_id AND c.invoice_id=i.id),'[]'::jsonb) AS amendments,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'payment_id',c.payment_id,'replacement_payment_id',c.replacement_payment_id) ORDER BY c.id)
      FROM fee_payment_corrections c WHERE c.school_id=i.school_id AND c.invoice_id=i.id),'[]'::jsonb) AS reversals,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',pay.id,'amount_paise',pay.amount_paise) ORDER BY pay.id)
      FROM fee_payments pay WHERE pay.school_id=i.school_id AND pay.invoice_id=i.id),'[]'::jsonb) AS payments
    FROM fee_effective_invoices i LEFT JOIN students s ON s.school_id=i.school_id AND s.id=i.student_id
    JOIN school_people p ON p.school_id=i.school_id AND p.id=coalesce(i.person_id,s.person_id)
    WHERE i.school_id=${schoolId}::uuid AND i.id=${invoiceId}::uuid`.execute(db)).rows[0];
    if (!row)
        throw new NotFoundException("This fee invoice is unavailable.");
    return { ...row, paid_paise: Number(row.paid_paise), credited_paise: Number(row.credited_paise), refunded_paise: Number(row.refunded_paise) };
}
export function correctedChargeState(invoice, values, paid) {
    const amount = values?.amount_paise ?? invoice.amount_paise, netPaid = paid ?? Math.max(0, invoice.paid_paise - invoice.refunded_paise);
    const adjusted = Math.max(0, amount - invoice.credited_paise);
    return { amount_paise: amount, description: values?.description ?? invoice.description, due_on: values?.due_on ?? invoice.due_on,
        charge_state: amount === 0 ? "cancelled" : "active", paid_paise: netPaid, balance_paise: Math.max(0, adjusted - netPaid), credit_paise: Math.max(0, netPaid - adjusted) };
}
export async function invoiceCorrectionHistory(db, schoolId, invoiceId) {
    return (await sql `SELECT h.id,i.revision,h.reason,h.created_at,h.created_by,h.actor_person_id,h.actor_name,h.actor_name AS created_by_label,i.amount_paise,i.description,i.due_on::text,i.charge_state
    FROM fee_invoice_correction_items i JOIN fee_invoice_corrections h ON h.school_id=i.school_id AND h.id=i.correction_id
    WHERE i.school_id=${schoolId}::uuid AND i.invoice_id=${invoiceId}::uuid ORDER BY i.revision`.execute(db)).rows;
}
//# sourceMappingURL=fee-corrections.store.js.map