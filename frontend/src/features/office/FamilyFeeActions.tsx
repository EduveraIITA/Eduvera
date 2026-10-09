import { RazorpayPayment } from "./RazorpayPayment";
import { useRef, useState, type FormEvent } from "react";
import { parseRupees, rupees, submitFeeReview, type FeePaymentSettings, type FeeReview, type Invoice } from "./api";

export function FamilyFeeActions({ schoolId, invoice, settings, reviews, onSaved, expanded = false, onlinePayments = false, hideBreakdown = false, initialQuestion = false }: { schoolId: string; invoice: Invoice; settings?: FeePaymentSettings; reviews: FeeReview[]; onSaved: () => Promise<unknown>; expanded?: boolean; onlinePayments?: boolean; hideBreakdown?: boolean; initialQuestion?: boolean }) {
  const [mode, setMode] = useState<"closed" | "review" | "pay" | "charge">(initialQuestion ? "charge" : expanded ? "review" : "closed");
  const [amount, setAmount] = useState((invoice.balance_paise / 100).toFixed(2));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const command = useRef({ key: crypto.randomUUID(), payload: "" });
  const inFlight = useRef(false);
  const pendingPayment = reviews.some(item => item.invoice_id === invoice.id && item.kind === "payment" && item.status === "pending");
  const pendingQuestion = reviews.some(item => item.invoice_id === invoice.id && item.kind === "charge" && item.status === "pending");
  let payable = 0; try { payable = parseRupees(amount); } catch { /* Validate on submit. */ }
  const upi = settings?.upi_id && payable > 0 && payable <= invoice.balance_paise ? `upi://pay?${new URLSearchParams({ pa: settings.upi_id, pn: settings.payee_name, am: (payable / 100).toFixed(2), cu: "INR", tn: invoice.reference })}` : "";
  const open = (next: typeof mode) => { setMode(next); setError(""); setSuccess(""); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try {
      const payload = mode === "pay" ? { kind: "payment", amount_paise: parseRupees(amount), method: form.get("method"), reference: form.get("reference"), note: form.get("note") } : { kind: "charge", note: form.get("note") };
      if (mode === "pay" && parseRupees(amount) > invoice.balance_paise) throw new Error("The amount exceeds this invoice’s balance. Request a fee review if you overpaid.");
      const serialized = JSON.stringify(payload);
      if (command.current.payload && command.current.payload !== serialized) command.current.key = crypto.randomUUID();
      command.current.payload = serialized;
      await submitFeeReview(schoolId, invoice.id, { ...payload, idempotency_key: command.current.key });
      setSuccess(mode === "pay" ? "Payment details submitted. Awaiting school verification; this is not a receipt." : "Your fee question was sent to the school.");
      setMode("closed"); command.current = { key: crypto.randomUUID(), payload: "" }; await onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="office-family-fee-actions">
    {success ? <p role="status" className="office-notice">{success}</p> : null}
    {mode === "closed" ? <button className="office-secondary" type="button" onClick={() => open("review")}>Review fee{invoice.balance_paise > 0 ? " & pay" : ""}</button> : <section className="office-fee-detail" aria-label={`Review ${invoice.reference}`}>
      {!hideBreakdown ? <h3>Review your fee</h3> : null}
      {!hideBreakdown ? <dl className="office-fee-breakdown"><div><dt>Original charge</dt><dd>{rupees(invoice.amount_paise)}</dd></div><div><dt>After credits</dt><dd>{rupees(invoice.adjusted_amount_paise)}</dd></div><div><dt>Received</dt><dd>{rupees(invoice.paid_paise)}</dd></div><div><dt>Outstanding</dt><dd>{rupees(invoice.balance_paise)}</dd></div><div><dt>Refund due</dt><dd>{rupees(invoice.refund_due_paise)}</dd></div></dl> : null}
      {onlinePayments && invoice.balance_paise > 0 ? <label className="office-field">Online payment amount (₹)<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" type="number" min="1" max={(invoice.balance_paise / 100).toFixed(2)} step="0.01" /></label> : null}
      {onlinePayments && invoice.balance_paise > 0 ? <RazorpayPayment schoolId={schoolId} invoiceId={invoice.id} amount={!pendingPayment && payable <= invoice.balance_paise ? payable : 0} onSaved={onSaved} /> : null}
      {pendingPayment ? <p className="office-notice">A payment is awaiting school verification. Check review history before paying again.</p> : null}
      <div className="office-actions">
        {invoice.balance_paise > 0 && !pendingPayment ? <button className="office-primary" type="button" disabled={busy} onClick={() => open("pay")}>Pay / report payment</button> : null}
        <button className="office-secondary" type="button" disabled={pendingQuestion || busy} onClick={() => open("charge")}>{pendingQuestion ? "Fee review pending" : "Question this fee"}</button>
        {!expanded || mode !== "review" ? <button className="office-secondary" type="button" disabled={busy} onClick={() => open(initialQuestion ? "charge" : expanded ? "review" : "closed")}>{expanded ? "Cancel" : "Close"}</button> : null}
      </div>
      {mode === "pay" && !pendingPayment && invoice.balance_paise > 0 ? <form className="office-form" onSubmit={event => void submit(event)}>
        <h3>Pay the school</h3><p className="office-hint">Review the payee and amount before paying. Opening a UPI app does not confirm payment. Report a payment already made below.</p>
        <label className="office-field">Amount (₹)<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" type="number" min="0.01" max={(invoice.balance_paise / 100).toFixed(2)} step="0.01" required /></label>
        {settings?.instructions ? <p className="office-payment-instructions">{settings.instructions}</p> : <p className="office-hint">Contact the school office for bank or counter payment instructions.</p>}
        {settings?.upi_id ? <div className="office-payment-instructions"><strong>{settings.payee_name}</strong><span>UPI ID: {settings.upi_id}</span>{upi ? <a className="office-primary" href={upi}>Open UPI app · {rupees(payable)}</a> : <p>Enter a valid amount to open UPI.</p>}<small>On desktop, use the UPI ID in your phone’s payment app. Check the recipient name in that app.</small></div> : null}
        <h3>Report your completed payment</h3>
        <label className="office-field">Payment method<select name="method" required><option value="bank_transfer">UPI / bank transfer</option><option value="cash">Cash at school counter</option><option value="cheque">Cheque</option></select></label>
        <label className="office-field">UTR / bank, counter or cheque reference<input name="reference" required minLength={3} maxLength={120} autoComplete="off" /></label>
        <label className="office-field">Note (optional)<textarea name="note" maxLength={1000} placeholder="Payment date or details to help the school find it" /></label>
        <label className="office-check"><input type="checkbox" required /> I have already made this payment. The school must verify it before issuing a receipt.</label>
        <button className="office-primary" disabled={busy}>{busy ? "Submitting…" : "Submit payment for review"}</button>
      </form> : null}
      {mode === "charge" && !pendingQuestion ? <form className="office-form" onSubmit={event => void submit(event)}><h3>Question this fee</h3><p className="office-hint">Explain a wrong charge, missing concession, duplicate payment or refund question. A review does not change the balance or extend the due date.</p><label className="office-field">Your question<textarea name="note" required minLength={5} maxLength={1000} /></label><button className="office-primary" disabled={busy}>{busy ? "Submitting…" : "Request fee review"}</button></form> : null}
      {error ? <p className="office-alert" role="alert">{error}</p> : null}
    </section>}
  </div>;
}
