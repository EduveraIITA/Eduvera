import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { feeLedgerReadOptions, getFeeLedger, invoiceStatusLabel } from "./api";
import { FeeLedgerPaging } from "./FeeLedgerPaging";
import { feeQueryRoots } from "./feeQueryKeys";
import { FamilyFeeActions } from "./FamilyFeeActions";
import { FeeReviewHistory } from "./FeeReviewHistory";
import { FamilyInvoiceList, FamilyReceiptList, FamilyReceiptDetail, PrintFeeButton } from "./FamilyFeeRecords";
import { FamilyFeePrint } from "./FamilyFeePrint";
import "./office.css";
import "./family-fees.css";
import { FamilyFeeOverview, FamilyFeeFilter, FeeHelp, type FeeFilter } from "./FamilyFeeOverview";
import { FamilyInvoiceStatement } from "./FamilyInvoiceStatement";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { FinanceArrangementsPanel } from "./FinanceArrangementsPanel";
import { NativeFeeReviewsPanel } from "./NativeFeeReviewsPanel";
import { WorkspaceState } from "../workspace/WorkspaceState";

export interface RelationshipFeeAccountWorkspaceProps {
  readonly relationship: "self" | "dependent";
  /** Exact learner identity resolved from the authorized workspace manifest. */
  readonly studentId?: string;
}

/**
 * Exact self/dependent fee account. When a canonical route supplies studentId,
 * this component never substitutes another accessible learner after revocation
 * or relationship drift.
 */
export function RelationshipFeeAccountWorkspace({ relationship, studentId: exactStudentId }: RelationshipFeeAccountWorkspaceProps) {
  const auth = useAuth(), environment = useOptionalExecutionEnvironment();
  if (environment?.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="unavailable" /></OperationsShell>;
  return <RelationshipFeeAccountContext key={`${auth.user?.id}:${auth.user?.active_school_id}:${environment?.namespaceId ?? "live"}:${environment?.mode === "simulation" ? environment.runId : "live"}:${relationship}:${exactStudentId ?? ""}`} relationship={relationship} {...(exactStudentId ? { studentId: exactStudentId } : {})} />;
}
function RelationshipFeeAccountContext({ relationship, studentId: exactStudentId }: RelationshipFeeAccountWorkspaceProps) {
  const auth = useAuth();
  const environment = useOptionalExecutionEnvironment(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [params, setParams] = useSearchParams();
  const schoolId = auth.user?.active_school_id ?? auth.memberships[0]?.school_id ?? "";
  const membership = auth.memberships.find((item) => item.school_id === schoolId);
  const isDependent = relationship === "dependent";
  const key = (parts: readonly unknown[]) => environment ? executionEnvironmentQueryKey(environment, parts) : parts;
  const children = useQuery({ queryKey: key(["school", "accessible-students", auth.user?.id, schoolId]), queryFn: getAccessibleStudents, enabled: Boolean(schoolId) });
  const requestedStudentId = exactStudentId ?? params.get("student_id") ?? "";
  const requestedStudent = children.data?.results.find((student) => student.id === requestedStudentId);
  const studentId = requestedStudent?.id ?? (exactStudentId ? "" : children.data?.results[0]?.id ?? "");
  const selectedChild = children.data?.results.find((student) => student.id === studentId);
  const readOptions = feeLedgerReadOptions(params, params.get("invoice") ?? undefined);
  const ledger = useQuery({ queryKey: key([...feeQueryRoots.family, auth.user?.id, schoolId, studentId, readOptions]), queryFn: () => getFeeLedger(schoolId, studentId, readOptions), enabled: Boolean(schoolId && studentId) });
  const reload = () => active.current ? ledger.refetch({ throwOnError: true }) : Promise.resolve(undefined);
  const view = params.get("view") === "arrangements" ? "arrangements" : params.get("view") === "receipts" ? "receipts" : params.get("view") === "reviews" ? "reviews" : "invoices";
  const filter: FeeFilter = ["unpaid", "overdue", "settled"].includes(params.get("filter") ?? "") ? params.get("filter") as FeeFilter : "all";
  const filteredInvoices = (ledger.data?.invoices ?? []).filter(item => filter === "unpaid" ? item.balance_paise > 0 : filter === "overdue" ? item.balance_paise > 0 && invoiceStatusLabel(item) === "Overdue" : filter === "settled" ? item.balance_paise === 0 : true);
  const invoiceId = params.get("invoice");
  const receiptId = params.get("receipt");
  const selectedPayment = ledger.data?.payments.find(item => item.id === receiptId);
  const selectedInvoice = ledger.data?.invoices.find(item => item.id === invoiceId);
  const focusReviewId = params.get("review") ?? undefined;
  const focusDecisionId = params.get("decision");
  const exactReview = isDependent && focusReviewId && focusDecisionId
    ? ledger.data?.reviews?.find((review) => review.id === focusReviewId
      && review.decision_id === focusDecisionId && review.status !== "pending")
    : undefined;
  const staleAttentionReview=Boolean(isDependent&&params.get("attention_notification_id")&&focusReviewId&&focusDecisionId&&ledger.data&&!exactReview);
  const path = (nextView = view, invoice?: string, receipt?: string) => {
    const next = new URLSearchParams(params); next.set("student_id", studentId); next.set("view", nextView); next.delete("invoice"); next.delete("receipt");
    next.delete("review"); next.delete("decision"); next.delete("attention_notification_id");
    if (invoice || receipt || params.has("invoice") || params.has("receipt")) { next.delete("ledger_payment_cursor"); next.delete("ledger_review_cursor"); }
    if (invoice) next.set("invoice", invoice);
    if (receipt) next.set("receipt", receipt);
    next.set("scope", relationship);
    return `/areas/fees/account?${next}`;
  };
  const filteredPath = (value: FeeFilter, question = false) => {
    const next = new URLSearchParams(params); next.set('student_id',studentId); next.set('view','invoices'); next.set('filter',value); next.delete('invoice'); next.delete('receipt'); next.delete('question');
    if(question) next.set('question','1');
    next.set("scope", relationship);
    return `/areas/fees/account?${next}`;
  };
  const pageTitle = receiptId ? "Payment receipt" : invoiceId ? "Invoice statement detail" : "Fees & receipts";
  const backTo = invoiceId || receiptId ? path(receiptId ? "receipts" : view) : "/areas/fees";
  const content = <div className="office-page office-page--fees">
    {exactReview ? <AttentionOpenAcknowledgement /> : null}
    {staleAttentionReview?<AttentionTargetUnavailable message="This fee-review update no longer matches the current record. It was not marked as opened."/>:null}
    {!schoolId ? <p className="office-alert">No active school membership is available.</p> : children.isPending ? <ScreenLoading /> : children.isError ? <LiveRouteError error={children.error} onRetry={children.refetch} /> : !studentId ? <p className="office-empty" role={exactStudentId ? "alert" : undefined}>{exactStudentId ? <>This fee account is no longer available in your current relationship. <Link to="/areas/fees">Return to fees</Link>.</> : "No linked student record is available. Contact your school office."}</p> : ledger.isPending ? <ScreenLoading /> : ledger.isError ? <LiveRouteError error={ledger.error} onRetry={ledger.refetch} /> : ledger.data ? <>
      {selectedChild ? <div className="family-fee-meta" role="group" aria-label="Fee account identity"><strong>{selectedChild.user.display_name}</strong>{selectedChild.admission_number ? <span>{selectedChild.admission_number}</span> : null}</div> : null}
      {receiptId ? selectedPayment ? <FamilyReceiptDetail payment={selectedPayment} invoice={ledger.data.invoices.find(item => item.id === selectedPayment.invoice_id)} testPayment={selectedPayment.method === "razorpay_test" || Boolean(ledger.data.gateway_payments?.some(item => item.payment_id === selectedPayment.id))} pdfUrl={isDependent&&selectedPayment.method==='razorpay_test'?`/api/v1/schools/${schoolId}/fees/invoices/${selectedPayment.invoice_id}/razorpay/receipts/${selectedPayment.id}/pdf/`:undefined} /> : <p className="office-alert" role="alert">This receipt is unavailable for the selected student. <Link to={path("receipts")}>Return to receipts</Link></p> : invoiceId ? selectedInvoice ? <section className="office-panel office-family-invoice" aria-label="Invoice details">
        <FamilyInvoiceStatement invoice={selectedInvoice} payments={ledger.data.payments.filter(item=>item.invoice_id===selectedInvoice.id)} year={selectedChild?.current_enrollment.term.academic_year} receiptHref={id=>path('receipts',undefined,id)} onSync={reload} syncing={ledger.isFetching} />
        <FeeLedgerPaging pagination={ledger.data.pagination} receipts />
        {environment ? <FinanceArrangementsPanel schoolId={schoolId} studentId={studentId} invoiceId={selectedInvoice.id} /> : null}
        {environment && params.get("native_review") ? <NativeFeeReviewsPanel schoolId={schoolId} studentId={studentId} invoiceId={selectedInvoice.id} focusReviewId={params.get("native_review")!} onLedgerReload={reload} receiptHref={id=>path("receipts",undefined,id)} /> : null}
        {isDependent && ledger.data.can_submit ? <FamilyFeeActions key={`${studentId}:${selectedInvoice.id}:${params.get('question')}`} schoolId={schoolId} invoice={selectedInvoice} onlinePayments={ledger.data.online_payments_enabled} settings={ledger.data.payment_settings} reviews={ledger.data.reviews ?? []} onSaved={reload} expanded hideBreakdown initialQuestion={params.get('question')==='1'} /> : null}
        <FeeReviewHistory reviews={(ledger.data.reviews ?? []).filter(review=>review.invoice_id===selectedInvoice.id)} invoices={[selectedInvoice]} {...(exactReview ? { focusReviewId: exactReview.id } : {})} />
        <FeeLedgerPaging pagination={ledger.data.pagination} reviews />
      </section> : <p className="office-alert" role="alert">This invoice is unavailable for the selected student. <Link to={path()}>Return to invoices</Link></p> : <>
        <FamilyFeeOverview ledger={ledger.data} year={selectedChild?.current_enrollment.term.academic_year} canPay={isDependent && Boolean(ledger.data.can_submit)} payHref={filteredPath('unpaid')} />
        {view === "invoices" || view === "receipts" ? <FeeLedgerPaging pagination={ledger.data.pagination} receipts={view === "receipts"} /> : null}
        {view === "reviews" ? <><FeeLedgerPaging pagination={ledger.data.pagination} /><FeeLedgerPaging pagination={ledger.data.pagination} reviews /></> : null}
        <nav className="workspace-sections" aria-label="Fee records">{([['invoices','Invoices'],['receipts','Receipts'],['reviews','Reviews'],['arrangements','Payment plans']] as const).map(([value,label])=><Link key={value} replace to={path(value)} aria-current={view===value?'page':undefined}>{label}{value==='invoices'?<b>{ledger.data?.invoices.length}</b>:null}{value==='reviews'&&(ledger.data?.reviews??[]).some(review=>review.status==='pending')?<b>{ledger.data?.reviews?.filter(review=>review.status==='pending').length}</b>:null}</Link>)}</nav>
        {view==='invoices'?<><div className="fee-list-heading"><span>{filter==='unpaid'?'Select an invoice to pay':params.get('question')==='1'?'Select an invoice to enquire':'Active ledgers'}</span><FamilyFeeFilter value={filter} onChange={value=>{const next=new URLSearchParams(params);next.set('filter',value);next.delete('invoices_page');setParams(next,{replace:true});}} /></div>{filteredInvoices.length ? <FamilyInvoiceList invoices={filteredInvoices} href={id=>path('invoices',id)} /> : <p className="office-empty">{ledger.data.invoices.length?'No invoices match this filter.':'No invoices have been issued. This does not mean all fees are cleared.'}</p>}</>:null}
        {view==='receipts'?<FamilyReceiptList payments={ledger.data.payments} invoices={ledger.data.invoices} href={id=>path('receipts',undefined,id)} />:null}
        {view==='reviews'?<>{ledger.data.reviews?.length?<FeeReviewHistory reviews={ledger.data.reviews} invoices={ledger.data.invoices} {...(exactReview ? { focusReviewId: exactReview.id } : {})}/>:<p className="office-empty">No fee reviews submitted.</p>}</>:null}
        {view==='arrangements' && environment ? <FinanceArrangementsPanel schoolId={schoolId} studentId={studentId} /> : null}
      </>}
      {!invoiceId && !receiptId && ledger.data.invoices.length > 0 && isDependent && ledger.data.can_submit ? <FeeHelp href={filteredPath('all',true)} /> : null}
      {!invoiceId && (view==='reviews'||view==='receipts') && !receiptId ? <PrintFeeButton label={view==='receipts'?'Print receipts on this page':'Print reviews on this page'} /> : null}
      <p className="office-hint">Only verified payments appear as receipts. {!isDependent ? "A linked guardian can submit payment details." : ledger.data.online_payments_enabled ? "Online checkout is in test mode; no real money is collected." : "Report completed payments for school verification."}</p>
      {view!=='arrangements' && (!invoiceId || selectedInvoice) && (!receiptId || selectedPayment) ? <FamilyFeePrint schoolName={membership?.school_name || "School"} student={selectedChild} ledger={ledger.data} view={view} invoice={selectedInvoice} payment={selectedPayment} /> : null}
    </> : null}
  </div>;
  return <OperationsShell active="areas" title={pageTitle} subtitle={selectedChild?.user.display_name} backTo={backTo}>
    {!exactStudentId && isDependent && (children.data?.results.length ?? 0) > 1 ? <label className="office-field office-context-field">Student
      <select value={studentId} onChange={(event) => setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("scope", relationship);
        next.set("student_id", event.target.value);
        next.delete("invoice");
        next.delete("receipt");
        next.delete("review");
        next.delete("decision");
        next.delete("ledger_cursor"); next.delete("ledger_payment_cursor"); next.delete("ledger_review_cursor"); next.delete("ledger_search");
        return next;
      }, { replace: true })}>{children.data?.results.map((student) => <option key={student.id} value={student.id}>{student.user.display_name}</option>)}</select>
    </label> : null}
    {content}
  </OperationsShell>;
}

/** Compatibility export for bounded callers while canonical routes converge. */
export function FamilyFeesPage(props: RelationshipFeeAccountWorkspaceProps) {
  return <RelationshipFeeAccountWorkspace {...props} />;
}
