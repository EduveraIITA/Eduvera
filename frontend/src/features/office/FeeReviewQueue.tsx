import { useEffect, useRef, useState, type FormEvent } from "react";
import { decideFeeReview, personName, rupees, type FeeReview, type Invoice } from "./api";
import { CollectionView } from "../../components/CollectionView";
type ReviewDraft = { open: boolean; outcome: string; response: string };
export function FeeReviewQueue({ schoolId, reviews, invoices, onSaved, focusReviewId = null }: { schoolId: string; reviews: FeeReview[]; invoices: Invoice[]; onSaved: () => Promise<unknown>; focusReviewId?: string | null }) {
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [busyCount, setBusyCount] = useState(0);
  const pending = reviews.filter(item => item.status === "pending");
  if (!pending.length) return <p className="workspace-context">No payments or fee questions awaiting review.</p>;
  return <section className="office-panel"><h2>Review queue <span>{pending.length}</span></h2><p className="office-hint">Verify against the school’s bank statement or counter records. A parent submission is not proof of funds.</p><CollectionView items={pending} namespace="fee_reviews" label="reviews" searchLabel="Find a review" searchPlaceholder="Invoice, person, payment reference or note" searchText={(review) => { const invoice = invoices.find((item) => item.id === review.invoice_id); return `${invoice?.reference ?? ""} ${invoice ? personName(invoice) : ""} ${review.reference ?? ""} ${review.note}`; }} categoryLabel="Review type" categories={[
    { value: "payment", label: "Payment claims", matches: (review) => review.kind === "payment" },
    { value: "charge", label: "Fee questions", matches: (review) => review.kind === "charge" },
  ]} focusedId={focusReviewId} disabled={busyCount > 0}>{(visible) => visible.map(review => <ReviewItem key={review.id} schoolId={schoolId} review={review} invoice={invoices.find(item => item.id === review.invoice_id)} onSaved={onSaved} focused={review.id === focusReviewId} draft={drafts[review.id] ?? { open: false, outcome: review.kind === "payment" ? "verified" : "answered", response: "" }} onDraftChange={(draft) => setDrafts((current) => ({ ...current, [review.id]: draft }))} onBusyChange={(saving) => setBusyCount((count) => Math.max(0, count + (saving ? 1 : -1)))} />)}</CollectionView></section>;
}
function ReviewItem({ schoolId, review, invoice, onSaved, focused, draft, onDraftChange, onBusyChange }: { schoolId: string; review: FeeReview; invoice?: Invoice; onSaved: () => Promise<unknown>; focused: boolean; draft: ReviewDraft; onDraftChange: (draft: ReviewDraft) => void; onBusyChange: (busy: boolean) => void }) {
  const { outcome } = draft;
  const expanded = draft.open || focused;
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const inFlight = useRef(false);
  const itemRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focused) return;
    const frame = window.requestAnimationFrame(() => {
      itemRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      itemRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focused]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusyChange(true); setError(""); const form = new FormData(event.currentTarget);
    try { await decideFeeReview(schoolId, review.id, { outcome, response: form.get("response"), verified_funds: form.get("verified") === "on" }); await onSaved(); onDraftChange({ ...draft, open: false }); }
    catch (cause) { setError((cause as Error).message); } finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  return <article ref={itemRef} id={`attention-${review.id}`} tabIndex={-1} className={`office-fee-detail${focused ? " attention-focus" : ""}`}><div className="office-invoice-top"><strong>{invoice?.reference ?? "Invoice"} · {invoice ? personName(invoice) : ""}</strong><span className="office-status">{review.kind === "payment" ? "Payment claim" : "Fee question"}</span></div>
    {review.kind === "payment" ? <p><strong>{rupees(review.amount_paise ?? 0)}</strong> · {review.method?.replaceAll("_", " ")} · {review.reference}</p> : null}
    <p className="office-review-note">{review.note}</p><small>Submitted {new Date(review.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</small>
    {!expanded ? <button className="office-secondary" type="button" onClick={() => onDraftChange({ ...draft, open: true })}>Review request</button> : <form className="office-form" onSubmit={event => void submit(event)}>
      {review.kind === "payment" ? <label className="office-field">Decision<select value={outcome} onChange={event => onDraftChange({ ...draft, outcome: event.target.value })}><option value="verified">Verify and issue receipt</option><option value="rejected">Cannot verify / duplicate</option></select></label> : <p className="office-hint">Answer after checking the ledger. A response does not adjust fees or move money. Event credits and refunds use event reconciliation.</p>}
      <label className="office-field">Response to the family<textarea name="response" value={draft.response} onChange={(event) => onDraftChange({ ...draft, response: event.target.value })} required minLength={5} maxLength={1000} /></label>
      {outcome === "verified" ? <label className="office-check"><input name="verified" type="checkbox" required /> I independently verified receipt of these funds. Any cheque has cleared.</label> : null}
      {error ? <p role="alert" className="office-alert">{error}</p> : null}
      <div className="office-actions"><button type="button" className="office-secondary" disabled={busy} onClick={() => onDraftChange({ ...draft, open: false })}>Cancel</button><button className="office-primary" disabled={busy}>{busy ? "Saving…" : outcome === "verified" ? "Verify payment & issue receipt" : "Send response"}</button></div>
    </form>}
  </article>;
}
