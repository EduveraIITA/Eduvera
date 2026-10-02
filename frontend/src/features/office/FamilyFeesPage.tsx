import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, ReceiptIndianRupee } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { useAuth } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFeeLedger, invoiceStatusLabel, personName, rupees } from "./api";
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
  const content = <div className="office-page office-page--fees">
    <Link className="office-back" to={portal === "parent" ? "/parent/more" : "/student/apps"}><ArrowLeft size={17} /> More tools</Link>
    <header className="office-heading"><span className="office-eyebrow"><ReceiptIndianRupee size={16} /> SCHOOL FINANCE</span><h1>Fees & receipts</h1><p>Review charges, pay your school and track verified receipts.</p></header>
    {!schoolId ? <p className="office-alert">No active school membership is available.</p> : children.isPending ? <ScreenLoading /> : children.isError ? <LiveRouteError error={children.error} onRetry={children.refetch} /> : !studentId ? <p className="office-empty">No linked student record is available. Contact your school office.</p> : ledger.isPending ? <ScreenLoading /> : ledger.isError ? <LiveRouteError error={ledger.error} onRetry={ledger.refetch} /> : ledger.data ? <>
      {portal === "parent" && (children.data?.results.length ?? 0) > 1 ? <label className="office-field">Child<select value={studentId} onChange={(event) => { const next = new URLSearchParams(params); next.set("student_id", event.target.value); setParams(next); }}>{children.data?.results.map((student) => <option key={student.id} value={student.id}>{student.user.display_name}</option>)}</select></label> : null}
      <div className="office-summary office-summary--money"><div><strong>{rupees(ledger.data.invoices.reduce((sum, item) => sum + item.adjusted_amount_paise, 0))}</strong><span>Adjusted billed</span></div><div><strong>{rupees(ledger.data.invoices.reduce((sum, item) => sum + item.paid_paise, 0))}</strong><span>Received</span></div><div><strong>{rupees(ledger.data.invoices.reduce((sum, item) => sum + item.balance_paise, 0))}</strong><span>Outstanding</span></div><div><strong>{rupees(ledger.data.invoices.reduce((sum, item) => sum + item.refund_due_paise, 0))}</strong><span>Refund due</span></div></div>
      <section className="office-panel"><h2><FileText size={19} /> Invoices <span>{ledger.data.invoices.length}</span></h2>{ledger.data.invoices.length ? <ul className="office-list office-invoices">{ledger.data.invoices.map((item) => <li key={item.id}><div className="office-invoice-main"><div><strong>{item.reference}</strong><span>{personName(item)} · {item.description}</span></div><b>{rupees(item.balance_paise)}<small>balance</small></b></div><div className="office-invoice-footer"><span>{invoiceStatusLabel(item)} · Due {item.due_on}</span><span>{rupees(item.amount_paise)} billed</span></div>{portal === "parent" && ledger.data?.can_submit ? <FamilyFeeActions schoolId={schoolId} invoice={item} settings={ledger.data.payment_settings} reviews={ledger.data.reviews ?? []} onSaved={ledger.refetch} /> : null}</li>)}</ul> : <p className="office-empty">No invoices have been issued. This does not mean all fees are cleared.</p>}</section>
      <button className="office-secondary" type="button" onClick={() => window.print()}>Print fee statement</button><section className="office-panel"><h2><ReceiptIndianRupee size={19} /> Receipts <span>{ledger.data.payments.length}</span></h2>{ledger.data.payments.length ? <ul className="office-list">{ledger.data.payments.map((item) => <li key={item.id}><div><strong>{item.reference}</strong><span>{ledger.data?.invoices.find((invoice) => invoice.id === item.invoice_id)?.reference ?? "Invoice"} · {item.method.replaceAll("_", " ")} · {new Date(item.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</span></div><b>{rupees(item.amount_paise)}</b></li>)}</ul> : <p className="office-empty">No receipts recorded.</p>}</section>
      <FeeReviewHistory reviews={ledger.data.reviews ?? []} invoices={ledger.data.invoices} /><p className="office-hint">Only school-verified payments appear as receipts. {portal === "student" ? "A linked guardian can submit payment details or request a fee review." : "Payments are made directly to the school; this app does not debit your account."}</p>
    </> : null}
  </div>;
  return portal === "parent" ? <ParentShell active="more" pageLabel="Fees & receipts" selectedChildId={studentId} child={selectedChild ? { id: selectedChild.id, name: selectedChild.user.display_name, grade: `Grade ${selectedChild.current_enrollment.grade}`, section: selectedChild.current_enrollment.section, board: selectedChild.current_enrollment.board, rollNumber: String(selectedChild.current_enrollment.roll_number), avatarUrl: selectedChild.avatar_url } : undefined} onSelectChild={(nextId) => { const next = new URLSearchParams(params); next.set("student_id", nextId); setParams(next); }}>{content}</ParentShell> : <StudentShell activeNav="fees">{content}</StudentShell>;
}
