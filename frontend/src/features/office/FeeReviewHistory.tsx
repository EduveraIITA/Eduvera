import { rupees, type FeeReview, type Invoice } from "./api";
export const reviewLabels = { pending: "Awaiting school review", verified: "Payment verified", rejected: "Payment not verified", answered: "School responded" };
export function FeeReviewHistory({ reviews, invoices }: { reviews: FeeReview[]; invoices: Invoice[] }) {
  if (!reviews.length) return null;
  return <section className="office-panel"><h2>Review history <span>{reviews.length}</span></h2>{reviews.length ? <ul className="office-review-list">{reviews.map(review => <li key={review.id}>
    <div className="office-invoice-top"><strong>{invoices.find(item => item.id === review.invoice_id)?.reference ?? "Invoice"}</strong><span className="office-status">{reviewLabels[review.status]}</span></div>
    <p>{review.kind === "payment" ? `Reported payment · ${rupees(review.amount_paise ?? 0)} · ${review.reference}` : "Fee question"}</p>
    {review.note ? <p className="office-review-note">{review.note}</p> : null}
    <small>{new Date(review.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</small>
    {review.response ? <p className="office-review-response"><strong>School response</strong>{review.response}</p> : <p className="office-hint">{review.kind === "payment" ? "Awaiting verification. Your balance has not changed. Do not pay again while the school checks this payment." : "The school will review your question. The due date and balance remain unchanged."}</p>}
  </li>)}</ul> : <p className="office-empty">No payment submissions or fee questions yet.</p>}</section>;
}
