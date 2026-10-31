import { useRef, useState, useEffect, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { shiftDate } from "../calendar/monthGrid";
import { PeopleBulkAddDialog } from "../people/PeopleBulkAddDialog";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { ActivityPeoplePicker } from "./ActivityPeoplePicker";
import { ActivityPlaceQuickCreate } from "./ActivityPlaceQuickCreate";
import { ProductIcon } from "../../components/ProductIcon";
import { InfoSummary } from "../../components/InfoSummary";
import { useUnsavedChangesGuard, type UnsavedChangesNavigationGuard } from "../navigation/useUnsavedChangesGuard";
import "./activity-plan-editor.css";
import { initialActivity, purposeLabels, validateActivity, weekdayLabels } from "./activityExperience";
import { createActivityPlan, transitionActivityPlan, updateActivityPlan, type ActivityCatalogue, type ActivityPlan, type ActivityPlanInput } from "./api";

function reviewPeople(input: ActivityPlanInput, catalogue: ActivityCatalogue) {
  return [...catalogue.people.filter((item) => input.person_ids.includes(item.id)), ...catalogue.groups.filter((item) => input.group_ids.includes(item.id))].map((item) => item.label).join(", ");
}
function reviewSelection(input: ActivityPlanInput) {
  return [input.person_ids.length ? `${input.person_ids.length} selected ${input.person_ids.length === 1 ? "person" : "people"}` : "", input.group_ids.length ? `${input.group_ids.length} selected ${input.group_ids.length === 1 ? "group" : "groups"}` : ""].filter(Boolean).join(" and ");
}
export function ActivityPlanEditor({ schoolId, catalogue, date, start, end, endDayOffset = 0, intent, plan, onClose, onSaved, onDraftAccepted, onBeforeLeaveChange }: { schoolId: string; catalogue: ActivityCatalogue; date: string; start?: string; end?: string; endDayOffset?: 0 | 1; intent?: "attendance" | "activity"; plan?: ActivityPlan; onClose: () => void; onSaved: (plan: ActivityPlan, message: string) => Promise<void>; onDraftAccepted?: (plan: ActivityPlan) => void; onBeforeLeaveChange?: (guard: UnsavedChangesNavigationGuard | null) => void }) {
  const queryClient = useQueryClient();
  const environment = useExecutionEnvironment();
  const readOnly = environment.mode === "simulation" && (environment.unavailable === true || environment.runStatus === "completed" || environment.runStatus === "stopped");
  const [discovered, setDiscovered] = useState<ActivityCatalogue["people"]>([]);
  const choices = { ...catalogue, people: [...new Map([...catalogue.people, ...discovered].map((person) => [person.id, person])).values()] };
  const [createdPlaces, setCreatedPlaces] = useState<ActivityCatalogue["spaces"]>([]);
  const spaces = [...new Map([...catalogue.spaces, ...createdPlaces].map((place) => [place.id, place])).values()];
  const discover = (person: ActivityCatalogue["people"][number]) => setDiscovered((current) => [...current.filter((existing) => existing.id !== person.id), person]);
  const [input, setInput] = useState<ActivityPlanInput>(() => plan ? { title: plan.title, purpose: plan.purpose, description: plan.description, timezone: plan.timezone, starts_on: plan.starts_on, ends_on: plan.ends_on, recurrence: plan.recurrence, weekdays: plan.weekdays, starts_at: plan.starts_at.slice(0, 5), ends_at: plan.ends_at.slice(0, 5), end_day_offset: plan.end_day_offset, space_id: plan.space_id, person_ids: plan.person_ids, group_ids: plan.group_ids, lead_person_id: plan.lead_person_id, recorder_person_id: plan.recorder_person_id, reviewer_person_id: plan.reviewer_person_id, attendance_mode: plan.attendance_mode, class_section_id: plan.class_section_id, term_id: plan.term_id, subject_id: plan.subject_id, location_kind: plan.location_kind ?? (plan.space_id ? "on_campus" : "unspecified"), location_label: plan.location_label ?? "", location_url: plan.location_url ?? "" } : { ...initialActivity(date, catalogue.timezone, start, end), attendance_mode: intent === "activity" ? "none" : "roll_call", end_day_offset: endDayOffset, location_kind: "unspecified", location_label: "", location_url: "" });
  const [reservation, setReservation] = useState(Boolean(plan && !plan.person_ids.length && !plan.group_ids.length && plan.space_id && plan.attendance_mode === "none"));
  const [step, setStep] = useState(0);
  const [academic, setAcademic] = useState(Boolean(plan?.class_section_id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);
  const [addingPlace, setAddingPlace] = useState(false);
  const [saved, setSaved] = useState<ActivityPlan | undefined>(plan);
  const [dirty, setDirty] = useState(false);
  const commandKey = useRef(crypto.randomUUID());
  const publication = useRef<{ draft: ActivityPlan; key: string } | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const confirmLeave = useUnsavedChangesGuard(dirty, "Discard this activity's unsaved changes? Any draft already saved will remain available.");
  useEffect(() => { onBeforeLeaveChange?.(confirmLeave); return () => onBeforeLeaveChange?.(null); }, [confirmLeave, onBeforeLeaveChange]);
  const progress = useRef<HTMLOListElement>(null);
  const addPersonButton = useRef<HTMLElement | null>(null);
  const addPlaceButton = useRef<HTMLButtonElement>(null);
  const timeSettings = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    progress.current?.focus({ preventScroll: true });
    const dialog = progress.current?.closest("dialog");
    if (dialog) dialog.scrollTop = 0;
  }, [step]);
  const changed = () => { setDirty(true); commandKey.current = crypto.randomUUID(); publication.current = null; setError(""); };
  const set = <K extends keyof ActivityPlanInput>(key: K, value: ActivityPlanInput[K]) => { changed(); setInput((previous) => ({ ...previous, [key]: value })); };
  const close = () => { if (!busy && confirmLeave()) onClose(); };
  const openPerson = () => { addPersonButton.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setAddingPerson(true); };
  const closePerson = () => { setAddingPerson(false); requestAnimationFrame(() => { if (addPersonButton.current?.isConnected) addPersonButton.current.focus(); }); };
  const closePlace = () => { setAddingPlace(false); requestAnimationFrame(() => addPlaceButton.current?.focus()); };
  const choosePlaceLater = () => { set("location_kind", "unspecified"); set("space_id", null); set("location_label", ""); set("location_url", ""); };
  const placePicker = (label: string) => <div className="activity-place-picker">
    <label>{label}<select required value={input.space_id ?? ""} onChange={(event) => set("space_id", event.target.value || null)}><option value="">Choose a place</option>{spaces.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {!spaces.length ? <p>No campus places have been added yet. {catalogue.can_create_places ? "Add one here without leaving this activity." : reservation ? "A campus administrator needs to add a place before it can be reserved." : "Choose the place later, or ask a campus administrator to add one."}</p> : null}
    {catalogue.can_create_places || !reservation && step === 1 ? <div className="activity-place-actions">{catalogue.can_create_places ? <button ref={addPlaceButton} type="button" className="activity-text-button" onClick={() => setAddingPlace(true)}>Add place</button> : null}{!reservation && step === 1 ? <button type="button" className="activity-text-button" onClick={choosePlaceLater}>Choose place later</button> : null}</div> : null}
  </div>;
  const normalized = { ...input, ends_on: input.recurrence === "once" ? input.starts_on : input.ends_on, weekdays: input.recurrence === "once" ? [] : input.weekdays, ...(input.attendance_mode === "none" ? { recorder_person_id: null, reviewer_person_id: null } : {}), ...(!academic ? { class_section_id: null, term_id: null, subject_id: null } : {}) };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (readOnly) { if (step < 2) setStep(step + 1); return; }
    if (step < 2) {
      if (step === 0 && (!input.title.trim() || (!input.person_ids.length && !input.group_ids.length && !(reservation && input.space_id)))) return setError(reservation ? "Name the reservation and choose the campus place." : "Name the activity and choose at least one existing person or group.");
      if (step === 1) { const issue = validateActivity(normalized, { publishing: false }); if (issue) { try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { if (timeSettings.current) timeSettings.current.open = true; } return setError(issue); } }
      setStep(step + 1); return;
    }
    const issue = validateActivity(normalized, { publishing: false }); if (issue) return setError(issue);
    setBusy(true);
    try {
      const next = saved ? await updateActivityPlan(schoolId, saved.id, normalized, saved.revision, commandKey.current) : await createActivityPlan(schoolId, normalized, commandKey.current);
      if (!active.current) return;
      setSaved(next); setDirty(false); commandKey.current = crypto.randomUUID();
      await onSaved(next, "Draft saved. It is not part of the published timetable yet.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The draft could not be saved. Your changes are still here."); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (readOnly) return;
    const issue = validateActivity(normalized); if (issue) return setError(issue);
    setBusy(true); setError("");
    try {
      const draft = publication.current?.draft ?? (saved ? await updateActivityPlan(schoolId, saved.id, normalized, saved.revision, commandKey.current) : await createActivityPlan(schoolId, normalized, commandKey.current));
      // An accepted first stage belongs to the initiating actor/world. Do not
      // issue the next command through a newly selected authenticated session.
      if (!active.current) return;
      setSaved(draft); setDirty(false); commandKey.current = crypto.randomUUID();
      publication.current ??= { draft, key: crypto.randomUUID() };
      onDraftAccepted?.(draft);
      const published = await transitionActivityPlan(schoolId, draft, "publish", undefined, publication.current.key);
      await onSaved(published, "Activity published. Its dates and participants are now scheduled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Publication was not confirmed. The saved draft remains available."); } finally { setBusy(false); }
  };
  return <><PlannerDialog title={plan ? "Edit activity" : intent === "attendance" ? "Set up attendance" : "Schedule activity"} busy={busy} onClose={close}>
    <form className="activity-form activity-form--setup" onSubmit={(event) => void submit(event)}>
      <ol ref={progress} tabIndex={-1} className="activity-setup-progress" aria-label={`Activity setup, step ${step + 1} of 3`}>{["People", "Time & place", "Review"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>
      {readOnly ? <p>This simulation has ended. This draft is read-only; unsaved edits have not been applied.</p> : null}
      <fieldset disabled={readOnly || busy} className="activity-setup-fields">
      {step === 0 ? <>
        <label>Purpose<select value={input.purpose} onChange={(event) => { set("purpose", event.target.value as ActivityPlanInput["purpose"]); if (event.target.value !== "teaching") setAcademic(false); if (event.target.value !== "other") setReservation(false); }}>{catalogue.purposes.map((purpose) => <option key={purpose} value={purpose}>{purposeLabels[purpose]}</option>)}</select></label>
        <label>Activity name<input autoFocus required maxLength={160} value={input.title} onChange={(event) => set("title", event.target.value)} placeholder="e.g. Evening study group" /></label>
        {input.purpose === "other" && intent !== "attendance" ? <label className="activity-check"><input type="checkbox" checked={reservation} onChange={(event) => { changed(); setReservation(event.target.checked); if (event.target.checked) { set("attendance_mode", "none"); set("person_ids", []); set("group_ids", []); set("location_kind", "on_campus"); } }} />Reserve a place without participants</label> : null}
        {reservation ? placePicker("Place to reserve") : <ActivityPeoplePicker catalogue={choices} people={input.person_ids} groups={input.group_ids} onPeople={(ids) => set("person_ids", ids)} onGroups={(ids) => set("group_ids", ids)} onCreatePerson={openPerson} onDiscovered={discover} legend={input.attendance_mode === "roll_call" ? "Whose attendance will be recorded?" : "Who is taking part?"} hint="Choose attendees, not the recorder. Participants do not need app accounts." />}
        <details open={input.lead_person_id ? true : undefined}><summary>Activity lead (optional)</summary><label>Activity lead<select value={input.lead_person_id ?? ""} onChange={(event) => set("lead_person_id", event.target.value || null)}><option value="">Not assigned</option>{choices.people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}</select></label><p>The lead is not an attendee unless selected above or through a group.</p></details>
        {input.purpose === "teaching" ? <details open={academic || undefined}><summary>Academic context, if applicable</summary><label className="activity-check"><input type="checkbox" checked={academic} onChange={(event) => { changed(); setAcademic(event.target.checked); }} />Use an existing academic class and term</label>{academic ? <><label>Class<select required value={input.class_section_id ?? ""} onChange={(event) => set("class_section_id", event.target.value || null)}><option value="">Choose class</option>{catalogue.classes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Term<select required value={input.term_id ?? ""} onChange={(event) => set("term_id", event.target.value || null)}><option value="">Choose term</option>{catalogue.terms.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Subject<select value={input.subject_id ?? ""} onChange={(event) => set("subject_id", event.target.value || null)}><option value="">No subject</option>{catalogue.subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></> : null}</details> : null}
      </> : step === 1 ? <>
        <fieldset className="activity-setup-section"><legend><ProductIcon name="schedule" size={20} />When</legend>
        <div className="activity-form-pair"><label>First date<TemporalInput required type="date" value={input.starts_on} onChange={(event) => set("starts_on", event.target.value)} /></label><label>Repeat<select value={input.recurrence} onChange={(event) => { set("recurrence", event.target.value as "once" | "weekly"); set("ends_on", event.target.value === "weekly" ? null : input.starts_on); }}><option value="once">Once</option><option value="weekly">Weekly</option></select></label></div>
        {input.recurrence === "weekly" ? <><fieldset className="activity-weekdays"><legend>Repeats on</legend>{weekdayLabels.map((day, index) => <button key={day} type="button" aria-pressed={input.weekdays.includes(index + 1)} onClick={() => set("weekdays", input.weekdays.includes(index + 1) ? input.weekdays.filter((item) => item !== index + 1) : [...input.weekdays, index + 1].sort())}>{day}</button>)}</fieldset><label className="activity-check"><input type="checkbox" checked={input.ends_on !== null} onChange={(event) => set("ends_on", event.target.checked ? input.starts_on : null)} />Set a last date</label>{input.ends_on !== null ? <label>Last date<TemporalInput required type="date" min={input.starts_on} value={input.ends_on} onChange={(event) => set("ends_on", event.target.value)} /></label> : <p>Repeats until you end it. Future dates are generated only as needed.</p>}</> : null}
        <div className="activity-form-pair"><label>Starts<TemporalInput required type="time" value={input.starts_at} onChange={(event) => set("starts_at", event.target.value)} /></label><label>Ends<TemporalInput required type="time" value={input.ends_at} onChange={(event) => set("ends_at", event.target.value)} /></label></div>
        <div className="activity-time-context"><label className="activity-check"><input type="checkbox" checked={input.end_day_offset === 1} onChange={(event) => set("end_day_offset", event.target.checked ? 1 : 0)} />Ends next day</label><p>Times use <strong>{input.timezone || "a time zone"}</strong></p></div>
        {input.end_day_offset ? <p>The first activity ends on {shiftDate(input.starts_on, 1)}.</p> : null}
        </fieldset>
        <fieldset className="activity-setup-section"><legend><ProductIcon name="building" size={20} />Place <span className="activity-optional">{reservation ? "Required" : "Optional"}</span></legend>
        {reservation ? <div className="activity-reserved-place"><span>{spaces.find((item) => item.id === input.space_id)?.label ?? "Campus place"}</span><button type="button" className="activity-text-button" aria-label="Edit reserved place" onClick={() => setStep(0)}>Edit</button></div> : <label>Location<select value={input.location_kind ?? "unspecified"} onChange={(event) => { set("location_kind", event.target.value as ActivityPlanInput["location_kind"]); if (event.target.value !== "on_campus") set("space_id", null); if (event.target.value !== "online") set("location_url", ""); if (!["online", "off_site"].includes(event.target.value)) set("location_label", ""); }}><option value="unspecified">Choose later</option><option value="on_campus">Campus place</option><option value="online">Online</option><option value="off_site">Off site</option></select></label>}
        {!reservation && input.location_kind === "on_campus" ? placePicker("Campus place") : null}
        {input.location_kind === "online" || input.location_kind === "off_site" ? <label>{input.location_kind === "online" ? "Online meeting name" : "Off-site location"}<input value={input.location_label ?? ""} maxLength={200} onChange={(event) => set("location_label", event.target.value)} /></label> : null}
        {input.location_kind === "online" ? <label>Joining link <span className="activity-optional">Optional</span><input type="url" value={input.location_url ?? ""} maxLength={1000} placeholder="https://" onChange={(event) => set("location_url", event.target.value)} /></label> : null}
        {!reservation && (input.location_kind === "online" || input.location_kind === "off_site") ? <div className="activity-place-later"><button type="button" className="activity-text-button" onClick={choosePlaceLater}>Choose place later</button></div> : null}
        </fieldset>
        <fieldset className="activity-setup-section"><legend><ProductIcon name="attendance" size={20} />Recording</legend>
        {reservation ? <p>Place reservation only. No participant attendance register will be created.</p> : <label>Attendance<select value={input.attendance_mode} onChange={(event) => set("attendance_mode", event.target.value as "roll_call" | "none")}><option value="roll_call">Record participant attendance</option><option value="none">Attendance not required</option></select></label>}
        {input.attendance_mode === "roll_call" ? <>
          <label>Attendance recorder<select value={input.recorder_person_id ?? ""} onChange={(event) => set("recorder_person_id", event.target.value || null)}><option value="">Choose an authorized person</option>{catalogue.recorders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Attendance reviewer<select value={input.reviewer_person_id ?? ""} onChange={(event) => set("reviewer_person_id", event.target.value || null)}><option value="">Choose an authorized person</option>{catalogue.reviewers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {!input.recorder_person_id || !input.reviewer_person_id ? <p>Assign both roles before publishing, or save a draft to finish later.</p> : null}
          {!catalogue.recorders.length || !catalogue.reviewers.length ? <p className="activity-notice">An administrator must configure existing attendance access for the missing role. You can save a draft meanwhile.</p> : null}
        </> : null}
        </fieldset>
        <details ref={timeSettings} className="activity-setup-options"><summary>Timezone &amp; notes</summary><label>Time zone<input required value={input.timezone} onChange={(event) => set("timezone", event.target.value)} onInvalid={(event) => { const details = event.currentTarget.closest("details"); if (details) details.open = true; }} placeholder="An IANA zone, such as Europe/London" /></label><label>Notes <span className="activity-optional">Optional</span><textarea maxLength={1000} value={input.description} onChange={(event) => set("description", event.target.value)} /></label></details>
        <details className="activity-setup-info"><InfoSummary>Setup details</InfoSummary><p>No placeholder place will be created when you choose later. The recorder submits attendance; the reviewer finalizes it. One authorized person may do both. These roles do not add attendees or grant app access.</p></details>
      </> : <dl className="activity-review">
        <div><dt>Activity<button type="button" aria-label="Edit activity details" onClick={() => setStep(0)}>Edit</button></dt><dd>{input.title} · {reservation ? "Place reservation" : purposeLabels[input.purpose]}</dd></div>
        <div><dt>{input.attendance_mode === "roll_call" ? "Attendance participants" : "Participants"}<button type="button" aria-label="Edit participants" onClick={() => setStep(0)}>Edit</button></dt><dd>{reservation ? "No participants; place reserved only" : <>{reviewPeople(input, choices)}<small>{reviewSelection(input)}</small></>}</dd></div>
        {input.lead_person_id ? <div><dt>Activity lead<button type="button" aria-label="Edit activity lead" onClick={() => setStep(0)}>Edit</button></dt><dd>{choices.people.find((item) => item.id === input.lead_person_id)?.label ?? "Not assigned"}<small>This responsibility is separate from attendance participation.</small></dd></div> : null}
        <div><dt>When<button type="button" aria-label="Edit activity time" onClick={() => setStep(1)}>Edit</button></dt><dd>{input.starts_on} · {input.starts_at}–{input.ends_at}{input.end_day_offset ? " (ends next day)" : ""}<small>{input.end_day_offset ? `Ends ${shiftDate(input.starts_on, 1)} · ` : ""}{input.recurrence === "weekly" ? `Every ${input.weekdays.map((day) => weekdayLabels[day - 1]).join(", ")} · ${input.ends_on ? `until ${input.ends_on}` : "no last date"}` : "One date"} · {input.timezone}</small></dd></div>
        <div><dt>Place<button type="button" aria-label="Edit activity place" onClick={() => setStep(1)}>Edit</button></dt><dd>{spaces.find((item) => item.id === input.space_id)?.label ?? (input.location_label || "To be chosen later")}</dd></div>
        <div><dt>Attendance<button type="button" aria-label="Edit attendance recording" onClick={() => setStep(1)}>Edit</button></dt><dd>{input.attendance_mode === "none" ? "Not required" : <><span>Recorded by {catalogue.recorders.find((item) => item.id === input.recorder_person_id)?.label ?? "Not assigned — required before publish"}</span><small>Reviewed by {catalogue.reviewers.find((item) => item.id === input.reviewer_person_id)?.label ?? "Not assigned — required before publish"}</small></>}</dd></div>
      </dl>}
      {step === 2 ? <details className="activity-setup-info"><InfoSummary>Before publishing</InfoSummary><p>Publication checks current people, places and timetable conflicts. A draft makes no operational changes.</p>{!reservation ? <p>{input.group_ids.length ? "Group membership is captured when published; later group changes do not rewrite this roster." : input.attendance_mode === "roll_call" ? "Only the people selected for attendance will appear in the register." : "Attendance is not required for these participants."}</p> : null}</details> : null}
      </fieldset>
      {error ? <p className="activity-error" role="alert">{error}</p> : null}
      <footer><button type="button" className="is-secondary" disabled={busy} onClick={() => step ? setStep(step - 1) : close()}>{step ? "Back" : "Cancel"}</button><button type="submit" className={step === 2 ? "is-secondary" : undefined} disabled={busy || readOnly && step === 2}>{busy ? "Saving…" : step === 2 ? "Save draft" : "Continue"}</button>{step === 2 ? <button type="button" disabled={busy || readOnly} onClick={() => void publish()}>{busy ? "Working…" : "Publish activity"}</button> : null}</footer>
    </form>
  </PlannerDialog>
    {addingPerson ? <PeopleBulkAddDialog schoolId={schoolId} onClose={closePerson} onDone={(people) => { people.forEach(discover); set("person_ids", [...new Set([...input.person_ids, ...people.map((person) => person.id)])]); closePerson(); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) }); }} /> : null}
    {addingPlace ? <ActivityPlaceQuickCreate schoolId={schoolId} campuses={catalogue.campuses ?? []} onClose={closePlace} onCreated={(place) => { setCreatedPlaces((current) => [...current.filter((item) => item.id !== place.id), { id: place.id, label: place.label }]); set("space_id", place.id); set("location_kind", "on_campus"); closePlace(); void queryClient.invalidateQueries({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId]) }); }} /> : null}
  </>;
}
