import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageTitle, Stat } from "../components/ui";
import { type Fees, type Invoice, fullName, money, save, schoolPath } from "../features/administration";
import { api, withQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { RecordForm } from "./administration/RecordForm";
import "./administration/administration.css";

export function FeesPage() {
  const { school, persona } = useAuth();
  const manager = persona === "principal" || persona === "teacher";
  const [studentId, setStudentId] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const students = useQuery({ queryKey: ["fee-students", school?.school_id, manager], enabled: Boolean(school), queryFn: () => manager
    ? api<{ results: Array<{ id: string; first_name: string; last_name: string; admission_number: string }> }>(schoolPath(school!.school_id, "fees/students"))
    : api<{ results: Array<{ id: string; user: { first_name: string; last_name: string }; admission_number: string }> }>("/api/v1/students/").then((result) => ({ results: result.results.map((item) => ({ ...item, ...item.user })) })) });
  const familyId = studentId || students.data?.results[0]?.id;
  const query = useQuery({ queryKey: ["fees", school?.school_id, manager ? "all" : familyId], enabled: Boolean(school && (manager || familyId)), queryFn: () => api<Fees>(withQuery(schoolPath(school!.school_id, "fees"), { student_id: manager ? undefined : familyId })) });
  if (!school) return <p>Select your school first.</p>;
  if (students.isPending) return <p role="status">Loading fee accounts…</p>;
  if (students.error) return <p role="alert">{students.error.message}</p>;
  if (!manager && !familyId) return <p>No linked student account is available. Contact your school.</p>;
  if (query.isPending) return <p role="status">Loading fee ledger…</p>;
  if (query.error) return <div role="alert"><p>{query.error.message}</p><button className="btn" onClick={() => void query.refetch()}>Retry</button></div>;
  const invoices = query.data.invoices;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const refresh = async () => { await query.refetch(); };
  return <><PageTitle eyebrow="Fees & collections" title={manager ? "School fee ledger" : "Your fee account"} sub="Posted invoices and confirmed offline receipts. Online payments are not enabled." actions={<button className="btn" onClick={() => window.print()}>Print statement</button>} />
    {manager ? <p className="ops-code">Pilot ledger: refunds, credit notes and settlement reconciliation are not available yet. Use test records until your collection and correction workflow is approved.</p> : null}
    {!manager ? <label>Student<select className="input" value={familyId} onChange={(event) => setStudentId(event.target.value)}>{students.data.results.map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}</select></label> : null}
    <div className="grid4"><Stat label="Invoiced" value={money(invoices.reduce((sum, item) => sum + item.amount_paise, 0))} /><Stat label="Received" value={money(invoices.reduce((sum, item) => sum + item.paid_paise, 0))} /><Stat label="Outstanding" value={money(invoices.reduce((sum, item) => sum + item.balance_paise, 0))} /><Stat label="Overdue" value={money(invoices.filter((item) => item.due_on < today).reduce((sum, item) => sum + item.balance_paise, 0))} /></div>
    {manager ? <RecordForm title="Post a student invoice" submitLabel="Post invoice" fields={[
      { name: "student_id", label: "Student", options: students.data.results.map((item) => ({ value: item.id, label: `${fullName(item)} · ${item.admission_number}` })) },
      { name: "reference", label: "Unique invoice reference" }, { name: "description", label: "Fee breakdown / description" },
      { name: "amount", label: "Amount (INR)", type: "number", min: .01, max: 1_000_000, step: ".01" }, { name: "due_on", label: "Due date", type: "date" },
    ]} onSave={async (values) => { await save(school.school_id, "fees/invoices", { ...values, amount_paise: Math.round(Number(values.amount) * 100) }); await refresh(); }}>
      <label className="ops-check"><input type="checkbox" required />I reviewed this invoice. Posted records cannot be edited or deleted.</label>
    </RecordForm> : null}
    <section className="card ops-panel"><h2>Invoices</h2><div className="ops-table"><table><thead><tr><th>Reference / student</th><th>Details</th><th>Due</th><th>Amount</th><th>Balance</th>{manager ? <th>Action</th> : null}</tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td>{item.reference}<br /><span className="muted">{fullName(item)}</span></td><td>{item.description}</td><td>{item.due_on}<br />{item.balance_paise === 0 ? "Paid" : item.due_on < today ? "Overdue" : "Open"}</td><td>{money(item.amount_paise)}</td><td>{money(item.balance_paise)}</td>{manager ? <td><button className="btn sm" disabled={!item.balance_paise} onClick={() => { setSelected(item); setPaymentKey(crypto.randomUUID()); }}>Record payment</button></td> : null}</tr>)}</tbody></table>{!invoices.length ? <p>No invoices have been issued. This does not imply that all school fees are cleared.</p> : null}</div></section>
    {manager && selected ? <RecordForm key={selected.id} title={`Record payment · ${selected.reference}`} submitLabel="Confirm receipt" onCancel={() => setSelected(null)} fields={[
      { name: "amount", label: "Received amount (INR)", type: "number", min: .01, max: selected.balance_paise / 100, step: ".01", value: String(selected.balance_paise / 100) },
      { name: "method", label: "Payment method", options: ["cash", "bank_transfer", "cheque"].map((method) => ({ value: method, label: method.replace("_", " ") })) },
      { name: "reference", label: "Unique receipt / bank / cleared cheque reference" },
    ]} onSave={async (values) => {
      await save(school.school_id, `fees/invoices/${selected.id}/payments`, { ...values, amount_paise: Math.round(Number(values.amount) * 100), idempotency_key: paymentKey }); setSelected(null); await refresh();
    }}><label className="ops-check"><input type="checkbox" required />Funds are received (cheques must be cleared). I verified the amount and reference.</label></RecordForm> : null}
    <section className="card ops-panel"><h2>Receipt register</h2><div className="ops-table"><table><thead><tr><th>Reference</th><th>Invoice</th><th>Date</th><th>Method</th><th>Amount</th></tr></thead><tbody>{query.data.payments.map((item) => <tr key={item.id}><td>{item.reference}</td><td>{invoices.find((invoice) => invoice.id === item.invoice_id)?.reference}</td><td>{new Date(item.created_at).toLocaleDateString()}</td><td>{item.method.replace("_", " ")}</td><td>{money(item.amount_paise)}</td></tr>)}</tbody></table>{!query.data.payments.length ? <p>No receipts recorded.</p> : null}</div></section>
  </>;
}
