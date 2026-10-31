import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoSummary } from "../../components/InfoSummary";
import { ApiError } from "../../lib/api";
import { useOptionalAuth } from "../auth/AuthContext";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { confirmFeeAuthority, getFeeAuthority, type FeeAuthorityConfirmation } from "./feeAuthorityApi";
import "./fee-authority.css";

export function FeeAuthoritySetup(props: { schoolId: string; onConfirmed: () => Promise<unknown> }) {
  const auth = useOptionalAuth();
  const environment = useExecutionEnvironment();
  if (environment.mode === "simulation" && environment.unavailable) {
    return <p role="status">This Simulation is unavailable. Return to Live to review payment-plan authority.</p>;
  }
  const context = `${props.schoolId}:${auth?.user?.id ?? "unknown"}:${environment.mode}:${environment.namespaceId ?? "live"}`;
  return <FeeAuthoritySetupContext key={context} {...props} actorId={auth?.user?.id ?? "unknown"} />;
}

function FeeAuthoritySetupContext({ schoolId, actorId, onConfirmed }: {
  schoolId: string; actorId: string; onConfirmed: () => Promise<unknown>;
}) {
  const environment = useExecutionEnvironment();
  const unavailable = environment.mode === "simulation" && environment.unavailable;
  const readOnly = environment.mode === "simulation" && (environment.unavailable || environment.runStatus === "stopped" || environment.runStatus === "completed");
  const command = useRef<FeeAuthorityConfirmation | null>(null);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["finance-arrangements", actorId, schoolId, "authority"]),
    queryFn: () => getFeeAuthority(schoolId, command.current?.command_id), enabled: !unavailable, retry: false });
  const [selected, setSelected] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<"accepted" | "unknown" | null>(null);
  const [error, setError] = useState("");
  const active = useRef(true), inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useUnsavedChangesGuard(busy || recovery !== null, "The approval setup has not been refreshed. Stay here to check its current state.");
  const candidate = query.data?.candidates.find(item => item.mandate_id === selected) ?? (selected ? undefined : query.data?.candidates[0]);
  const locked = busy || recovery !== null || readOnly;

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await query.refetch({ throwOnError: true });
      if (!active.current) return;
      if (result.data?.confirmation && result.data.confirmation.state !== "pending" && result.data.route.state === "ready") {
        await onConfirmed();
        if (active.current) { setRecovery(null); command.current = null; }
      } else if (recovery === "accepted" || result.data?.confirmation?.state === "accepted") {
        setRecovery("accepted");
        setError("The confirmation was saved, but current authority is unavailable. Review its current source before continuing.");
      } else if (result.data?.confirmation?.state === "not_found" || result.data?.confirmation?.state === "not_accepted") {
        command.current = null; setAttested(false);
        setRecovery(null);
        setError("No accepted confirmation was found. Review the current authority before confirming again.");
      } else if (recovery) {
        setError("This confirmation is still unconfirmed. Refresh again before continuing.");
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Couldn’t refresh current authority.");
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }

  async function confirm() {
    if (!candidate || !attested || locked || inFlight.current) return;
    const body = command.current ?? { command_id: crypto.randomUUID(), mandate_id: candidate.mandate_id,
      expected: candidate.expected, attestation: true as const };
    command.current = body; inFlight.current = true; setBusy(true); setError("");
    let accepted = false;
    try {
      await confirmFeeAuthority(schoolId, body); accepted = true;
      if (!active.current) return;
      setRecovery("accepted");
      const refreshed = await query.refetch({ throwOnError: true });
      if (!active.current) return;
      if (refreshed.data?.route.state !== "ready") {
        setError("The confirmation was saved, but current authority is unavailable. Review its current source before continuing.");
        return;
      }
      await onConfirmed();
      if (active.current) { setRecovery(null); command.current = null; setAttested(false); }
    } catch (cause) {
      if (!active.current) return;
      const refused = !accepted && cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 409;
      setRecovery(accepted ? "accepted" : refused ? null : "unknown");
      if (refused) { command.current = null; setAttested(false); }
      setError(accepted ? "The confirmation was saved. Refresh the current route before continuing."
        : refused ? cause.message : "Confirmation was not received. Refresh current authority before retrying.");
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }

  if (unavailable) return <p role="status">This Simulation is unavailable. Return to Live to review payment-plan authority.</p>;
  if (query.isPending) return <p role="status">Checking payment-plan authority…</p>;
  if (query.error && !query.data) return <section className="fee-authority"><p role="alert">{query.error.message}</p><button type="button" onClick={() => void refresh()} disabled={busy}>Try again</button></section>;
  const data = query.data;
  if (!data) return null;
  return <section className="fee-authority" aria-labelledby="fee-authority-title" aria-busy={busy}>
    <h3 id="fee-authority-title">Payment-plan approval</h3>
    {data.route.state === "ready" ? <p>{data.route.reviewer?.name ?? "The authorized reviewer"} handles payment-plan decisions.</p> : <>
      {candidate ? <>
        <p>Confirm the existing authority you’ll use. Payment-plan requests will come to you.</p>
        {data.candidates.length > 1 ? <label>Authority<select disabled={locked} value={candidate.mandate_id} onChange={event => { setSelected(event.target.value); setAttested(false); command.current = null; }}>
          {data.candidates.map(item => <option key={item.mandate_id} value={item.mandate_id}>{item.title}</option>)}
        </select></label> : null}
        <div className="fee-authority__person"><strong>{candidate.holder_name}</strong><span>{candidate.office_title}</span></div>
        <details><InfoSummary>Authority details</InfoSummary><div className="fee-authority__evidence">
          <p>{candidate.title}{candidate.max_amount_paise !== null ? ` · Up to ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(candidate.max_amount_paise / 100)}` : ""}</p>
          {candidate.sources.map(source => <div key={source.id}><strong>{source.title}</strong><p>{source.reference}{source.provision ? ` · ${source.provision}` : ""}</p><small>{source.effective_from}{source.effective_until ? ` – ${source.effective_until}` : " onward"}</small></div>)}
        </div></details>
        <label className="fee-authority__confirm"><input type="checkbox" checked={attested} disabled={locked} onChange={event => setAttested(event.target.checked)} />I confirm this authority covers payment-plan decisions.</label>
        {!recovery ? <button className="fee-authority__primary" type="button" disabled={locked || !attested} onClick={() => void confirm()}>{busy ? "Confirming…" : "Use existing authority"}</button> : null}
      </> : <p>{data.other_holders.length ? `Ask ${data.other_holders.map(holder => holder.name).join(" or ")} to confirm their existing authority.` : "An authorized institution representative needs to record who may approve payment plans."}</p>}
      {!candidate && data.route.reason ? <details><InfoSummary>What’s needed</InfoSummary><p>{data.route.reason}</p></details> : null}
    </>}
    {readOnly ? <p>This Simulation is read-only.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {recovery ? <button type="button" disabled={busy || readOnly} onClick={() => void refresh()}>{busy ? "Refreshing…" : "Refresh current authority"}</button> : null}
  </section>;
}
