import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { feeLedgerReadOptions, rupees } from "./api";
import { FeeLedgerPaging, FeeLedgerSearch } from "./FeeLedgerPaging";
import { FeeChargeDialog } from "./FeeChargeDialog";
import { FeeChargeCorrectionDialog } from "./FeeChargeCorrectionDialog";
import { FeePaymentSettings } from "./FeePaymentSettings";
import { PersonFeeReceiptDetail } from "./PersonFeeReceiptDetail";
import { FinanceArrangementsPanel } from "./FinanceArrangementsPanel";
import { NativeFeeReviewsPanel } from "./NativeFeeReviewsPanel";
import { PersonFeeInvoiceDetail } from "./PersonFeesAccount";
import { feeReadDenied, getPersonFeeWorkspace, type PersonFeeInvoice } from "./personFeesApi";
import { getFeeChargeBatch } from "./feeBatchApi";
import { FeeLedgerRecords } from "./FeeLedgerRecords";
import { FeeCollectionDetail } from "./FeeCollectionDetail";
import { feeLedgerHref, feeLedgerRecords } from "./feeLedgerCollections";
import "./person-fees.css";

export function PersonFeesLedger() {
  const auth = useAuth(), environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="areas" title="Fees & receipts"><WorkspaceState state="unavailable" /></OperationsShell>;
  return <PersonFeesLedgerContext key={`${auth.user?.id}:${auth.user?.active_school_id}:${environment.namespaceId}:${environment.mode === "simulation" ? environment.runId : "live"}`} />;
}
function PersonFeesLedgerContext() {
  const auth = useAuth(), environment = useExecutionEnvironment(), [params, setParams] = useSearchParams();
  const schoolId = auth.user?.active_school_id ?? "", batchId = params.get("batch_id") ?? undefined;
  const personId = batchId ? undefined : params.get("person_id") ?? undefined;
  const invoiceId = params.get("invoice_id") ?? undefined, [adding, setAdding] = useState(false), [correctionTarget, setCorrectionTarget] = useState<{ batchId?: string; invoices: PersonFeeInvoice[] } | null>(null);
  const readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  const readOptions = { ...feeLedgerReadOptions(params, invoiceId), group_collections: "true" };
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", "person-fees", auth.user?.id, schoolId, personId, readOptions]),
    queryFn: () => getPersonFeeWorkspace(schoolId, personId, readOptions), enabled: Boolean(schoolId), retry: false });
  const batch = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", "charge-batch", auth.user?.id, schoolId, batchId]),
    queryFn: () => getFeeChargeBatch(schoolId, batchId!), enabled: Boolean(schoolId && batchId), retry: false });
  const reload = () => query.refetch({ throwOnError: true });
  const view = params.get("native_review") ? "reviews" : params.get("view") ?? "charges";
  const batchIds = new Set(batch.data?.invoices.map(item => item.invoice_id) ?? []);
  const receiptId = params.get("receipt"), payment = query.data?.payments.find(item => item.id === receiptId && (!batchId || batchIds.has(item.invoice_id)) && (!invoiceId || item.invoice_id === invoiceId));
  const invoice = query.data?.invoices.find(item => item.id === invoiceId && (!batchId || batchIds.has(item.id)));
  const invoices = batchId ? query.data?.invoices.filter(item => batchIds.has(item.id)) ?? [] : query.data?.invoices ?? [];
  const completeBatch = !batchId || Boolean(batch.data && invoices.length === batch.data.person_count && new Set(invoices.map(item => item.id)).size === batch.data.person_count);
  const records = feeLedgerRecords(invoices, query.data?.pagination ? query.data.pagination.grouped : query.data?.can_issue === true && !personId && !batchId), completeRecords = records.every(record => record.kind === "collection" ? record.complete : !record.collectionUnavailable);
  const receiptHref = (id: string) => {
    const target = query.data?.payments.find(item => item.id === id && item.invoice_id === payment?.invoice_id && (!batchId || batchIds.has(item.invoice_id)));
    return target ? feeLedgerHref(params, { invoice_id: target.invoice_id, ...(batchId ? { batch_id: batchId } : {}), receipt: target.id }) : undefined;
  };
  const href = (item: PersonFeeInvoice) => item.beneficiary?.kind === "person" && item.beneficiary.person_id
    ? feeLedgerHref(params, { person_id: item.beneficiary.person_id, invoice_id: item.id, ...(batchId ? { batch_id: batchId } : {}) })
    : `/areas/fees/ledger?${new URLSearchParams({ student_id: item.student_id ?? "", invoice: item.id })}`;
  const back = (invoiceId || receiptId) && batchId ? feeLedgerHref(params, { batch_id: batchId }) : invoiceId || personId || batchId || view !== "charges" ? feeLedgerHref(params, {}, false) : "/areas/fees";
  const collectionView = params.get("collection_view") === "receipts" ? "receipts" : "people";
  const revealCollection = Boolean(schoolId && query.data && batch.data && !feeReadDenied(query.error) && !feeReadDenied(batch.error));
  return <OperationsShell active="areas" title={receiptId ? "Payment receipt" : view === "arrangements" ? "Payment plans" : view === "reviews" ? "Payment reports & questions" : view === "settings" ? "Payment settings" : revealCollection && batch.data && !invoiceId ? batch.data.description : "Fees & receipts"} backTo={back}>
    <main className="person-fees-workspace">
      {!schoolId ? <WorkspaceState state="revoked" /> : query.isPending || batchId && batch.isPending ? <WorkspaceState state="loading" /> : feeReadDenied(query.error) || !query.data ? <WorkspaceState state="error" error={query.error} onRetry={query.refetch} /> : batchId && (feeReadDenied(batch.error) || !batch.data) ? <WorkspaceState state="error" error={batch.error} onRetry={batch.refetch} /> : <>
        {query.error ? <p role="alert">The view could not be refreshed. Previously loaded records and your unsent choices are kept. <button className="is-secondary" type="button" onClick={() => void query.refetch()}>Try again</button></p> : null}
        {receiptId ? payment ? <PersonFeeReceiptDetail schoolId={schoolId} payment={payment} invoice={query.data.invoices.find(item => item.id === payment.invoice_id)} receiptHref={receiptHref} onReload={reload} allowCorrections={!query.error} /> : <p role="alert">This receipt is unavailable in the current fee account.</p> : invoiceId ? invoice ? <PersonFeeInvoiceDetail schoolId={schoolId} invoice={invoice} payments={query.data.payments.filter(item => item.invoice_id === invoice.id)} onReload={reload} manager={query.data.can_issue} allowCorrections={!query.error} {...(batchId ? { batchId } : {})} ledgerReceiptHref={id => feeLedgerHref(params, { person_id: invoice.beneficiary.person_id ?? "", invoice_id: invoice.id, ...(batchId ? { batch_id: batchId } : {}), receipt: id })} />
          : <p role="alert">This charge is unavailable in the current fee account. <Link to="/areas/fees/ledger">Return to records</Link></p> : view === "arrangements" ? <FinanceArrangementsPanel standalone schoolId={schoolId} {...(personId ? { personId } : {})} />
            : view === "reviews" ? <NativeFeeReviewsPanel schoolId={schoolId} {...(personId ? { personId } : {})} {...(params.get("native_review") ? { focusReviewId: params.get("native_review")! } : {})} onLedgerReload={reload} />
              : view === "settings" ? <FeePaymentSettings schoolId={schoolId} settings={query.data.payment_settings} onSaved={reload} defaultOpen /> : <>
                {batchId && batch.data ? <>{batch.error ? <p role="alert">The recorded collection could not be refreshed. The last confirmed collection is shown.</p> : null}<FeeCollectionDetail batch={batch.data} invoices={invoices} payments={query.data.payments} complete={completeBatch} view={collectionView} onView={value => setParams(current => { const next = new URLSearchParams(current); if (value === "people") next.delete("collection_view"); else next.set("collection_view", value); return next; }, { replace: true })} chargeHref={href} receiptHref={item => feeLedgerHref(params, { invoice_id: item.invoice_id, batch_id: batchId, receipt: item.id })} onCorrect={() => setCorrectionTarget({ batchId, invoices })} canCorrect={!readOnly && invoices.some(item => item.can_correct === true)} stale={Boolean(query.error || batch.error)} onRefresh={() => void query.refetch()} /></> : <>
                  <header className="person-fee-overview"><div><span>Outstanding</span><strong>{query.data.totals ? rupees(query.data.totals.outstanding) : completeRecords ? rupees(invoices.reduce((sum, item) => sum + item.balance_paise, 0)) : "Unavailable"}</strong></div>{query.data.can_issue && !readOnly ? <button type="button" onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" />Record charge</button> : null}</header>
                  {!completeRecords ? <p role="alert">Some collection records are unavailable. Refresh before relying on the total.</p> : null}
                  <nav className="person-fee-tools" aria-label="Fee work"><Link to="/areas/fees/ledger?view=arrangements">Payment plans</Link><Link to="/areas/fees/ledger?view=reviews">Reports & questions</Link><Link to="/areas/fees/ledger?view=settings">Settings</Link></nav>
                  <FeeLedgerSearch pagination={query.data.pagination} />
                  <FeeLedgerRecords records={records} serverPaged={Boolean(query.data.pagination)} chargeHref={href} collectionHref={id => feeLedgerHref(params, { batch_id: id })} />
                  <FeeLedgerPaging pagination={query.data.pagination} showSearch={false} />
                </>}
              </>}
        {(invoiceId || batchId && collectionView === "receipts") && !receiptId ? <FeeLedgerPaging pagination={query.data.pagination} receipts /> : null}
        {readOnly ? <p className="person-fee-caption">This Simulation is read-only.</p> : null}
        {adding ? <FeeChargeDialog schoolId={schoolId} today={query.data.today} onClose={() => setAdding(false)} onReload={reload} onIssued={(person, id) => { setAdding(false); setParams({ person_id: person, invoice_id: id }); }} onBatchIssued={id => { setAdding(false); setParams({ batch_id: id }); }} /> : null}
        {correctionTarget ? <FeeChargeCorrectionDialog schoolId={schoolId} invoices={correctionTarget.invoices} {...(correctionTarget.batchId ? { batchId: correctionTarget.batchId } : {})} onClose={() => setCorrectionTarget(null)} onReload={reload} /> : null}
      </>}
    </main>
  </OperationsShell>;
}
