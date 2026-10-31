import { useEffect, useRef, useState } from "react";
import { Camera, Download, FileImage } from "lucide-react";
import { apiBlob } from "../../lib/api";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import type { RepairAction, RepairDetail, RepairPhoto } from "./facilitiesApi";
import { FacilitiesPages, repairDate, repairStateLabels, repairWaitLabels } from "./FacilitiesPrimitives";
import { RepairActionDialog } from "./RepairActionDialog";
import { RepairPhotoDialog } from "./RepairPhotoDialog";
import { RepairAccommodationLink } from "../accommodation/RepairAccommodationLink";
import { RepairTechnicianAccess } from "./RepairTechnicianAccess";
import { RepairJobAcceptance } from "./RepairJobAcceptance";

const historyLabels: Record<string, string> = { reported: "Problem reported", accepted: "Responsibility accepted", assigned: "Responsible person changed", updated: "Progress updated", completed: "Work reported complete", verified: "Repair checked and closed", reopened: "Repair reopened", photo_added: "Photo added", accept: "Responsibility accepted", assign: "Responsible person changed", update: "Progress updated", complete: "Work reported complete", verify: "Repair checked and closed", reopen: "Repair reopened" };
export function RepairDetailView({ schoolId, actorId, repair, timezone, readOnly, refresh, historyPage, onHistoryPage, onTransferred }: {
  schoolId: string; actorId: string; repair: RepairDetail; timezone: string; readOnly: boolean; refresh: () => Promise<unknown>;
  historyPage: number; onHistoryPage: (page: number) => void;
  onTransferred?: () => Promise<unknown>;
}) {
  const [action, setAction] = useState<RepairAction | null>(null), [photo, setPhoto] = useState(false), [assignment, setAssignment] = useState<"handler" | "verifier" | "coordinator">("handler");
  const allowed = repair.allowed_actions;
  const visibleProblem = repair.external_view ? repair.external_access?.instructions ?? "" : repair.problem;
  const description = visibleProblem.startsWith(`${repair.title}\n`) ? visibleProblem.slice(repair.title.length).trim() : visibleProblem === repair.title ? "" : visibleProblem;
  const externalAccept = Boolean(repair.external_view && (repair.external_access?.can_activate || allowed.accept));
  const primary: RepairAction | null = allowed.accept && !externalAccept ? "accept" : allowed.verify ? "verify" : allowed.update ? "update" : null;
  const actionLabels: Record<RepairAction, string> = { accept: "Accept repair", assign: "Change handler", update: "Update progress", complete: "Report work done", verify: "Confirm repaired", reopen: repair.state === "closed" ? "Reopen repair" : "Needs more work" };
  const actions = ([primary, ...(["complete", "reopen"] as RepairAction[])]).filter((value): value is RepairAction => Boolean(value && allowed[value]));
  const ongoing = !["awaiting_verification", "closed"].includes(repair.state);
  const pendingExternal = !repair.external_view && repair.external_access && repair.handler.id !== repair.external_access.person.id && ["scheduled", "awaiting_sign_in", "ready"].includes(repair.external_access.state) ? repair.external_access : null;
  const pendingExternalStep = pendingExternal?.state === "scheduled" ? `Access for ${pendingExternal.person.label} starts ${repairDate(pendingExternal.starts_at, timezone)}. They can accept then.`
    : pendingExternal ? `Waiting for ${pendingExternal.person.label} to ${pendingExternal.state === "awaiting_sign_in" ? "sign in and " : ""}accept the job.` : null;
  const nextStep = repair.state === "closed" ? "Repair checked and closed. Reopen it if more work is needed."
    : repair.state === "awaiting_verification" ? repair.external_view ? "Waiting for the campus to check the reported work." : `${repair.verifier.label} needs to check the repair.`
      : externalAccept ? "Review the instructions and accept this job when you can take it on."
      : pendingExternalStep ? pendingExternalStep
      : repair.state === "reported" ? `${repair.handler.label} needs to accept this report.`
        : repair.state === "waiting" ? `${repair.handler.label} is following up${repair.wait_reason ? ` · waiting for ${repairWaitLabels[repair.wait_reason].toLowerCase()}` : ""}.`
          : repair.state === "accepted" ? `${repair.handler.label} has accepted the repair. Work has not been reported started.`
            : `${repair.handler.label} is handling the repair.`;
  const canChangeResponsibility = allowed.assign || allowed.assign_verifier || allowed.assign_coordinator;
  return <>
    <section className="facilities-summary" aria-label="Repair summary"><header><span className={`facilities-status is-${repair.state}`}>{repairStateLabels[repair.state]}</span>{repair.urgent ? <span className="facilities-caption">Reported urgent</span> : null}</header>
      <h2>{repair.title}</h2>{description ? <p className="facilities-problem">{description}</p> : null}
      <p className="facilities-caption">{[repair.place?.label, repair.item ? `${repair.item.label}${repair.item.asset_tag ? ` · ${repair.item.asset_tag}` : ""}` : null, repair.location_note].filter(Boolean).join(" · ")}</p>
      {repair.external_view && repair.coordinator ? <p className="facilities-caption">Campus contact · {repair.coordinator.label}</p> : null}
      {!repair.recovery_only ? <div className="facilities-next-step" aria-label="Current repair progress"><p>{nextStep}</p>
        {ongoing ? <p className="facilities-caption">{repair.expected_finish_at ? <>Expected finish · <time dateTime={repair.expected_finish_at}>{repairDate(repair.expected_finish_at, timezone)}</time></> : "Finish estimate not shared yet"}</p> : null}
      </div> : null}
      {!repair.recovery_only && repair.latest_progress?.note ? <section className="facilities-latest-update" aria-label="Latest repair update"><h3>Latest update</h3><p className="facilities-problem">{repair.latest_progress.note}</p><p className="facilities-caption">{repair.latest_progress.actor_label} · <time dateTime={repair.latest_progress.recorded_at}>{repairDate(repair.latest_progress.recorded_at, timezone)}</time></p></section> : null}
      {repair.route_unavailable ? <p className="facilities-safety" role="alert">The next responsible person cannot receive this work. {allowed.assign ? "Reassign it to restore a clear handoff." : "An authorized repair coordinator needs to restore the handoff."}</p> : null}
      {!repair.route_unavailable && repair.coordinator_unavailable ? <p className="facilities-safety" role="alert">The repair coordinator is no longer available. A current coordinator is needed to keep oversight.</p> : null}
      {!repair.route_unavailable && !repair.coordinator_unavailable && repair.verification_route_unavailable ? <p className="facilities-safety" role="alert">A current verifier is needed before this repair can be closed.</p> : null}
      {!readOnly && actions.length ? <div className="facilities-actions">{actions.map(value => <button type="button" key={value} className={value === primary ? "" : "is-secondary"} onClick={() => { setAssignment("handler"); setAction(value); }}>{actionLabels[value]}</button>)}</div> : null}
      {!readOnly && externalAccept ? <RepairJobAcceptance schoolId={schoolId} repair={repair} refresh={refresh} /> : null}
      {!readOnly && canChangeResponsibility ? <details className="facilities-responsibility" open={repair.recovery_only || repair.route_unavailable || repair.coordinator_unavailable || repair.verification_route_unavailable || undefined}><summary>Change responsibility</summary><div className="facilities-inline-actions">
        {allowed.assign ? <button type="button" className="is-secondary" onClick={() => { setAssignment("handler"); setAction("assign"); }}>Change handler</button> : null}
        {allowed.assign_verifier ? <button type="button" className="is-secondary" onClick={() => { setAssignment("verifier"); setAction("assign"); }}>Change verifier</button> : null}
        {allowed.assign_coordinator ? <button type="button" className="is-secondary" onClick={() => { setAssignment("coordinator"); setAction("assign"); }}>Change coordinator</button> : null}
      </div></details> : null}
    </section>
    {!repair.recovery_only ? <><RepairTechnicianAccess schoolId={schoolId} actorId={actorId} repair={repair} timezone={timezone} refresh={refresh} readOnly={readOnly} />{!readOnly && !repair.external_view ? <section className="facilities-section"><RepairAccommodationLink schoolId={schoolId} actorId={actorId} repairId={repair.id} /></section> : null}<section className="facilities-section" aria-labelledby="repair-photos-title"><header><h2 id="repair-photos-title">Photos{repair.photos.length ? ` · ${repair.photos.length}` : ""}</h2>{!readOnly && allowed.add_photo ? <button type="button" className="is-text" onClick={() => setPhoto(true)}><Camera size={17} aria-hidden="true" />Add photo</button> : null}</header>
      {repair.photos.length ? <ul className="facilities-photo-list">{repair.photos.map(file => <RepairPhotoEvidence key={file.id} schoolId={schoolId} repairId={repair.id} photo={file} />)}</ul> : <p className="facilities-caption">No photos added.</p>}
    </section>
    <details className="facilities-history" open={historyPage > 1}><summary>Repair history · {repair.history_pagination?.total ?? repair.history.length}</summary>
      <ol>{repair.history.map(entry => <li key={entry.id}><strong>{entry.assignment_target === "coordinator" ? "Coordinator changed" : entry.assignment_target === "verifier" ? "Verifier changed" : historyLabels[entry.action] ?? "Repair updated"}{entry.reopen_kind === "further_work" ? " · Further work needed" : entry.reopen_kind === "record_amendment" ? " · Record amendment" : ""}</strong><small>{entry.actor_label} · <time dateTime={entry.recorded_at}>{repairDate(entry.recorded_at, timezone)}</time></small>
        {entry.note ? <p>{entry.note}</p> : null}{entry.action === "assigned" ? <p className="facilities-caption">{entry.assignment_target === "coordinator" ? [entry.previous_coordinator_label, entry.coordinator_label].filter(Boolean).join(" → ") : entry.assignment_target === "verifier" ? [entry.previous_verifier_label, entry.verifier_label].filter(Boolean).join(" → ") : [entry.previous_handler_label, entry.handler_label].filter(Boolean).join(" → ")}</p> : null}
        {entry.wait_reason ? <p className="facilities-caption">Waiting for {repairWaitLabels[entry.wait_reason].toLowerCase()}</p> : null}{entry.expected_finish_at ? <p className="facilities-caption">Expected finish {repairDate(entry.expected_finish_at, timezone)}</p> : null}</li>)}</ol>
      <FacilitiesPages label="Repair history pages" page={historyPage} hasMore={repair.history_pagination ? historyPage * repair.history_pagination.page_size < repair.history_pagination.total : Boolean(repair.history_has_more)} onChange={onHistoryPage} />
    </details>
    <details className="facilities-evidence"><InfoSummary>{repair.external_view ? "Job details" : "Report details"}</InfoSummary><dl className="facilities-facts">{!repair.external_view ? <><div><dt>Reported by</dt><dd>{repair.reporter.label}</dd></div><div><dt>Recorded by</dt><dd>{repair.recorder.label}</dd></div></> : null}<div><dt>Responsible</dt><dd>{repair.handler.label}</dd></div><div><dt>Checks repair</dt><dd>{repair.verifier.label}</dd></div>{repair.coordinator && repair.coordinator.id !== repair.handler.id ? <div><dt>Campus contact</dt><dd>{repair.coordinator.label}</dd></div> : null}<div><dt>Last updated</dt><dd>{repairDate(repair.updated_at, timezone)}</dd></div></dl><p className="facilities-caption">Repair updates do not grant room entry, authorize spending or make a damaged item available.</p></details></> : null}
    {action ? <RepairActionDialog schoolId={schoolId} actorId={actorId} repair={repair} action={action} assignVerifier={assignment === "verifier"} assignCoordinator={assignment === "coordinator"} refresh={refresh} onClose={() => setAction(null)} {...(onTransferred ? { onTransferred } : {})} /> : null}
    {photo ? <RepairPhotoDialog schoolId={schoolId} repair={repair} refresh={refresh} onClose={() => setPhoto(false)} /> : null}
  </>;
}

function RepairPhotoEvidence({ schoolId, repairId, photo }: { schoolId: string; repairId: string; photo: RepairPhoto }) {
  const environment = useExecutionEnvironment();
  const [image, setImage] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [omitted, setOmitted] = useState(false);
  const active = useRef(true), retainedUrl = useRef<string | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current); }; }, []);
  const view = async () => {
    if (busy) return; setBusy(true); setError("");
    try {
      const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/facilities/repairs/${encodeURIComponent(repairId)}/photos/${encodeURIComponent(photo.id)}`;
      const blob = await apiBlob(path); if (!active.current) return;
      if (environment.mode === "simulation" && blob.type === "image/svg+xml") { setOmitted(true); return; }
      if (!["image/jpeg", "image/png"].includes(blob.type)) throw new Error("This photo could not be displayed safely.");
      if (retainedUrl.current) URL.revokeObjectURL(retainedUrl.current);
      retainedUrl.current = URL.createObjectURL(blob); setImage(retainedUrl.current);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "This photo could not be opened."); }
    finally { if (active.current) setBusy(false); }
  };
  const close = () => { setImage(null); if (retainedUrl.current) { URL.revokeObjectURL(retainedUrl.current); retainedUrl.current = null; } };
  return <li><button type="button" className="facilities-photo-row is-secondary" disabled={busy} onClick={() => void view()}><FileImage size={20} aria-hidden="true" /><span>{photo.file_name}<small>{Math.ceil(photo.size / 1024)} KB</small></span><span>{busy ? "Opening…" : "View"}</span></button>{omitted ? <p className="facilities-caption" role="status">Original photo not copied into Simulation. This is a placeholder, not repair evidence.</p> : null}{error ? <p className="facilities-error" role="alert">{error}</p> : null}
    {image ? <PlannerDialog title="Repair photo" subtitle={photo.file_name} onClose={close}><div className="facilities-form"><img className="facilities-photo-preview" src={image} alt={`Photo attached to repair: ${photo.file_name}`} /><footer><button className="is-secondary" type="button" onClick={close}>Close</button><a className="facilities-button" href={image} download={photo.file_name}><Download size={17} aria-hidden="true" />Download</a></footer></div></PlannerDialog> : null}
  </li>;
}
