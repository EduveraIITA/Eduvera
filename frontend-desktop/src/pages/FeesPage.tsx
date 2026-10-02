import { FeeReviewPanel, type Review } from "./FeeReviewPanel";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileText, Info, Receipt, Wallet } from "lucide-react";
import { useState } from "react";
import { Empty, PageTitle, Skeleton, Stat, Status, fmtDate } from "../components/ui";
import { canRecordInvoicePayment, feeLedgerSummary, invoiceStateLabel, type Fees, type Invoice, fullName, money, save, schoolPath } from "../features/administration";
import { api, withQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { RecordForm } from "./administration/RecordForm";

const METHOD: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", cheque: "Cheque" };

/* Fees: a posted ledger, not a payment gateway. Managers post invoices and
   record offline receipts; families see the same numbers for their child. */
export function FeesPage() {
  const { school, persona } = useAuth();
  const manager = persona === "principal" || persona === "teacher";
  const [studentId, setStudentId] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const students = useQuery({
    queryKey: ["fee-students", school?.school_id, manager], enabled: Boolean(school),
    queryFn: () => manager
      ? api<{ results: Array<{ id: string; first_name: string; last_name: string; admission_number: string }> }>(schoolPath(school!.school_id, "fees/students"))
      : api<{ results: Array<{ id: string; user: { first_name: string; last_name: string }; admission_number: string }> }>("/api/v1/students/").then((result) => ({ results: result.results.map((item) => ({ ...item, ...item.user })) })),
  });
  const familyId = studentId || students.data?.results[0]?.id;
  const query = useQuery({
    queryKey: ["fees", school?.school_id, manager ? "all" : familyId], enabled: Boolean(school && (manager || familyId)),
    queryFn: () => api<Fees & { reviews: Review[] }>(withQuery(schoolPath(school!.school_id, "fees/workspace"), { student_id: manager ? undefined : familyId })),
  });

  if (!school) return <Empty>Select your school first.</Empty>;
  if (students.isPending || (query.isPending && (manager || familyId))) return <><Skeleton h={60} w={480} /><div className="grid4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={118} />)}</div><Skeleton h={320} /></>;
  if (students.error) return <Empty>{students.error.message}</Empty>;
  if (!manager && !familyId) return <Empty>No linked student account is available. Contact your school.</Empty>;
  if (query.error || !query.data) return <div className="card" style={{ padding: 24 }}><Empty>{query.error?.message ?? "Could not load the ledger."}</Empty><div className="btnrow" style={{ justifyContent: "center" }}><button className="btn" onClick={() => void query.refetch()}>Retry</button></div></div>;

  const invoices = query.data.invoices;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const summary = feeLedgerSummary(invoices);
  const refresh = async () => { await query.refetch(); };
  const state = (i: Invoice) => {
    const label = invoiceStateLabel(i, today);
    return [label, label === "Paid" || label === "Credited" || label === "Refunded" ? "pos" : label === "Overdue" || label.startsWith("Refund") ? "cri" : "cau"] as const;
  };
  const studentName = !manager ? students.data.results.find((s) => s.id === familyId) : undefined;

  return (
    <>
      <PageTitle
        icon={Wallet}
        eyebrow={<>Fees & collections<span className="sep" />{query.data.currency}</>}
        title={manager ? "School fee ledger" : studentName ? `${fullName(studentName)}'s fees` : "Your fee account"}
        sub={`Posted invoices and confirmed offline receipts. ${query.data.online_payments_enabled ? "Online payments are enabled." : "Online payments are not enabled."}`}
        actions={<>
          {!manager && students.data.results.length > 1 ? <label className="field inline"><span className="lbl">Student</span><select className="input sm" value={familyId} onChange={(event) => setStudentId(event.target.value)} style={{ width: 220 }}>{students.data.results.map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}</select></label> : null}
          <button className="btn outline no-print" onClick={() => window.print()}><Download size={18} />Print statement</button>
        </>}
      />

      {manager ? <div className="callout"><Info size={18} color="var(--brand-text)" style={{ flexShrink: 0, marginTop: 1 }} /><span className="t-bsm ink2"><b>Posted ledger.</b> Credits reduce the collectible balance; any refund due is tracked separately. Posted invoices and receipts cannot be edited or deleted.</span></div> : null}

      <div className="grid4">
        <Stat label="Adjusted billed" icon={FileText} value={money(summary.adjusted_paise)} tone="inf" note={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`} />
        <Stat label="Received" icon={CheckCircle2} value={money(summary.received_paise)} tone="pos" note={`${query.data.payments.length} receipt${query.data.payments.length === 1 ? "" : "s"}`} />
        <Stat label="Outstanding" icon={Wallet} value={money(summary.outstanding_paise)} tone={summary.outstanding_paise ? "cau" : "pos"} note={summary.outstanding_paise ? "across open invoices" : "nothing due"} />
        <Stat label="Refund due" icon={AlertTriangle} value={money(summary.refund_due_paise)} tone={summary.refund_due_paise ? "cri" : "pos"} note={summary.refund_due_paise ? "requires reconciliation" : "none due"} />
      </div>

        <div className="card">
          <div className="card-h"><b><FileText size={18} />Invoices</b><span className="aside">{invoices.length}</span></div>
          {invoices.length === 0 ? <Empty>No invoices have been issued. This does not mean all fees are cleared.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Invoice</th><th>Details</th><th>Due</th><th className="num">Amount</th><th className="num">Balance</th><th>Status</th>{manager ? <th></th> : null}</tr></thead>
              <tbody>{invoices.map((item) => { const [label, tone] = state(item); return (
                <tr key={item.id} style={selected?.id === item.id ? { background: "var(--brand-tint)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}><div className="rowtxt"><b className="mono">{item.reference}</b><span>{fullName(item)} · {item.admission_number}</span></div></td>
                  <td className="ink2 wrap" style={{ maxWidth: 360 }}>{item.description}</td>
                  <td className="ink2" style={{ whiteSpace: "nowrap" }}>{fmtDate(item.due_on, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>{money(item.amount_paise)}</td>
                  <td className="num" style={{ fontWeight: item.balance_paise ? 600 : 400, whiteSpace: "nowrap" }}>{money(item.balance_paise)}</td>
                  <td><Status tone={tone}>{label}</Status></td>
                  {manager ? <td className="num" style={{ whiteSpace: "nowrap" }}><button className="btn sm" disabled={!canRecordInvoicePayment(item)} onClick={() => { setSelected(item); setPaymentKey(crypto.randomUUID()); }}>Record payment</button></td> : null}
                </tr>
              ); })}</tbody>
            </table></div>
          )}
        </div>

      {manager ? <FeeReviewPanel schoolId={school.school_id} reviews={query.data.reviews ?? []} invoices={invoices} onSaved={refresh} /> : <a className="btn" href={`/${persona === "parent" ? "parent" : "student"}/fees?student_id=${encodeURIComponent(familyId ?? "")}`}>Review fees & pay</a>}
      {persona === "principal" ? <a className="btn" href="/principal/fees">Manage school payment instructions</a> : null}
      <div className="grid12">
        {manager ? (
          <div className="col-4 col">
            {selected && canRecordInvoicePayment(invoices.find((invoice) => invoice.id === selected.id) ?? selected) ? (
              <RecordForm key={selected.id} icon={Receipt} title={`Record payment · ${selected.reference}`} submitLabel="Confirm receipt" onCancel={() => setSelected(null)} fields={[
                { name: "amount", label: "Received amount (INR)", type: "number", min: .01, max: selected.balance_paise / 100, step: ".01", value: String(selected.balance_paise / 100), hint: `Balance ${money(selected.balance_paise)} · ${fullName(selected)}` },
                { name: "method", label: "Payment method", options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) },
                { name: "reference", label: "Receipt / bank / cheque reference", wide: true },
              ]} onSave={async (values) => {
                await save(school.school_id, `fees/invoices/${selected.id}/payments`, { ...values, amount_paise: Math.round(Number(values.amount) * 100), idempotency_key: paymentKey });
                setSelected(null); await refresh();
              }}>
                <label className="check"><input type="checkbox" required /><span>Funds are received (cheques must be cleared). I verified the amount and reference.</span></label>
              </RecordForm>
            ) : (
              <RecordForm icon={FileText} title="Post a student invoice" submitLabel="Post invoice" fields={[
                { name: "student_id", label: "Student", options: students.data.results.map((item) => ({ value: item.id, label: `${fullName(item)} · ${item.admission_number}` })), wide: true },
                { name: "reference", label: "Invoice reference", hint: "Must be unique.", placeholder: "INV-2026-0042" }, { name: "due_on", label: "Due date", type: "date" },
                { name: "description", label: "Fee breakdown / description", wide: true },
                { name: "amount", label: "Amount (INR)", type: "number", min: .01, max: 1_000_000, step: ".01" },
              ]} onSave={async (values) => { await save(school.school_id, "fees/invoices", { ...values, amount_paise: Math.round(Number(values.amount) * 100) }); await refresh(); }}>
                <label className="check"><input type="checkbox" required /><span>I reviewed this invoice. Posted records cannot be edited or deleted.</span></label>
              </RecordForm>
            )}
          </div>
        ) : null}
          <div className={`${manager ? "col-8" : "col-12"} card`}>
          <div className="card-h"><b><Receipt size={18} />Receipt register</b><span className="aside">{query.data.payments.length}</span></div>
          {query.data.payments.length === 0 ? <Empty>No receipts recorded.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Receipt</th><th>Invoice</th><th>Date</th><th>Method</th><th className="num">Amount</th></tr></thead>
              <tbody>{query.data.payments.map((item) => { const inv = invoices.find((invoice) => invoice.id === item.invoice_id); return (
                <tr key={item.id}>
                  <td className="mono">{item.reference}</td>
                  <td>{inv ? <div className="rowtxt"><b className="mono">{inv.reference}</b><span>{fullName(inv)}</span></div> : <span className="faint">—</span>}</td>
                  <td className="ink2">{fmtDate(item.created_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td>{METHOD[item.method] ?? item.method}</td>
                  <td className="num">{money(item.amount_paise)}</td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
