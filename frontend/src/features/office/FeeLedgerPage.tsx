import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, FileText, Printer, ReceiptIndianRupee } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { CollectionView } from "../../components/CollectionView";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFeeLedger, getFeeStudents, getGatewayPaymentReview, invoiceAmount, invoiceCollectionDue, invoiceDescription, invoiceStatusLabel, personName, postInvoice, recordPayment, rupees, type Invoice, type Payment } from "./api";
import { FeeChargeCorrectionDialog } from "./FeeChargeCorrectionDialog";
import { FeePaymentCorrectionDialog } from "./FeePaymentCorrectionDialog";
import { FeeCorrectionHistory } from "./FeeCorrectionHistory";
import { PaymentCorrectionNotice } from "./FamilyFeeRecords";
import { feeReadDenied } from "./personFeesApi";
import { feeQueryRoots } from "./feeQueryKeys";
import { feeLedgerReadOptions } from "./api";
import { FeeLedgerPaging } from "./FeeLedgerPaging";
import { FeePaymentSettings } from "./FeePaymentSettings";
import { FeeReviewHistory } from "./FeeReviewHistory";
import { FeeReviewQueue } from "./FeeReviewQueue";
import { FinanceArrangementsPanel } from "./FinanceArrangementsPanel";
import { NativeFeeReviewsPanel } from "./NativeFeeReviewsPanel";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import "./office.css";

import { TemporalInput } from "../../components/forms/TemporalInput";
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

/**
 * Institution-scoped finance responsibility. The route boundary decides whether
 * this responsibility is present; the finance APIs remain authoritative for
 * every record and command rendered here.
 */
export function FinanceResponsibilityWorkspace() {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment();
  if (environment?.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="unavailable" /></OperationsShell>;
  return <FinanceResponsibilityContext key={`${auth.user?.id}:${auth.user?.active_school_id}:${environment?.namespaceId ?? "live"}:${environment?.mode === "simulation" ? environment.runId : "live"}`} />;
}
function FinanceResponsibilityContext() {
  const auth = useAuth();
  const environment = useOptionalExecutionEnvironment(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [params,setParams] = useSearchParams();
  const schools = auth.memberships.filter((membership) => membership.permissions?.includes("fees.manage"));
  const currentSchoolId = schools.find(school=>school.school_id===params.get("school"))?.school_id || schools[0]?.school_id || "";
  const changeSchool=(id:string)=>{setError("");setParams(current=>{const next=new URLSearchParams(current);next.set("school",id);next.delete("student_id");next.delete("mode");next.delete("invoice");next.delete("review");next.delete("order");for (const field of ["ledger_cursor","ledger_payment_cursor","ledger_review_cursor","ledger_search","student_cursor","student_search"]) next.delete(field);return next;},{replace:true});};
  const studentId=params.get("student_id")??"";
  const changeStudent=(id:string)=>{setError("");setParams(current=>{const next=new URLSearchParams(current);if(id)next.set("student_id",id);else next.delete("student_id");next.delete("mode");next.delete("invoice");next.delete("review");next.delete("order");for (const field of ["ledger_cursor","ledger_payment_cursor","ledger_review_cursor","ledger_search"]) next.delete(field);return next;},{replace:true});};
  const focusReviewId=params.get("review");
  const nativeReviewId=params.get("native_review");
  const focusOrderId=params.get("order");
  const focusInvoiceId=params.get("invoice");
  const requestedView=params.get("view");
  const view=nativeReviewId?"native_review":focusReviewId||focusOrderId?"review":requestedView==="arrangements"||requestedView==="receipts"||requestedView==="review"||requestedView==="settings"?requestedView:"invoices";
  const mode=params.get("mode")==="invoice"?"invoice":params.get("mode")==="payment"?"payment":"none";
  const setView=(value:string)=>setParams(current=>{const next=new URLSearchParams(current);next.set("school",currentSchoolId);next.set("view",value);next.delete("mode");next.delete("invoice");next.delete("review");next.delete("order");return next;},{replace:true});
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [correction, setCorrection] = useState<{ schoolId: string; kind: "charge"; invoice: Invoice } | { schoolId: string; kind: "payment"; payment: Payment } | null>(null);
  const readOnly = environment?.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  useEffect(() => {
    const beforePrint = () => flushSync(() => setPrinting(true));
    const afterPrint = () => setPrinting(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => { window.removeEventListener("beforeprint", beforePrint); window.removeEventListener("afterprint", afterPrint); };
  }, []);
  const printStatement = () => { flushSync(() => setPrinting(true)); try { window.print(); } finally { setPrinting(false); } };
  const [error, setError] = useState("");
  const key = (parts: readonly unknown[]) => environment ? executionEnvironmentQueryKey(environment, parts) : parts;
  const readOptions = feeLedgerReadOptions(params, params.get("invoice") ?? undefined);
  const studentRead = { cursor: params.get("student_cursor") ?? undefined, search: params.get("student_search") ?? undefined };
  const students = useQuery({ queryKey: key([...feeQueryRoots.students, auth.user?.id, currentSchoolId, studentRead]), queryFn: () => getFeeStudents(currentSchoolId, studentRead), enabled: Boolean(currentSchoolId) });
  const nextStudents = students.data?.next_cursor;
  const ledger = useQuery({ queryKey: key([...feeQueryRoots.ledger, auth.user?.id, currentSchoolId, studentId, readOptions]), queryFn: () => getFeeLedger(currentSchoolId, studentId || undefined, readOptions), enabled: Boolean(currentSchoolId) });
  const exactGatewayReview = useQuery({
    queryKey: key([...feeQueryRoots.gateway, auth.user?.id, currentSchoolId, focusOrderId]),
    queryFn: () => getGatewayPaymentReview(currentSchoolId, focusOrderId!),
    enabled: Boolean(currentSchoolId && focusOrderId),
    retry: false,
    staleTime: 5_000,
  });
  const invoices = ledger.data?.invoices ?? [];
  const selected=invoices.find(item=>item.id===params.get("invoice"));
  const listedGatewayReviews=ledger.data?.gateway_payments?.filter(item=>item.state==="review_required")??[];
  const focusedGatewayReview=focusOrderId&&focusInvoiceId&&exactGatewayReview.data?.id===focusOrderId&&exactGatewayReview.data.invoice_id===focusInvoiceId&&exactGatewayReview.data.state==="review_required"?exactGatewayReview.data:undefined;
  const gatewayReviews=focusOrderId
    ? [...(focusedGatewayReview?[focusedGatewayReview]:[]),...listedGatewayReviews.filter(item=>item.id!==focusOrderId)]
    : listedGatewayReviews;
  const gatewayTargetLoading=Boolean(focusOrderId&&exactGatewayReview.isPending);
  const gatewayTargetUnavailable=Boolean(focusOrderId&&!exactGatewayReview.isPending&&(exactGatewayReview.isError||!focusedGatewayReview));
  const focusedFeeReview=focusReviewId?ledger.data?.reviews?.find(item=>item.id===focusReviewId):undefined;
  const feeReviewTargetUnavailable=Boolean(focusReviewId&&ledger.isSuccess&&!focusedFeeReview);
  const gatewayTargetRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!focusedGatewayReview)return;
    const frame=window.requestAnimationFrame(()=>{
      gatewayTargetRef.current?.scrollIntoView?.({behavior:"smooth",block:"center"});
      gatewayTargetRef.current?.focus({preventScroll:true});
    });
    return()=>window.cancelAnimationFrame(frame);
  },[focusedGatewayReview]);
  const payments = ledger.data?.payments ?? [];
  const summary = ledger.data?.totals ?? invoices.reduce((totals, item) => ({ billed: totals.billed + item.adjusted_amount_paise, received: totals.received + item.paid_paise, outstanding: totals.outstanding + item.balance_paise, refunds: totals.refunds + item.refund_due_paise }), { billed: 0, received: 0, outstanding: 0, refunds: 0 });
  const openInvoices = ledger.data?.totals?.open ?? invoices.filter((item) => item.collection_state === "collectible" && item.balance_paise > 0).length;
  const reset = () => { setParams(current=>{const next=new URLSearchParams(current);next.delete("mode");next.delete("invoice");next.delete("review");next.delete("order");return next;},{replace:true}); setError(""); };
  const openForm=(form:"invoice"|"payment",invoice?:Invoice)=>{setError("");setPaymentKey(crypto.randomUUID());setParams(current=>{const next=new URLSearchParams(current);next.set("school",currentSchoolId);next.set("mode",form);if(invoice)next.set("invoice",invoice.id);else next.delete("invoice");next.delete("ledger_payment_cursor");next.delete("ledger_review_cursor");return next;});};
  const listParams=new URLSearchParams(params);listParams.delete("mode");listParams.delete("invoice");listParams.delete("review");listParams.delete("order");
  const listPath=`/areas/fees/ledger${listParams.size?`?${listParams}`:""}`;
  const rootParams=new URLSearchParams(listParams);rootParams.delete("view");
  const rootPath=`/areas/fees/ledger${rootParams.size?`?${rootParams}`:""}`;
  const pendingReviews=ledger.data?.reviews?.filter(item=>item.status==="pending").length??0;

  async function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try {
      await postInvoice(currentSchoolId, { student_id: values.get("student_id"), reference: values.get("reference"), description: values.get("description"), due_on: values.get("due_on"), amount_paise: paise(values.get("amount")) });
      if (!active.current) return;
      await ledger.refetch(); if (active.current) reset();
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
      if (!active.current) return;
      await ledger.refetch(); if (active.current) { reset(); setPaymentKey(crypto.randomUUID()); }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <OperationsShell active="areas" title={mode==="invoice"?"Post invoice":mode==="payment"?"Record payment":view==="arrangements"?"Payment plans":view==="review"?"Fee reviews":view==="settings"?"Payment settings":"Fees & receipts"} schoolName={schools.find((school) => school.school_id === currentSchoolId)?.school_name} backTo={mode!=="none"?listPath:view==="arrangements"||view==="review"||view==="settings"?rootPath:"/areas/fees"}>
    <div className="office-page office-page--fees">
      {schools.length > 1 ? <label className="office-field office-context-field">School<select value={currentSchoolId} onChange={(event) => changeSchool(event.target.value)}>{schools.map((school) => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label> : null}
      {!currentSchoolId ? <p className="office-alert">An active finance responsibility is required.</p> : students.isPending || ledger.isPending ? <ScreenLoading /> : feeReadDenied(students.error) || feeReadDenied(ledger.error) || students.isError && !students.data || ledger.isError && !ledger.data ? <LiveRouteError error={students.error ?? ledger.error} onRetry={async () => { await Promise.all([students.refetch(), ledger.refetch()]); }} /> : <>
        {ledger.error || students.error ? <p role="alert">Records could not be refreshed. Previously loaded records and unsent corrections are kept. <button type="button" className="office-secondary" onClick={() => void Promise.all([students.refetch(), ledger.refetch()])}>Try again</button></p> : null}
        {(mode === "none" && view !== "settings" || mode === "invoice") ? <div><label className="office-field">Find a student<input type="search" value={studentRead.search ?? ""} maxLength={80} onChange={event => setParams(current => { const next = new URLSearchParams(current); if (event.target.value) next.set("student_search", event.target.value); else next.delete("student_search"); next.delete("student_cursor"); return next; }, { replace: true })} /></label>
          <div className="office-actions">{studentRead.cursor ? <button type="button" className="office-secondary" onClick={() => setParams(current => { const next = new URLSearchParams(current); next.delete("student_cursor"); return next; })}>First students</button> : null}{nextStudents ? <button type="button" className="office-secondary" onClick={() => setParams(current => { const next = new URLSearchParams(current); next.set("student_cursor", nextStudents); return next; })}>Next students</button> : null}</div></div> : null}
        {mode==="none" && view!=="settings" ? <label className="office-field office-student-filter">Student<select value={studentId} onChange={(event) => { changeStudent(event.target.value); }}><option value="">All students</option>{studentId && !students.data?.results.some(student => student.id === studentId) ? <option value={studentId}>Selected student</option> : null}{students.data?.results.map((student) => <option key={student.id} value={student.id}>{personName(student)}, {student.admission_number}</option>)}</select></label> : null}
        {mode === "none" && view === "review" ? <><FeeLedgerPaging pagination={ledger.data?.pagination} /><FeeLedgerPaging pagination={ledger.data?.pagination} reviews /></> : null}
        {mode==="none" && (view==="invoices"||view==="receipts") ? <>
        <nav className="office-fee-tools" aria-label="Fee actions"><button className="office-primary" type="button" onClick={()=>openForm("invoice")}><FileText size={17}/>Post invoice</button><button className="office-secondary" type="button" aria-label="Print statement" onClick={printStatement}><Printer size={17}/></button><button className="workspace-text-action" onClick={()=>setView("arrangements")}>Payment plans</button><button className="workspace-text-action" onClick={()=>setView("review")}>Reviews{pendingReviews>0?` · ${pendingReviews}`:""}</button><button className="workspace-text-action" onClick={()=>setView("settings")}>Settings</button></nav>
        <details className="workspace-disclosure office-fee-summary"><summary>Outstanding {rupees(summary.outstanding)} · {openInvoices} open{summary.refunds>0?` · ${rupees(summary.refunds)} refund due`:""}</summary>
        <section className="office-finance-overview" aria-label="Fee balance summary"><div className="office-finance-balance"><span>Outstanding balance</span><strong>{rupees(summary.outstanding)}</strong><small>{openInvoices} open invoice{openInvoices === 1 ? "" : "s"}</small></div><div className="office-finance-stats"><div><span>Received</span><strong>{rupees(summary.received)}</strong></div><div><span>Adjusted billed</span><strong>{rupees(summary.billed)}</strong></div><div className={summary.refunds ? "has-refund" : ""}><span>Refund due</span><strong>{rupees(summary.refunds)}</strong></div></div></section>
        <p className="office-notice office-notice--neutral"><CircleAlert size={16} /><span>Credits reduce the collectible balance. Posted records stay in the ledger.</span></p>
        </details>
        </> : null}
        {mode==="none" && view==="arrangements" && environment ? <FinanceArrangementsPanel standalone schoolId={currentSchoolId} {...(studentId?{studentId}:{})} {...(focusInvoiceId?{invoiceId:focusInvoiceId}:{})} {...(params.get("arrangement")?{focusRequestId:params.get("arrangement")!}:{})} /> : null}
        {mode==="none" && view==="native_review" && environment ? <NativeFeeReviewsPanel schoolId={currentSchoolId} {...(studentId?{studentId}:{})} {...(focusInvoiceId?{invoiceId:focusInvoiceId}:{})} focusReviewId={nativeReviewId!} onLedgerReload={() => ledger.refetch({throwOnError:true})} /> : null}
        {mode === "invoice" ? <section className="office-panel office-panel--selected"><div className="office-panel-heading"><span className="office-panel-icon"><ProductIcon name="fees" size={28} /></span><div><h2>Post a student invoice</h2><p>Creates an immutable financial record.</p></div></div><form className="office-form" onSubmit={(event) => void submitInvoice(event)}><label className="office-field">Student<select name="student_id" required defaultValue={studentId}><option value="" disabled>Select student</option>{students.data?.results.map((student) => <option key={student.id} value={student.id}>{personName(student)}, {student.admission_number}</option>)}</select></label><label className="office-field">Invoice reference<input name="reference" maxLength={80} required placeholder="INV-2026-0042" /></label><label className="office-field">Fee breakdown<input name="description" maxLength={200} required placeholder="Term 1 tuition and activity fee" /></label><div className="office-form-grid"><label className="office-field">Amount (₹)<input name="amount" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" required /></label><label className="office-field">Due date<TemporalInput name="due_on" type="date" required /></label></div><label className="office-check"><input type="checkbox" required /> I reviewed this invoice. Posted records cannot be edited or deleted.</label>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions"><button type="button" className="office-secondary" onClick={reset}>Cancel</button><button className="office-primary" disabled={busy}>{busy ? "Posting…" : "Post invoice"}</button></div></form></section> : null}
        {mode === "payment" && selected ? <section className="office-panel office-panel--selected"><div className="office-panel-heading"><span className="office-panel-icon"><ProductIcon name="finance" size={28} /></span><div><h2>Record payment</h2><p>{selected.reference}, {personName(selected)}</p></div><b>{rupees(selected.balance_paise)}</b></div><form className="office-form" onSubmit={(event) => void submitPayment(event)}><label className="office-field">Amount received (₹)<input name="amount" type="number" min="0.01" max={(selected.balance_paise / 100).toFixed(2)} step="0.01" inputMode="decimal" required defaultValue={(selected.balance_paise / 100).toFixed(2)} /></label><label className="office-field">Method<select name="method"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label><label className="office-field">Receipt, bank or cheque reference<input name="reference" maxLength={120} required /></label><label className="office-check"><input type="checkbox" required /> Funds have been received and verified. Any cheque has cleared.</label>{error ? <p className="office-alert" role="alert">{error}</p> : null}<div className="office-actions"><button type="button" className="office-secondary" onClick={reset}>Cancel</button><button className="office-primary" disabled={busy}>{busy ? "Recording…" : "Confirm receipt"}</button></div></form></section> : null}
        {mode==="payment" && !selected ? <p role="alert">This invoice is not available in the current ledger. <Link to={listPath} replace>Return to records</Link></p> : null}
        {mode==="none" && view==="settings" ? <FeePaymentSettings key={currentSchoolId} schoolId={currentSchoolId} settings={ledger.data?.payment_settings} onSaved={ledger.refetch} defaultOpen /> : null}
        {mode==="none" && view==="review" ? <>{gatewayTargetLoading?<section className="office-gateway-review office-gateway-review--unavailable" role="status"><CircleAlert size={18}/><div><strong>Opening payment review…</strong><p>Checking the current school record.</p></div></section>:null}{gatewayTargetUnavailable?<section className="office-gateway-review office-gateway-review--unavailable" role="alert"><CircleAlert size={18}/><div><strong>Payment review unavailable</strong><p>This captured payment no longer needs review, is outside your current school access, or does not match the linked invoice.</p><button className="office-secondary" type="button" onClick={()=>void exactGatewayReview.refetch()}>Try again</button></div></section>:null}{feeReviewTargetUnavailable?<section className="office-gateway-review office-gateway-review--unavailable" role="alert"><CircleAlert size={18}/><div><strong>Fee review unavailable</strong><p>This review no longer belongs to the current school ledger.</p></div></section>:null}{gatewayReviews.length ? <section aria-label="Provider payments to reconcile"><p className="office-hint">This list checks up to the 100 most recent provider orders. Search covers those loaded orders only; a linked payment is checked separately.</p><CollectionView items={gatewayReviews} namespace="gateway_reviews" label="provider payments" searchLabel="Find a provider payment" searchPlaceholder="Invoice or provider payment reference" searchText={(item) => `${item.provider_payment_id ?? ""} ${invoices.find((invoice) => invoice.id === item.invoice_id)?.reference ?? ""}`} focusedId={focusedGatewayReview?.id}>{(visible) => visible.map(item=>{const invoice=invoices.find(candidate=>candidate.id===item.invoice_id);const focused=item.id===focusedGatewayReview?.id;return <article ref={focused?gatewayTargetRef:undefined} id={focused?`attention-payment-order-${item.id}`:undefined} tabIndex={focused?-1:undefined} className={`office-gateway-review${focused?" is-attention-target":""}`} key={item.id}><CircleAlert size={18}/><div><strong>Captured payment needs reconciliation</strong><p>{rupees(item.amount_paise)} · {invoice?.reference??"Invoice unavailable"}{item.provider_payment_id?` · ${item.provider_payment_id}`:""}</p><small>Captured after the balance changed. Verify the provider record before collecting again.</small></div></article>;})}</CollectionView></section> : null}<FeeReviewQueue schoolId={currentSchoolId} reviews={ledger.data?.reviews ?? []} invoices={invoices} onSaved={ledger.refetch} focusReviewId={focusedFeeReview?.status==="pending"?focusReviewId:null} /><FeeReviewHistory reviews={(ledger.data?.reviews ?? []).filter((item) => item.status !== "pending")} invoices={invoices} focusReviewId={focusedFeeReview?.status!=="pending"?focusReviewId??undefined:undefined}/></> : null}
        {mode==="none" && (view==="invoices"||view==="receipts") ? <>
        <FeeLedgerPaging pagination={ledger.data?.pagination} receipts={view === "receipts"} />
        <nav className="office-tabs office-ledger-tabs" aria-label="Ledger records"><button type="button" className={view === "invoices" ? "is-active" : ""} aria-current={view === "invoices" ? "page" : undefined} onClick={() => setView("invoices")}><FileText size={16} />Invoices <span>{invoices.length}</span></button><button type="button" className={view === "receipts" ? "is-active" : ""} aria-current={view === "receipts" ? "page" : undefined} onClick={() => setView("receipts")}><ReceiptIndianRupee size={16} />Receipts <span>{payments.length}</span></button></nav>
        {view === "invoices" ? <section className="office-panel office-ledger-panel"><h2 className="sr-only">Invoices</h2>
          <CollectionView items={invoices} namespace="invoices" label="invoices" searchLabel="Find an invoice" searchPlaceholder="Person, admission number, reference or fee" searchText={item => `${personName(item)} ${item.admission_number} ${item.reference} ${invoiceDescription(item)}`} categoryLabel="Invoice status" categories={[...new Set(invoices.map(invoiceStatusLabel))].map(status => ({ value: statusClass(status), label: status, matches: (item: Invoice) => invoiceStatusLabel(item) === status }))} renderAllForPrint={printing} empty={<p className="office-empty">No invoices have been issued. This does not mean all fees are cleared.</p>}>
            {visible => <ul className="office-invoices">{visible.map(item => { const status = invoiceStatusLabel(item); return <li key={item.id}>
              <div className="office-invoice-top"><div><strong>{item.reference}</strong><span>{personName(item)}, {item.admission_number}</span></div><span className={`office-status office-status--${statusClass(status)}`}>{status}</span></div><p>{invoiceDescription(item)}</p>
              <div className="office-invoice-amounts"><div><span>Balance</span><strong>{rupees(item.balance_paise)}</strong></div><div><span>Billed</span><strong>{rupees(invoiceAmount(item))}</strong></div><div><span>{item.payment_plan_state === "active" ? "Agreed date" : "Due"}</span><strong>{invoiceCollectionDue(item) ? formatLedgerDate(invoiceCollectionDue(item)!) : item.payment_plan_state === "needs_review" ? "Needs review" : "—"}</strong></div></div>
              <FeeCorrectionHistory invoice={item} />
              <div className="office-actions">{item.collection_state === "collectible" && item.balance_paise > 0 ? <button type="button" className="office-secondary office-record-payment" onClick={() => openForm("payment", item)}>Record payment</button> : <p className="office-settled"><CircleCheck size={15} /> No payment action required</p>}{item.can_correct === true && !readOnly ? <button type="button" className="office-secondary" disabled={Boolean(ledger.error)} onClick={() => setCorrection({ schoolId: currentSchoolId, kind: "charge", invoice: item })}>Correct charge</button> : null}</div>
            </li>; })}</ul>}
          </CollectionView>
        </section> : <section className="office-panel office-ledger-panel"><h2 className="sr-only">Receipt register</h2>
          <CollectionView items={payments} namespace="receipts" label="receipts" searchLabel="Find a receipt" searchPlaceholder="Payment or invoice reference" searchText={payment => `${payment.reference} ${invoices.find(invoice => invoice.id === payment.invoice_id)?.reference ?? payment.invoice_reference ?? ""} ${payment.method.replaceAll("_", " ")}`} categoryLabel="Payment method" categories={[...new Set(payments.map(payment => payment.method))].map(method => ({ value: method, label: method.replaceAll("_", " "), matches: (payment: Payment) => payment.method === method }))} renderAllForPrint={printing} empty={<p className="office-empty">No receipts recorded.</p>}>
            {visible => <ul className="office-receipts">{visible.map(payment => <li key={payment.id}><span className="office-receipt-icon"><ReceiptIndianRupee size={18} /></span><div><strong>{payment.reference}</strong><span>{invoices.find(invoice => invoice.id === payment.invoice_id)?.reference ?? payment.invoice_reference ?? "Invoice"}, {payment.method.replaceAll("_", " ")}</span><small>{formatLedgerDate(payment.created_at)}</small><PaymentCorrectionNotice payment={payment} />{!readOnly && (payment.can_reverse === true || payment.can_replace === true) ? <button type="button" className="office-secondary" disabled={Boolean(ledger.error)} onClick={() => setCorrection({ schoolId: currentSchoolId, kind: "payment", payment })}>Correct receipt</button> : null}</div><b>{rupees(payment.amount_paise)}</b></li>)}</ul>}
          </CollectionView>
        </section>}
        </> : null}
        {correction?.schoolId === currentSchoolId && correction.kind === "charge" ? <FeeChargeCorrectionDialog key={`${currentSchoolId}:${correction.invoice.id}`} schoolId={currentSchoolId} invoices={[correction.invoice]} onReload={() => ledger.refetch({ throwOnError: true })} onClose={() => setCorrection(null)} /> : null}
        {correction?.schoolId === currentSchoolId && correction.kind === "payment" ? <FeePaymentCorrectionDialog key={`${currentSchoolId}:${correction.payment.id}`} schoolId={currentSchoolId} payment={correction.payment} onReload={() => ledger.refetch({ throwOnError: true })} onClose={() => setCorrection(null)} /> : null}
      </>}
    </div>
  </OperationsShell>;
}

/** Compatibility export for callers that have not moved to FeesWorkspaceRoutes. */
export default function FeeLedgerPage() {
  return <FinanceResponsibilityWorkspace />;
}
