import { useEffect, useRef, useState } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { parseRupees, rupees } from "./api";
import { confirmNativeFeeReview, getNativeFeeReviews, nativeFeeReviewObsolete, reportNativeFeeReview, type NativeFeeReviewInvoice } from "./nativeFeeReviewsApi";
import { useFeeCommand } from "./useFeeCommand";

export function NativeFeeReportDialog({ schoolId, invoice, kind, onClose, onReload }: {
  schoolId: string; invoice: NativeFeeReviewInvoice; kind: "payment" | "charge"; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const [basis, setBasis] = useState(invoice), [reviewId] = useState(() => crypto.randomUUID()), [reviewing, setReviewing] = useState(false);
  const [reviewerId, setReviewerId] = useState(""), [amount, setAmount] = useState(""), [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState(""), [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false), [error, setError] = useState("");
  const [reading, setReading] = useState(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const context = { invoiceId: invoice.id, ...(invoice.context_kind === "person" ? { personId: invoice.person_id! } : { studentId: invoice.student_id! }) };
  const writer = useFeeCommand(onReload, onClose, commandId => confirmNativeFeeReview(schoolId, context, commandId, reviewId, "report"),
    (cause, commandId) => nativeFeeReviewObsolete(cause, commandId, basis, reviewId));
  const guard = useUnsavedChangesGuard(Boolean(amount || reference || note) && !writer.recovery, "Discard this unsent fee request?");
  const reviewer = basis.reviewers.find(item => item.user_id === reviewerId);
  const close = () => { if (!writer.locked && !reading && guard()) onClose(); };
  const submit = async () => {
    if (writer.locked || reading || !reviewer) return;
    try {
      const amountPaise = kind === "payment" ? parseRupees(amount) : null;
      if (amountPaise !== null && amountPaise > basis.balance_paise) throw new Error("The amount exceeds this charge’s current outstanding balance.");
      if (!reviewing) { setReviewing(true); setError(""); return; }
      const payload = { review_id: reviewId, expected_revision: basis.stream_revision, basis_hash: basis.basis_hash, basis_revision: basis.basis_revision,
        reviewer: { user_id: reviewer.user_id, person_id: reviewer.person_id, eligibility_hash: reviewer.eligibility_hash }, note,
        ...(kind === "payment" ? { kind, amount_paise: amountPaise, method, reference, payment_made: true } : { kind }) };
      await writer.execute(command_id => reportNativeFeeReview(schoolId, basis.id, { ...payload, command_id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review the request details."); }
  };
  return <PlannerDialog title={kind === "payment" ? reviewing ? "Review payment report" : "Report payment" : "Question this charge"} busy={writer.locked || reading} onClose={close}>
    <form className="person-fee-form" onSubmit={event => { event.preventDefault(); void submit(); }}><p className="person-fee-caption">{invoice.description} · {invoice.reference}</p>
      <fieldset disabled={writer.locked || writer.obsolete || reading}>
        {reviewing ? <section className="person-fee-review">{kind === "payment" ? <><strong className="person-fee-large">{rupees(parseRupees(amount))}</strong><p>{method.replaceAll("_", " ")} · {reference}</p></> : null}<p>For <strong>{reviewer?.label}</strong> to review</p>{note ? <p>{note}</p> : null}<p className="person-fee-caption">{kind === "payment" ? "The balance changes only after Finance verifies the funds." : "A question does not change this charge or its due date."}</p></section> : <>
          {kind === "payment" ? <><label>Amount paid (₹)<input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>Method<select value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></label><label>Payment reference<input required minLength={3} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} /></label></> : null}
          <label>{kind === "charge" ? "What needs checking?" : "Note · Optional"}<textarea rows={3} required={kind === "charge"} minLength={kind === "charge" ? 3 : undefined} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
          <label>Who should review?<select required value={reviewerId} onChange={event => setReviewerId(event.target.value)}><option value="" disabled>Choose a Finance reviewer</option>{basis.reviewers.map(item => <option key={item.user_id} value={item.user_id}>{item.label}</option>)}</select></label>
          {!basis.reviewers.length ? <p role="alert">No independent Finance reviewer is available. Ask the campus administrator to assign one.</p> : null}
          {kind === "payment" ? <label className="person-fee-check"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I have already made this payment.</span></label> : null}
        </>}
      </fieldset>{error || writer.error ? <p role="alert" className="person-fee-error">{error || writer.error}</p> : null}
      {writer.obsolete ? <button type="button" className="is-secondary" disabled={writer.busy || reading} onClick={() => { setReading(true); void getNativeFeeReviews(schoolId, context).then(current => {
        const updated = current.invoices.find(item => item.id === invoice.id); if (!updated || !(kind === "payment" ? updated.can_report : updated.can_question)) throw new Error("This charge no longer accepts this request. Close and return to the current record."); if (active.current) { setBasis(updated); setReviewing(false); writer.clearObsolete(); }
      }).catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : "The charge could not be refreshed."); }).finally(() => { if (active.current) setReading(false); }); }}>Review current charge</button> : null}
      <footer><button className="is-secondary" type="button" disabled={writer.locked || reading} onClick={() => reviewing ? setReviewing(false) : close()}>{reviewing ? "Back" : "Cancel"}</button>{writer.recovery
        ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retry() : writer.check())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Check result"}</button>
        : <button disabled={writer.locked || writer.obsolete || reading || !reviewer || kind === "payment" && (!confirmed || !reference.trim() || !amount) || kind === "charge" && note.trim().length < 3}>{reviewing ? "Send for review" : "Review"}</button>}</footer>
    </form>
  </PlannerDialog>;
}
