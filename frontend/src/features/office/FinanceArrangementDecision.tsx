import { useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { rupees } from "./api";
import { decidePaymentPlan, enableInvoiceSelfPayer, getFinanceArrangements, revokeInvoiceSelfPayer, withdrawPaymentPlan, type ArrangementInvoice, type ArrangementRequest } from "./financeArrangementsApi";
import { useFinanceArrangementWrite } from "./useFinanceArrangementWrite";
import { useFinanceArrangementRefresh } from "./useFinanceArrangementRefresh";

export function FinanceArrangementDecision({ schoolId, invoice, request, onClose, onReload }: {
  schoolId: string; invoice: ArrangementInvoice; request: ArrangementRequest; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected">(request.can_approve ? "approved" : "rejected"), [response, setResponse] = useState("");
  const [basis, setBasis] = useState(invoice), [proposal, setProposal] = useState(request);
  const writer = useFinanceArrangementWrite(onReload, onClose, async commandId => (await (invoice.person_id && !invoice.student_id ? getFinanceArrangements(schoolId, null, invoice.id, commandId, invoice.person_id) : getFinanceArrangements(schoolId, invoice.student_id, invoice.id, commandId))).confirmation,
    () => ({ invoiceId: basis.id, expectedRevision: basis.stream_revision, requestId: proposal.id }));
  const sourceRead = useFinanceArrangementRefresh(schoolId, invoice.student_id, invoice.id, current => {
    const updated = current.invoices.find(item => item.id === invoice.id), retained = updated?.requests.find(item => item.id === request.id);
    if (!updated || !retained?.can_decide) throw new Error("This proposal is no longer available for your decision. Close and return to the fee account.");
    setBasis(updated); setProposal(retained); if (!retained.can_approve) setDecision("rejected"); writer.clearObsolete();
  }, invoice.context_kind === "person" || !invoice.student_id ? invoice.person_id : undefined);
  const guard = useUnsavedChangesGuard(Boolean(response.trim()) && !writer.recovery, "Discard this unsent decision?");
  const close = () => { if (!writer.locked && guard()) onClose(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (writer.obsolete || sourceRead.busy) return; void writer.execute(commandId => decidePaymentPlan(schoolId, proposal.id,
    { command_id: commandId, expected_revision: basis.stream_revision, decision, response })); };
  return <PlannerDialog title="Review payment proposal" busy={writer.locked} onClose={close}><form className="finance-arrangement-form" onSubmit={submit}>
    <p className="finance-arrangement-caption">{invoice.student_label} · {invoice.reference}</p>
    <ul className="finance-arrangement-schedule">{proposal.schedule.map(row => <li key={row.due_on}><span>{row.due_on}</span><strong>{rupees(row.amount_paise)}</strong></li>)}</ul>
    {proposal.note ? <blockquote className="finance-arrangement-note">{proposal.note}</blockquote> : null}
    {proposal.basis_changed ? <p role="alert">The ledger changed. Explain why a new proposal is needed; this schedule cannot be approved.</p> : null}
    <fieldset disabled={writer.locked}><legend className="sr-only">Decision</legend><div className="finance-arrangement-choices">
      <label><input type="radio" name="decision" value="approved" checked={decision === "approved"} disabled={!proposal.can_approve} onChange={() => setDecision("approved")} />Approve dates</label>
      <label><input type="radio" name="decision" value="rejected" checked={decision === "rejected"} onChange={() => setDecision("rejected")} />Decline proposal</label>
    </div><label>{decision === "rejected" ? "Reason" : "Response · Optional"}<textarea rows={3} required={decision === "rejected"} minLength={decision === "rejected" ? 3 : undefined} maxLength={1000} value={response} onChange={event => setResponse(event.target.value)} /></label>
    <p className="finance-arrangement-caption">Approval changes the agreed dates only. No charge, payment or receipt is created.</p></fieldset>
    {sourceRead.error || writer.error ? <p role="alert" className="finance-arrangement-error">{sourceRead.error || writer.error}</p> : null}
    {writer.obsolete ? <button type="button" className="is-secondary" disabled={sourceRead.busy} onClick={() => void sourceRead.refresh()}>{sourceRead.busy ? "Refreshing…" : "Refresh proposal"}</button> : null}
    <footer><button type="button" className="is-secondary" disabled={writer.locked} onClick={close}>Cancel</button>{writer.recovery
      ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retrySame() : writer.refresh())}>{writer.retrySafe ? "Retry same action" : "Refresh account"}</button>
      : <button type="submit" disabled={writer.locked || writer.obsolete || sourceRead.busy}>{writer.busy ? "Saving…" : decision === "approved" ? "Approve schedule" : "Send decision"}</button>}</footer>
  </form></PlannerDialog>;
}

export function FinanceArrangementAccessDialog({ schoolId, invoice, today, action, onClose, onReload }: {
  schoolId: string; invoice: ArrangementInvoice; today: string; action: "enable" | "revoke" | "withdraw"; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const [from, setFrom] = useState(today), [until, setUntil] = useState(""), [reason, setReason] = useState(""), [attested, setAttested] = useState(false);
  const [basis, setBasis] = useState(invoice);
  const pending = basis.requests.find(item => item.status === "pending");
  const [sourceId] = useState(() => crypto.randomUUID()), writer = useFinanceArrangementWrite(onReload, onClose,
    async commandId => (await (invoice.person_id && !invoice.student_id ? getFinanceArrangements(schoolId, null, invoice.id, commandId, invoice.person_id) : getFinanceArrangements(schoolId, invoice.student_id, invoice.id, commandId))).confirmation,
    () => ({ invoiceId: basis.id, expectedRevision: basis.stream_revision, ...(action === "withdraw" ? { requestId: pending?.id } : {}) }));
  const sourceRead = useFinanceArrangementRefresh(schoolId, invoice.student_id, invoice.id, current => {
    const updated = current.invoices.find(item => item.id === invoice.id);
    if (!updated || action === "enable" && !updated.can_enable_self_payer || action === "revoke" && !updated.can_revoke_self_payer
      || action === "withdraw" && !updated.requests.some(item => item.status === "pending" && item.can_withdraw)) throw new Error("This action is no longer available. Close and return to the fee account.");
    setBasis(updated); writer.clearObsolete();
  }, invoice.context_kind === "person" || !invoice.student_id ? invoice.person_id : undefined);
  const personAccount = invoice.context_kind === "person" || !invoice.student_id;
  const title = action === "enable" ? personAccount ? "Enable fee account access" : "Enable learner self-service" : action === "revoke" ? personAccount ? "Revoke fee account access" : "Revoke learner self-service" : "Withdraw proposal";
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (writer.obsolete || sourceRead.busy) return;
    void writer.execute(commandId => action === "enable" ? enableInvoiceSelfPayer(schoolId, basis.id, { command_id: commandId, expected_revision: basis.stream_revision,
      entitlement_id: sourceId, valid_from: from, valid_until: until, attested_adult_self_payer: attested }) : action === "revoke" ? revokeInvoiceSelfPayer(schoolId, basis.id,
      { command_id: commandId, expected_revision: basis.stream_revision, entitlement_id: basis.self_payer?.id, reason }) : withdrawPaymentPlan(schoolId, pending!.id,
      { command_id: commandId, expected_revision: basis.stream_revision }));
  };
  return <PlannerDialog title={title} busy={writer.locked} onClose={() => { if (!writer.locked) onClose(); }}><form className="finance-arrangement-form" onSubmit={submit}>
    <p>{invoice.student_label} · {invoice.reference}</p><fieldset disabled={writer.locked}>
      {action === "enable" ? <><p className="finance-arrangement-caption">{personAccount ? "This person can view this charge, report payments, ask questions and propose payment dates until the chosen date. No other account or decision powers are shared." : "This learner can propose payment dates for this invoice only. Other accounts and payment-verification powers are not shared."}</p>
        <div className="finance-arrangement-fields"><label>From<TemporalInput type="date" min={today} required value={from} onChange={event => setFrom(event.target.value)} /></label><label>Until<TemporalInput type="date" min={from} required value={until} onChange={event => setUntil(event.target.value)} /></label></div>
        <label className="finance-arrangement-attestation"><input type="checkbox" required checked={attested} onChange={event => setAttested(event.target.checked)} /><span>I confirm this person is an adult acting as their own payer, and my authority covers this access.</span></label></>
        : action === "revoke" ? <><p className="finance-arrangement-caption">{personAccount ? "This person will no longer access this fee account or send requests. Finance retains the recorded charge, agreements and verified receipts." : "Future proposals are blocked. Existing agreements, receipts and the learner’s own account view remain."}</p><label>Reason<textarea required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label></>
          : <p>The pending proposal will close. Any earlier approved schedule and the ledger stay unchanged.</p>}
    </fieldset>{sourceRead.error || writer.error ? <p role="alert" className="finance-arrangement-error">{sourceRead.error || writer.error}</p> : null}
    {writer.obsolete ? <button type="button" className="is-secondary" disabled={sourceRead.busy} onClick={() => void sourceRead.refresh()}>{sourceRead.busy ? "Refreshing…" : "Refresh account"}</button> : null}
    <footer><button type="button" className="is-secondary" disabled={writer.locked} onClick={onClose}>Cancel</button>{writer.recovery
      ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retrySame() : writer.refresh())}>{writer.retrySafe ? "Retry same action" : "Refresh account"}</button>
      : <button disabled={writer.locked || writer.obsolete || sourceRead.busy || action === "withdraw" && !pending}>{writer.busy ? "Saving…" : action === "enable" ? "Enable self-service" : action === "revoke" ? "Revoke access" : "Withdraw proposal"}</button>}</footer>
  </form></PlannerDialog>;
}
