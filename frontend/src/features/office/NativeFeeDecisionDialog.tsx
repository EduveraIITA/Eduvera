import { useEffect, useRef, useState } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { rupees } from "./api";
import { confirmNativeFeeReview, decideNativeFeeReview, getNativeFeeReviews, nativeFeeReviewObsolete, withdrawNativeFeeReview, type NativeFeeReview, type NativeFeeReviewInvoice } from "./nativeFeeReviewsApi";
import { useFeeCommand } from "./useFeeCommand";

export function NativeFeeDecisionDialog({ schoolId, invoice, review, withdrawing = false, onClose, onReload }: {
  schoolId: string; invoice: NativeFeeReviewInvoice; review: NativeFeeReview; withdrawing?: boolean; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const [basis, setBasis] = useState(invoice), [source, setSource] = useState(review), [response, setResponse] = useState("");
  const [outcome, setOutcome] = useState<"verified" | "rejected" | "answered">(review.kind === "charge" ? "answered" : review.can_verify ? "verified" : "rejected");
  const [verified, setVerified] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState("");
  const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const context = { invoiceId: invoice.id, ...(invoice.context_kind === "person" ? { personId: invoice.person_id! } : { studentId: invoice.student_id! }) };
  const writer = useFeeCommand(onReload, onClose, commandId => confirmNativeFeeReview(schoolId, context, commandId, review.id, withdrawing ? "withdraw" : "decide"),
    (cause, commandId) => nativeFeeReviewObsolete(cause, commandId, basis, source.id));
  const guard = useUnsavedChangesGuard(Boolean(response) && !writer.recovery, "Discard this unsent response?");
  const close = () => { if (!writer.locked && !reading && guard()) onClose(); };
  const submit = () => { if (writer.locked || reading) return; void writer.execute(command_id => withdrawing
    ? withdrawNativeFeeReview(schoolId, source.id, basis.id, { command_id, expected_revision: basis.stream_revision })
    : decideNativeFeeReview(schoolId, source.id, basis.id, { command_id, expected_revision: basis.stream_revision, outcome, response, verified_funds: verified })); };
  const refresh = async () => {
    if (reading) return; setReading(true); setError("");
    try {
      const current = await getNativeFeeReviews(schoolId, context), updated = current.invoices.find(item => item.id === invoice.id), retained = updated?.reviews.find(item => item.id === review.id);
      if (!updated || !retained || (withdrawing ? !retained.can_withdraw : !retained.can_decide)) throw new Error("This action is no longer available. Close and return to the current fee record.");
      if (active.current) { setBasis(updated); setSource(retained); setVerified(false); if (!retained.can_verify && outcome === "verified") setOutcome("rejected"); writer.clearObsolete(); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "This request could not be refreshed."); }
    finally { if (active.current) setReading(false); }
  };
  return <PlannerDialog title={withdrawing ? "Withdraw request" : review.kind === "payment" ? "Verify reported payment" : "Answer fee question"} busy={writer.locked || reading} onClose={close}>
    <form className="person-fee-form" onSubmit={event => { event.preventDefault(); submit(); }}>
      <p className="person-fee-caption">{invoice.label} · {invoice.reference}</p>
      {source.kind === "payment" ? <section className="person-fee-review"><strong className="person-fee-large">{rupees(source.amount_paise ?? 0)}</strong><p>{source.method?.replaceAll("_", " ")} · {source.reference}</p></section> : null}
      {source.note ? <blockquote>{source.note}</blockquote> : null}
      <fieldset disabled={writer.locked || reading || writer.obsolete}>
        {withdrawing ? <p>This pending request will close. The charge, balance and any verified payments stay unchanged.</p> : <>
          {source.basis_changed ? <p role="alert">The ledger changed after this report. Review the current balance; this report cannot be verified.</p> : null}
          {source.kind === "payment" ? <label>Decision<select value={outcome} onChange={event => { setOutcome(event.target.value as "verified" | "rejected"); setVerified(false); }}><option value="verified" disabled={!source.can_verify}>Funds verified</option><option value="rejected">Reject report</option></select></label> : null}
          <label>{outcome === "rejected" ? "Reason" : "Response"}<textarea required minLength={3} maxLength={1000} rows={3} value={response} onChange={event => setResponse(event.target.value)} /></label>
          {outcome === "verified" ? <label className="person-fee-check"><input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} /><span>I independently verified that these funds were received. Any cheque has cleared.</span></label> : <p className="person-fee-caption">{outcome === "answered" ? "This response does not change the charge or record a payment." : "No payment will be recorded."}</p>}
        </>}
      </fieldset>{error || writer.error ? <p role="alert" className="person-fee-error">{error || writer.error}</p> : null}
      {writer.obsolete ? <button type="button" className="is-secondary" disabled={reading} onClick={() => void refresh()}>{reading ? "Refreshing…" : "Review current request"}</button> : null}
      <footer><button type="button" className="is-secondary" disabled={writer.locked || reading} onClick={close}>Cancel</button>{writer.recovery
        ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retry() : writer.check())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Check result"}</button>
        : <button disabled={writer.locked || reading || writer.obsolete || !withdrawing && (response.trim().length < 3 || outcome === "verified" && !verified)}>{withdrawing ? "Withdraw request" : outcome === "verified" ? "Confirm receipt" : "Send response"}</button>}</footer>
    </form>
  </PlannerDialog>;
}
