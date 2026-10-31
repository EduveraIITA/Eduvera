import { useRef, useState, type FormEvent } from "react";
import { Camera, MapPin, X } from "lucide-react";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { reportRepair, type FacilitiesOptions, type FacilitiesSettings } from "./facilitiesApi";
import { FacilitiesOptionPicker, type FacilitiesChoice } from "./FacilitiesOptionPicker";
import { FacilitiesWriteFeedback } from "./FacilitiesPrimitives";
import { useFacilitiesCommand } from "./useFacilitiesCommand";

export const validateRepairPhoto = (file: File) => {
  if (!["image/jpeg", "image/png"].includes(file.type)) return "Choose a JPEG or PNG photo.";
  if (!file.size || file.size > 5 * 1024 * 1024) return "Choose a photo up to 5 MB.";
  return "";
};
export function RepairReportDialog({ schoolId, actorId, settings, canManage, refresh, onClose, onSaved, initialContext }: {
  schoolId: string; actorId: string; settings: FacilitiesSettings; canManage: boolean; refresh: () => Promise<unknown>;
  onClose: () => void; onSaved: (id: string, photo: File | null) => void;
  initialContext?: NonNullable<FacilitiesOptions["selected"]>;
}) {
  const [problem, setProblem] = useState(""), [location, setLocation] = useState(""), [urgent, setUrgent] = useState(false);
  const [place, setPlace] = useState<FacilitiesChoice | null>(initialContext?.place ?? null), [item, setItem] = useState<FacilitiesChoice | null>(initialContext?.holding ?? null), [reporter, setReporter] = useState<FacilitiesChoice | null>(null);
  const [assetImpact, setAssetImpact] = useState<"not_working" | "degraded" | null>(null);
  const [photo, setPhoto] = useState<File | null>(null), [error, setError] = useState(""), [selecting, setSelecting] = useState<"places" | "holdings" | "people" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null), dirty = Boolean(problem || location || place?.id !== initialContext?.place?.id || item?.id !== initialContext?.holding?.id || reporter || photo || urgent || assetImpact);
  const write = useFacilitiesCommand({ schoolId, onAccepted: async id => { await refresh(); onSaved(id, photo); } });
  const canLeave = useUnsavedChangesGuard(dirty && !write.recovery && !write.busy, "Discard this unfinished repair report?");
  const close = () => { if (!write.busy && !write.recovery && canLeave()) onClose(); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!place && !item && location.trim().length < 3) { setError("Add a location or choose an existing place or item."); return; }
    if (problem.trim().length < 3) { setError("Describe what needs repairing."); return; }
    const body = { expected_revision: 0, problem: problem.trim(), location_note: location.trim(), space_id: place?.id ?? null, holding_id: item?.id ?? null, asset_impact: item?.map_status_supported ? assetImpact : null, urgent, ...(reporter ? { reporter_person_id: reporter.id } : {}) };
    void write.execute(command_id => reportRepair(schoolId, { ...body, command_id }));
  };
  return <PlannerDialog title="Report a problem" busy={write.busy || Boolean(write.recovery)} onClose={close}>
    <form className="facilities-form" onSubmit={submit}><fieldset disabled={write.locked}>
      {settings.handler?.label ? <p className="facilities-caption">Reports go to <strong>{settings.handler.label}</strong></p> : null}
      <label>Where?<input autoFocus maxLength={300} value={location} onChange={event => setLocation(event.target.value)} placeholder="Building, room or nearby landmark" required={!place && !item} minLength={!place && !item ? 3 : undefined} /></label>
      <div className="facilities-inline-actions"><button type="button" className="is-text" onClick={() => setSelecting("places")}><MapPin size={17} aria-hidden="true" />{place?.label ?? "Choose a place"}</button>{place ? <button type="button" className="is-text facilities-icon-button" aria-label="Clear selected place" onClick={() => setPlace(null)}><X size={17} aria-hidden="true" /></button> : null}<button type="button" className="is-text" onClick={() => setSelecting("holdings")}>{item?.label ?? "Link an item"}</button>{item ? <button type="button" className="is-text facilities-icon-button" aria-label="Clear selected item" onClick={() => { setItem(null); setAssetImpact(null); }}><X size={17} aria-hidden="true" /></button> : null}</div>
      {item?.map_status_supported ? <details className="facilities-asset-impact"><summary>Share asset status on campus map</summary><label>Asset status<select aria-label="Asset status" value={assetImpact ?? ""} onChange={event => setAssetImpact(event.target.value === "not_working" || event.target.value === "degraded" ? event.target.value : null)}><option value="">No shared asset status</option><option value="not_working">Not working</option><option value="degraded">Reduced service</option></select></label>{assetImpact ? <p className="facilities-caption">This asset status appears on the campus map. Your description and photos stay private.</p> : null}</details> : null}
      <label>What’s wrong?<textarea required minLength={3} maxLength={2000} rows={3} value={problem} onChange={event => setProblem(event.target.value)} placeholder="Tell us what needs attention" /></label>
      <div className="facilities-photo-input"><input ref={fileRef} className="facilities-sr" tabIndex={-1} type="file" accept="image/jpeg,image/png" aria-label="Attach a photo" onChange={event => { const next = event.target.files?.[0]; if (!next) return; const issue = validateRepairPhoto(next); setError(issue); if (!issue) setPhoto(next); event.target.value = ""; }} /><button type="button" className="is-secondary" onClick={() => fileRef.current?.click()}><Camera size={18} aria-hidden="true" />{photo ? "Change photo" : "Add photo"}</button>{photo ? <span><span>{photo.name}</span><button type="button" className="is-text" onClick={() => setPhoto(null)}>Remove</button></span> : <small className="facilities-caption">Optional</small>}</div>
      <label className="facilities-check"><input type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)} /><span>Urgent safety concern</span></label>
      {urgent ? <p className="facilities-safety" role="alert">For immediate danger, contact {settings.emergency_contact || "campus security or local emergency services"} now. A report does not guarantee an immediate response.</p> : null}
      {canManage ? <details><summary>Recording for someone else</summary><button type="button" className="facilities-select is-secondary" onClick={() => setSelecting("people")}>{reporter?.label ?? "Choose the person reporting"}</button>{reporter ? <button type="button" className="is-text" onClick={() => setReporter(null)}>Report as myself instead</button> : null}</details> : null}
      <details><InfoSummary>Access and privacy</InfoSummary><p className="facilities-caption">Submitting does not grant permission to enter a room. Arrange access with the handler. Photos stay with this repair, available only to authorized participants.</p></details>
    </fieldset>
      {error ? <p className="facilities-error" role="alert">{error}</p> : null}<FacilitiesWriteFeedback write={write} />
      <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery)} onClick={close}>Cancel</button><button type="submit" disabled={write.locked || problem.trim().length < 3 || !place && !item && location.trim().length < 3}>{write.busy ? "Reporting…" : "Send report"}</button></footer>
    </form>
    {selecting ? <FacilitiesOptionPicker schoolId={schoolId} actorId={actorId} kind={selecting} title={selecting === "places" ? "Choose place" : selecting === "holdings" ? "Choose item" : "Choose reporter"} onClose={() => setSelecting(null)} onSelected={choice => { if (selecting === "places") { setPlace(choice); if (place?.id !== choice.id) { setItem(null); setAssetImpact(null); } } else if (selecting === "holdings") { setItem(choice); setAssetImpact(null); if (item?.id !== choice.id) setPlace(null); } else setReporter(choice); setSelecting(null); }} /> : null}
  </PlannerDialog>;
}
