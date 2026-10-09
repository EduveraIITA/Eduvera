import { useState } from "react";
import { BadgeCheck, CheckCircle2, Copy, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { invoiceStatusLabel, rupees, type Invoice, type Payment } from "./api";
import { feeDate, PrintFeeButton } from "./FamilyFeeRecords";
export function FamilyInvoiceStatement({ invoice, payments, year, receiptHref, onSync, syncing }: { invoice: Invoice; payments: Payment[]; year?: string; receiptHref: (id: string) => string; onSync: () => Promise<unknown>; syncing: boolean }) {
  const [message, setMessage] = useState("");
  async function copy() { try { await navigator.clipboard.writeText(invoice.reference); setMessage("Reference copied"); } catch { setMessage("Copy unavailable. Select the reference above to copy it."); } }
  const credits = invoice.amount_paise - invoice.adjusted_amount_paise;
  const settled = invoice.balance_paise === 0 && invoice.refund_due_paise === 0;
  return <div className="fee-statement">
    <div className="family-fee-detail-heading"><div><p className="fee-eyebrow">{year ? `Academic year ${year}` : "Fee statement"}</p><h2>{invoice.description || "School fee"}</h2></div><PrintFeeButton label="Print invoice" /></div>
    <div className="fee-statement-meta"><span>{invoice.reference}</span><button type="button" aria-label="Copy invoice reference" onClick={() => void copy()}><Copy size={15}/></button><span>Due {feeDate(invoice.due_on)}</span></div>{message ? <p role="status" className="office-hint">{message}</p> : null}
    <div className="fee-breakdown-label"><span>Fee breakdown</span><span>Amount (INR)</span></div>
    <dl className="fee-statement-lines"><div><dt>Original charge<small>Issued academic fee</small></dt><dd>{rupees(invoice.amount_paise)}</dd></div><div><dt>Credits & waivers<small>Adjustments applied by school</small></dt><dd>{credits > 0 ? "−" : ""}{rupees(credits)}</dd></div></dl>
    {payments.map(payment => <Link className="fee-statement-payment" key={payment.id} to={receiptHref(payment.id)}><CheckCircle2 size={18}/><span>Paid via {payment.method.replaceAll("_", " ")}<small>Receipt · {payment.reference}</small></span><strong>−{rupees(payment.amount_paise)}</strong></Link>)}
    <div className="fee-statement-balance"><div><strong>Outstanding balance</strong>{settled ? <small><CheckCircle2 size={14}/>No balance outstanding</small> : null}</div><strong>{rupees(invoice.balance_paise)}</strong></div>
    {invoice.refund_due_paise > 0 ? <p>Refund due: {rupees(invoice.refund_due_paise)}</p> : null}
    <div className="fee-settlement"><BadgeCheck size={19}/><span>{invoiceStatusLabel(invoice)}{settled ? " · Recorded in school ledger" : " · School ledger"}</span><button type="button" disabled={syncing} onClick={async () => { try { const result = await onSync() as { isError?: boolean }; setMessage(result?.isError ? "Could not refresh. Please retry." : "Statement is up to date"); } catch { setMessage("Could not refresh. Please retry."); } }}><RefreshCw size={15}/>{syncing ? "Syncing…" : "Sync"}</button></div>
  </div>;
}
