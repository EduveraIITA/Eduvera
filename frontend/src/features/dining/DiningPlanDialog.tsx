import { useState, type FormEvent } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { weekdayLabels } from "../activities/activityExperience";
import { shiftDate } from "../calendar/monthGrid";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { getDiningService, type DiningService } from "./diningApi";
import { getDiningPlan, saveDiningPlan, type DiningFoldPolicy, type DiningPlan, type DiningPlanDay } from "./diningPlanApi";
import { DiningPicker } from "./DiningPicker";
import { DiningWriteFeedback } from "./DiningPrimitives";
import { diningDayInput, diningDraftDay, type DiningMenuDraft, validDiningDay } from "./diningWeekly";
import { useDiningCommand } from "./useDiningCommand";

export function DiningPlanDialog({ schoolId, actorId, service, initial, draft, timezone, refresh, onClose, onSaved, onOnce }: {
  schoolId: string; actorId: string; service?: DiningService; initial?: DiningPlan; draft: DiningMenuDraft; timezone: string;
  refresh: () => Promise<unknown>; onClose: () => void; onSaved: (id: string) => void; onOnce?: (draft: DiningMenuDraft) => void;
}) {
  const [current, setCurrent] = useState(initial), [currentService, setCurrentService] = useState(service);
  const [label, setLabel] = useState(initial?.label ?? draft.label), [startsOn, setStartsOn] = useState(initial?.starts_on ?? draft.start.slice(0, 10)), [endsOn, setEndsOn] = useState(initial?.ends_on ?? "");
  const [days, setDays] = useState<DiningPlanDay[]>(initial?.days ?? [diningDraftDay(draft)]), [editing, setEditing] = useState(initial?.days[0]?.weekday ?? diningDraftDay(draft).weekday);
  const [picking, setPicking] = useState<"people" | "spaces" | null>(null), [note, setNote] = useState(""), [reviewing, setReviewing] = useState(false), [error, setError] = useState("");
  const zone = initial?.timezone ?? timezone, day = days.find(item => item.weekday === editing) ?? days[0], menuMode = current?.menu_mode ?? currentService?.menu_mode ?? "native";
  const write = useDiningCommand({ schoolId, ...(initial ? { sourceId: initial.id } : {}), kind: "plan", onAccepted: async id => { await refresh(); onSaved(id); } });
  const canLeave = useUnsavedChangesGuard(!write.busy && !write.recovery && (Boolean(label || note) || JSON.stringify(days) !== JSON.stringify(initial?.days ?? [diningDraftDay(draft)])), "Discard this unfinished weekly menu?");
  const close = () => { if (!write.busy && !write.recovery && canLeave()) onClose(); };
  const allowed = current ? current.allowed_actions.includes("save") : Boolean(currentService?.allowed_actions.includes("create_plan"));
  const valid = label.trim().length >= 2 && Boolean(startsOn) && (!endsOn || endsOn >= startsOn) && days.length > 0 && days.every(validDiningDay);
  const updateDay = (patch: Partial<DiningPlanDay>) => setDays(values => values.map(value => value.weekday === editing ? { ...value, ...patch } : value));
  const toggleDay = (weekday: number) => { if (days.some(value => value.weekday === weekday)) { if (days.length === 1) return; const next = days.filter(value => value.weekday !== weekday); setDays(next); if (editing === weekday) setEditing(next[0]!.weekday); }
    else { setDays([...days, { ...day!, weekday }].sort((a, b) => a.weekday - b.weekday)); setEditing(weekday); } };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!valid || !allowed) return; const body = { ...(current ? { id: current.id } : {}), expected_revision: current?.revision ?? 0, service_id: current?.service_id ?? currentService!.id, service_expected_revision: current?.service_revision ?? currentService!.revision, label: label.trim(), timezone: zone, starts_on: startsOn, ends_on: endsOn || null, days: days.map(value => diningDayInput({ ...value, menu_text: menuMode === "native" ? value.menu_text : "" })), note: note.trim() };
    void write.execute(command_id => saveDiningPlan(schoolId, { ...body, command_id }), current ? { id: current.id, revision: current.revision } : { id: currentService!.id, revision: currentService!.revision }); };
  const review = async () => { setReviewing(true); setError(""); try { if (current) { const fresh = await getDiningPlan(schoolId, current.id); if (fresh.id !== current.id || fresh.recovery_only) throw new Error("This weekly responsibility changed. Close and review its current record."); setCurrent(fresh); } else if (currentService) { const fresh = await getDiningService(schoolId, currentService.id); if (fresh.id !== currentService.id) throw new Error("This service changed. Reopen it."); setCurrentService(fresh); } write.reviewed(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Current menu could not load."); } finally { setReviewing(false); } };
  const switchOnce = () => { if (onOnce && day) onOnce({ label, start: `${startsOn}T${day.starts_at}`, end: `${day.end_day_offset ? shiftDate(startsOn, 1) : startsOn}T${day.ends_at}`, menu: day.menu_text, operator: day.operator.id ? day.operator : null, place: day.place }); };
  return <PlannerDialog title={initial ? "Edit weekly draft" : "Plan menu"} busy={write.busy || Boolean(write.recovery) || reviewing} onClose={close}><form className="dining-form" onSubmit={submit}><fieldset disabled={write.locked || reviewing}>
    <p className="dining-caption">{current?.service.label ?? currentService?.name} · {zone}</p>
    {onOnce ? <label>Repeat<select value="weekly" onChange={switchOnce}><option value="once">Once</option><option value="weekly">Weekly</option></select></label> : null}
    <label>Menu label<input autoFocus required minLength={2} maxLength={100} value={label} onChange={event => setLabel(event.target.value)} placeholder="Lunch, after-school snacks…" /></label>
    <label>First date<TemporalInput type="date" required value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label>
    <fieldset className="dining-weekdays"><legend>Repeat on</legend><div>{weekdayLabels.map((name, index) => <button type="button" className="is-secondary" key={name} aria-pressed={days.some(value => value.weekday === index + 1)} onClick={() => toggleDay(index + 1)}>{name}</button>)}</div></fieldset>
    <label>Day to edit<select value={editing} onChange={event => setEditing(Number(event.target.value))}>{days.map(value => <option key={value.weekday} value={value.weekday}>{weekdayLabels[value.weekday - 1]}</option>)}</select></label>
    {day ? <section className="dining-weekday-editor" aria-label={`${weekdayLabels[day.weekday - 1]} menu and hours`}>
      <div className="dining-pair"><label>Serving starts<TemporalInput type="time" required value={day.starts_at} onChange={event => updateDay({ starts_at: event.target.value })} /></label><label>Serving ends<TemporalInput type="time" required value={day.ends_at} onChange={event => updateDay({ ends_at: event.target.value })} /></label></div>
      <label className="dining-check"><input type="checkbox" checked={day.end_day_offset === 1} onChange={event => updateDay({ end_day_offset: event.target.checked ? 1 : 0 })} />Ends next day</label>
      {!validDiningDay(day) ? <p className="dining-error">Choose an operator and a time window up to 24 hours.</p> : null}
      <div className="dining-pair"><div className="dining-field"><span>Operator</span><button type="button" className="is-secondary dining-select" onClick={() => setPicking("people")}>{day.operator.label}</button></div><div className="dining-field"><span>Place · optional</span><button type="button" className="is-secondary dining-select" onClick={() => setPicking("spaces")}>{day.place?.label ?? "Choose a place"}</button>{day.place ? <button type="button" className="is-text" onClick={() => updateDay({ place: null, space_id: null })}>No place</button> : null}</div></div>
      {menuMode === "native" ? <label>Menu<textarea rows={3} maxLength={4000} value={day.menu_text} onChange={event => updateDay({ menu_text: event.target.value })} placeholder="Dishes and information from your catering team" /></label> : <p className="dining-caption">Menu stays in the existing system. Only serving availability is planned here.</p>}
      {days.length > 1 ? <button type="button" className="is-text" onClick={() => setDays(values => values.map(value => ({ ...day, weekday: value.weekday })))}>Copy {weekdayLabels[day.weekday - 1]} to other selected days</button> : null}
      <details><InfoSummary>Repeated clock hours</InfoSummary><p className="dining-caption">For daylight-saving time changes. A missing clock time must be corrected before publication.</p><div className="dining-pair">{(["start", "end"] as const).map(kind => <label key={kind}>{kind === "start" ? "Start repeated hour" : "End repeated hour"}<select value={day[`${kind}_fold`]} onChange={event => updateDay({ [`${kind}_fold`]: event.target.value as DiningFoldPolicy })}><option value="reject">Ask me to resolve</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>)}</div></details>
    </section> : null}
    <label className="dining-check"><input type="checkbox" checked={Boolean(endsOn)} onChange={event => setEndsOn(event.target.checked ? startsOn : "")} />Set a last date</label>{endsOn ? <label>Last date<TemporalInput type="date" min={startsOn} required value={endsOn} onChange={event => setEndsOn(event.target.value)} /></label> : <p className="dining-caption">Repeats until you end it. Dates are generated only when needed.</p>}
    {initial ? <label>Note · optional<textarea rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label> : null}
    <p className="dining-caption">Save a draft, then review dated menus before publishing. This does not open service or reserve a place.</p>
  </fieldset>{!allowed ? <p className="dining-error" role="alert">This draft can no longer be edited. Review the current record.</p> : null}{error ? <p className="dining-error" role="alert">{error}</p> : null}<DiningWriteFeedback write={write} review={() => void review()} /><footer><button type="button" className="is-secondary" disabled={write.busy || Boolean(write.recovery) || reviewing} onClick={close}>Cancel</button><button type="submit" disabled={!valid || !allowed || write.locked || reviewing}>{write.busy ? "Saving…" : "Save weekly draft"}</button></footer></form>
    {picking && day ? <DiningPicker schoolId={schoolId} actorId={actorId} serviceId={current?.service_id ?? currentService!.id} kind={picking} title={picking === "people" ? "Choose operator" : "Choose serving place"} onClose={() => setPicking(null)} onSelected={choice => { updateDay(picking === "people" ? { operator: choice, operator_person_id: choice.id } : { place: choice, space_id: choice.id }); setPicking(null); }} /> : null}
  </PlannerDialog>;
}
