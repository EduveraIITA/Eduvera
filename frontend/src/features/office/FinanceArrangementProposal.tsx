import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { parseRupees, rupees } from "./api";
import { getFinanceArrangements, requestPaymentPlan, type ArrangementInvoice, type FinanceArrangementsWorkspace } from "./financeArrangementsApi";
import { useFinanceArrangementWrite } from "./useFinanceArrangementWrite";
import { useFinanceArrangementRefresh } from "./useFinanceArrangementRefresh";

export function FinanceArrangementProposal({ schoolId, invoice, context, onClose, onReload }: {
  schoolId: string; invoice: ArrangementInvoice; context: FinanceArrangementsWorkspace; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const [basis, setBasis] = useState(invoice), [reviewContext, setReviewContext] = useState(context), [review, setReview] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  const [rows, setRows] = useState(() => [{ id: crypto.randomUUID(), amount: (invoice.balance_paise / 100).toFixed(2), date: invoice.original_due_on < context.today ? context.today : invoice.original_due_on }]);
  const source = useRef(crypto.randomUUID()), [dirty, setDirty] = useState(false);
  const writer = useFinanceArrangementWrite(onReload, onClose, async commandId => (await (invoice.person_id && !invoice.student_id ? getFinanceArrangements(schoolId, null, invoice.id, commandId, invoice.person_id) : getFinanceArrangements(schoolId, invoice.student_id, invoice.id, commandId))).confirmation,
    () => ({ invoiceId: basis.id, expectedRevision: basis.stream_revision, requestId: source.current }));
  const sourceRead = useFinanceArrangementRefresh(schoolId, invoice.student_id, invoice.id, current => {
    const updated = current.invoices.find(item => item.id === basis.id); if (!updated) throw new Error("This fee account is unavailable.");
    if (!updated.can_request) throw new Error(updated.requests.some(item => item.status === "pending")
      ? "A proposal is already pending. Close this form and open the current proposal. Your entries have not been sent."
      : "This account no longer accepts a proposal. Your entries have not been sent.");
    setBasis(updated); setReviewContext(current); setReview(false); writer.clearObsolete();
  }, invoice.context_kind === "person" || !invoice.student_id ? invoice.person_id : undefined);
  const guard = useUnsavedChangesGuard(dirty && !writer.recovery, "Discard this unsent payment proposal?");
  const close = () => { if (!writer.locked && guard()) onClose(); };
  const change = () => { setDirty(true); setError(""); setReview(false); };
  const schedule = () => rows.map(row => ({ amount_paise: parseRupees(row.amount), due_on: row.date }));
  let total = 0; try { total = schedule().reduce((sum, row) => sum + row.amount_paise, 0); } catch { /* Invalid entry remains visible until review. */ }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (writer.locked || writer.obsolete || sourceRead.busy) return;
    try {
      const proposed = schedule();
      if (proposed.some((row, index) => row.due_on < reviewContext.today || index > 0 && row.due_on <= proposed[index - 1]!.due_on)) throw new Error("Use today or later, with a later date for each payment.");
      if (total !== basis.balance_paise) throw new Error("The proposed payments must add up to the outstanding balance.");
      if (!review) { setReview(true); setError(""); return; }
      await writer.execute(commandId => requestPaymentPlan(schoolId, basis.id, { command_id: commandId, request_id: source.current,
        expected_revision: basis.stream_revision, basis_hash: basis.basis_hash, basis_revision: basis.basis_revision, schedule: proposed, note }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review the proposed dates and amounts."); }
  };
  return <PlannerDialog title={review ? "Review payment dates" : "Propose payment dates"} busy={writer.locked} onClose={close}>
    <form className="finance-arrangement-form" onSubmit={event => void submit(event)}>
      <div className="finance-arrangement-summary"><p className="finance-arrangement-caption">{basis.description} · {basis.reference}</p>
        <div className="finance-arrangement-balance"><span>Outstanding</span><strong>{rupees(basis.balance_paise)}</strong></div></div>
      <fieldset disabled={writer.locked}>
        {review ? <><ul className="finance-arrangement-schedule">{rows.map(row => <li key={row.id}><span>{row.date}</span><strong>{rupees(parseRupees(row.amount))}</strong></li>)}</ul>
          <p>For {reviewContext.review_route.reviewer?.label ?? "Finance"} to review.</p>{note ? <p className="finance-arrangement-note">{note}</p> : null}
          <p className="finance-arrangement-caption">Existing due dates apply until this proposal is approved. Sending it does not record a payment.</p></> : <>
          <div className="finance-arrangement-edit-list">{rows.map((row, index) => <div key={row.id} className="finance-arrangement-edit-row">
            <label>Amount {index + 1} (₹)<input required inputMode="decimal" value={row.amount} onChange={event => { change(); setRows(current => current.map(item => item.id === row.id ? { ...item, amount: event.target.value } : item)); }} /></label>
            <label>Date {index + 1}<TemporalInput type="date" min={reviewContext.today} required value={row.date} onChange={event => { change(); setRows(current => current.map(item => item.id === row.id ? { ...item, date: event.target.value } : item)); }} /></label>
            {rows.length > 1 ? <button className="finance-arrangement-icon" type="button" aria-label={`Remove payment ${index + 1}`} onClick={() => { change(); setRows(current => current.filter(item => item.id !== row.id)); }}><Trash2 size={18} aria-hidden="true" /></button> : null}
          </div>)}</div>
          {rows.length < 12 ? <button className="finance-arrangement-text" type="button" onClick={() => { change(); setRows(current => [...current, { id: crypto.randomUUID(), amount: "", date: "" }]); }}><Plus size={18} aria-hidden="true" />Add payment</button> : null}
          <p className="finance-arrangement-caption">Proposed {rupees(total)} of {rupees(basis.balance_paise)}</p>
          <details><summary>Note <span className="finance-arrangement-caption">Optional</span></summary><label className="sr-only" htmlFor="fee-plan-note">Note for Finance</label><textarea id="fee-plan-note" rows={3} maxLength={1000} value={note} onChange={event => { change(); setNote(event.target.value); }} /></details>
          <details><InfoSummary>How this works</InfoSummary><p>Finance reviews these dates against this invoice. Charges, verified receipts and other accounts stay unchanged.</p></details>
        </>}
      </fieldset>
      {sourceRead.error || error || writer.error ? <p role="alert" className="finance-arrangement-error">{sourceRead.error || error || writer.error}</p> : null}
      {writer.obsolete ? <button type="button" className="is-secondary" disabled={sourceRead.busy} onClick={() => void sourceRead.refresh()}>{sourceRead.busy ? "Refreshing…" : "Refresh balance"}</button> : null}
      <footer><button type="button" className="is-secondary" disabled={writer.locked} onClick={() => review && !writer.recovery ? setReview(false) : close()}>{review && !writer.recovery ? "Back" : "Cancel"}</button>
        {writer.recovery ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retrySame() : writer.refresh())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Refresh account"}</button>
          : <button type="submit" disabled={writer.locked || writer.obsolete}>{writer.busy ? "Sending…" : review ? "Send proposal" : "Review"}</button>}</footer>
    </form>
  </PlannerDialog>;
}
