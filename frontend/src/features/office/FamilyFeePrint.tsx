import { createPortal } from "react-dom";
import type { ApiStudent } from "../school/api";
import { invoiceStatusLabel, rupees, type FeeLedger, type Invoice, type Payment } from "./api";
import { feeDate } from "./FamilyFeeRecords";
import { reviewLabels } from "./FeeReviewHistory";

export function FamilyFeePrint({ schoolName, student, ledger, view, invoice, payment }: {
  schoolName: string; student?: ApiStudent; ledger: FeeLedger; view: string; invoice?: Invoice; payment?: Payment;
}) {
  const invoices = invoice ? [invoice] : ledger.invoices;
  const payments = payment ? [payment] : ledger.payments;
  const receiptView = Boolean(payment) || view === "receipts";
  const testPayment = (item: Payment) => item.method === "razorpay_test" || ledger.gateway_payments?.some(gateway => gateway.payment_id === item.id);
  return createPortal(<article className="family-fee-print-document" aria-hidden="true">
    <header><strong>{schoolName}</strong><h1>{payment ? "Payment receipt" : invoice ? "Fee invoice" : view === "reviews" ? "Fee reviews" : receiptView ? "Receipt register" : "Fee statement"}</h1>
      <p>{student?.user.display_name} · {student?.admission_number} · Class {student?.current_enrollment.grade}{student?.current_enrollment.section}</p>
      <p>Issued from Eduera · {feeDate(new Date().toISOString())} · INR</p>
    </header>
    {receiptView ? <>{payments.length ? payments.map(item => <section key={item.id}>
      <h2>{rupees(item.amount_paise)}</h2>{testPayment(item) ? <p><strong>TEST RECEIPT — Sandbox only. No real money collected.</strong></p> : null}
      <dl><dt>Payment reference</dt><dd>{item.reference}</dd><dt>Invoice</dt><dd>{ledger.invoices.find(record => record.id === item.invoice_id)?.reference || "Unavailable"}</dd><dt>Fee</dt><dd>{ledger.invoices.find(record => record.id === item.invoice_id)?.description}</dd><dt>Recorded on</dt><dd>{feeDate(item.created_at)}</dd><dt>Method</dt><dd>{item.method.replaceAll("_", " ")}</dd></dl>
    </section>) : <p>No verified payments available.</p>}<p>Only verified payments appear in this receipt register.</p></> : view === "reviews" && !invoice ? <>{ledger.reviews?.length ? ledger.reviews.map(review => <section key={review.id}><h2>{ledger.invoices.find(item => item.id === review.invoice_id)?.description || "Fee review"}</h2><p>{reviewLabels[review.status]} · {feeDate(review.created_at)}</p><p>{review.reference}</p><p>{review.note}</p><p>{review.response}</p></section>) : <p>No reviews to print.</p>}<p>Review submissions are not payment receipts.</p></> : <>
      <table><thead><tr><th>Fee / reference</th><th>Due / status</th><th>After credits</th><th>Received</th><th>Balance</th><th>Refund due</th></tr></thead><tbody>{invoices.map(item => <tr key={item.id}><td>{item.description}<small>{item.reference}</small></td><td>{feeDate(item.due_on)}<small>{invoiceStatusLabel(item)}</small></td><td>{rupees(item.adjusted_amount_paise)}</td><td>{rupees(item.paid_paise)}</td><td>{rupees(item.balance_paise)}</td><td>{rupees(item.refund_due_paise)}</td></tr>)}</tbody></table>
      <p><strong>Total outstanding: {rupees(invoices.reduce((sum, item) => sum + item.balance_paise, 0))}</strong></p><p>This statement is not a payment receipt.</p>
    </>}
  </article>, document.body);
}
