import { ArrowRight, HelpCircle, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { invoiceCollectionDue, invoiceStatusLabel, paymentIsActive, rupees, type FeeLedger } from "./api";
import { PrintFeeButton, feeDate } from "./FamilyFeeRecords";
export type FeeFilter = "all" | "unpaid" | "overdue" | "settled";
export function FamilyFeeOverview({ ledger, year, canPay, payHref }: { ledger: FeeLedger; year?: string; canPay: boolean; payHref: string }) {
  const unpaid = ledger.invoices.filter(item => item.balance_paise > 0);
  const total = ledger.totals?.outstanding ?? unpaid.reduce((sum, item) => sum + item.balance_paise, 0);
  const needsReview = unpaid.some(item => item.payment_plan_state === "needs_review");
  const overdue = unpaid.filter(item => invoiceStatusLabel(item) === "Overdue").reduce((sum, item) => sum + (item.collection_overdue_paise ?? item.balance_paise), 0);
  const nextDue = unpaid.map(invoiceCollectionDue).filter((value): value is string => Boolean(value)).sort()[0];
  const pendingCount = ledger.totals?.open ?? unpaid.length;
  return <section className="fee-overview-card" aria-label="Fee overview"><div className="fee-overview-top"><div><p className="fee-eyebrow">Total outstanding</p><strong className="fee-overview-total">{rupees(total)}</strong></div><PrintFeeButton label={ledger.pagination ? "Print this page" : "Statement"} /></div>
    <p className="fee-overview-caption">{pendingCount} {pendingCount === 1 ? "invoice" : "invoices"} pending{nextDue ? ` · ${ledger.pagination ? "Shown due" : "Due"} ${feeDate(nextDue)}` : ""}</p>
    <div className="fee-overview-stats"><div><span>Paid to date</span><strong>{rupees(ledger.totals?.received ?? ledger.payments.filter(paymentIsActive).reduce((sum, item) => sum + item.amount_paise, 0))}</strong></div><div><span>{ledger.pagination ? "Overdue in this page" : needsReview ? "Known overdue" : "Overdue"}</span><strong className={overdue ? "fee-overdue-amount" : ""}>{rupees(overdue)}</strong></div></div>
    {needsReview ? <p className="fee-overview-caption">Some agreed dates need Finance review; their overdue amount is not confirmed.</p> : null}
    {canPay && total > 0 ? <Link className="fee-balance-action" to={payHref}>Pay balance ({rupees(total)})<ArrowRight size={18} /></Link> : null}
    {year ? <small className="fee-year-note">Academic year {year} · Balances across issued invoices</small> : null}
  </section>;
}
export function FamilyFeeFilter({ value, onChange }: { value: FeeFilter; onChange: (value: FeeFilter) => void }) {
  return <label className="fee-filter"><SlidersHorizontal size={16} aria-hidden="true"/><span className="sr-only">Filter invoices</span><select aria-label="Filter invoices" value={value} onChange={event => onChange(event.target.value as FeeFilter)}><option value="all">All invoices</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="settled">Settled / credited</option></select></label>;
}
export function FeeHelp({ href }: { href: string }) {
  return <aside className="fee-help"><HelpCircle size={22} aria-hidden="true"/><div><strong>Questions about fees?</strong><small>Select an invoice to contact your school</small></div><Link to={href}>Enquire<ArrowRight size={16} /></Link></aside>;
}
