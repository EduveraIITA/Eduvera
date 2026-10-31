import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { deliveryLabel, deliveryPending, getMemberInvitation, invitationState, resendMemberInvitation, revokeMember } from "../onboarding/api";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { VisitSharing } from "./visitSharingApi";

export function VisitInvitationDialog({ schoolId, actorId, sharing, refresh, onClose }: { schoolId: string; actorId: string; sharing: NonNullable<VisitSharing["current"]>; refresh: () => Promise<unknown>; onClose: () => void }) {
  const world = useExecutionEnvironment(), active = useRef(true), invitation = sharing.invitation;
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const detail = useQuery({ queryKey: executionEnvironmentQueryKey(world, ["gate-visits", schoolId, actorId, "invitation", sharing.id, invitation?.id]), queryFn: async () => {
    const current = await getMemberInvitation(schoolId, invitation!.id);
    if (current.id !== invitation?.id || current.person_id !== sharing.organiser.id) throw new Error("This invitation does not match the organiser. Refresh visit sharing.");
    return current;
  }, enabled: world.mode === "live" && Boolean(invitation), refetchInterval: query => deliveryPending(query.state.data?.delivery) ? 2000 : false });
  const check = async () => { setBusy(true); setError(""); try { await detail.refetch({ throwOnError: true }); if (active.current) { setUnknown(false); await refresh(); } } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "The invitation could not be checked."); } finally { if (active.current) setBusy(false); } };
  const manage = async (action: "resend" | "revoke") => { if (busy || unknown || detail.error || !detail.data || world.mode !== "live") return; setBusy(true); setError(""); try { if (action === "resend") await resendMemberInvitation(schoolId, detail.data.id); else await revokeMember(schoolId, detail.data.id); if (active.current) { await detail.refetch({ throwOnError: true }); await refresh(); } } catch (cause) { if (active.current) { setUnknown(true); setError(`${cause instanceof Error ? cause.message : "The invitation update was not confirmed."} Check its status before another action.`); } } finally { if (active.current) setBusy(false); } };
  const current = detail.data, state = current ? invitationState(current) : null;
  return <PlannerDialog title="Visit invitation" subtitle={sharing.organiser.label} onClose={onClose} busy={busy}><div className="visits-form">
    {world.mode !== "live" ? <p className="visits-caption">Real app invitations are managed in Live. This run has not sent an email or changed an account.</p> : detail.isPending ? <p role="status">Checking invitation…</p> : detail.error || !current ? <p className="visits-error" role="alert">{detail.error?.message ?? "The invitation could not load."}</p> : <div className="visits-summary"><strong>{state === "Accepted" ? "App account linked" : `Invitation ${state?.toLowerCase()}`}</strong><p>{current.email}</p><p className="visits-caption">{deliveryLabel(current.delivery) || "Email delivery is unavailable or unconfirmed."}</p></div>}
    <p className="visits-caption">Sharing is separate from the account. Stop visit access from this visit.</p>{error ? <p className="visits-error" role="alert">{error}</p> : null}
    <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Close</button>{unknown || detail.error ? <button type="button" disabled={busy} onClick={() => void check()}>Check status</button> : current && ["Pending", "Expired"].includes(state ?? "") ? <button type="button" disabled={busy || deliveryPending(current.delivery)} onClick={() => void manage("resend")}>Resend email</button> : null}</footer>
    {!unknown && !detail.error && current && ["Pending", "Expired"].includes(state ?? "") ? <button type="button" className="is-text" disabled={busy} onClick={() => void manage("revoke")}>Revoke invitation</button> : null}
  </div></PlannerDialog>;
}
