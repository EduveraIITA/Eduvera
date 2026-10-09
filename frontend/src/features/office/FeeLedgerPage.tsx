import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, FileText, Printer, ReceiptIndianRupee, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFeeLedger, getFeeStudents, invoiceStatusLabel, personName, postInvoice, recordPayment, rupees, type Invoice } from "./api";
import { FeePaymentSettings } from "./FeePaymentSettings";
import { FeeReviewHistory } from "./FeeReviewHistory";
import { FeeReviewQueue } from "./FeeReviewQueue";
import "./office.css";

function paise(value: FormDataEntryValue | null) {
  const input = (typeof value === "string" ? value : "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) throw new Error("Enter an amount in rupees, with at most two decimal places.");
  const [whole, fraction = ""] = input.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) throw new Error("Enter an amount between ₹0.01 and ₹10,00,000.");
  return amount;
}

const formatLedgerDate = (value: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
const statusClass = (status: string) => status.toLowerCase().replaceAll(" ", "-");

export default function FeeLedgerPage() {
  const auth = useAuth();
  const [params,setParams] = useSearchParams();
  const portal=auth.hasPortal("principal")?"principal":"teacher";
  const schools = auth.memberships.filter((membership) => (membership.role === "admin" || (membership.role === "staff" && membership.permissions?.includes("fees.manage"))));
  const currentSchoolId = schools.find(school=>school.school_id===params.get("school"))?.school_id || schools[0]?.school_id || "";
  const changeSchool=(id:string)=>{setError("");setParams(current=>{const next=new URLSearchParams(current);next.set("school",id);next.delete("student_id");next.delete("mode");next.delete("invoice");return next;});};
  const studentId=params.get("student_id")??"";
  const changeStudent=(id:string)=>{setError("");setParams(current=>{const next=new URLSearchParams(current);if(id)next.set("student_id",id);else next.delete("student_id");next.delete("mode");next.delete("invoice");return next;});};
  const requestedView=params.get("view");
  const view=requestedView==="receipts"||requestedView==="review"||(requestedView==="settings"&&portal==="principal")?requestedView:"invoices";
  const mode=params.get("mode")==="invoice"?"invoice":params.get("mode")==="payment"?"payment":"none";
  const setView=(value:string)=>setParams(current=>{const next=new URLSearchParams(current);next.set("school",currentSchoolId);next.set("view",value);next.delete("mode");next.delete("invoice");return next;});
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const students = useQuery({ queryKey: ["office", "fee-students", currentSchoolId], queryFn: () => getFeeStudents(currentSchoolId), enabled: Boolean(currentSchoolId) });
  const ledger = useQuery({ queryKey: ["office", "fees", currentSchoolId, studentId], queryFn: () => getFeeLedger(currentSchoolId, studentId || undefined), enabled: Boolean(currentSchoolId) });
  const invoices = ledger.data?.invoices ?? [];
  const selected=invoices.find(item=>item.id===params.get("invoice"));
  const payments = ledger.data?.payments ?? [];
  const summary = invoices.reduce((totals, item) => ({ billed: totals.billed + item.adjusted_amount_paise, received: totals.received + item.paid_paise, outstanding: totals.outstanding + item.balance_paise, refunds: totals.refunds + item.refund_due_paise }), { billed: 0, received: 0, outstanding: 0, refunds: 0 });
  const openInvoices = invoices.filter((item) => item.collection_state === "collectible" && item.balance_paise > 0).length;
  const reset = () => { setParams(current=>{const next=new URLSearchParams(current);next.delete("mode");next.delete("invoice");return next;}); setError(""); };
  const openForm=(form:"invoice"|"payment",invoice?:Invoice)=>{setError("");setPaymentKey(crypto.randomUUID());setParams(current=>{const next=new URLSearchParams(current);next.set("school",currentSchoolId);next.set("mode",form);if(invoice)next.set("invoice",invoice.id);else next.delete("invoice");return next;});};
  const listParams=new URLSearchParams(params);listParams.delete("mode");listParams.delete("invoice");
  const listPath=`/${portal}/fees${listParams.size?`?${listParams}`:""}`;
  const rootParams=new URLSearchParams(listParams);rootParams.delete("view");
  const rootPath=`/${portal}/fees${rootParams.size?`?${rootParams}`:""}`;
  const pendingReviews=ledger.data?.reviews?.filter(item=>item.status==="pending").length??0;

  async function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try {
      await postInvoice(currentSchoolId, { student_id: values.get("student_id"), reference: values.get("reference"), description: values.get("description"), due_on: values.get("due_on"), amount_paise: paise(values.get("amount")) });
      await ledger.refetch(); reset();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(""); const values = new FormData(event.currentTarget);
    try {
      const amount = paise(values.get("amount"));
      if (amount > selected.balance_paise) throw new Error(`Payment exceeds the ${rupees(selected.balance_paise)} balance.`);
      await recordPayment(currentSchoolId, selected.id, { amount_paise: amount, method: values.get("method"), reference: values.get("reference"), idempotency_key: paymentKey });
      await ledger.refetch(); reset(); setPaymentKey(crypto.randomUUID());
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <OperationsShell portal={portal} active="more" title={mode==="invoice"?"Post invoice":mode==="payment"?"Record payment":view==="review"?"Fee reviews":view==="settings"?"Payment settings":"Fees & receipts"} schoolName={schools.find((school) => school.school_id === currentSchoolId)?.school_name} backTo={mode!=="none"?listPath:view==="review"||view==="settings"?rootPath:`/${portal}/more`} contentHasHeading>
    <div className="office-page office-page--fees">
      {schools.length > 1 ? <label className="office-field office-context-field">School<select value={currentSchoolId} onChange={(event) => changeSchool(event.target.value)}>{schools.map((school) => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label> : null}
      {!currentSchoolId ? <p className="office-alert">An active administrator membership is required.</p> : students.isPending || ledger.isPending ? <ScreenLoading /> : students.isError || ledger.isError ? <LiveRouteError error={students.error ?? ledger.error} onRetry={async () => { await Promise.all([students.refetch(), ledger.refetch()]); }} /> : <>
        {mode==="none" && view!=="settings" ? <label className="office-field office-student-filter">Student<select value={studentId} onChange={(event) => { changeStudent(event.target.value); }}><option value="">All students</option>{students.data?.results.map((student) => <option key={student.id} value={student.id}>{personName(student)}, {student.admission_number}</option>)}</select></label> : null}
        {mode==="none" && (view==="invoices"||view==="receipts") ? <>
        <nav className="office-fee-tools" aria-label="Fee actions"><button className="office-primary" type="button" onClick={()=>openForm("invoice")}><FileText size={17}/>Post invoice</button><button className="office-secondary" type="button" aria-label="Print statement" onClick={()=>window.print()}><Printer size={17}/></button><button className="workspace-text-action" onClick={()=>setView("review")}>Reviews{pendingReviews>0?` · ${pendingReviews}`:""}</button>{portal==="principal"?<button className="workspace-text-action" onClick={()=>setView("settings")}>Settings</button>:null}</nav>
        <details className="workspace-disclosure office-fee-summary"><summary>Outstanding {rupees(summary.outstanding)} · {openInvoices} open{summary.refunds>0?` · ${rupees(summary.refunds)} refund due`:""}</summary>
        <section className="office-finance-overview" aria-label="Fee balance summary"><div className="office-finance-balance"><span>Outstanding balance</span><strong>{rupees(summary.outstanding)}</strong><small>{openInvoices} open invoice{openInvoices === 1 ? "" : "s"}</small></div><div className="office-finance-stats"><div><span>Received</span><strong>{rupees(summary.received)}</strong></div><div><span>Adjusted billed</span><strong>{rupees(summary.billed)}</strong></div><div className={summary.refunds ? "has-refund" : ""}><span>Refund due</span><strong>{rupees(summary.refunds)}</strong></div></div></section>
        <p className="office-notice office-notice--neutral"><CircleAlert size={16} /><span>Credits reduce the collectible balance. Posted records stay in the ledger.</span></p>
        </details>
        </> : null}
        {mode === "invoice" ? <section className="office-panel office-panel--selected"><div className="office-panel-heading"><span className="office-panel-icon"><FileText size={19} /></span><div><h2>Post a student invoice</h2><p>Creates an immutable financial record.</p></div></div><form className="office-form" onSubmit={(event) => void submitInvoice(event)}><label className="office-field">Student<select name="student_id" required defaultValue={studentId}><option value="" disabled>Select student</option>{students.data?.results.map((student) => <option key={student.id} value={student.id}>{personName(student)}, {student.admission_number}</option>)}</select></label><label className="office-field">Invoice reference<input name="reference" maxLength={80} required placeholder="INV-2026-0042" /></label><label className="office-field">Fee breakdown<input name="description" maxLength={200} required placeholder="Term 1 tuition and activity fee" /></label><div className="office-form-grid"><label className="office-field">Amount (₹)<input name="amount" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required /></label><label className="office-field">Due date<input name="due_on" type="date" required /></label></div><label className="office-check"><input type="checkbox" required /> I reviewed this invoice. Posted records cannot be edited or deleted.</label>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions"><button type="button" className="office-secondary" onClick={reset}>Cancel</button><button className="office-primary" disabled={busy}>{busy ? "Posting…" : "Post invoice"}</button></div></form></section> : null}
        {mode === "payment" && selected ? <section className="office-panel office-panel--selected"><div className="office-panel-heading"><span className="office-panel-icon"><Wallet size={19} /></span><div><h2>Record payment</h2><p>{selected.reference}, {personName(selected)}</p></div><b>{rupees(selected.balance_paise)}</b></div><form className="office-form" onSubmit={(event) => void submitPayment(event)}><label className="office-field">Amount received (₹)<input name="amount" type="number" min="0.01" max={(selected.balance_paise / 100).toFixed(2)} step="0.01" inputMode="decimal" required defaultValue={(selected.balance_paise / 100).toFixed(2)} /></label><label className="office-field">Method<select name="method"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label><label className="office-field">Receipt, bank or cheque reference<input name="reference" maxLength={120} required /></label><label className="office-check"><input type="checkbox" required /> Funds have been received and verified. Any cheque has cleared.</label>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions"><button type="button" className="office-secondary" onClick={reset}>Cancel</button><button className="office-primary" disabled={busy}>{busy ? "Recording…" : "Confirm receipt"}</button></div></form></section> : null}
        {mode==="payment" && !selected ? <p role="alert">This invoice is not available in the current ledger. <Link to={listPath}>Return to records</Link></p> : null}
        {mode==="none" && view==="settings" && portal==="principal" ? <FeePaymentSettings key={currentSchoolId} schoolId={currentSchoolId} settings={ledger.data?.payment_settings} onSaved={ledger.refetch} defaultOpen /> : null}
        {mode==="none" && view==="review" ? <>{ledger.data?.gateway_payments?.filter(item => item.state === "review_required").map(item => <p className="office-alert" key={item.id}>Sandbox payment {item.provider_payment_id} · {rupees(item.amount_paise)} · {invoices.find(invoice => invoice.id === item.invoice_id)?.reference}. Captured after the balance changed; reconcile in Razorpay before collecting again.</p>)}<FeeReviewQueue schoolId={currentSchoolId} reviews={ledger.data?.reviews ?? []} invoices={invoices} onSaved={ledger.refetch} /><FeeReviewHistory reviews={(ledger.data?.reviews ?? []).filter((item) => item.status !== "pending")} invoices={invoices} /></> : null}
        {mode==="none" && (view==="invoices"||view==="receipts") ? <>
        <nav className="office-tabs office-ledger-tabs" aria-label="Ledger records"><button type="button" className={view === "invoices" ? "is-active" : ""} aria-current={view === "invoices" ? "page" : undefined} onClick={() => setView("invoices")}><FileText size={16} />Invoices <span>{invoices.length}</span></button><button type="button" className={view === "receipts" ? "is-active" : ""} aria-current={view === "receipts" ? "page" : undefined} onClick={() => setView("receipts")}><ReceiptIndianRupee size={16} />Receipts <span>{payments.length}</span></button></nav>
        {view === "invoices" ? <section className="office-panel office-ledger-panel"><h2 className="sr-only">Invoices</h2>{invoices.length ? <ul className="office-invoices">{invoices.map((item) => { const status = invoiceStatusLabel(item); return <li key={item.id}><div className="office-invoice-top"><div><strong>{item.reference}</strong><span>{personName(item)}, {item.admission_number}</span></div><span className={`office-status office-status--${statusClass(status)}`}>{status}</span></div><p>{item.description}</p><div className="office-invoice-amounts"><div><span>Balance</span><strong>{rupees(item.balance_paise)}</strong></div><div><span>Billed</span><strong>{rupees(item.amount_paise)}</strong></div><div><span>Due</span><strong>{formatLedgerDate(item.due_on)}</strong></div></div>{item.collection_state === "collectible" && item.balance_paise > 0 ? <button type="button" className="office-secondary office-record-payment" onClick={() => openForm("payment",item)}>Record payment</button> : <p className="office-settled"><CircleCheck size={15} /> No payment action required</p>}</li>; })}</ul> : <p className="office-empty">No invoices have been issued. This does not mean all fees are cleared.</p>}</section> : <section className="office-panel office-ledger-panel"><h2 className="sr-only">Receipt register</h2>{payments.length ? <ul className="office-receipts">{payments.map((payment) => <li key={payment.id}><span className="office-receipt-icon"><ReceiptIndianRupee size={18} /></span><div><strong>{payment.reference}</strong><span>{invoices.find((invoice) => invoice.id === payment.invoice_id)?.reference ?? "Invoice"}, {payment.method.replaceAll("_", " ")}</span><small>{formatLedgerDate(payment.created_at)}</small></div><b>{rupees(payment.amount_paise)}</b></li>)}</ul> : <p className="office-empty">No receipts recorded.</p>}</section>}
        </> : null}
      </>}
    </div>
  </OperationsShell>;
}
