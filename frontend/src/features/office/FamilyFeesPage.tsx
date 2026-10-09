import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Printer } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFeeLedger, invoiceStatusLabel, rupees } from "./api";
import { FamilyFeeActions } from "./FamilyFeeActions";
import { FeeReviewHistory } from "./FeeReviewHistory";
import "./office.css";

export function FamilyFeesPage({ portal }: { portal: "parent" | "student" }) {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const schoolId = auth.memberships.find((membership) => membership.role === (portal === "parent" ? "guardian" : "student"))?.school_id ?? "";
  const children = useQuery({ queryKey: ["school", "accessible-students"], queryFn: getAccessibleStudents, enabled: Boolean(schoolId) });
  const requestedStudentId = params.get("student_id") ?? "";
  const studentId = children.data?.results.find((student) => student.id === requestedStudentId)?.id ?? children.data?.results[0]?.id ?? "";
  const selectedChild = children.data?.results.find((student) => student.id === studentId);
  const ledger = useQuery({ queryKey: ["office", "family-fees", schoolId, studentId], queryFn: () => getFeeLedger(schoolId, studentId), enabled: Boolean(schoolId && studentId) });
  const view = params.get("view") === "receipts" ? "receipts" : params.get("view") === "reviews" ? "reviews" : "invoices";
  const invoiceId = params.get("invoice");
  const selectedInvoice = ledger.data?.invoices.find(item => item.id === invoiceId);
  const path = (nextView = view, invoice?: string) => {
    const next = new URLSearchParams(params); next.set("student_id", studentId); next.set("view", nextView); next.delete("invoice");
    if (invoice) next.set("invoice", invoice);
    return `/${portal}/fees?${next}`;
  };
  const pageTitle = invoiceId ? selectedInvoice?.reference ?? "Invoice" : "Fees & receipts";
  const backTo = invoiceId ? path() : portal === "parent" ? "/parent/more" : "/student/apps";
  const content = <div className="office-page office-page--fees">
    {!schoolId ? <p className="office-alert">No active school membership is available.</p> : children.isPending ? <ScreenLoading /> : children.isError ? <LiveRouteError error={children.error} onRetry={children.refetch} /> : !studentId ? <p className="office-empty">No linked student record is available. Contact your school office.</p> : ledger.isPending ? <ScreenLoading /> : ledger.isError ? <LiveRouteError error={ledger.error} onRetry={ledger.refetch} /> : ledger.data ? <>
      {invoiceId ? selectedInvoice ? <section className="office-panel office-family-invoice" aria-label="Invoice details">
        <p className="workspace-context">{selectedInvoice.description}</p><p>{invoiceStatusLabel(selectedInvoice)} · Due {selectedInvoice.due_on}</p>
        {portal === "parent" && ledger.data.can_submit ? <FamilyFeeActions key={`${studentId}:${selectedInvoice.id}`} schoolId={schoolId} invoice={selectedInvoice} onlinePayments={ledger.data.online_payments_enabled} settings={ledger.data.payment_settings} reviews={ledger.data.reviews ?? []} onSaved={ledger.refetch} expanded /> : <dl className="office-fee-breakdown"><div><dt>Original charge</dt><dd>{rupees(selectedInvoice.amount_paise)}</dd></div><div><dt>After credits</dt><dd>{rupees(selectedInvoice.adjusted_amount_paise)}</dd></div><div><dt>Received</dt><dd>{rupees(selectedInvoice.paid_paise)}</dd></div><div><dt>Outstanding</dt><dd>{rupees(selectedInvoice.balance_paise)}</dd></div><div><dt>Refund due</dt><dd>{rupees(selectedInvoice.refund_due_paise)}</dd></div></dl>}
        <FeeReviewHistory reviews={(ledger.data.reviews ?? []).filter(review=>review.invoice_id===selectedInvoice.id)} invoices={[selectedInvoice]} />
      </section> : <p className="office-alert" role="alert">This invoice is unavailable for the selected student. <Link to={path()}>Return to invoices</Link></p> : <>
        <div className="office-fee-tools"><span><strong>{rupees(ledger.data.invoices.reduce((sum,item)=>sum+item.balance_paise,0))}</strong> outstanding{ledger.data.invoices.some(item=>item.refund_due_paise>0)?` · ${rupees(ledger.data.invoices.reduce((sum,item)=>sum+item.refund_due_paise,0))} refund due`:""}</span><button type="button" className="office-secondary" aria-label="Print this fee view" onClick={()=>window.print()}><Printer size={19}/></button></div>
        <nav className="workspace-sections" aria-label="Fee records">{([['invoices','Invoices'],['receipts','Receipts'],['reviews','Reviews']] as const).map(([value,label])=><Link key={value} to={path(value)} aria-current={view===value?'page':undefined}>{label}{value==='reviews'&&(ledger.data?.reviews??[]).some(review=>review.status==='pending')?<b>{ledger.data?.reviews?.filter(review=>review.status==='pending').length}</b>:null}</Link>)}</nav>
        {view==='invoices'?<section className="office-panel office-ledger-panel" aria-label="Invoices">{ledger.data.invoices.length?<ul className="office-list office-invoices">{ledger.data.invoices.map(item=><li key={item.id}><Link className="office-invoice-link" to={path('invoices',item.id)}><span><strong>{item.reference}</strong><small>{item.description}</small><small>{invoiceStatusLabel(item)} · Due {item.due_on}</small></span><span><b>{rupees(item.balance_paise)}</b><small>balance</small></span><ChevronRight size={18}/></Link></li>)}</ul>:<p className="office-empty">No invoices have been issued. This does not mean all fees are cleared.</p>}</section>:null}
        {view==='receipts'?<section className="office-panel" aria-label="Receipts">{ledger.data.payments.length?<ul className="office-list">{ledger.data.payments.map(item=><li key={item.id}><div><strong>{item.reference}</strong><span>{ledger.data?.invoices.find(invoice=>invoice.id===item.invoice_id)?.reference??'Invoice'} · {item.method.replaceAll('_',' ')} · {new Date(item.created_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})}</span></div><b>{rupees(item.amount_paise)}</b></li>)}</ul>:<p className="office-empty">No receipts recorded.</p>}</section>:null}
        {view==='reviews'?<>{ledger.data.reviews?.length?<FeeReviewHistory reviews={ledger.data.reviews} invoices={ledger.data.invoices}/>:<p className="office-empty">No fee reviews submitted.</p>}</>:null}
      </>}
      <p className="office-hint">Only verified payments appear as receipts. {portal === "student" ? "A linked guardian can submit payment details." : "The app does not debit your account."}</p>
    </> : null}
  </div>;
  return portal === "parent" ? <ParentShell active="more" pageLabel={pageTitle} backTo={backTo} selectedChildId={studentId} child={selectedChild ? { id: selectedChild.id, name: selectedChild.user.display_name, grade: `Grade ${selectedChild.current_enrollment.grade}`, section: selectedChild.current_enrollment.section, board: selectedChild.current_enrollment.board, rollNumber: String(selectedChild.current_enrollment.roll_number), avatarUrl: selectedChild.avatar_url } : undefined} onSelectChild={(nextId) => { const next = new URLSearchParams(params); next.set("student_id", nextId); next.delete('invoice'); setParams(next); }}>{content}</ParentShell> : <StudentShell activeNav="fees" pageTitle={pageTitle} backTo={backTo}>{content}</StudentShell>;
}
