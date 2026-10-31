import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { deliveryLabel, deliveryPending, getMemberInvitation, invitationState, resendMemberInvitation, revokeMember } from "../onboarding/api";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { RepairDetail } from "./facilitiesApi";

export function RepairInvitationDialog({ schoolId, actorId, repair, refresh, onClose }: { schoolId: string; actorId: string; repair: RepairDetail; refresh: () => Promise<unknown>; onClose: () => void }) {
  const world = useExecutionEnvironment(), invitation = repair.external_access?.invitation, active = useRef(true);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const detail = useQuery({ queryKey: executionEnvironmentQueryKey(world, ["facilities", schoolId, actorId, "job-invitation", repair.id, invitation?.id]), queryFn: async () => {
    const result = await getMemberInvitation(schoolId, invitation!.id);
    if (result.id !== invitation?.id || result.person_id !== repair.external_access?.person.id) throw new Error("This invitation does not match the assigned technician. Refresh the repair before continuing.");
    return result;
  }, enabled: world.mode === "live" && Boolean(invitation), refetchInterval: query => deliveryPending(query.state.data?.delivery) ? 2000 : query.state.data && invitationState(query.state.data) === "Pending" ? 5000 : false });
  const manage = async (action: "resend" | "revoke") => {
    if (busy || unknown || detail.isError || !detail.data || world.mode !== "live") return;
    setBusy(true); setError("");
    try {
      if (action === "resend") await resendMemberInvitation(schoolId, detail.data.id);
      else await revokeMember(schoolId, detail.data.id);
      if (!active.current) return;
      await detail.refetch({ throwOnError: true }); await refresh();
    } catch (cause) { if (active.current) { setUnknown(true); setError(`${cause instanceof Error ? cause.message : "The invitation update was not confirmed."} Check its current status before another action.`); } }
    finally { if (active.current) setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setError("");
    try { await detail.refetch({ throwOnError: true }); if (active.current) { setUnknown(false); await refresh(); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The current invitation could not be checked."); }
    finally { if (active.current) setBusy(false); }
  };
  const current = detail.data, state = current ? invitationState(current) : null;
  return <PlannerDialog title="Technician invitation" subtitle={repair.external_access?.person.label} onClose={onClose} busy={busy}><div className="facilities-form">
    {world.mode !== "live" ? <p>Real app invitations are managed in Live. This run has not sent an email or changed an account.</p> : detail.isPending ? <p role="status">Checking invitation…</p> : detail.isError || !current ? <p className="facilities-error" role="alert">{detail.error?.message ?? "This invitation could not be loaded."}</p> : <><div className="facilities-job-access"><strong>{state === "Accepted" ? "App account linked" : `Invitation ${state?.toLowerCase()}`}</strong><p>{current.email}</p><p className="facilities-caption" aria-live="polite">{deliveryLabel(current.delivery)}</p></div><p className="facilities-caption">{state === "Accepted" ? "Job access is separate. End it from this repair without deleting the account." : `Expires ${new Date(current.expires_at).toLocaleString()}. Sending an email does not accept the job.`}</p></>}
    {error ? <p className="facilities-error" role="alert">{error}</p> : null}
    <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Close</button>{unknown || detail.isError ? <button type="button" disabled={busy} onClick={() => void check()}>Check status</button> : current && (state === "Pending" || state === "Expired") ? <button type="button" disabled={busy || deliveryPending(current.delivery)} onClick={() => void manage("resend")}>Resend email</button> : null}</footer>
    {!unknown && !detail.isError && current && (state === "Pending" || state === "Expired") ? <button type="button" className="is-text" disabled={busy} onClick={() => void manage("revoke")}>Revoke invitation</button> : null}
  </div></PlannerDialog>;
}
