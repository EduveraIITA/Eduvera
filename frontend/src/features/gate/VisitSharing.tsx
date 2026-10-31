import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import type { ArrangedVisit } from "./visitApi";
import { getSharedVisit, getVisitSharing, revokeVisitSharing, takeOverVisitQuestions, type VisitSharing as Sharing } from "./visitSharingApi";
import { VisitShareDialog } from "./VisitShareDialog";
import { VisitInvitationDialog } from "./VisitInvitationDialog";
import { VisitQuestions } from "./VisitQuestions";
import { VisitReadError, visitDate } from "./VisitPrimitives";
import { useVisitSharingCommand, VisitSharingFeedback } from "./useVisitSharingCommand";

const states = { active: "Shared", expired: "Sharing expired", revoked: "Sharing stopped", party_changed: "Guest details changed" };
export function VisitSharing({ schoolId, actorId, visit, timezone, disabled }: { schoolId: string; actorId: string; visit: ArrangedVisit; timezone: string; disabled: boolean }) {
  const world = useExecutionEnvironment(), [editing, setEditing] = useState(false), [action, setAction] = useState<"revoke" | "takeover" | null>(null), [invitation, setInvitation] = useState(false);
  const root = executionEnvironmentQueryKey(world, ["gate-visits", schoolId, actorId, "sharing", visit.id]);
  const metadata = useQuery({ queryKey: [...root, visit.revision], queryFn: ({ signal }) => getVisitSharing(schoolId, visit.id, signal), retry: false });
  const shared = useQuery({ queryKey: [...root, "questions", metadata.data?.current?.id], queryFn: ({ signal }) => getSharedVisit(schoolId, visit.id, signal), enabled: metadata.data?.can_open_shared === true && !metadata.error, retry: false });
  const refresh = async () => { await metadata.refetch({ throwOnError: true }); if (metadata.data?.can_open_shared) await shared.refetch({ throwOnError: true }); };
  if (metadata.isPending) return <p role="status" className="visits-caption">Checking visit sharing…</p>;
  if (metadata.error || !metadata.data) return <VisitReadError error={metadata.error} onRetry={metadata.refetch} />;
  const data = metadata.data, current = data.current;
  return <>
    <section className="visits-section visits-sharing" aria-label="Visit sharing"><header><div><h2>{current ? `${states[current.state]} with ${current.organiser.label}` : "Share with the organiser"}</h2>{current ? <p className="visits-caption">Until {visitDate(current.ends_at, timezone)}</p> : <p className="visits-caption">Time, place, directions and a private question thread.</p>}</div>{data.can_share && (!current || current.can_renew) ? <button type="button" className="is-secondary" disabled={disabled} onClick={() => setEditing(true)}><Share2 size={16} aria-hidden="true" />{current ? "Update sharing" : "Share visit"}</button> : null}</header>
      {current ? <><p className="visits-caption">Questions go to {current.owner.label}.{!current.owner.available ? " This person is unavailable." : ""}</p><div className="visits-actions">{current.can_takeover ? <button type="button" className="is-secondary" disabled={disabled} onClick={() => setAction("takeover")}>Take over questions</button> : null}{current.invitation ? <button type="button" className="is-text" disabled={disabled} onClick={() => setInvitation(true)}>Manage invitation</button> : null}{current.can_revoke ? <button type="button" className="is-text" disabled={disabled} onClick={() => setAction("revoke")}>Stop sharing</button> : null}</div></> : null}
    </section>
    {data.can_open_shared ? shared.isPending ? <p role="status" className="visits-caption">Loading questions…</p> : shared.error || !shared.data ? <VisitReadError error={shared.error} onRetry={shared.refetch} /> : <VisitQuestions schoolId={schoolId} detail={shared.data} timezone={shared.data.timezone} disabled={disabled} refresh={async () => { await shared.refetch({ throwOnError: true }); }} /> : null}
    {editing && !disabled ? <VisitShareDialog schoolId={schoolId} actorId={actorId} visit={visit} initial={data} refresh={refresh} onClose={() => setEditing(false)} /> : null}
    {action && current && !disabled ? <SharingAction schoolId={schoolId} visit={visit} sharing={data} action={action} refresh={refresh} onClose={() => setAction(null)} /> : null}
    {invitation && current?.invitation && !disabled ? <VisitInvitationDialog schoolId={schoolId} actorId={actorId} sharing={current} refresh={refresh} onClose={() => setInvitation(false)} /> : null}
  </>;
}
function SharingAction({ schoolId, visit, sharing, action, refresh, onClose }: { schoolId: string; visit: ArrangedVisit; sharing: Sharing; action: "revoke" | "takeover"; refresh: () => Promise<unknown>; onClose: () => void }) {
  const write = useVisitSharingCommand<Sharing>({ schoolId, visitId: visit.id, accepts: receipt => receipt.action === (action === "revoke" ? "revoked" : "taken_over") && receipt.share_root_id === sharing.current?.root_id, onAccepted: async () => { await refresh(); onClose(); } });
  const submit = () => { if (!sharing.current || write.locked) return; const shareId = sharing.current.id, body = { expected_revision: sharing.share_revision }; void write.execute(command_id => (action === "revoke" ? revokeVisitSharing : takeOverVisitQuestions)(schoolId, visit.id, shareId, { ...body, command_id }), body.expected_revision); };
  return <PlannerDialog title={action === "revoke" ? "Stop sharing this visit?" : "Take over visit questions?"} subtitle={visit.title} onClose={onClose} busy={write.busy || Boolean(write.recovery)}><div className="visits-form"><p>{action === "revoke" ? "The organiser will no longer open this shared visit. Their account and other work stay unchanged." : "New and pending questions will come to you. The earlier conversation stays with this visit."}</p><VisitSharingFeedback write={write} onReview={async () => { await refresh(); onClose(); }} /><footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery)} onClick={onClose}>Cancel</button><button type="button" disabled={write.locked} onClick={submit}>{write.busy ? "Saving…" : action === "revoke" ? "Stop sharing" : "Take over questions"}</button></footer></div></PlannerDialog>;
}
