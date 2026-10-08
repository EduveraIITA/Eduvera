import { useRef, useState, type FormEvent } from "react";
import { decideFeeReview, personName, rupees, type FeeReview, type Invoice } from "./api";
export function FeeReviewQueue({ schoolId, reviews, invoices, onSaved }: { schoolId: string; reviews: FeeReview[]; invoices: Invoice[]; onSaved: () => Promise<unknown> }) {
  const pending = reviews.filter(item => item.status === "pending");
  if (!pending.length) return <p className="workspace-context">No payments or fee questions awaiting review.</p>;
  return <section className="office-panel"><h2>Review queue <span>{pending.length}</span></h2><p className="office-hint">Verify against the school’s bank statement or counter records. A parent submission is not proof of funds.</p>{pending.length ? pending.map(review => <ReviewItem key={review.id} schoolId={schoolId} review={review} invoice={invoices.find(item => item.id === review.invoice_id)} onSaved={onSaved} />) : <p className="office-empty">No payments or fee questions awaiting review.</p>}</section>;
}
function ReviewItem({ schoolId, review, invoice, onSaved }: { schoolId: string; review: FeeReview; invoice?: Invoice; onSaved: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false); const [outcome, setOutcome] = useState(review.kind === "payment" ? "verified" : "answered");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await decideFeeReview(schoolId, review.id, { outcome, response: form.get("response"), verified_funds: form.get("verified") === "on" }); await onSaved(); setOpen(false); }
    catch (cause) { setError((cause as Error).message); } finally { inFlight.current = false; setBusy(false); }
  }
  return <article className="office-fee-detail"><div className="office-invoice-top"><strong>{invoice?.reference ?? "Invoice"} · {invoice ? personName(invoice) : ""}</strong><span className="office-status">{review.kind === "payment" ? "Payment claim" : "Fee question"}</span></div>
    {review.kind === "payment" ? <p><strong>{rupees(review.amount_paise ?? 0)}</strong> · {review.method?.replaceAll("_", " ")} · {review.reference}</p> : null}
    <p className="office-review-note">{review.note}</p><small>Submitted {new Date(review.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</small>
    {!open ? <button className="office-secondary" type="button" onClick={() => setOpen(true)}>Review request</button> : <form className="office-form" onSubmit={event => void submit(event)}>
      {review.kind === "payment" ? <label className="office-field">Decision<select value={outcome} onChange={event => setOutcome(event.target.value)}><option value="verified">Verify and issue receipt</option><option value="rejected">Cannot verify / duplicate</option></select></label> : <p className="office-hint">Answer after checking the ledger. A response does not adjust fees or move money. Event credits and refunds use event reconciliation.</p>}
      <label className="office-field">Response to the family<textarea name="response" required minLength={5} maxLength={1000} /></label>
      {outcome === "verified" ? <label className="office-check"><input name="verified" type="checkbox" required /> I independently verified receipt of these funds. Any cheque has cleared.</label> : null}
      {error ? <p role="alert" className="office-alert">{error}</p> : null}
      <div className="office-actions"><button type="button" className="office-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="office-primary" disabled={busy}>{busy ? "Saving…" : outcome === "verified" ? "Verify payment & issue receipt" : "Send response"}</button></div>
    </form>}
  </article>;
}
