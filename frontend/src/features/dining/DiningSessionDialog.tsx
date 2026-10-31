import { useState, type FormEvent } from "react";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { applicationNow } from "../simulation/applicationTime";
import { actOnDiningSession, createDiningSession, getDiningService, getDiningSession, type DiningAction, type DiningRef, type DiningService, type DiningSession } from "./diningApi";
import { DiningPicker } from "./DiningPicker";
import { DiningWriteFeedback, diningDate } from "./DiningPrimitives";
import { diningFold, diningInput, diningInstant } from "./diningTime";
import { DiningTimeField } from "./DiningTimeField";
import { useDiningCommand } from "./useDiningCommand";
import { actOnDiningPlanDate, diningDatePresentation, getDiningPlanDate, type DiningPlanDate } from "./diningPlanApi";
import type { DiningMenuDraft } from "./diningWeekly";
import { shiftDate } from "../calendar/monthGrid";

export function DiningSessionDialog({ schoolId, actorId, service, initial, planDate, draft, onWeekly, publish = false, timezone, refresh, onClose, onSaved }: {
  schoolId: string; actorId: string; service?: DiningService; initial?: DiningSession; publish?: boolean; timezone: string;
  refresh: () => Promise<unknown>; onClose: () => void; onSaved: (id: string) => void;
  planDate?: DiningPlanDate; draft?: DiningMenuDraft; onWeekly?: (draft: DiningMenuDraft) => void;
}) {
  const unresolvedStart = planDate && !planDate.starts_at && planDate.wall_times ? `${planDate.local_date}T${planDate.wall_times.starts_at}` : "";
  const unresolvedEnd = planDate && !planDate.ends_at && planDate.wall_times ? `${shiftDate(planDate.local_date, planDate.wall_times.end_day_offset)}T${planDate.wall_times.ends_at}` : "";
  const [current, setCurrent] = useState(initial), [currentPlanDate, setCurrentPlanDate] = useState(planDate), [currentService, setCurrentService] = useState(service), [label, setLabel] = useState(initial?.label ?? draft?.label ?? "");
  const [start, setStart] = useState(draft?.start ?? (unresolvedStart || diningInput(initial?.starts_at ?? applicationNow(), timezone))), [end, setEnd] = useState(draft?.end ?? (unresolvedEnd || diningInput(initial?.ends_at ?? new Date(applicationNow().getTime() + 3600000), timezone)));
  const [startFold, setStartFold] = useState(planDate && !planDate.starts_at ? "" : diningFold(initial?.starts_at ?? applicationNow(), timezone)), [endFold, setEndFold] = useState(planDate && !planDate.ends_at ? "" : diningFold(initial?.ends_at ?? new Date(applicationNow().getTime() + 3600000), timezone));
  const [initialTimes] = useState({ start, end });
  const [menu, setMenu] = useState(initial?.menu_text ?? draft?.menu ?? ""), [operator, setOperator] = useState<DiningRef | null>(initial?.operator ?? draft?.operator ?? service?.coordinator ?? null), [place, setPlace] = useState<DiningRef | null>(initial?.place ?? draft?.place ?? service?.place ?? null);
  const [picking, setPicking] = useState<"people" | "spaces" | null>(null), [reason, setReason] = useState(""), [review, setReview] = useState(publish), [confirmed, setConfirmed] = useState(false), [reviewing, setReviewing] = useState(false), [error, setError] = useState("");
  const publishedEdit = Boolean(current && current.state !== "draft"), menuMode = current?.menu_mode ?? currentService?.menu_mode ?? "native";
  const action: DiningAction = publishedEdit ? "publish_changes" : publish ? "publish" : "save", title = planDate ? "Change this date" : !initial ? "Plan menu" : action === "publish" ? "Publish menu and hours" : publishedEdit ? "Change menu and hours" : "Edit draft";
  const allowed = current ? current.allowed_actions.includes(action) : Boolean(currentService?.allowed_actions.includes("create_session"));
  const write = useDiningCommand({ schoolId, ...(initial ? { sourceId: initial.id } : {}), kind: "session", onAccepted: async id => { await refresh(); onSaved(id); } });
  const dirty = initial ? menu !== initial.menu_text || start !== (unresolvedStart || diningInput(initial.starts_at, timezone)) || end !== (unresolvedEnd || diningInput(initial.ends_at, timezone)) || operator?.id !== initial.operator.id || place?.id !== initial.place?.id || reason !== "" : Boolean(label || menu || start !== initialTimes.start || end !== initialTimes.end || operator?.id !== service?.coordinator.id || place?.id !== service?.place?.id);
  const canLeave = useUnsavedChangesGuard(dirty && !write.busy && !write.recovery, "Discard this unfinished menu and hours?");
  const close = () => { if (!write.busy && !write.recovery && canLeave()) onClose(); };
  let startsAt = "", endsAt = ""; try { startsAt = diningInstant(start, timezone, startFold); endsAt = diningInstant(end, timezone, endFold); } catch { /* Invalid or ambiguous wall times stay editable. */ }
  const valid = Boolean(operator && startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt) && Date.parse(endsAt) - Date.parse(startsAt) <= 86400000 && (!(publish || publishedEdit) || menuMode === "reference" || menu.trim()) && (initial || label.trim().length >= 2) && (!publishedEdit || reason.trim().length >= 3));
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError(""); if (!valid || !allowed) return;
    if ((publish || publishedEdit) && !review) { setReview(true); setConfirmed(false); return; }
    if ((publish || publishedEdit) && !confirmed) return;
    try {
      const timing = { starts_at: startsAt, ends_at: endsAt, menu_text: menuMode === "native" ? menu.trim() : "" };
      if (currentPlanDate) { const date = currentPlanDate; const body = { ...timing, space_id: place?.id ?? null, expected_plan_version_id: date.plan_version_id, expected_plan_revision: date.plan_revision, expected_session_revision: 0 as const, action: "publish_changes" as const, note: reason.trim() }; void write.execute(command_id => actOnDiningPlanDate(schoolId, date.series_id, date.local_date, { ...body, command_id }), [{ id: date.plan_version_id, revision: date.plan_revision, planVersion: true }, { id: date.id, revision: 0 }]); }
      else if (current) { const body = { ...(action === "publish" ? {} : { ...timing, space_id: place?.id ?? null }), expected_revision: current.revision, action, note: reason.trim() }; void write.execute(command_id => actOnDiningSession(schoolId, current.id, { ...body, command_id }), { id: current.id, revision: current.revision }); }
      else if (currentService) { const body = { ...timing, expected_revision: 0, service_id: currentService.id, service_expected_revision: currentService.revision, label: label.trim(), operator_person_id: operator!.id, space_id: place?.id ?? null }; void write.execute(command_id => createDiningSession(schoolId, { ...body, command_id }), { id: currentService.id, revision: currentService.revision }); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the date and time."); }
  };
  const reviewCurrent = async () => { setReviewing(true); setError(""); try {
    if (current) { const resolved = currentPlanDate ? await getDiningPlanDate(schoolId, currentPlanDate.series_id, currentPlanDate.local_date) : null; const fresh = resolved ? resolved.origin === "session" ? resolved.session : diningDatePresentation(resolved) : await getDiningSession(schoolId, current.id); if (fresh.id !== current.id || fresh.recovery_only) throw new Error("Current responsibility changed. Close and review the dated record."); setCurrent(fresh); if (resolved) setCurrentPlanDate(resolved.origin === "plan_date" ? resolved : undefined); setOperator(fresh.operator); if (publish) { setMenu(fresh.menu_text); setStart(diningInput(fresh.starts_at, timezone)); setEnd(diningInput(fresh.ends_at, timezone)); setStartFold(diningFold(fresh.starts_at, timezone)); setEndFold(diningFold(fresh.ends_at, timezone)); setPlace(fresh.place); } }
    else if (currentService) { const fresh = await getDiningService(schoolId, currentService.id); if (fresh.id !== currentService.id) throw new Error("The current service could not be confirmed."); setCurrentService(fresh); }
    setConfirmed(false); setReview(Boolean(publish || publishedEdit)); write.reviewed();
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Current record unavailable."); } finally { setReviewing(false); } };
  return <PlannerDialog title={title} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={close}><form className="dining-form" onSubmit={submit}><fieldset disabled={write.locked || reviewing}>
    <p className="dining-caption">{current?.service.label ?? currentService?.name}{current?.place ? ` · ${current.place.label}` : ""}</p>
    {planDate ? <p className="dining-warning">{planDate.local_date} only · The weekly pattern and other dates stay unchanged.</p> : null}
    {review ? <><section className="dining-review" aria-label="Publication review"><h3>{publishedEdit ? "Current → proposed" : "Ready to publish"}</h3>{current ? <p className="dining-caption">Current operator: {current.operator.label} · Revision {current.revision}</p> : null}
      {current && (current.starts_at !== startsAt || current.ends_at !== endsAt) ? <del>{diningDate(current.starts_at, timezone)} – {diningDate(current.ends_at, timezone)}</del> : null}<p>{diningDate(startsAt, timezone)} – {diningDate(endsAt, timezone)}</p><p>Responsible operator: {operator?.label}</p>
      {publishedEdit && current?.place?.id !== place?.id ? <p><span className="dining-caption">Previous place: {current?.place?.label ?? "Not set"} → </span>{place?.label ?? "Not set"}</p> : <p>Place: {place?.label ?? "Not set"}</p>}
      {menuMode === "native" ? <>{publishedEdit && current?.menu_text !== menu.trim() ? <><strong>Previous menu</strong><p className="dining-menu dining-caption">{current?.menu_text || "No menu"}</p></> : null}<strong>{publishedEdit ? "Proposed menu" : "Menu"}</strong><p className="dining-menu">{menu}</p></> : <p className="dining-caption">Menu stays in the existing system. No menu is copied or synced.</p>}
      <p className="dining-caption">Serving hours are availability, not a venue reservation. Publication does not open service or record meals served.</p>
    </section><label className="dining-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed this menu, timing and responsibility.</label></> : <>
      {onWeekly ? <label>Repeat<select value="once" onChange={() => onWeekly({ label, start, end, menu, operator, place })}><option value="once">Once</option><option value="weekly">Weekly</option></select></label> : null}
      {!initial ? <label>Date label<input autoFocus required minLength={2} maxLength={100} value={label} onChange={event => setLabel(event.target.value)} placeholder="Lunch, evening meal, workshop tea…" /></label> : null}
      <div className="dining-pair"><DiningTimeField label="Serving starts" value={start} onChange={setStart} timezone={timezone} fold={startFold} onFold={setStartFold} /><DiningTimeField label="Serving ends" value={end} onChange={setEnd} timezone={timezone} fold={endFold} onFold={setEndFold} /></div><p className="dining-caption">Times: {timezone}. At most 24 hours; availability does not reserve this place.</p>
      {!initial ? <div className="dining-field"><span>Responsible operator</span><button type="button" className="is-secondary dining-select" onClick={() => setPicking("people")}>{operator?.label ?? "Choose a person"}</button></div> : <p className="dining-caption">Operator: {operator?.label}. Use Change responsibility for a handoff.</p>}
      {!publish ? <div className="dining-field"><span>Place <small className="dining-caption">Optional</small></span><button type="button" className="is-secondary dining-select" onClick={() => setPicking("spaces")}>{place?.label ?? "Choose a place"}</button>{place ? <button type="button" className="is-text" onClick={() => setPlace(null)}>No place</button> : null}</div> : null}
      {menuMode === "native" ? <label>Menu<textarea required={publishedEdit || publish} rows={4} maxLength={4000} value={menu} onChange={event => setMenu(event.target.value)} placeholder="Dishes and information supplied by your catering team" /></label> : <p className="dining-caption">Menus remain in the existing system; this date contains serving hours only.</p>}
      {publishedEdit ? <label>Reason for change<textarea required minLength={3} maxLength={1000} rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label> : null}
    </>}
  </fieldset>{error ? <p className="dining-error" role="alert">{error}</p> : null}{!allowed ? <p role="alert" className="dining-error">This action is no longer available. Close and review the current record.</p> : null}<DiningWriteFeedback write={write} review={() => void reviewCurrent()} /><footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={() => review && !publish ? (setReview(false), setConfirmed(false)) : close()}>{review ? "Back" : "Cancel"}</button><button type="submit" disabled={write.locked || reviewing || !allowed || !valid || review && !confirmed}>{write.busy ? "Saving…" : review ? publishedEdit ? "Publish changes" : "Publish" : publish || publishedEdit ? "Review changes" : "Save draft"}</button></footer></form>
    {picking ? <DiningPicker schoolId={schoolId} actorId={actorId} kind={picking} {...(currentPlanDate ? { serviceId: currentPlanDate.service.id } : current ? { sessionId: current.id } : currentService ? { serviceId: currentService.id } : {})} title={picking === "people" ? "Choose operator" : "Choose serving place"} onClose={() => setPicking(null)} onSelected={choice => { if (picking === "people") setOperator(choice); else setPlace(choice); setPicking(null); }} /> : null}
  </PlannerDialog>;
}
