import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { rupees } from "./api";
import { loadRazorpay, type RazorpayResult } from "./razorpay";
interface Order { key_id: string; order_id: string; amount: number; currency: string }
interface Status { id?:string; state: string; payment_id: string | null; amount_paise?:number; provider_payment_id?:string; email_status?:string; checked_at?:string }
export function RazorpayPayment({ schoolId, invoiceId, amount, onSaved }: { schoolId: string; invoiceId: string; amount: number; onSaved: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [statuses,setStatuses]=useState<Status[]>([]);
  const checkoutRef=useRef<InstanceType<NonNullable<Window['Razorpay']>>|null>(null);
  const savedRef=useRef(onSaved);
  const lastConfirmed=useRef('');
  useEffect(()=>{savedRef.current=onSaved;},[onSaved]);
  const inFlight = useRef(false);
  const statusVersion=useRef(0);
  const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees/invoices/${encodeURIComponent(invoiceId)}/razorpay`;
  const describe = (state: string) => state === "captured" ? "Sandbox payment verified. Your test receipt is available under Fees & receipts → Receipts." : state === "review_required" ? "Payment captured, but the balance changed. The school must reconcile it. Do not pay again." : state === 'failed' ? 'The last payment attempt failed. No receipt was issued. Check status before retrying.' : "Payment is not yet confirmed. Check status before paying again.";
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      if(inFlight.current || document.visibilityState==='hidden')return;
      const version=++statusVersion.current;
      try {
        const rows=await apiFetch<Status[]>(`${path}/status/`);
        if(active && version===statusVersion.current){
          setStatuses(rows);
          const confirmed=rows.filter(row=>row.state==='captured').map(row=>row.payment_id).join(',');
          if(confirmed && confirmed!==lastConfirmed.current){lastConfirmed.current=confirmed;await savedRef.current();}
        }
      }
      catch {if(active && version===statusVersion.current)setError('Payment status could not refresh. Use Check payment status before paying again.');}
    };
    void refresh();const timer=window.setInterval(()=>void refresh(),30000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[path]);
  function done() { inFlight.current = false; setBusy(false); }
  async function check() {
    if (inFlight.current) return;
    statusVersion.current++;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const statuses = await apiFetch<Status[]>(`${path}/status/`);
      setStatuses(statuses);
      setMessage(statuses.length ? describe(statuses[0]!.state) : "No Razorpay checkout has been started for this invoice.");
      await onSaved();
    } catch (cause) { setError((cause as Error).message); }
    finally { done(); }
  }
  async function verify(result: RazorpayResult) {
    statusVersion.current++;
    try {
      const status = await apiFetch<Status>(`${path}/verify/`, { method: "POST", body: JSON.stringify(result) });
      setMessage(describe(status.state));setStatuses([status]); await onSaved();
    } catch (cause) { setError(`${(cause as Error).message} Use Check payment status before paying again.`); }
    finally { done(); }
  }
  async function pay() {
    if (inFlight.current) return;
    statusVersion.current++;
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
      checkoutRef.current=checkout;
      checkout.on("payment.failed", () => { setMessage("Payment attempt failed. You can retry in checkout or close it and check status."); });
      checkout.open();
    } catch (cause) { setError((cause as Error).message); done(); }
  }
  return <section className="office-payment-instructions" aria-label="Razorpay sandbox payment">
    <strong>Razorpay · Test mode</strong><small>Sandbox only. No real money is collected.</small>
    <div className="office-actions"><button type="button" className="office-primary" disabled={busy || amount < 100} onClick={() => void pay()}>{busy ? "Checking payment…" : `Pay with Razorpay · ${rupees(amount)}`}</button><button type="button" className="office-secondary" disabled={busy} onClick={() => void check()}>Check payment status</button></div>
    {busy ? <p>If a wallet window is blank, <button type="button" className="office-secondary" onClick={()=>{checkoutRef.current?.close();done();setMessage('Checkout closed. Check payment status before trying again.');}}>Close checkout</button> and check payment status. Allow popups for this site.</p> : null}
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="office-alert">{error}</p> : null}
    {statuses.length ? <div aria-label="Payment history">{statuses.map((status,index)=><div key={status.id??index} className="office-payment-instructions"><strong>{status.state==='captured'?'Payment confirmed':status.state==='review_required'?'School review required':status.state==='failed'?'Attempt failed':'Awaiting confirmation'}</strong>{status.amount_paise!=null?<span>{rupees(status.amount_paise)}</span>:null}{status.provider_payment_id?<small>Payment reference: {status.provider_payment_id}</small>:null}<small>{status.email_status==='accepted'?'Email accepted by provider. Check your inbox or spam folder.':status.email_status==='unknown'?'Email delivery unconfirmed. Check the payment record here.':status.email_status==='skipped'?'Email not sent. Check your verified account email or contact the school.':status.email_status==='sending'?'Sending payment email…':status.email_status==='queued'?'Payment email queued.':'Payment status is saved in Eduera.'}</small>{status.state==='captured'&&status.payment_id?<a className="office-secondary" href={`${path}/receipts/${encodeURIComponent(status.payment_id)}/pdf/`}>Download PDF receipt</a>:null}</div>)}</div>:null}
  </section>;
}
