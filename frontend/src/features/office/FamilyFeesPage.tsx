import { useQuery } from "@tanstack/react-query";

import { Link, useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFeeLedger, rupees } from "./api";
import { FamilyFeeActions } from "./FamilyFeeActions";
import { FeeReviewHistory } from "./FeeReviewHistory";
import { FamilyInvoiceList, FamilyReceiptList, FamilyReceiptDetail, FeeStatus, PrintFeeButton, feeDate } from "./FamilyFeeRecords";
import { FamilyFeePrint } from "./FamilyFeePrint";
import "./office.css";
import "./family-fees.css";

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
  const pageTitle = receiptId ? "Payment receipt" : invoiceId ? "Fee details" : "Fees & receipts";
  const backTo = invoiceId || receiptId ? path(receiptId ? "receipts" : view) : portal === "parent" ? "/parent/more" : "/student/apps";
  const content = <div className="office-page office-page--fees">
    {!schoolId ? <p className="office-alert">No active school membership is available.</p> : children.isPending ? <ScreenLoading /> : children.isError ? <LiveRouteError error={children.error} onRetry={children.refetch} /> : !studentId ? <p className="office-empty">No linked student record is available. Contact your school office.</p> : ledger.isPending ? <ScreenLoading /> : ledger.isError ? <LiveRouteError error={ledger.error} onRetry={ledger.refetch} /> : ledger.data ? <>
      {receiptId ? selectedPayment ? <FamilyReceiptDetail payment={selectedPayment} invoice={ledger.data.invoices.find(item => item.id === selectedPayment.invoice_id)} testPayment={selectedPayment.method === "razorpay_test" || Boolean(ledger.data.gateway_payments?.some(item => item.payment_id === selectedPayment.id))} pdfUrl={portal==='parent'&&selectedPayment.method==='razorpay_test'?`/api/v1/schools/${schoolId}/fees/invoices/${selectedPayment.invoice_id}/razorpay/receipts/${selectedPayment.id}/pdf/`:undefined} /> : <p className="office-alert" role="alert">This receipt is unavailable for the selected student. <Link to={path("receipts")}>Return to receipts</Link></p> : invoiceId ? selectedInvoice ? <section className="office-panel office-family-invoice" aria-label="Invoice details">
        <div className="family-fee-detail-heading"><h2>{selectedInvoice.description || "School fee"}</h2><PrintFeeButton label="Print invoice" /></div><p className="family-fee-meta"><FeeStatus invoice={selectedInvoice} />Due {feeDate(selectedInvoice.due_on)}</p><p className="family-fee-reference">{selectedInvoice.reference}</p>
        {portal === "parent" && ledger.data.can_submit ? <FamilyFeeActions key={`${studentId}:${selectedInvoice.id}`} schoolId={schoolId} invoice={selectedInvoice} onlinePayments={ledger.data.online_payments_enabled} settings={ledger.data.payment_settings} reviews={ledger.data.reviews ?? []} onSaved={ledger.refetch} expanded /> : <dl className="office-fee-breakdown"><div><dt>Original charge</dt><dd>{rupees(selectedInvoice.amount_paise)}</dd></div><div><dt>After credits</dt><dd>{rupees(selectedInvoice.adjusted_amount_paise)}</dd></div><div><dt>Received</dt><dd>{rupees(selectedInvoice.paid_paise)}</dd></div><div><dt>Outstanding</dt><dd>{rupees(selectedInvoice.balance_paise)}</dd></div><div><dt>Refund due</dt><dd>{rupees(selectedInvoice.refund_due_paise)}</dd></div></dl>}
        <FeeReviewHistory reviews={(ledger.data.reviews ?? []).filter(review=>review.invoice_id===selectedInvoice.id)} invoices={[selectedInvoice]} />
      </section> : <p className="office-alert" role="alert">This invoice is unavailable for the selected student. <Link to={path()}>Return to invoices</Link></p> : <>
        <div className="family-fee-summary"><div><span>Outstanding balance</span><strong>{rupees(ledger.data.invoices.reduce((sum,item)=>sum+item.balance_paise,0))}</strong><small>{ledger.data.invoices.filter(item=>item.balance_paise>0).length} unpaid invoices{ledger.data.invoices.some(item=>item.refund_due_paise>0)?` · ${rupees(ledger.data.invoices.reduce((sum,item)=>sum+item.refund_due_paise,0))} refund due`:""}</small></div><PrintFeeButton label={view === "receipts" ? "Print receipts" : view === "reviews" ? "Print reviews" : "Print statement"} /></div>
        <nav className="workspace-sections" aria-label="Fee records">{([['invoices','Invoices'],['receipts','Receipts'],['reviews','Reviews']] as const).map(([value,label])=><Link key={value} to={path(value)} aria-current={view===value?'page':undefined}>{label}{value==='reviews'&&(ledger.data?.reviews??[]).some(review=>review.status==='pending')?<b>{ledger.data?.reviews?.filter(review=>review.status==='pending').length}</b>:null}</Link>)}</nav>
        {view==='invoices'?<FamilyInvoiceList invoices={ledger.data.invoices} href={id=>path('invoices',id)} />:null}
        {view==='receipts'?<FamilyReceiptList payments={ledger.data.payments} invoices={ledger.data.invoices} href={id=>path('receipts',undefined,id)} />:null}
        {view==='reviews'?<>{ledger.data.reviews?.length?<FeeReviewHistory reviews={ledger.data.reviews} invoices={ledger.data.invoices}/>:<p className="office-empty">No fee reviews submitted.</p>}</>:null}
      </>}
      <p className="office-hint">Only verified payments appear as receipts. {portal === "student" ? "A linked guardian can submit payment details." : ledger.data.online_payments_enabled ? "Online checkout is in test mode; no real money is collected." : "Report completed payments for school verification."}</p>
      {(!invoiceId || selectedInvoice) && (!receiptId || selectedPayment) ? <FamilyFeePrint schoolName={membership?.school_name || "School"} student={selectedChild} ledger={ledger.data} view={view} invoice={selectedInvoice} payment={selectedPayment} /> : null}
    </> : null}
  </div>;
  return portal === "parent" ? <ParentShell active="more" pageLabel={pageTitle} backTo={backTo} selectedChildId={studentId} child={selectedChild ? { id: selectedChild.id, name: selectedChild.user.display_name, grade: `Grade ${selectedChild.current_enrollment.grade}`, section: selectedChild.current_enrollment.section, board: selectedChild.current_enrollment.board, rollNumber: String(selectedChild.current_enrollment.roll_number), avatarUrl: selectedChild.avatar_url } : undefined} onSelectChild={(nextId) => { const next = new URLSearchParams(params); next.set("student_id", nextId); next.delete('invoice'); next.delete('receipt'); setParams(next); }}>{content}</ParentShell> : <StudentShell activeNav="fees" pageTitle={pageTitle} backTo={backTo}>{content}</StudentShell>;
}
