import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WorkspaceState } from "../workspace/WorkspaceState";
import { getNativeFeeReviewRecovery, nativeFeeReviewObsolete, validateNativeFeeConfirmation, withdrawNativeFeeReview, type NativeFeeReviewRecovery } from "./nativeFeeReviewsApi";
import { feeReadDenied } from "./personFeesApi";
import { useFeeCommand } from "./useFeeCommand";
import "./person-fees.css";

/** Own retained request only: access recovery never reveals the old private invoice. */
export function NativeFeeReviewRecoveryRoute() {
  const auth = useAuth(), environment = useExecutionEnvironment(), { reviewId = "" } = useParams();
  if (environment.mode === "simulation" && environment.unavailable) return <OperationsShell active="work" title="Fee request" backTo="/work"><WorkspaceState state="unavailable" /></OperationsShell>;
  return <NativeFeeRecoveryContext key={`${auth.user?.id}:${auth.user?.active_school_id}:${environment.namespaceId}:${environment.mode === "simulation" ? environment.runId : "live"}:${reviewId}`} reviewId={reviewId} />;
}
function NativeFeeRecoveryContext({ reviewId }: { reviewId: string }) {
  const auth = useAuth(), environment = useExecutionEnvironment(), schoolId = auth.user?.active_school_id ?? "", [withdrawing, setWithdrawing] = useState(false);
  const readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", "native-fee-recovery", auth.user?.id, schoolId, reviewId]),
    queryFn: () => getNativeFeeReviewRecovery(schoolId, reviewId), enabled: Boolean(schoolId && reviewId), retry: false });
  return <OperationsShell active="work" title="Fee request" backTo="/work"><main className="person-fees-workspace">
    {query.isPending ? <WorkspaceState state="loading" /> : !query.data || feeReadDenied(query.error) ? <WorkspaceState state="error" error={query.error} onRetry={query.refetch} /> : <>
      {query.error ? <p role="alert">The request could not be refreshed. Your last confirmed status is kept.</p> : null}
      <h2>{query.data.status === "pending" ? "Pending review" : query.data.status === "withdrawn" ? "Request withdrawn" : "Review completed"}</h2>
      <p>{query.data.status === "pending" ? `Waiting for ${query.data.reviewer.label}` : "This request is no longer pending."}</p>
      <p className="person-fee-caption">Your fee account access changed. You can still close your own pending request here; private account details are not shown.</p>
      {!readOnly && query.data.can_withdraw ? <button disabled={Boolean(query.error)} type="button" onClick={() => setWithdrawing(true)}>Withdraw request</button> : null}
      {withdrawing ? <RecoveryWithdrawal schoolId={schoolId} source={query.data} onClose={() => setWithdrawing(false)} onReload={() => query.refetch({ throwOnError: true })} /> : null}
    </>}
  </main></OperationsShell>;
}
function RecoveryWithdrawal({ schoolId, source, onClose, onReload }: { schoolId: string; source: NativeFeeReviewRecovery; onClose: () => void; onReload: () => Promise<unknown> }) {
  const [basis, setBasis] = useState(source), [error, setError] = useState(""), [reading, setReading] = useState(false);
  const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const writer = useFeeCommand(onReload, onClose, async commandId => validateNativeFeeConfirmation((await getNativeFeeReviewRecovery(schoolId, source.id, commandId)).confirmation, source.invoice_id, commandId, source.id, "withdraw"),
    (cause, commandId) => nativeFeeReviewObsolete(cause, commandId, { id: basis.invoice_id, stream_revision: basis.stream_revision }, basis.id));
  return <PlannerDialog title="Withdraw request" busy={writer.locked || reading} onClose={() => { if (!writer.locked && !reading) onClose(); }}><form className="person-fee-form" onSubmit={event => { event.preventDefault(); if (!writer.locked && !reading) void writer.execute(command_id => withdrawNativeFeeReview(schoolId, basis.id, basis.invoice_id, { command_id, expected_revision: basis.stream_revision })); }}>
    <p>Close your request to {source.reviewer.label}?</p><p className="person-fee-caption">The charge, any payment and previous decisions stay unchanged.</p>
    {error || writer.error ? <p role="alert" className="person-fee-error">{error || writer.error}</p> : null}
    {writer.obsolete ? <button type="button" className="is-secondary" disabled={reading} onClick={() => { setReading(true); void getNativeFeeReviewRecovery(schoolId, basis.id).then(current => { if (!current.can_withdraw) throw new Error("This request is no longer available to withdraw. Close and return to its current status."); if (active.current) { setBasis(current); writer.clearObsolete(); } }).catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : "The request could not be refreshed."); }).finally(() => { if (active.current) setReading(false); }); }}>Review current status</button> : null}
    <footer><button type="button" className="is-secondary" disabled={writer.locked || reading} onClick={onClose}>Cancel</button>{writer.recovery ? <button type="button" disabled={writer.busy} onClick={() => void (writer.retrySafe ? writer.retry() : writer.check())}>{writer.busy ? "Checking…" : writer.retrySafe ? "Retry same action" : "Check result"}</button>
      : <button disabled={writer.locked || reading || writer.obsolete}>Withdraw request</button>}</footer>
  </form></PlannerDialog>;
}
