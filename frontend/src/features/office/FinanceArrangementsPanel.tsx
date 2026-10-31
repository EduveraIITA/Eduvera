import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CircleCheck, Clock3 } from "lucide-react";
import { CollectionView } from "../../components/CollectionView";
import { InfoSummary } from "../../components/InfoSummary";
import { ProductIcon } from "../../components/ProductIcon";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { rupees } from "./api";
import { FinanceArrangementAccessDialog, FinanceArrangementDecision } from "./FinanceArrangementDecision";
import { FinanceArrangementProposal } from "./FinanceArrangementProposal";
import { getFinanceArrangements, type ArrangementInvoice, type ArrangementRequest, type FinanceArrangementsWorkspace } from "./financeArrangementsApi";
import { FeeAuthoritySetup } from "./FeeAuthoritySetup";
import "./finance-arrangements.css";

interface Props { schoolId: string; studentId?: string; personId?: string; invoiceId?: string; focusRequestId?: string; standalone?: boolean }
export function FinanceArrangementsPanel(props: Props) {
  const auth = useAuth(), environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) return <WorkspaceState state="unavailable" />;
  return <FinanceArrangementsPanelContext key={`${auth.user?.id}:${props.schoolId}:${environment.namespaceId}:${environment.mode === "simulation" ? environment.runId : "live"}:${props.personId ?? props.studentId ?? ""}:${props.invoiceId ?? ""}`} {...props} />;
}
function FinanceArrangementsPanelContext({ schoolId, studentId, personId, invoiceId, focusRequestId, standalone = false }: Props) {
  const auth = useAuth(), environment = useExecutionEnvironment();
  const unavailable = environment.mode === "simulation" && environment.unavailable;
  const readOnly = environment.mode === "simulation" && (unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", auth.user?.id, schoolId, studentId, invoiceId, personId]),
    queryFn: () => personId ? getFinanceArrangements(schoolId, undefined, invoiceId, undefined, personId) : getFinanceArrangements(schoolId, studentId, invoiceId), enabled: Boolean(schoolId && !unavailable), retry: false });
  const [action, setAction] = useState<{ invoice: ArrangementInvoice; mode: "propose" | "enable" | "revoke" | "withdraw" | "decide"; request?: ArrangementRequest } | null>(null);
  const reload = () => query.refetch({ throwOnError: true });
  if (unavailable) return <WorkspaceState state="unavailable" />;
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (!query.data || query.error instanceof ApiError && query.error.status >= 400 && query.error.status < 500) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  const data = query.data, focused = focusRequestId ? data.invoices.find(invoice => invoice.requests.some(request => request.id === focusRequestId)) : undefined;
  const invoices = focusRequestId ? focused ? [focused] : [] : data.invoices;
  return <section className="finance-arrangements" aria-label="Payment plans">
    {query.error ? <p role="alert">The account could not be refreshed. Previously loaded information is retained; no further action was sent.</p> : null}
    {standalone ? <h2 className="sr-only">Fee accounts</h2> : <header className="finance-arrangements-heading"><ProductIcon name="finance" size={28} /><h2>Payment plans</h2></header>}
    {readOnly ? <p className="finance-arrangement-caption">This Simulation is read-only.</p> : null}
    {data.can_manage && data.review_route.state === "unavailable" && !readOnly ? <FeeAuthoritySetup schoolId={schoolId} onConfirmed={reload} /> : null}
    {!data.can_manage && data.review_route.state === "unavailable" ? <p className="finance-arrangement-caption">Finance has not confirmed a reviewer yet. Contact Finance before sending a proposal.</p> : null}
    {focusRequestId && !focused ? <p role="alert">This payment-plan request is unavailable in the current fee account.</p> : null}
    <CollectionView items={invoices} namespace="payment_plans" label="fee accounts" searchLabel="Find a payment plan" searchPlaceholder="Person, fee or reference"
      searchText={invoice => `${invoice.student_label} ${invoice.description} ${invoice.reference}`} focusedId={focused?.id}
      empty={<p className="finance-arrangement-caption">No fee accounts are available here.</p>}>
      {visible => visible.map(invoice => <ArrangementAccount key={invoice.id} invoice={invoice} context={data} readOnly={readOnly}
        onAction={(mode, request) => setAction({ invoice, mode, request })} focusedRequestId={focusRequestId} />)}
    </CollectionView>
    {action?.mode === "propose" ? <FinanceArrangementProposal schoolId={schoolId} invoice={action.invoice} context={data} onClose={() => setAction(null)} onReload={reload} /> : null}
    {action?.mode === "decide" && action.request ? <FinanceArrangementDecision schoolId={schoolId} invoice={action.invoice} request={action.request} onClose={() => setAction(null)} onReload={reload} /> : null}
    {action && ["enable", "revoke", "withdraw"].includes(action.mode) ? <FinanceArrangementAccessDialog schoolId={schoolId} invoice={action.invoice} today={data.today}
      action={action.mode as "enable" | "revoke" | "withdraw"} onClose={() => setAction(null)} onReload={reload} /> : null}
  </section>;
}
function ArrangementAccount({ invoice, context, readOnly, onAction, focusedRequestId }: {
  invoice: ArrangementInvoice; context: FinanceArrangementsWorkspace; readOnly: boolean; focusedRequestId?: string;
  onAction: (mode: "propose" | "enable" | "revoke" | "withdraw" | "decide", request?: ArrangementRequest) => void;
}) {
  const pending = invoice.requests.find(request => request.status === "pending"), agreement = invoice.agreement;
  const focused = focusedRequestId ? invoice.requests.find(request => request.id === focusedRequestId) : pending;
  const stateLabel = pending?.route_state === "needs_reassignment" ? "Reviewer changed — withdraw and send again" : pending?.route_state === "review_window_ended"
    ? "Review window ended — withdraw and send again" : pending?.route_state === "route_unavailable" ? "Review route unavailable" : `Waiting for ${pending?.reviewer.label ?? "Finance"}`;
  return <article className="finance-arrangement-account">
    <header><div><h3>{invoice.description}</h3><p className="finance-arrangement-caption">{invoice.student_label} · {invoice.reference}</p></div><strong>{rupees(invoice.balance_paise)}<small>Outstanding</small></strong></header>
    {agreement ? <section aria-label="Agreed payment dates"><h4>{agreement.state === "needs_review" ? "Agreement needs review" : agreement.state === "satisfied" ? "Agreed payments received" : "Agreed payment dates"}</h4>
      {agreement.state === "needs_review" ? <p className="finance-arrangement-caption">Credits or refunds changed this account. Finance needs to review the schedule; the ledger balance above is current.</p> : null}
      <ul className="finance-arrangement-schedule">{agreement.rows.map(row => <li key={row.due_on}><span>{row.due_on}</span><strong>{row.remaining_paise === null ? rupees(row.amount_paise) : rupees(row.remaining_paise)}{row.remaining_paise === 0 ? <CircleCheck size={16} aria-label="Received" /> : null}</strong></li>)}</ul>
      <p className="finance-arrangement-caption">Only verified ledger payments count towards these amounts.</p>
    </section> : !pending ? <p className="finance-arrangement-caption">No agreed plan. Invoice due {invoice.original_due_on}.</p> : null}
    {focused ? <section className="finance-arrangement-request" aria-label="Payment proposal"><h4><Clock3 size={17} aria-hidden="true" />{focused.status === "pending" ? focused.can_decide ? "Your decision needed" : stateLabel : focused.status === "approved" ? "Proposal approved" : focused.status === "withdrawn" ? "Proposal withdrawn" : "Proposal declined"}</h4>
      {focused.status === "pending" ? <ul className="finance-arrangement-schedule">{focused.schedule.map(row => <li key={row.due_on}><span>{row.due_on}</span><strong>{rupees(row.amount_paise)}</strong></li>)}</ul> : null}
      {focused.basis_changed && focused.status === "pending" ? <p className="finance-arrangement-caption">The balance changed after this proposal. A new proposal is needed.</p> : null}
      {focused.decision_response ? <p className="finance-arrangement-note">{focused.decision_response}</p> : null}
      {!readOnly ? <div className="finance-arrangement-actions">{focused.can_decide ? <button type="button" onClick={() => onAction("decide", focused)}>Review proposal</button> : null}
        {focused.can_withdraw ? <button className="is-secondary" type="button" onClick={() => onAction("withdraw")}>Withdraw proposal</button> : null}</div> : null}
    </section> : null}
    {!readOnly && invoice.can_request && context.review_route.state === "ready" ? <button type="button" onClick={() => onAction("propose")}>Propose payment dates</button> : null}
    {context.can_manage && !readOnly ? <details><summary>{invoice.context_kind === "person" ? "Fee account access" : "Learner self-service"}</summary><p className="finance-arrangement-caption">{invoice.self_payer ? `${invoice.self_payer.state === "active" ? "Enabled" : invoice.self_payer.state} · ${invoice.self_payer.valid_from}–${invoice.self_payer.valid_until}` : "Not enabled for this invoice"}</p>
      {invoice.can_enable_self_payer && !invoice.can_revoke_self_payer ? <button className="is-secondary" type="button" onClick={() => onAction("enable")}>{invoice.context_kind === "person" ? "Enable fee account access" : "Enable for learner"}</button> : null}
      {invoice.can_revoke_self_payer ? <button className="is-secondary" type="button" onClick={() => onAction("revoke")}>Revoke access</button> : null}
      {!invoice.self_payer_account_available ? <p className="finance-arrangement-caption">Link the learner’s app account first.</p> : null}</details> : null}
    {invoice.requests.length > 1 ? <details><summary>Earlier proposals · {invoice.requests.length - 1}</summary><ol className="finance-arrangement-history">{invoice.requests.slice(1).map(request => <li key={request.id}><strong>{request.status}</strong><span>{new Date(request.submitted_at).toLocaleDateString()}</span>{request.decision_response ? <p>{request.decision_response}</p> : null}</li>)}</ol></details> : null}
    <details><InfoSummary>About this plan</InfoSummary><p className="finance-arrangement-caption">This campus uses Finance approval for proposed dates. A plan never changes the posted charge or proves funds were received.</p></details>
  </article>;
}
