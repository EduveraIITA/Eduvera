import { useEffect, useRef, useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { deliveryLabel, deliveryPending, invitePersonToApp, type ReadyInvitation } from "../onboarding/api";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { ApiError } from "../../lib/api";
import { getRepair, type RepairDetail, type RepairExternalAccess } from "./facilitiesApi";
import { FacilitiesWriteFeedback } from "./FacilitiesPrimitives";
import { grantRepairExternalAccess } from "./repairExternalAccessApi";
import { RepairTechnicianPicker, type RepairTechnician } from "./RepairTechnicianPicker";
import { useFacilitiesCommand } from "./useFacilitiesCommand";

export function RepairTechnicianDialog({ schoolId, actorId, repair, refresh, onClose }: {
  schoolId: string; actorId: string; repair: RepairDetail; refresh: () => Promise<unknown>; onClose: () => void;
}) {
  const world = useExecutionEnvironment(), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [person, setPerson] = useState<RepairTechnician | null>(null), [choosing, setChoosing] = useState(false), [until, setUntil] = useState("");
  const [current, setCurrent] = useState(repair), [reviewing, setReviewing] = useState(false);
  const [instructions, setInstructions] = useState(repair.problem), [sharePhotos, setSharePhotos] = useState(false), [email, setEmail] = useState("");
  const [grant, setGrant] = useState<RepairExternalAccess | null>(null), [invitation, setInvitation] = useState<ReadyInvitation | null>(null);
  const invitationKey = useRef(crypto.randomUUID()), [sending, setSending] = useState(false), [unknown, setUnknown] = useState(false), [refused, setRefused] = useState(false), [error, setError] = useState("");
  const send = async (access: RepairExternalAccess) => {
    if (world.mode !== "live" || !person || sending) return;
    setSending(true); setError("");
    try {
      const result = await invitePersonToApp(schoolId, { email: email.trim().toLowerCase(), role: "member", person_id: person.id, idempotency_key: invitationKey.current, work_context: { kind: "facility_repair", source_id: repair.id, access_id: access.id } });
      if (active.current) { setInvitation(result); setUnknown(false); setRefused(false); try { await refresh(); } catch { if (active.current) setError("Invitation created. The updated repair view could not refresh; your saved job access is retained."); } }
    } catch (cause) { if (active.current) { const definite = !unknown && cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 409; setUnknown(!definite); setRefused(definite); setError(`Job access saved. The app invitation was ${definite ? "not created" : "not confirmed"}. ${cause instanceof Error ? cause.message : "Retry the same invitation here."}`); } }
    finally { if (active.current) setSending(false); }
  };
  const write = useFacilitiesCommand({ schoolId, sourceId: repair.id, onAccepted: async (_id, result) => {
    const detail = result && typeof result === "object" && "external_access" in result ? result as RepairDetail : await getRepair(schoolId, repair.id);
    if (!active.current) return;
    const confirmedId = result && typeof result === "object" && "external_access_id" in result ? result.external_access_id : detail.external_access?.id;
    if (!confirmedId || !detail.external_access || detail.external_access.id !== confirmedId || detail.external_access.person.id !== person?.id) throw new Error("Job access was saved, but this technician’s current access could not be loaded.");
    setGrant(detail.external_access);
    if (person.has_app_access || world.mode !== "live") { await refresh(); onClose(); }
    else await send(detail.external_access);
  } });
  const locked = write.locked || sending || reviewing || Boolean(grant), dirty = Boolean(person || until || instructions !== repair.problem || sharePhotos || email);
  const canLeave = useUnsavedChangesGuard(!grant && dirty && !write.busy && !write.recovery, "Discard this unfinished technician invitation?");
  const close = () => { if (!write.busy && !reviewing && !sending && (write.recovery !== "unknown" || grant) && !unknown && (grant || canLeave())) onClose(); };
  const valid = Boolean(person && until && Number.isFinite(Date.parse(until)) && instructions.trim() && (person.has_app_access || world.mode !== "live" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())));
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!valid || locked || !person) return;
    const body = { expected_revision: current.revision, person_id: person.id, expected_person_revision: person.revision, ends_at: new Date(until).toISOString(), instructions: instructions.trim(), shared_photo_ids: sharePhotos ? current.photos.map(photo => photo.id) : [] };
    void write.execute(command_id => grantRepairExternalAccess(schoolId, repair.id, { ...body, command_id }), { id: repair.id, revision: current.revision });
  };
  const review = async () => { setReviewing(true); setError(""); try { const fresh = await getRepair(schoolId, repair.id); if (!active.current) return; if (!fresh.can_invite_external) throw new Error("This repair can no longer be shared. Close and review its current access."); setCurrent(fresh); write.reviewed(); } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "This repair could not be checked."); } finally { if (active.current) setReviewing(false); } };
  return <PlannerDialog title="Invite technician" subtitle={repair.title} busy={write.busy || sending || reviewing || unknown || write.recovery === "unknown"} onClose={close}>
    <form className="facilities-form" onSubmit={submit}>
      {grant ? <div role="status" className="facilities-job-access"><strong>Job access saved</strong><p>{grant.person.label}</p><p className="facilities-caption">{invitation ? deliveryLabel(invitation.delivery) : unknown ? "Invitation not confirmed" : "Preparing app invitation…"}</p>{invitation && !deliveryPending(invitation.delivery) && invitation.delivery !== "email_accepted" ? <p className="facilities-caption">Email delivery is unavailable or not confirmed. App access starts only after the recipient accepts.</p> : null}</div> : null}
      <fieldset disabled={locked}>
        <div className="facilities-field"><span>Technician</span><button type="button" aria-label={person ? `Technician: ${person.label}` : "Choose person"} className="facilities-select is-secondary" onClick={() => setChoosing(true)}>{person?.label ?? "Choose person"}</button></div>
        <label>Instructions<textarea rows={3} maxLength={2000} required value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
        <label>Access until<TemporalInput type="datetime-local" required value={until} onChange={event => setUntil(event.target.value)} /></label>
        <p className="facilities-caption">{Intl.DateTimeFormat().resolvedOptions().timeZone} · This repair only. No room-entry permission.</p>
        {repair.photos.length ? <label className="facilities-check"><input type="checkbox" checked={sharePhotos} onChange={event => setSharePhotos(event.target.checked)} /><span>Share report photos <small>Optional</small></span></label> : null}
        {person && !person.has_app_access && world.mode === "live" ? <label>Invitation email<input type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></label> : null}
        {person && !person.has_app_access && world.mode !== "live" ? <p className="facilities-caption">This run can rehearse access. Real invitations and account changes are managed in Live.</p> : null}
      </fieldset>
      {grant && refused ? <label>Invitation email<input type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => { setEmail(event.target.value); invitationKey.current = crypto.randomUUID(); }} /></label> : null}
      {error ? <p className="facilities-error" role="alert">{error}</p> : null}
      {!grant ? <FacilitiesWriteFeedback write={write} onReview={() => void review()} /> : null}
      <footer>{grant ? <><button type="button" className="is-secondary" disabled={sending || unknown} onClick={close}>Done</button>{unknown || refused ? <button type="button" disabled={sending || !email.trim()} onClick={() => void send(grant)}>{sending ? "Checking…" : unknown ? "Retry same invitation" : "Send invitation"}</button> : null}</> : <><button type="button" className="is-secondary" disabled={write.busy || reviewing || write.recovery === "unknown"} onClick={close}>{write.recovery === "accepted" ? "Close" : "Cancel"}</button><button type="submit" disabled={!valid || locked}>{write.busy ? "Sharing…" : "Share job"}</button></>}</footer>
    </form>
    {choosing ? <RepairTechnicianPicker schoolId={schoolId} repairId={repair.id} actorId={actorId} onClose={() => setChoosing(false)} onSelected={value => { setPerson(value); setChoosing(false); }} /> : null}
  </PlannerDialog>;
}
