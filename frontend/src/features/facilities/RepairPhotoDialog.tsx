import { useEffect, useRef, useState, type FormEvent } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { getRepair, uploadRepairPhoto, type RepairDetail } from "./facilitiesApi";
import { FacilitiesWriteFeedback } from "./FacilitiesPrimitives";
import { validateRepairPhoto } from "./RepairReportDialog";
import { useFacilitiesCommand } from "./useFacilitiesCommand";

export function RepairPhotoDialog({ schoolId, repair, initialFile = null, reportSaved = false, refresh, onClose }: {
  schoolId: string; repair: RepairDetail; initialFile?: File | null; reportSaved?: boolean; refresh: () => Promise<unknown>; onClose: () => void;
}) {
  const [current, setCurrent] = useState(repair), [file, setFile] = useState(initialFile), [error, setError] = useState(() => initialFile ? validateRepairPhoto(initialFile) : ""), [reviewing, setReviewing] = useState(false);
  const autoAttempted = useRef(false);
  const write = useFacilitiesCommand({ schoolId, sourceId: repair.id, onAccepted: async () => { await refresh(); onClose(); } });
  useEffect(() => {
    if (!reportSaved || !initialFile || autoAttempted.current) return;
    // Sending the report also sends its chosen photo. This is one initial attempt,
    // not an effect-driven retry: unknown or obsolete outcomes stay explicit.
    // The ref also survives React's StrictMode effect replay.
    autoAttempted.current = true;
    if (!current.allowed_actions.add_photo) return;
    if (validateRepairPhoto(initialFile)) return;
    void write.execute(command_id => uploadRepairPhoto(schoolId, repair.id, { command_id, expected_revision: current.revision }, initialFile), { id: repair.id, revision: current.revision });
  }, [current.allowed_actions.add_photo, current.revision, initialFile, repair.id, reportSaved, schoolId, write]);
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!file || !current.allowed_actions.add_photo) return;
    const issue = validateRepairPhoto(file); setError(issue); if (issue) return;
    void write.execute(command_id => uploadRepairPhoto(schoolId, repair.id, { command_id, expected_revision: current.revision }, file), { id: repair.id, revision: current.revision });
  };
  const review = async () => {
    setReviewing(true); setError("");
    try { setCurrent(await getRepair(schoolId, repair.id)); write.reviewed(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The repair could not be checked."); }
    finally { setReviewing(false); }
  };
  const savedMessage = write.recovery === "accepted" ? "Report and photo saved. Refresh to load the updated repair."
    : write.recovery ? "Report saved. Check whether your photo was added."
    : write.busy ? "Report saved. Uploading your photo…"
    : error || write.error ? "Report saved. Your photo wasn’t added. Retry or add it later."
    : "Report saved. Add a photo now or later.";
  return <PlannerDialog title={reportSaved ? "Report saved" : "Add photo"} subtitle={repair.title} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={onClose}>
    <form className="facilities-form" onSubmit={submit}>
      {reportSaved ? <p className="facilities-saved" role="status">{savedMessage}</p> : null}
      <fieldset disabled={write.locked || reviewing}><label>Photo<input type="file" accept="image/jpeg,image/png" onChange={event => { const next = event.target.files?.[0]; if (next) { const issue = validateRepairPhoto(next); setError(issue); if (!issue) setFile(next); } }} /></label>
        {file ? <p className="facilities-caption">{file.name} · {Math.ceil(file.size / 1024)} KB</p> : null}<p className="facilities-caption">JPEG or PNG · up to 5 MB</p>
        {!current.allowed_actions.add_photo ? <p role="alert" className="facilities-error">You can no longer add a photo to this repair.</p> : null}
      </fieldset>
      {error ? <p className="facilities-error" role="alert">{error}</p> : null}<FacilitiesWriteFeedback write={write} onReview={() => void review()} />
      <footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={onClose}>{reportSaved ? "Add later" : "Cancel"}</button><button type="submit" disabled={write.locked || reviewing || !file || !current.allowed_actions.add_photo}>{write.busy ? "Uploading…" : "Upload photo"}</button></footer>
    </form>
  </PlannerDialog>;
}
