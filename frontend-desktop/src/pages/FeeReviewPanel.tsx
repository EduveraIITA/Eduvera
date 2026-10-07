import { useState, type FormEvent } from "react";
import { money, save, type Invoice } from "../features/administration";
export interface Review { id: string; invoice_id: string; kind: "payment" | "charge"; amount_paise: number | null; reference: string | null; note: string; status: string; response: string | null }
export function FeeReviewPanel({ schoolId, reviews, invoices, onSaved }: { schoolId: string; reviews: Review[]; invoices: Invoice[]; onSaved: () => Promise<void> }) {
  return <section className="card"><div className="card-h"><b>Payment & fee reviews</b><span className="aside">{reviews.filter(row => row.status === "pending").length} pending</span></div><div style={{ padding: 20 }}><p className="ink2">Check funds against school bank or counter records before issuing a receipt.</p>{reviews.length ? reviews.map(review => <ReviewRow key={review.id} review={review} schoolId={schoolId} reference={invoices.find(row => row.id === review.invoice_id)?.reference ?? "Invoice"} onSaved={onSaved} />) : <p>No review requests yet.</p>}</div></section>;
}
function ReviewRow({ review, schoolId, reference, onSaved }: { review: Review; schoolId: string; reference: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [outcome, setOutcome] = useState(review.kind === "payment" ? "verified" : "answered");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { await save(schoolId, `fees/reviews/${review.id}/decision`, { outcome, response: form.get("response"), verified_funds: form.get("verified") === "on" }); await onSaved(); setOpen(false); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <article style={{ borderTop: "1px solid var(--line)", padding: "16px 0" }}><strong>{reference} · {review.kind === "payment" ? `${money(review.amount_paise ?? 0)} · ${review.reference}` : "Fee question"}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review.note}</p>
    {review.status !== "pending" ? <p>{review.status === "verified" ? "Payment verified" : review.status === "rejected" ? "Payment not verified" : "School responded"} · {review.response}</p> : !open ? <button className="btn" onClick={() => setOpen(true)}>Review request</button> : <form onSubmit={event => void submit(event)} className="col">
      {review.kind === "payment" ? <label className="field"><span className="lbl">Decision</span><select className="input" value={outcome} onChange={event => setOutcome(event.target.value)}><option value="verified">Verify and issue receipt</option><option value="rejected">Cannot verify / duplicate</option></select></label> : <p>A response does not adjust charges or move money.</p>}
      <label className="field"><span className="lbl">Response to family</span><textarea className="input" name="response" required minLength={5} maxLength={1000} /></label>
      {outcome === "verified" ? <label className="check"><input name="verified" type="checkbox" required /> I independently verified funds received. Any cheque has cleared.</label> : null}
      {error ? <p role="alert">{error}</p> : null}<div className="btnrow"><button className="btn" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : outcome === "verified" ? "Verify payment & issue receipt" : "Send response"}</button></div>
    </form>}
  </article>;
}
