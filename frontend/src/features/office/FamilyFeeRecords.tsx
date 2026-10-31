import { ChevronRight, Printer, TriangleAlert, CircleCheck } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { CollectionView } from "../../components/CollectionView";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { invoiceCollectionDue, invoiceDescription, invoiceStatusLabel, paymentIsActive, rupees, type Invoice, type Payment } from "./api";

export const feeDate = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
export function FeeStatus({ invoice }: { invoice: Invoice }) {
  const status = invoiceStatusLabel(invoice);
  return <span className={`family-fee-status ${status === "Overdue" ? "is-overdue" : invoice.balance_paise === 0 ? "is-settled" : ""}`}>{status}</span>;
}
export function PrintFeeButton({ label = "Print statement" }: { label?: string }) {
  return <button type="button" className="office-secondary family-fee-print" onClick={() => window.print()}><Printer size={17} aria-hidden="true" />{label}</button>;
}
export function FamilyInvoiceList({ invoices, href }: { invoices: Invoice[]; href: (id: string) => string }) {
  return <section className="family-fee-records" aria-label="Invoices"><CollectionView items={invoices} namespace="invoices" label="invoices" searchLabel="Find an invoice" searchPlaceholder="Fee or invoice reference" searchText={(invoice) => `${invoiceDescription(invoice)} ${invoice.reference}`} empty={<p className="office-empty">No invoices have been issued. This does not mean all fees are cleared.</p>}>{(visible) => <ul>{visible.map(invoice => <li key={invoice.id}>
    <Link className="family-fee-row" to={href(invoice.id)}>
      <span className={`fee-row-icon ${invoiceStatusLabel(invoice)==="Overdue"?"is-overdue":""}`}>{invoiceStatusLabel(invoice)==="Overdue"?<TriangleAlert size={20}/>:invoice.balance_paise===0?<CircleCheck size={20}/>:<ProductIcon name="fees" size={28}/>}</span><span className="family-fee-copy"><strong>{invoiceDescription(invoice) || "School fee"}</strong><span><FeeStatus invoice={invoice} />{invoiceCollectionDue(invoice)?<small>{invoice.payment_plan_state==='active'?'Agreed date':'Due'} {feeDate(invoiceCollectionDue(invoice)!)}</small>:null}</span><small className="family-fee-reference">{invoice.reference}</small></span>
      <span className="family-fee-amount"><strong>{rupees(invoice.balance_paise)}</strong><small>{invoice.balance_paise > 0 ? "Balance" : invoice.collection_state === "credited" ? "Adjusted" : "Settled"}</small></span><ChevronRight size={18} aria-hidden="true" />
    </Link>
  </li>)}</ul>}</CollectionView></section>;
}
export function FamilyReceiptList({ payments, invoices, href }: { payments: Payment[]; invoices: Invoice[]; href: (id: string) => string }) {
  return <section className="family-fee-records" aria-label="Receipts"><CollectionView items={payments} namespace="receipts" label="receipts" searchLabel="Find a receipt" searchPlaceholder="Payment or invoice reference" searchText={(payment) => `${payment.reference} ${invoices.find((invoice) => invoice.id === payment.invoice_id)?.reference ?? payment.invoice_reference ?? ""} ${payment.method.replaceAll("_", " ")}`} empty={<p className="office-empty">No receipts recorded.</p>}>{(visible) => <ul>{visible.map(payment => <li key={payment.id}><Link className="family-fee-row" to={href(payment.id)}>
    <span className="family-fee-copy"><strong>{invoices.find(invoice => invoice.id === payment.invoice_id)?.effective_description ?? invoices.find(invoice => invoice.id === payment.invoice_id)?.description ?? payment.invoice_description ?? "Fee payment"}</strong><small>{feeDate(payment.created_at)} · {payment.method.replaceAll("_", " ")}{payment.status && payment.status !== "active" ? ` · ${payment.status === "replaced" ? "Replaced" : "Reversed"}` : ""}</small><small className="family-fee-reference">{payment.reference}</small></span>
    <span className="family-fee-amount"><strong>{rupees(payment.amount_paise)}</strong><small>View receipt</small></span><ChevronRight size={18} aria-hidden="true" />
  </Link></li>)}</ul>}</CollectionView></section>;
}
export function PaymentCorrectionNotice({ payment, receiptHref }: { payment: Payment; receiptHref?: (id: string) => string | undefined }) {
  const replacement = payment.replacement_payment_id ? receiptHref?.(payment.replacement_payment_id) : undefined, original = payment.replaces_payment_id ? receiptHref?.(payment.replaces_payment_id) : undefined;
  return <>{payment.status && payment.status !== "active" ? <div className="fee-receipt-correction-status"><p><strong>{payment.status === "replaced" ? "Receipt replaced" : "Receipt reversed"}</strong> — not included in payments received.</p>{payment.correction_reason ? <p>{payment.correction_reason}</p> : null}{payment.corrected_at ? <small>{payment.corrected_by_label ? `${payment.corrected_by_label} · ` : "Corrected "}{feeDate(payment.corrected_at)}</small> : null}{replacement ? <Link to={replacement}>View replacement receipt</Link> : null}</div> : null}{payment.replaces_payment_id ? <p className="office-hint">This is a replacement receipt.{original ? <> <Link to={original}>View original receipt</Link></> : null}</p> : null}</>;
}
export function FamilyReceiptDetail({ payment, invoice, testPayment = false, pdfUrl, receiptHref, headerActions }: { payment: Payment; invoice?: Pick<Invoice, "description" | "reference" | "effective_description">; testPayment?: boolean; pdfUrl?:string|undefined; receiptHref?: (id: string) => string | undefined; headerActions?: ReactNode }) {
  return <section className="office-panel family-fee-receipt" aria-label="Receipt details">
    <div className="family-fee-detail-heading"><span><ProductIcon name="records" size={28} />{testPayment ? "Test payment receipt" : "Payment receipt"}</span><div className="family-fee-detail-actions">{headerActions}<PrintFeeButton label="Print receipt" /></div></div>
    {testPayment ? <p className="office-notice">Sandbox payment · No real money collected</p> : null}
    <PaymentCorrectionNotice payment={payment} receiptHref={receiptHref} />
    <p className="family-fee-total">{rupees(payment.amount_paise)}</p><p>{invoice ? invoiceDescription(invoice) : "School fee"}</p>
    <dl className="office-fee-breakdown"><div><dt>Payment reference</dt><dd>{payment.reference}</dd></div><div><dt>Recorded on</dt><dd>{feeDate(payment.created_at)}</dd></div><div><dt>Payment method</dt><dd>{payment.method.replaceAll("_", " ")}</dd></div><div><dt>Invoice reference</dt><dd>{invoice?.reference || "Unavailable"}</dd></div></dl>
    <p className="office-hint">{paymentIsActive(payment) ? "This receipt records the verified payment above." : "This original receipt is retained for correction history."}</p>
    {pdfUrl?<a className="office-secondary" href={pdfUrl}>Download PDF receipt</a>:null}
  </section>;
}
