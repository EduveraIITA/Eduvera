import { useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { getFacilitiesSettings, saveFacilitiesSettings, type FacilitiesSettings } from "./facilitiesApi";
import { FacilitiesOptionPicker, type FacilitiesChoice } from "./FacilitiesOptionPicker";
import { FacilitiesWriteFeedback } from "./FacilitiesPrimitives";
import { useFacilitiesCommand } from "./useFacilitiesCommand";

export function FacilitiesSetupDialog({ schoolId, actorId, settings, refresh, onClose }: {
  schoolId: string; actorId: string; settings: FacilitiesSettings; refresh: () => Promise<unknown>; onClose: () => void;
}) {
  const [current, setCurrent] = useState(settings), [handler, setHandler] = useState<FacilitiesChoice | null>(settings.handler_person_id ? { id: settings.handler_person_id, label: settings.handler?.label ?? "Current responsible person" } : null);
  const [mode, setMode] = useState(settings.verifier_mode), [verifier, setVerifier] = useState<FacilitiesChoice | null>(settings.verifier_person_id ? { id: settings.verifier_person_id, label: settings.verifier?.label ?? "Current verifier" } : null);
  const [contact, setContact] = useState(settings.emergency_contact), [selecting, setSelecting] = useState<"handler" | "verifier" | null>(null), [reviewing, setReviewing] = useState(false), [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const write = useFacilitiesCommand({ schoolId, sourceId: schoolId, settings: true, onAccepted: async () => { await refresh(); onClose(); } });
  const dirty = (handler?.id ?? null) !== settings.handler_person_id || mode !== settings.verifier_mode || (verifier?.id ?? null) !== settings.verifier_person_id || contact !== settings.emergency_contact;
  const canLeave = useUnsavedChangesGuard(dirty && !write.busy && !write.recovery, "Discard these repair settings?");
  const close = () => { if (!write.busy && !write.recovery && canLeave()) onClose(); };
  const locked = write.locked || reviewing;
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!current.can_manage || !handler || mode === "named" && !verifier) return;
    const body = { expected_revision: current.revision, handler_person_id: handler.id, verifier_mode: mode, verifier_person_id: mode === "named" ? verifier!.id : null, emergency_contact: contact.trim() };
    void write.execute(command_id => saveFacilitiesSettings(schoolId, { ...body, command_id }), { id: schoolId, revision: current.revision });
  };
  const review = async () => {
    setReviewing(true); setError("");
    try { setCurrent(await getFacilitiesSettings(schoolId)); setReviewed(true); write.reviewed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be checked."); }
    finally { setReviewing(false); }
  };
  return <PlannerDialog title={settings.configured ? "Repair settings" : "Start handling repairs"} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={close}>
    <form className="facilities-form" onSubmit={submit}>
      {reviewed ? <section className="facilities-summary" aria-label="Current repair settings" role="status"><strong>Current setup</strong><p className="facilities-caption">Reports go to {current.handler?.label ?? "the current handler"}. Checked by {current.verifier_mode === "reporter" ? "the reporter" : current.verifier_mode === "handler" ? current.handler?.label ?? "the handler" : current.verifier?.label ?? "the named verifier"}.</p><p className="facilities-caption">Your choices are kept below. Review them before saving a new setup.</p></section> : null}
      {!current.can_manage ? <p className="facilities-error" role="alert">Your repair setup permission has changed. Close this sheet and refresh your workspace.</p> : null}
      <fieldset disabled={locked || !current.can_manage}>
      {settings.configured ? <p className="facilities-caption">For new reports. Existing responsibilities stay unchanged.</p> : null}
      <div className="facilities-field"><span>Who receives new reports?</span><button type="button" className="facilities-select is-secondary" onClick={() => setSelecting("handler")}>{handler?.label ?? "Choose responsible person"}</button></div>
      <label>Who checks the finished repair?<select value={mode} onChange={event => setMode(event.target.value as FacilitiesSettings["verifier_mode"])}><option value="reporter">Person who reported it</option><option value="handler">Responsible handler</option><option value="named">A designated verifier</option></select></label>
      {mode === "named" ? <div className="facilities-field"><span>Verifier</span><button type="button" className="facilities-select is-secondary" onClick={() => setSelecting("verifier")}>{verifier?.label ?? "Choose verifier"}</button></div> : null}
      <label>Emergency contact <small className="facilities-caption">Optional</small><input maxLength={300} value={contact} onChange={event => setContact(event.target.value)} placeholder="Campus helpdesk or emergency number" /></label>
      <details><InfoSummary>How this works</InfoSummary><p className="facilities-caption">The handler accepts reports and records progress. Finished work waits for an explicit check; silence does not close it. No room-entry permission or spending approval is granted.</p></details>
    </fieldset>
      {error ? <p role="alert" className="facilities-error">{error}</p> : null}<FacilitiesWriteFeedback write={write} onReview={() => void review()} />
      <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={close}>Cancel</button><button type="submit" disabled={locked || !current.can_manage || !handler || mode === "named" && !verifier}>{write.busy ? "Saving…" : settings.configured ? "Save settings" : "Start repairs"}</button></footer>
    </form>
    {selecting ? <FacilitiesOptionPicker schoolId={schoolId} actorId={actorId} kind="people" title={selecting === "handler" ? "Choose handler" : "Choose verifier"} eligible={selecting} onClose={() => setSelecting(null)} onSelected={choice => { if (selecting === "handler") setHandler(choice); else setVerifier(choice); setSelecting(null); }} /> : null}
  </PlannerDialog>;
}
