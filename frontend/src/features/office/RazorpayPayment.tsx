import { useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { rupees } from "./api";
import { loadRazorpay, type RazorpayResult } from "./razorpay";
interface Order { key_id: string; order_id: string; amount: number; currency: string }
interface Status { state: string; payment_id: string | null }
export function RazorpayPayment({ schoolId, invoiceId, amount, onSaved }: { schoolId: string; invoiceId: string; amount: number; onSaved: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees/invoices/${encodeURIComponent(invoiceId)}/razorpay`;
  const describe = (state: string) => state === "captured" ? "Sandbox payment verified. Your test receipt is available." : state === "review_required" ? "Payment captured, but the balance changed. The school must reconcile it. Do not pay again." : "Payment is not yet confirmed. Check status before paying again.";
  function done() { inFlight.current = false; setBusy(false); }
  async function check() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const statuses = await apiFetch<Status[]>(`${path}/status/`);
      setMessage(statuses.length ? describe(statuses[0]!.state) : "No Razorpay checkout has been started for this invoice.");
      await onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { done(); }
  }
  async function verify(result: RazorpayResult) {
    try {
      const status = await apiFetch<Status>(`${path}/verify/`, { method: "POST", body: JSON.stringify(result) });
      setMessage(describe(status.state)); await onSaved();
    } catch (cause) { setError(`${(cause as Error).message} Use Check payment status before paying again.`); }
    finally { done(); }
  }
  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (!Number.isSafeInteger(amount) || amount < 100) throw new Error("Enter at least ₹1 for Razorpay.");
      await loadRazorpay();
      const order = await apiFetch<Order>(`${path}/order/`, { method: "POST", body: JSON.stringify({ amount_paise: amount }) });
      const checkout = new window.Razorpay!({ key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
        name: "Eduera", description: "School fee · Sandbox test", theme: { color: "#2563eb" },
        handler: result => { void verify(result); },
        modal: { ondismiss: () => { setMessage("Checkout closed. Check status if you attempted a payment."); done(); } },
      });
      checkout.on("payment.failed", () => { setMessage("Payment attempt failed. You can retry in checkout or close it and check status."); });
      checkout.open();
    } catch (cause) { setError((cause as Error).message); done(); }
  }
  return <section className="office-payment-instructions" aria-label="Razorpay sandbox payment">
    <strong>Razorpay · Test mode</strong><small>Sandbox only. No real money is collected.</small>
    <div className="office-actions"><button type="button" className="office-primary" disabled={busy || amount < 100} onClick={() => void pay()}>{busy ? "Checking payment…" : `Pay with Razorpay · ${rupees(amount)}`}</button><button type="button" className="office-secondary" disabled={busy} onClick={() => void check()}>Check payment status</button></div>
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="office-alert">{error}</p> : null}
  </section>;
}
