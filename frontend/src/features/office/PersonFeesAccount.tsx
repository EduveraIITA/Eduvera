import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { CollectionView } from "../../components/CollectionView";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { feeLedgerReadOptions, invoiceAmount, invoiceDescription, rupees, type Payment } from "./api";
import { FeeLedgerPaging } from "./FeeLedgerPaging";
import { PersonFeeReceiptDetail } from "./PersonFeeReceiptDetail";
import { FinanceArrangementsPanel } from "./FinanceArrangementsPanel";
import { NativeFeeReviewsPanel } from "./NativeFeeReviewsPanel";
import { FeeChargeCorrectionDialog } from "./FeeChargeCorrectionDialog";
import { FeeCorrectionHistory } from "./FeeCorrectionHistory";
import { feeDate } from "./FamilyFeeRecords";
import { feeReadDenied, getPersonFeeWorkspace, personFeeAccountHref, type PersonFeeInvoice } from "./personFeesApi";
import "./person-fees.css";

export function PersonFeeAccountWorkspace({ personId }: { personId: string }) {
  const auth = useAuth(), environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="unavailable" /></OperationsShell>;
  return <PersonFeeAccountContext key={`${auth.user?.id}:${auth.user?.active_school_id}:${environment.namespaceId}:${environment.mode === "simulation" ? environment.runId : "live"}:${personId}`} personId={personId} />;
}
function PersonFeeAccountContext({ personId }: { personId: string }) {
  const auth = useAuth(), environment = useExecutionEnvironment(), [params] = useSearchParams(), schoolId = auth.user?.active_school_id ?? "";
  const readOptions = feeLedgerReadOptions(params, params.get("invoice_id") ?? undefined);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", "person-fee-account", auth.user?.id, schoolId, personId, readOptions]),
    queryFn: () => getPersonFeeWorkspace(schoolId, personId, readOptions), enabled: Boolean(schoolId && personId), retry: false });
  const invoiceId = params.get("invoice_id") ?? undefined, invoice = query.data?.invoices.find(item => item.id === invoiceId);
  const receiptId = params.get("receipt"), payment = query.data?.payments.find(item => item.id === receiptId);
  const reload = () => query.refetch({ throwOnError: true });
  return <OperationsShell active="areas" title={receiptId ? "Payment receipt" : "Fees & receipts"} backTo={invoiceId || receiptId ? personFeeAccountHref(personId) : "/areas/fees"}>
    <main className="person-fees-workspace">
      {query.error && query.data && !feeReadDenied(query.error) ? <p role="alert">The account could not be refreshed. Previously loaded records and unsent choices are kept.</p> : null}
      {query.isPending ? <WorkspaceState state="loading" /> : feeReadDenied(query.error) || !query.data ? <WorkspaceState state="error" error={query.error} onRetry={query.refetch} /> : receiptId ? payment ? <PersonFeeReceiptDetail schoolId={schoolId} payment={payment} invoice={query.data.invoices.find(item => item.id === payment.invoice_id)} onReload={reload} receiptHref={id => query.data.payments.some(item => item.id === id && item.invoice_id === payment.invoice_id) ? `${personFeeAccountHref(personId)}&receipt=${encodeURIComponent(id)}` : undefined} /> : <p role="alert">This receipt is unavailable in the current account.</p>
        : invoiceId ? invoice ? <PersonFeeInvoiceDetail schoolId={schoolId} invoice={invoice} payments={query.data.payments.filter(item => item.invoice_id === invoice.id)} onReload={reload} /> : <p role="alert">This charge is unavailable in the current fee account.</p> : <>
          {query.data.invoices[0]?.beneficiary.name ? <p className="person-fee-account-name">{query.data.invoices[0].beneficiary.name}</p> : null}
          <section className="person-fee-overview"><div><span>Outstanding</span><strong>{rupees(query.data.totals?.outstanding ?? query.data.invoices.reduce((sum, item) => sum + item.balance_paise, 0))}</strong></div></section>
          <FeeLedgerPaging pagination={query.data.pagination} />
          <CollectionView items={query.data.invoices} namespace="person_account_charges" label="charges" searchLabel="Find a charge" searchText={item => `${invoiceDescription(item)} ${item.reference}`} empty={<p className="person-fee-caption">No charges are available here.</p>}>
            {visible => <div className="person-fee-records">{visible.map(item => <Link key={item.id} className="person-fee-charge-row" to={personFeeAccountHref(personId, item.id)}><div><strong>{invoiceDescription(item)}</strong><small>{item.reference} · <span className="person-fee-date">{item.charge_state === "cancelled" ? "Cancelled" : `Due ${feeDate(item.collection_due_on ?? item.effective_due_on ?? item.due_on)}`}</span></small></div><div><strong>{rupees(item.balance_paise)}</strong><small>{item.balance_paise ? "Outstanding" : "No balance"}</small></div></Link>)}</div>}
          </CollectionView>
        </>}
      {query.data && invoiceId && !receiptId ? <FeeLedgerPaging pagination={query.data.pagination} receipts /> : null}
    </main>
  </OperationsShell>;
}

export function PersonFeeInvoiceDetail({ schoolId, invoice, payments, onReload, manager = false, allowCorrections = false, batchId, ledgerReceiptHref }: {
  schoolId: string; invoice: PersonFeeInvoice; payments: Payment[]; onReload: () => Promise<unknown>; manager?: boolean;
  allowCorrections?: boolean;
  /** Supplied only by the ledger after checking this invoice against its authorized batch manifest. */
  batchId?: string;
  ledgerReceiptHref?: (id: string) => string;
}) {
  const [params] = useSearchParams(), personId = invoice.beneficiary.person_id ?? invoice.person_id ?? "";
  const environment = useExecutionEnvironment(), readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? "")), [correcting, setCorrecting] = useState(false);
  const receiptHref = (id: string) => ledgerReceiptHref ? ledgerReceiptHref(id) : allowCorrections || manager ? `/areas/fees/ledger?${new URLSearchParams({ person_id: personId, invoice_id: invoice.id, ...(batchId ? { batch_id: batchId } : {}), receipt: id })}` : `${personFeeAccountHref(personId)}&receipt=${encodeURIComponent(id)}`;
  return <div className="person-fee-invoice-detail">
    <header><p className="person-fee-caption">{invoice.beneficiary.name} · {invoice.reference}</p><h2>{invoiceDescription(invoice)}</h2>{invoice.charge_state === "cancelled" ? <p>Charge cancelled</p> : null}</header>
    <section className="person-fee-overview"><div><span>Outstanding</span><strong>{rupees(invoice.balance_paise)}</strong><small>{invoice.charge_state === "cancelled" ? "Cancelled" : `Due ${feeDate(invoice.collection_due_on ?? invoice.effective_due_on ?? invoice.due_on)}`}</small></div>{allowCorrections && invoice.can_correct === true && !readOnly ? <button className="is-secondary" type="button" onClick={() => setCorrecting(true)}>Correct charge</button> : null}</section>
    <details><InfoSummary>Charge details</InfoSummary><dl className="person-fee-facts"><div><dt>Original charge</dt><dd>{rupees(invoice.amount_paise)}</dd></div>
      {invoiceAmount(invoice) !== invoice.amount_paise ? <div><dt>Current recorded charge</dt><dd>{rupees(invoiceAmount(invoice))}</dd></div> : null}
      {invoiceDescription(invoice) !== invoice.description ? <div><dt>Original description</dt><dd>{invoice.description}</dd></div> : null}
      {invoice.effective_due_on && invoice.effective_due_on !== invoice.due_on ? <div><dt>Original due date</dt><dd>{invoice.due_on}</dd></div> : null}
      <div><dt>Adjusted charge</dt><dd>{rupees(invoice.adjusted_amount_paise)}</dd></div><div><dt>Verified payments</dt><dd>{rupees(invoice.paid_paise)}</dd></div><div><dt>Refund due</dt><dd>{rupees(invoice.refund_due_paise)}</dd></div></dl></details>
    <NativeFeeReviewsPanel schoolId={schoolId} invoiceId={invoice.id} personId={personId} {...(params.get("native_review") ? { focusReviewId: params.get("native_review")! } : {})} onLedgerReload={onReload} receiptHref={receiptHref} />
    <details className="person-fee-plan-options"><summary>Payment plans & account access</summary>
      <FinanceArrangementsPanel standalone schoolId={schoolId} personId={personId} invoiceId={invoice.id} />
    </details>
    <FeeCorrectionHistory invoice={invoice} />
    <section aria-label="Verified receipts"><h2>Receipts</h2><CollectionView items={payments} namespace="invoice_receipts" label="receipts" searchLabel="Find a receipt" searchText={payment => `${payment.reference} ${payment.method}`} empty={<p className="person-fee-caption">No verified payments yet.</p>}>
      {visible => <ul className="person-fee-receipts">{visible.map(payment => <li key={payment.id}><span><strong>{payment.reference}</strong><small>{payment.method.replaceAll("_", " ")} · {new Date(payment.created_at).toLocaleDateString()}{payment.status && payment.status !== "active" ? ` · ${payment.status === "replaced" ? "Replaced" : "Reversed"}` : ""}</small><Link aria-label={`View receipt ${payment.reference}`} to={receiptHref(payment.id)}>View receipt</Link></span><strong>{rupees(payment.amount_paise)}</strong></li>)}</ul>}
    </CollectionView></section>
    {payments.length ? <button className="is-secondary person-fee-print" type="button" onClick={() => window.print()}><Printer size={18} aria-hidden="true" />Print statement</button> : null}
    {manager ? <p className="person-fee-caption">Payment-plan approval and payment verification are separate responsibilities.</p> : null}
    {correcting ? <FeeChargeCorrectionDialog schoolId={schoolId} invoices={[invoice]} {...(batchId ? { batchId } : {})} onReload={onReload} onClose={() => setCorrecting(false)} /> : null}
  </div>;
}
