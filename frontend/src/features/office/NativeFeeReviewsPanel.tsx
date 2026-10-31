import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { CollectionView } from "../../components/CollectionView";
import { rupees } from "./api";
import { getNativeFeeReviews, type NativeFeeReview, type NativeFeeReviewInvoice } from "./nativeFeeReviewsApi";
import { NativeFeeReportDialog } from "./NativeFeeReviewDialog";
import { NativeFeeDecisionDialog } from "./NativeFeeDecisionDialog";
import { feeReadDenied } from "./personFeesApi";

interface Props { schoolId: string; invoiceId?: string; personId?: string; studentId?: string; focusReviewId?: string; onLedgerReload: () => Promise<unknown>; receiptHref?: (paymentId: string) => string }
export function NativeFeeReviewsPanel(props: Props) {
  const auth = useAuth(), environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) return <WorkspaceState state="unavailable" />;
  return <NativeFeeReviewsContext key={`${auth.user?.id}:${props.schoolId}:${environment.namespaceId}:${environment.mode === "simulation" ? environment.runId : "live"}:${props.personId ?? props.studentId ?? "all"}:${props.invoiceId ?? ""}`} {...props} />;
}
function NativeFeeReviewsContext({ schoolId, invoiceId, personId, studentId, focusReviewId, onLedgerReload, receiptHref }: Props) {
  const auth = useAuth(), environment = useExecutionEnvironment();
  const readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  const context = { invoiceId, personId, studentId };
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", "native-fee-reviews", auth.user?.id, schoolId, invoiceId, personId, studentId]),
    queryFn: () => getNativeFeeReviews(schoolId, context), retry: false });
  const [action, setAction] = useState<{ mode: "payment" | "charge" | "decide" | "withdraw"; invoice: NativeFeeReviewInvoice; review?: NativeFeeReview } | null>(null);
  const reload = async () => { await onLedgerReload(); await query.refetch({ throwOnError: true }); };
  if (query.isPending) return <WorkspaceState state="loading" />;
  if (!query.data || feeReadDenied(query.error)) return <WorkspaceState state="error" error={query.error} onRetry={query.refetch} />;
  const all = query.data.invoices.flatMap(invoice => invoice.reviews.map(review => ({ id: review.id, invoice, review })));
  const focused = focusReviewId ? all.find(item => item.review.id === focusReviewId) : undefined;
  const entries = focusReviewId ? focused ? [focused] : [] : all;
  return <section className="person-fee-reviews" aria-label="Payment reports and questions">
    {query.error ? <p role="alert">Requests could not be refreshed. Previously loaded information and unsent choices are kept.</p> : null}
    {focusReviewId && !focused ? <p role="alert">This request is unavailable in the current fee account.</p> : null}
    {!readOnly && invoiceId ? query.data.invoices.map(invoice => <div key={invoice.id} className="person-fee-actions">
      {invoice.can_report ? <button type="button" disabled={Boolean(query.error)} onClick={() => setAction({ mode: "payment", invoice })}>Report payment</button> : null}
      {invoice.can_question ? <button type="button" className="is-secondary" disabled={Boolean(query.error)} onClick={() => setAction({ mode: "charge", invoice })}>Question charge</button> : null}
      {query.data.can_manage && !invoice.reviewers.length ? <p className="person-fee-caption">Assign an independent Finance reviewer before reporting a payment. <Link to="/more/setup/responsibilities">Manage responsibilities</Link></p> : null}
    </div>) : null}
    <CollectionView items={entries} namespace="payment_review_records" label="requests" searchLabel="Find a request" searchPlaceholder="Person or charge" searchText={item => `${item.invoice.label} ${item.invoice.reference} ${item.invoice.description}`} empty={<p className="person-fee-caption">No payment reports or questions.</p>}>
      {visible => <div className="person-fee-records">{visible.map(({ invoice, review }) => <article className="person-fee-review-record" key={review.id}>
        <header><div><h3>{review.kind === "payment" ? "Payment report" : "Fee question"}</h3><p className="person-fee-caption">{invoice.label} · {invoice.reference}</p></div>{review.amount_paise ? <strong>{rupees(review.amount_paise)}</strong> : null}</header>
        <p>{review.status === "pending" ? review.can_decide ? "Your review needed" : review.route_state === "waiting_for_review" ? `Waiting for ${review.reviewer.label}` : "Reviewer unavailable — review or withdraw this request" : review.status === "verified" ? "Payment verified" : review.status === "answered" ? "Question answered" : review.status === "withdrawn" ? "Request withdrawn" : "Payment report rejected"}</p>
        {review.reference ? <p className="person-fee-caption">{review.method?.replaceAll("_", " ")} · {review.reference}</p> : null}{review.note ? <p>{review.note}</p> : null}{review.response ? <p>{review.response}</p> : null}
        {!readOnly ? <div className="person-fee-actions">{review.can_decide ? <button type="button" onClick={() => setAction({ mode: "decide", invoice, review })}>Review request</button> : null}{review.can_withdraw ? <button className="is-secondary" type="button" onClick={() => setAction({ mode: "withdraw", invoice, review })}>Withdraw</button> : null}</div> : null}
        {review.payment_id && receiptHref ? <Link to={receiptHref(review.payment_id)}>View receipt</Link> : null}
      </article>)}</div>}
    </CollectionView>
    {action && (action.mode === "payment" || action.mode === "charge") ? <NativeFeeReportDialog schoolId={schoolId} invoice={action.invoice} kind={action.mode} onClose={() => setAction(null)} onReload={reload} /> : null}
    {action?.review && (action.mode === "decide" || action.mode === "withdraw") ? <NativeFeeDecisionDialog schoolId={schoolId} invoice={action.invoice} review={action.review} withdrawing={action.mode === "withdraw"} onClose={() => setAction(null)} onReload={reload} /> : null}
  </section>;
}
