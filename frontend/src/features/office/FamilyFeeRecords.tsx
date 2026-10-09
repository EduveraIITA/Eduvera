import { ChevronRight, Printer, Receipt, BookOpen, TriangleAlert, CircleCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { invoiceStatusLabel, rupees, type Invoice, type Payment } from "./api";

export const feeDate = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
export function FeeStatus({ invoice }: { invoice: Invoice }) {
  const status = invoiceStatusLabel(invoice);
  return <span className={`family-fee-status ${status === "Overdue" ? "is-overdue" : invoice.balance_paise === 0 ? "is-settled" : ""}`}>{status}</span>;
}
export function PrintFeeButton({ label = "Print statement" }: { label?: string }) {
  return <button type="button" className="office-secondary family-fee-print" onClick={() => window.print()}><Printer size={17} aria-hidden="true" />{label}</button>;
}
export function FamilyInvoiceList({ invoices, href }: { invoices: Invoice[]; href: (id: string) => string }) {
  return <section className="family-fee-records" aria-label="Invoices">{invoices.length ? <ul>{invoices.map(invoice => <li key={invoice.id}>
    <Link className="family-fee-row" to={href(invoice.id)}>
      <span className={`fee-row-icon ${invoiceStatusLabel(invoice)==="Overdue"?"is-overdue":""}`}>{invoiceStatusLabel(invoice)==="Overdue"?<TriangleAlert size={20}/>:invoice.balance_paise===0?<CircleCheck size={20}/>:<BookOpen size={20}/>}</span><span className="family-fee-copy"><strong>{invoice.description || "School fee"}</strong><span><FeeStatus invoice={invoice} /><small>Due {feeDate(invoice.due_on)}</small></span><small className="family-fee-reference">{invoice.reference}</small></span>
      <span className="family-fee-amount"><strong>{rupees(invoice.balance_paise)}</strong><small>{invoice.balance_paise > 0 ? "Balance" : invoice.collection_state === "credited" ? "Adjusted" : "Settled"}</small></span><ChevronRight size={18} aria-hidden="true" />
    </Link>
  </li>)}</ul> : <p className="office-empty">No invoices have been issued. This does not mean all fees are cleared.</p>}</section>;
}
export function FamilyReceiptList({ payments, invoices, href }: { payments: Payment[]; invoices: Invoice[]; href: (id: string) => string }) {
  return <section className="family-fee-records" aria-label="Receipts">{payments.length ? <ul>{payments.map(payment => <li key={payment.id}><Link className="family-fee-row" to={href(payment.id)}>
    <span className="family-fee-copy"><strong>{invoices.find(invoice => invoice.id === payment.invoice_id)?.description || "Fee payment"}</strong><small>{feeDate(payment.created_at)} · {payment.method.replaceAll("_", " ")}</small><small className="family-fee-reference">{payment.reference}</small></span>
    <span className="family-fee-amount"><strong>{rupees(payment.amount_paise)}</strong><small>View receipt</small></span><ChevronRight size={18} aria-hidden="true" />
  </Link></li>)}</ul> : <p className="office-empty">No receipts recorded.</p>}</section>;
}
export function FamilyReceiptDetail({ payment, invoice, testPayment, pdfUrl }: { payment: Payment; invoice?: Invoice; testPayment: boolean; pdfUrl?:string|undefined }) {
  return <section className="office-panel family-fee-receipt" aria-label="Receipt details">
    <div className="family-fee-detail-heading"><span><Receipt size={22} aria-hidden="true" />{testPayment ? "Test payment receipt" : "Payment receipt"}</span><PrintFeeButton label="Print receipt" /></div>
    {testPayment ? <p className="office-notice">Sandbox payment · No real money collected</p> : null}
    <p className="family-fee-total">{rupees(payment.amount_paise)}</p><p>{invoice?.description || "School fee"}</p>
    <dl className="office-fee-breakdown"><div><dt>Payment reference</dt><dd>{payment.reference}</dd></div><div><dt>Recorded on</dt><dd>{feeDate(payment.created_at)}</dd></div><div><dt>Payment method</dt><dd>{payment.method.replaceAll("_", " ")}</dd></div><div><dt>Invoice reference</dt><dd>{invoice?.reference || "Unavailable"}</dd></div></dl>
    <p className="office-hint">This receipt records the verified payment above.</p>
    {pdfUrl?<a className="office-secondary" href={pdfUrl}>Download PDF receipt</a>:null}
  </section>;
}
