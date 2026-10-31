import { useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { actOnRepair, getRepair, type RepairAction, type RepairActionInput, type RepairDetail, type RepairWait } from "./facilitiesApi";
import { FacilitiesOptionPicker, type FacilitiesChoice } from "./FacilitiesOptionPicker";
import { FacilitiesWriteFeedback, repairStateLabels, repairWaitLabels } from "./FacilitiesPrimitives";
import { useFacilitiesCommand } from "./useFacilitiesCommand";

const titles: Record<RepairAction, string> = { accept: "Accept repair", assign: "Change responsible person", update: "Update progress", complete: "Report work done", verify: "Confirm repaired", reopen: "Reopen repair" };
const localTime = (value: string | null) => { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
export function RepairActionDialog({ schoolId, actorId, repair, action, assignVerifier = false, assignCoordinator = false, refresh, onClose, onTransferred }: {
  schoolId: string; actorId: string; repair: RepairDetail; action: RepairAction; assignVerifier?: boolean; assignCoordinator?: boolean; refresh: () => Promise<unknown>; onClose: () => void; onTransferred?: () => Promise<unknown>;
}) {
  const [current, setCurrent] = useState(repair), [note, setNote] = useState(""), [handler, setHandler] = useState<FacilitiesChoice | null>(null), [choosing, setChoosing] = useState(false);
  const [status, setStatus] = useState<"in_progress" | "waiting">(repair.state === "waiting" ? "waiting" : "in_progress"), [wait, setWait] = useState<RepairWait | "">(repair.wait_reason ?? ""), [eta, setEta] = useState(localTime(repair.expected_finish_at));
  const [etaOpen, setEtaOpen] = useState(Boolean(repair.expected_finish_at));
  const [verified, setVerified] = useState(false), [reasonKind, setReasonKind] = useState("Further work needed"), [reviewing, setReviewing] = useState(false), [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const write = useFacilitiesCommand({ schoolId, sourceId: repair.id, onAccepted: async (_id, result) => {
    if (result && typeof result === "object" && "access_transferred" in result && result.access_transferred === true) { if (onTransferred) await onTransferred(); onClose(); return; }
    await refresh(); onClose();
  } });
  const dirty = Boolean(note || handler || verified || reasonKind !== "Further work needed" || eta !== localTime(repair.expected_finish_at) || status !== (repair.state === "waiting" ? "waiting" : "in_progress") || wait !== (repair.wait_reason ?? ""));
  const canLeave = useUnsavedChangesGuard(dirty && !write.busy && !write.recovery, "Discard this unfinished repair update?");
  const close = () => { if (!write.busy && !write.recovery && canLeave()) onClose(); };
  const noteRequired = ["assign", "update", "complete", "reopen"].includes(action), locked = write.locked || reviewing;
  const permitted = assignCoordinator ? current.allowed_actions.assign_coordinator : assignVerifier ? current.allowed_actions.assign_verifier : current.allowed_actions[action];
  const title = assignCoordinator ? "Change coordinator" : assignVerifier ? "Change verifier" : titles[action];
  const valid = permitted && (!noteRequired || note.trim().length >= 3) && (action !== "assign" || Boolean(handler)) && (action !== "update" || status !== "waiting" || Boolean(wait)) && (action !== "verify" || verified);
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!valid) return; setError("");
    const input: RepairActionInput = { action, note: action === "reopen" ? `${reasonKind}: ${note.trim()}` : note.trim() };
    if (action === "reopen" && current.asset_impact) input.reopen_kind = reasonKind === "Record amendment needed" ? "record_amendment" : "further_work";
    if (action === "assign") { if (assignCoordinator) input.coordinator_person_id = handler!.id; else if (assignVerifier) input.verifier_person_id = handler!.id; else input.handler_person_id = handler!.id; }
    if (action === "update") {
      if (eta && !Number.isFinite(Date.parse(eta))) { setEtaOpen(true); setError("Choose a valid expected finish time."); return; }
      Object.assign(input, { status, wait_reason: status === "waiting" ? wait : null, expected_finish_at: eta ? new Date(eta).toISOString() : null });
    }
    const body = { ...input, expected_revision: current.revision };
    void write.execute(command_id => actOnRepair(schoolId, repair.id, { ...body, command_id }), { id: repair.id, revision: current.revision });
  };
  const review = async () => {
    setReviewing(true); setError("");
    try { setCurrent(await getRepair(schoolId, repair.id)); setVerified(false); setReviewed(true); write.reviewed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The current repair could not be loaded."); }
    finally { setReviewing(false); }
  };
  return <PlannerDialog title={title} subtitle={repair.title} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={close}>
    <form className="facilities-form" onSubmit={submit}>
      {reviewed ? <section className="facilities-summary" role="status" aria-label="Current repair state"><strong>{repairStateLabels[current.state]}</strong><p className="facilities-caption">Responsible: {current.handler.label} · Checks repair: {current.verifier.label}</p><p className="facilities-caption">{current.photos.length} photo{current.photos.length === 1 ? "" : "s"} · Your note and choices are kept. {action === "verify" ? "Check the repair again before confirming." : "Review before sending."}</p>{current.history[0] ? <p className="facilities-caption">Latest update by {current.history[0].actor_label}{current.history[0].note ? `: ${current.history[0].note}` : ""}</p> : null}</section> : null}
      <fieldset disabled={locked}>
      {action === "accept" ? <p className="facilities-caption">You’ll follow up this repair. Work is not marked as started.</p> : null}
      {action === "assign" ? <div className="facilities-field"><span>{assignCoordinator ? "Next coordinator" : assignVerifier ? "Next verifier" : "Next responsible person"}</span><button type="button" className="facilities-select is-secondary" onClick={() => setChoosing(true)}>{handler?.label ?? "Choose person"}</button><p className="facilities-caption">{assignCoordinator ? "Only coordination of this repair is transferred. No campus-wide permissions are granted." : assignVerifier ? "The repair still needs an explicit check. Earlier responsibility stays in history." : "The next person must accept. Earlier responsibility stays in history."}</p></div> : null}
      {action === "update" ? <><label>Progress<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="in_progress">In progress</option><option value="waiting">Waiting / delayed</option></select></label>
        {status === "waiting" ? <label>Waiting for<select required value={wait} onChange={event => setWait(event.target.value as RepairWait)}><option value="">Choose reason</option>{Object.entries(repairWaitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}</> : null}
      {action === "complete" ? <p className="facilities-caption">Your report goes to {current.verifier.label} to check. The repair stays open until confirmed.</p> : null}
      {action === "verify" ? <label className="facilities-check"><input type="checkbox" required checked={verified} onChange={event => setVerified(event.target.checked)} /><span>I checked the repair and it is satisfactory.</span></label> : null}
      {action === "reopen" ? <><label>{current.asset_impact ? "Reopen for" : "Reason"}<select value={reasonKind} onChange={event => setReasonKind(event.target.value)}><option>Further work needed</option><option>Record amendment needed</option></select></label>{current.asset_impact ? <p className="facilities-caption">{reasonKind === "Record amendment needed" ? "A record amendment does not report a new fault or clear an unresolved fault." : "Further work marks this asset as needing work again on the campus map."}</p> : null}</> : null}
      {noteRequired ? <label>{action === "complete" ? "What was done?" : action === "reopen" || action === "assign" ? "Reason" : "Update"}<textarea autoFocus={action !== "assign"} rows={3} required minLength={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder={action === "update" ? status === "waiting" ? "What is needed to continue?" : "What has changed?" : undefined} /></label>
        : <details><summary>Add note <span className="facilities-caption">Optional</span></summary><label>Note <small className="facilities-caption">Optional</small><textarea rows={2} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} /></label></details>}
      {action === "update" ? <details open={etaOpen} onToggle={event => setEtaOpen(event.currentTarget.open)}><summary>Expected finish <span className="facilities-caption">{eta ? "Estimate set" : "Optional"}</span></summary>
        <label>Expected finish <small className="facilities-caption">Optional</small><TemporalInput type="datetime-local" value={eta} onChange={event => setEta(event.target.value)} /></label><p className="facilities-caption">Estimate only · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p></details> : null}
      {!permitted ? <p role="alert" className="facilities-error">This action is no longer available. Close this sheet and review the repair.</p> : null}
    </fieldset>
      {error ? <p role="alert" className="facilities-error">{error}</p> : null}<FacilitiesWriteFeedback write={write} onReview={() => void review()} />
      <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={close}>Cancel</button><button type="submit" disabled={locked || !valid}>{write.busy ? "Saving…" : title}</button></footer>
    </form>
    {choosing ? <FacilitiesOptionPicker schoolId={schoolId} actorId={actorId} repairId={repair.id} kind="people" title={assignCoordinator ? "Choose coordinator" : assignVerifier ? "Choose verifier" : "Choose responsible person"} eligible={assignVerifier ? "verifier" : "handler"} onClose={() => setChoosing(false)} onSelected={choice => { setHandler(choice); setChoosing(false); }} /> : null}
  </PlannerDialog>;
}
