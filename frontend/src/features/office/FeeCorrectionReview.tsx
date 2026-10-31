import { useState } from "react";
import { rupees } from "./api";
import type { ChargeCorrectionQuote, CorrectedChargeState, PaymentCorrectionPreviewInput, PaymentCorrectionQuote } from "./feeCorrectionsApi";

function Changes({ before, after }: { before: CorrectedChargeState; after: CorrectedChargeState }) {
  return <dl className="person-fee-facts fee-correction-comparison"><div><dt>Charge</dt><dd>{rupees(before.amount_paise)} → {rupees(after.amount_paise)}</dd></div>
    {before.description !== after.description ? <div><dt>Description</dt><dd>{before.description} → {after.description}</dd></div> : null}
    {before.due_on !== after.due_on ? <div><dt>Due date</dt><dd>{before.due_on} → {after.due_on}</dd></div> : null}
    {before.paid_paise !== after.paid_paise ? <div><dt>Payments received</dt><dd>{rupees(before.paid_paise)} → {rupees(after.paid_paise)}</dd></div> : null}
    <div><dt>Outstanding</dt><dd>{rupees(before.balance_paise)} → {rupees(after.balance_paise)}</dd></div>{before.credit_paise > 0 || after.credit_paise > 0 ? <div><dt>Credit</dt><dd>{rupees(before.credit_paise)} → {rupees(after.credit_paise)}</dd></div> : null}
    {after.charge_state === "cancelled" ? <div><dt>Charge status</dt><dd>Cancelled</dd></div> : null}</dl>;
}
export function ChargeCorrectionReview({ quote }: { quote: ChargeCorrectionQuote }) {
  const [page, setPage] = useState(1), pages = Math.ceil(quote.items.length / 10);
  return <section className="fee-correction-review" aria-label="Correction preview">
    <h3>{quote.items.length} {quote.items.length === 1 ? "charge" : "charges"} · {quote.person_count} {quote.person_count === 1 ? "person" : "people"}</h3>
    <dl className="person-fee-facts fee-correction-comparison"><div><dt>Charge total</dt><dd>{rupees(quote.before_total_amount_paise)} → {rupees(quote.after_total_amount_paise)}</dd></div><div><dt>Outstanding</dt><dd>{rupees(quote.before_balance_paise)} → {rupees(quote.after_balance_paise)}</dd></div>{quote.credit_paise > 0 || quote.items.some(item => item.before.credit_paise > 0) ? <div><dt>Credit after correction</dt><dd>{rupees(quote.credit_paise)}</dd></div> : null}</dl>
    <details open={quote.items.length === 1}><summary>Changes by person · {quote.items.length}</summary><div className="fee-correction-item-list">{quote.items.slice((page - 1) * 10, page * 10).map(item => <article key={item.invoice_id}><h3>{item.name}</h3><p className="person-fee-caption">{item.reference}</p><Changes before={item.before} after={item.after} /></article>)}</div>
      {pages > 1 ? <nav className="fee-beneficiary-pages" aria-label="Correction preview pages"><button type="button" className="is-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className="is-secondary" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button></nav> : null}
    </details>
    <p className="person-fee-caption">Original charges and references stay in history. A credit does not send money back.</p>
  </section>;
}
export function PaymentCorrectionReview({ quote, input }: { quote: PaymentCorrectionQuote; input: PaymentCorrectionPreviewInput }) {
  return <section className="fee-correction-review" aria-label="Receipt correction preview"><h3>{input.action === "replace" ? "Reverse and replace receipt" : "Reverse receipt"}</h3>
    <p>{rupees(quote.amount_paise)} · {quote.method.replaceAll("_", " ")} · {quote.reference}</p>
    {input.action === "replace" ? <section><h3>Replacement</h3><p>{rupees(input.replacement.amount_paise)} · {input.replacement.method.replaceAll("_", " ")} · {input.replacement.reference}</p></section> : null}
    <Changes before={quote.before} after={quote.after} /><p className="person-fee-caption">The original receipt stays in history. No refund or transfer is made.</p>
  </section>;
}
