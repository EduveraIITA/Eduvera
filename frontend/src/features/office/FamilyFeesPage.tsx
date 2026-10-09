import { useQuery } from "@tanstack/react-query";

import { Link, useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFeeLedger, invoiceStatusLabel } from "./api";
import { FamilyFeeActions } from "./FamilyFeeActions";
import { FeeReviewHistory } from "./FeeReviewHistory";
import { FamilyInvoiceList, FamilyReceiptList, FamilyReceiptDetail, PrintFeeButton } from "./FamilyFeeRecords";
import { FamilyFeePrint } from "./FamilyFeePrint";
import "./office.css";
import "./family-fees.css";
import { FamilyFeeOverview, FamilyFeeFilter, FeeHelp, type FeeFilter } from "./FamilyFeeOverview";
import { FamilyInvoiceStatement } from "./FamilyInvoiceStatement";

export function FamilyFeesPage({ portal }: { portal: "parent" | "student" }) {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const membership = auth.memberships.find((membership) => membership.role === (portal === "parent" ? "guardian" : "student"));
  const schoolId = membership?.school_id ?? "";
  const children = useQuery({ queryKey: ["school", "accessible-students"], queryFn: getAccessibleStudents, enabled: Boolean(schoolId) });
  const requestedStudentId = params.get("student_id") ?? "";
  const studentId = children.data?.results.find((student) => student.id === requestedStudentId)?.id ?? children.data?.results[0]?.id ?? "";
  const selectedChild = children.data?.results.find((student) => student.id === studentId);
  const ledger = useQuery({ queryKey: ["office", "family-fees", schoolId, studentId], queryFn: () => getFeeLedger(schoolId, studentId), enabled: Boolean(schoolId && studentId) });
  const view = params.get("view") === "receipts" ? "receipts" : params.get("view") === "reviews" ? "reviews" : "invoices";
  const filter: FeeFilter = ["unpaid", "overdue", "settled"].includes(params.get("filter") ?? "") ? params.get("filter") as FeeFilter : "all";
  const filteredInvoices = (ledger.data?.invoices ?? []).filter(item => filter === "unpaid" ? item.balance_paise > 0 : filter === "overdue" ? item.balance_paise > 0 && invoiceStatusLabel(item) === "Overdue" : filter === "settled" ? item.balance_paise === 0 : true);
  const invoiceId = params.get("invoice");
  const receiptId = params.get("receipt");
  const selectedPayment = ledger.data?.payments.find(item => item.id === receiptId);
  const selectedInvoice = ledger.data?.invoices.find(item => item.id === invoiceId);
  const path = (nextView = view, invoice?: string, receipt?: string) => {
    const next = new URLSearchParams(params); next.set("student_id", studentId); next.set("view", nextView); next.delete("invoice"); next.delete("receipt");
    if (invoice) next.set("invoice", invoice);
    if (receipt) next.set("receipt", receipt);
    return `/${portal}/fees?${next}`;
  };
  const filteredPath = (value: FeeFilter, question = false) => {
    const next = new URLSearchParams(params); next.set('student_id',studentId); next.set('view','invoices'); next.set('filter',value); next.delete('invoice'); next.delete('receipt'); next.delete('question');
    if(question) next.set('question','1');
    return `/${portal}/fees?${next}`;
  };
  const pageTitle = receiptId ? "Payment receipt" : invoiceId ? "Invoice statement detail" : "Fees & receipts";
  const backTo = invoiceId || receiptId ? path(receiptId ? "receipts" : view) : portal === "parent" ? "/parent/more" : "/student/apps";
  const content = <div className="office-page office-page--fees">
    {!schoolId ? <p className="office-alert">No active school membership is available.</p> : children.isPending ? <ScreenLoading /> : children.isError ? <LiveRouteError error={children.error} onRetry={children.refetch} /> : !studentId ? <p className="office-empty">No linked student record is available. Contact your school office.</p> : ledger.isPending ? <ScreenLoading /> : ledger.isError ? <LiveRouteError error={ledger.error} onRetry={ledger.refetch} /> : ledger.data ? <>
      {receiptId ? selectedPayment ? <FamilyReceiptDetail payment={selectedPayment} invoice={ledger.data.invoices.find(item => item.id === selectedPayment.invoice_id)} testPayment={selectedPayment.method === "razorpay_test" || Boolean(ledger.data.gateway_payments?.some(item => item.payment_id === selectedPayment.id))} pdfUrl={portal==='parent'&&selectedPayment.method==='razorpay_test'?`/api/v1/schools/${schoolId}/fees/invoices/${selectedPayment.invoice_id}/razorpay/receipts/${selectedPayment.id}/pdf/`:undefined} /> : <p className="office-alert" role="alert">This receipt is unavailable for the selected student. <Link to={path("receipts")}>Return to receipts</Link></p> : invoiceId ? selectedInvoice ? <section className="office-panel office-family-invoice" aria-label="Invoice details">
        <FamilyInvoiceStatement invoice={selectedInvoice} payments={ledger.data.payments.filter(item=>item.invoice_id===selectedInvoice.id)} year={selectedChild?.current_enrollment.term.academic_year} receiptHref={id=>path('receipts',undefined,id)} onSync={ledger.refetch} syncing={ledger.isFetching} />
        {portal === "parent" && ledger.data.can_submit ? <FamilyFeeActions key={`${studentId}:${selectedInvoice.id}:${params.get('question')}`} schoolId={schoolId} invoice={selectedInvoice} onlinePayments={ledger.data.online_payments_enabled} settings={ledger.data.payment_settings} reviews={ledger.data.reviews ?? []} onSaved={ledger.refetch} expanded hideBreakdown initialQuestion={params.get('question')==='1'} /> : null}
        <FeeReviewHistory reviews={(ledger.data.reviews ?? []).filter(review=>review.invoice_id===selectedInvoice.id)} invoices={[selectedInvoice]} />
      </section> : <p className="office-alert" role="alert">This invoice is unavailable for the selected student. <Link to={path()}>Return to invoices</Link></p> : <>
        <FamilyFeeOverview ledger={ledger.data} year={selectedChild?.current_enrollment.term.academic_year} canPay={portal==='parent' && Boolean(ledger.data.can_submit)} payHref={filteredPath('unpaid')} />
        <nav className="workspace-sections" aria-label="Fee records">{([['invoices','Invoices'],['receipts','Receipts'],['reviews','Reviews']] as const).map(([value,label])=><Link key={value} to={path(value)} aria-current={view===value?'page':undefined}>{label}{value==='invoices'?<b>{ledger.data?.invoices.length}</b>:null}{value==='reviews'&&(ledger.data?.reviews??[]).some(review=>review.status==='pending')?<b>{ledger.data?.reviews?.filter(review=>review.status==='pending').length}</b>:null}</Link>)}</nav>
        {view==='invoices'?<><div className="fee-list-heading"><span>{filter==='unpaid'?'Select an invoice to pay':params.get('question')==='1'?'Select an invoice to enquire':'Active ledgers'}</span><FamilyFeeFilter value={filter} onChange={value=>{const next=new URLSearchParams(params);next.set('filter',value);setParams(next);}} /></div>{filteredInvoices.length ? <FamilyInvoiceList invoices={filteredInvoices} href={id=>path('invoices',id)} /> : <p className="office-empty">{ledger.data.invoices.length?'No invoices match this filter.':'No invoices have been issued. This does not mean all fees are cleared.'}</p>}</>:null}
        {view==='receipts'?<FamilyReceiptList payments={ledger.data.payments} invoices={ledger.data.invoices} href={id=>path('receipts',undefined,id)} />:null}
        {view==='reviews'?<>{ledger.data.reviews?.length?<FeeReviewHistory reviews={ledger.data.reviews} invoices={ledger.data.invoices}/>:<p className="office-empty">No fee reviews submitted.</p>}</>:null}
      </>}
      {!invoiceId && !receiptId && ledger.data.invoices.length > 0 && portal==='parent' && ledger.data.can_submit ? <FeeHelp href={filteredPath('all',true)} /> : null}
      {!invoiceId && view!=='invoices' && !receiptId ? <PrintFeeButton label={view==='receipts'?'Print receipts':'Print reviews'} /> : null}
      <p className="office-hint">Only verified payments appear as receipts. {portal === "student" ? "A linked guardian can submit payment details." : ledger.data.online_payments_enabled ? "Online checkout is in test mode; no real money is collected." : "Report completed payments for school verification."}</p>
      {(!invoiceId || selectedInvoice) && (!receiptId || selectedPayment) ? <FamilyFeePrint schoolName={membership?.school_name || "School"} student={selectedChild} ledger={ledger.data} view={view} invoice={selectedInvoice} payment={selectedPayment} /> : null}
    </> : null}
  </div>;
  return portal === "parent" ? <ParentShell active="more" pageLabel={pageTitle} backTo={backTo} selectedChildId={studentId} child={selectedChild ? { id: selectedChild.id, name: selectedChild.user.display_name, grade: `Grade ${selectedChild.current_enrollment.grade}`, section: selectedChild.current_enrollment.section, board: selectedChild.current_enrollment.board, rollNumber: String(selectedChild.current_enrollment.roll_number), avatarUrl: selectedChild.avatar_url } : undefined} onSelectChild={(nextId) => { const next = new URLSearchParams(params); next.set("student_id", nextId); next.delete('invoice'); next.delete('receipt'); setParams(next); }}>{content}</ParentShell> : <StudentShell activeNav="fees" pageTitle={pageTitle} backTo={backTo}>{content}</StudentShell>;
}
