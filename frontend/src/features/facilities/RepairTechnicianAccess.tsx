import { useState } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import type { RepairDetail } from "./facilitiesApi";
import { FacilitiesWriteFeedback, repairDate } from "./FacilitiesPrimitives";
import { endRepairExternalAccess } from "./repairExternalAccessApi";
import { RepairTechnicianDialog } from "./RepairTechnicianDialog";
import { useFacilitiesCommand } from "./useFacilitiesCommand";
import { RepairInvitationDialog } from "./RepairInvitationDialog";

const states = { scheduled: "Scheduled", awaiting_sign_in: "Awaiting sign-in", ready: "Ready to accept", active: "Job connected", expired: "Access expired", ended: "Access ended" };
export function RepairTechnicianAccess({ schoolId, actorId, repair, timezone, refresh, readOnly }: {
  schoolId: string; actorId: string; repair: RepairDetail; timezone: string; refresh: () => Promise<unknown>; readOnly: boolean;
}) {
  const [inviting, setInviting] = useState(false), [ending, setEnding] = useState(false), [managing, setManaging] = useState(false), access = repair.external_access;
  const currentAssignment = Boolean(access && access.state !== "ended"), canEnd = !readOnly && access?.can_manage && currentAssignment;
  if (repair.external_view) return access ? <section className="facilities-job-access" aria-label="Your job access"><p>Access until <time dateTime={access.ends_at}>{repairDate(access.ends_at, timezone)}</time></p><p className="facilities-caption">This repair only · Campus checks the completed work.</p></section> : null;
  return <>
    {access ? <section className="facilities-section facilities-job-access" aria-label="Technician access"><header><div><strong>{access.person.label}</strong><p className="facilities-caption">{states[access.state]} · until {repairDate(access.ends_at, timezone)}</p></div>{canEnd ? <button type="button" className="is-text" onClick={() => setEnding(true)}>{access.state === "expired" ? "End assignment" : "End access"}</button> : null}</header>{canEnd && (access.state === "expired" || repair.can_invite_external) ? <p className="facilities-caption">End this assignment before inviting someone else.</p> : null}{!readOnly && access.can_manage && access.invitation ? <button type="button" className="is-text" onClick={() => setManaging(true)}>Manage invitation</button> : null}</section> : null}
    {!readOnly && access?.state === "ended" && repair.handler.id === access.person.id && !["closed", "awaiting_verification"].includes(repair.state) && repair.allowed_actions.assign ? <p className="facilities-caption">Choose a current handler in Change responsibility, then invite a technician.</p> : null}
    {!readOnly && !currentAssignment && repair.can_invite_external ? <button type="button" className="is-secondary facilities-invite" onClick={() => setInviting(true)}>Invite technician</button> : null}
    {inviting ? <RepairTechnicianDialog schoolId={schoolId} actorId={actorId} repair={repair} refresh={refresh} onClose={() => setInviting(false)} /> : null}
    {ending && access ? <EndRepairAccess schoolId={schoolId} repair={repair} refresh={refresh} onClose={() => setEnding(false)} /> : null}
    {managing && access?.invitation ? <RepairInvitationDialog schoolId={schoolId} actorId={actorId} repair={repair} refresh={refresh} onClose={() => setManaging(false)} /> : null}
  </>;
}
function EndRepairAccess({ schoolId, repair, refresh, onClose }: { schoolId: string; repair: RepairDetail; refresh: () => Promise<unknown>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const title = repair.external_access?.state === "expired" ? "End technician assignment" : "End technician access";
  const write = useFacilitiesCommand({ schoolId, sourceId: repair.id, onAccepted: async () => { await refresh(); onClose(); } });
  return <PlannerDialog title={title} subtitle={repair.external_access?.person.label} onClose={onClose} busy={write.busy || Boolean(write.recovery)}><form className="facilities-form" onSubmit={event => {
    event.preventDefault(); if (note.trim().length < 3 || !repair.external_access) return;
    const body = { expected_revision: repair.revision, note: note.trim() }, grantId = repair.external_access.id;
    void write.execute(command_id => endRepairExternalAccess(schoolId, repair.id, grantId, { ...body, command_id }), { id: repair.id, revision: repair.revision });
  }}><p className="facilities-caption">Ends this repair assignment, not the person’s account or their other work.</p><label>Reason<textarea required minLength={3} maxLength={2000} rows={2} value={note} disabled={write.locked} onChange={event => setNote(event.target.value)} /></label><FacilitiesWriteFeedback write={write} /><footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery)} onClick={onClose}>Cancel</button><button type="submit" disabled={write.locked || note.trim().length < 3}>{write.busy ? "Ending…" : repair.external_access?.state === "expired" ? "End assignment" : "End access"}</button></footer></form></PlannerDialog>;
}
