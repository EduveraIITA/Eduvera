import { AlertTriangle, Banknote, CheckCircle2, CreditCard, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { eventIdempotencyKey } from "./api";
import type { EventFinanceParticipant, EventFinanceResponse } from "./types";

const financeLabels: Record<EventFinanceParticipant["finance_state"], string> = {
  not_required: "No event fee",
  not_invoiced: "Not invoiced",
  collectible: "Fee due",
  paid: "Paid",
  credited: "Invoice credited",
  refund_due: "Manual refund due",
  partially_refunded: "Refund partly recorded",
  refunded: "Refund recorded",
};

const methodLabels: Record<"cash" | "bank_transfer" | "cheque", string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100);
}

export function FamilyEventFinancePanel({
  finance,
  onWithdraw,
}: {
  finance?: EventFinanceParticipant;
  onWithdraw: (reason: string, idempotencyKey: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  const [commandKey] = useState(eventIdempotencyKey);
  if (!finance || finance.finance_state === "not_required") return null;
  const refund = finance.refunds.at(-1);
  const withdraw = async () => {
    if (reason.trim().length < 3) return;
    setState("saving");
    setMessage("");
    try {
      await onWithdraw(reason.trim(), commandKey);
      setOpen(false);
      setReason("");
      setState("idle");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "The event place could not be withdrawn.");
    }
  };

  return (
    <section className={`family-event-finance is-${finance.finance_state}`}>
      <header>
        <span><CreditCard size={19} /></span>
        <div><small>Event fee</small><h2>{financeLabels[finance.finance_state]}</h2></div>
        {finance.finance_state === "paid" || finance.finance_state === "refunded" ? <CheckCircle2 size={21} /> : null}
      </header>
      {finance.finance_state === "not_invoiced" ? <p>The fee record is created only after a guardian accepts this optional activity.</p> : null}
      {finance.finance_state === "collectible" ? <div className="family-event-finance__amount"><span>Balance with school</span><strong>{money(finance.collectible_balance_paise)}</strong></div> : null}
      {finance.finance_state === "paid" ? <div className="family-event-finance__amount"><span>Received by school</span><strong>{money(finance.paid_paise)}</strong></div> : null}
      {finance.finance_state === "credited" ? <p>The original invoice remains in the audit ledger and has been fully credited. Nothing remains collectible.</p> : null}
      {finance.finance_state === "refund_due" || finance.finance_state === "partially_refunded" ? (
        <div className="family-event-refund-due"><AlertTriangle size={18} /><div><strong>{money(finance.refund_due_paise)} manual refund due</strong><p>The school office must return this amount and record the real-world method and reference. This app has not initiated an online refund.</p></div></div>
      ) : null}
      {finance.finance_state === "refunded" && refund ? (
        <div className="family-event-refund-record"><CheckCircle2 size={18} /><div><strong>{money(finance.refunded_paise)} refund recorded</strong><p>{methodLabels[refund.method]} · Reference {refund.reference}</p><small>{new Date(refund.recorded_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div></div>
      ) : null}
      {finance.can_withdraw ? <button className="campus-event-secondary family-event-withdraw" type="button" onClick={() => setOpen(true)}><RotateCcw size={16} />Withdraw from event</button> : null}
      {open ? (
        <div className="campus-event-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="campus-event-modal family-event-withdraw-modal" role="dialog" aria-modal="true" aria-labelledby="withdraw-event-heading" onClick={(event) => event.stopPropagation()}>
            <button className="campus-event-modal-close" type="button" aria-label="Close withdrawal" onClick={() => setOpen(false)}><X size={20} /></button>
            <span className="campus-event-modal__icon"><RotateCcw size={20} /></span>
            <h2 id="withdraw-event-heading">Withdraw this event place?</h2>
            <p>The accepted place will be removed. Its invoice will remain in the immutable school ledger with a matching credit. Any amount already paid will require a manual school-office refund.</p>
            <label>Reason<textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why can the student no longer participate?" /></label>
            {message ? <p className="campus-event-form-error" role="alert">{message}</p> : null}
            <div><button className="campus-event-secondary" type="button" onClick={() => setOpen(false)}>Keep place</button><button className="campus-event-danger" type="button" disabled={reason.trim().length < 3 || state === "saving"} onClick={() => void withdraw()}>{state === "saving" ? "Withdrawing..." : "Withdraw place"}</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function OperationsEventFinancePanel({
  finance,
  onRecordRefund,
}: {
  finance: EventFinanceResponse;
  onRecordRefund: (studentId: string, input: { amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string; reason: string; idempotency_key: string }) => Promise<void>;
}) {
  const relevant = finance.items.filter((item) => !["not_required", "not_invoiced", "collectible", "paid"].includes(item.finance_state));
  const [selected, setSelected] = useState<EventFinanceParticipant | null>(null);
  if (!relevant.length) return null;
  return (
    <section className="campus-event-detail-panel campus-event-finance-operations">
      <header><div><span>Finance reconciliation</span><h2>Credits and manual refunds</h2></div><b>{finance.counts.reconciliation_required} need action</b></header>
      <p className="campus-event-finance-explainer">Event invoices and payments are never deleted. A withdrawal or cancellation posts an offsetting credit; money already received remains refund-due until the school records how it was returned.</p>
      <div className="campus-event-finance-list">
        {relevant.map((item) => (
          <article key={item.student_id}>
            <span className="campus-event-avatar">{item.avatar_url ? <img src={item.avatar_url} alt="" /> : item.student_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span>
            <div><strong>{item.student_name}</strong><small>{item.admission_number} · {item.participation_state}</small></div>
            <span className={`campus-event-finance-state is-${item.finance_state}`}>{financeLabels[item.finance_state]}</span>
            {finance.permissions.can_view_finance_details ? <div className="campus-event-finance-values"><span>Credited <b>{money(item.credited_paise)}</b></span><span>Refund due <b>{money(item.refund_due_paise)}</b></span></div> : <p className="campus-event-finance-coarse">{item.finance_state === "refunded" || item.finance_state === "credited" ? "Reconciled" : "Finance follow-up pending"}</p>}
            {finance.permissions.can_record_refund && item.refund_due_paise > 0 ? <button className="campus-event-primary" type="button" onClick={() => setSelected(item)}><Banknote size={16} />Record refund</button> : null}
          </article>
        ))}
      </div>
      <p className="campus-event-policy-note"><AlertTriangle size={15} />Recording a refund documents a manual transaction. It does not send money through a payment gateway.</p>
      {selected ? <RecordRefundDialog participant={selected} onClose={() => setSelected(null)} onSubmit={async (input) => { await onRecordRefund(selected.student_id, input); setSelected(null); }} /> : null}
    </section>
  );
}

function RecordRefundDialog({
  participant,
  onClose,
  onSubmit,
}: {
  participant: EventFinanceParticipant;
  onClose: () => void;
  onSubmit: (input: { amount_paise: number; method: "cash" | "bank_transfer" | "cheque"; reference: string; reason: string; idempotency_key: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState((participant.refund_due_paise / 100).toFixed(2));
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "cheque">("bank_transfer");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [commandKey] = useState(eventIdempotencyKey);
  const amountPaise = useMemo(() => Math.round(Number(amount) * 100), [amount]);
  const valid = Number.isSafeInteger(amountPaise) && amountPaise > 0 && amountPaise <= participant.refund_due_paise && reference.trim().length > 0 && reason.trim().length >= 3;
  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError("");
    try { await onSubmit({ amount_paise: amountPaise, method, reference: reference.trim(), reason: reason.trim(), idempotency_key: commandKey }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The refund record could not be saved."); setSaving(false); }
  };
  return (
    <div className="campus-event-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="campus-event-modal campus-event-refund-modal" role="dialog" aria-modal="true" aria-labelledby="record-refund-heading" onClick={(event) => event.stopPropagation()}>
        <button className="campus-event-modal-close" type="button" aria-label="Close refund form" onClick={onClose}><X size={20} /></button>
        <span className="campus-event-modal__icon"><Banknote size={20} /></span>
        <h2 id="record-refund-heading">Record manual refund</h2>
        <p>{participant.student_name} has {money(participant.refund_due_paise)} remaining refund due. Save only after the money has actually been returned.</p>
        <div className="campus-event-refund-fields">
          <label>Amount (INR)<input type="number" min="0.01" max={(participant.refund_due_paise / 100).toFixed(2)} step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></label>
          <label>Transaction or receipt reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank UTR, cheque or receipt number" /></label>
          <label>Reconciliation reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this refund is being recorded" /></label>
        </div>
        {error ? <p className="campus-event-form-error" role="alert">{error}</p> : null}
        <div><button className="campus-event-secondary" type="button" onClick={onClose}>Cancel</button><button className="campus-event-primary" type="button" disabled={!valid || saving} onClick={() => void save()}>{saving ? "Recording..." : "Record completed refund"}</button></div>
      </section>
    </div>
  );
}
