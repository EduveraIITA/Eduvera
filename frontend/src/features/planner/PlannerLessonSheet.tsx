import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Clock3, MapPin, Repeat2, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { shiftDate } from "../calendar/monthGrid";
import { cleanPeriod, getScheduleSettings, scheduleCommand, type SchedulePeriod, type ScheduleScreen, type ScheduleVersion } from "../schedule-planning/api";
import type { PlannerPeriod } from "./PrincipalPlannerRoute";

const dateLabel = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`));
const timeLabel = (time: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${time.slice(0, 5)}`));

export function PlannerDialog({ title, subtitle, children, onClose, busy = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="planner-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="planner-dialog__surface"><header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" disabled={busy} aria-label="Close" onClick={onClose}><X size={20} /></button></header>{children}</div>
  </dialog>;
}

// Draft creation copies periods with new IDs. Match the original series within its class,
// never merely by subject, because a subject can have multiple lessons on the same day.
export function findDraftPeriod(draft: ScheduleVersion, original: SchedulePeriod) {
  return draft.periods.find((item) => item.id === original.id) ?? draft.periods.find((item) => item.weekday === original.weekday && item.period_number === original.period_number && item.subject_id === original.subject_id && item.starts_at.slice(0, 5) === original.starts_at.slice(0, 5));
}

async function editableDraft(data: ScheduleScreen, period: PlannerPeriod, date: string) {
  let draft = data.versions.find((version) => version.class_section_id === period.class_section_id && version.state === "draft");
  if (!draft) {
    const term = data.terms.find((item) => item.id === data.selected_term_id)!;
    const startsOn = [date, shiftDate(data.school_date, 1), term.starts_on].sort().at(-1)!;
    const created = await scheduleCommand("drafts", data.school_id, { term_id: term.id, class_section_id: period.class_section_id, starts_on: startsOn, ends_on: term.ends_on });
    const fresh = await getScheduleSettings(term.id);
    draft = fresh.versions.find((version) => version.id === created.id);
  }
  if (!draft) throw new Error("The draft could not be opened. Please refresh the timetable.");
  const match = findDraftPeriod(draft, period);
  if (!match) throw new Error("This lesson has changed in the draft. Close this sheet and open the current lesson.");
  return { draft, match };
}

export function PlannerLessonSheet({ data, period, date, onClose, onSaved }: { data: ScheduleScreen; period: PlannerPeriod; date: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(period.subject_id ?? "");
  const [teacher, setTeacher] = useState(period.teacher_user_id ?? "");
  const [title, setTitle] = useState(period.title);
  const [room, setRoom] = useState(period.room);
  const [start, setStart] = useState(period.starts_at.slice(0, 5));
  const [end, setEnd] = useState(period.ends_at.slice(0, 5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const teaching = period.slot_type === "class";
  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (end <= start) return setError("Choose an end time after the start time.");
    setBusy(true); setError("");
    try {
      const { draft, match } = await editableDraft(data, period, date);
      const updated = { ...match, starts_at: start, ends_at: end, subject_id: teaching ? subject : null, teacher_user_id: teacher || null, room, title: teaching ? data.subjects.find((item) => item.id === subject)?.name ?? title : title };
      await scheduleCommand(`${draft.id}/save`, data.school_id, { expected_revision: draft.revision, starts_on: draft.starts_on, ends_on: draft.ends_on, periods: draft.periods.map((item) => cleanPeriod(item.id === match.id ? updated : item)) });
      onSaved(`${period.display_title} updated in the draft.`); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This lesson could not be saved."); } finally { setBusy(false); }
  };
  return <PlannerDialog title={editing ? `Edit ${teaching ? "class" : "period"}` : period.display_title} subtitle={`${period.class_name} · ${dateLabel(date)}`} onClose={onClose} busy={busy}>
    {editing ? <form className="planner-lesson-form" onSubmit={(event) => void save(event)}>
      {teaching ? <label>Subject<select required value={subject} onChange={(event) => setSubject(event.target.value)}>{data.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
      <div className="planner-form-pair"><label>Starts<TemporalInput type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Ends<TemporalInput type="time" required value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
      {teaching ? <label>Teacher<select required value={teacher} onChange={(event) => setTeacher(event.target.value)}><option value="">Choose teacher</option>{data.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
      <label>Room<input value={room} onChange={(event) => setRoom(event.target.value)} /></label>
      <p className="planner-form-note">Repeats every {weekday}. Saved to the class draft for publication.</p>
      {error ? <p role="alert" className="planner-form-error">{error}</p> : null}
      <footer><button type="button" className="is-secondary" disabled={busy} onClick={() => setEditing(false)}>Back</button><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></footer>
    </form> : <div className="planner-lesson-detail">
      <dl><div><Clock3 size={18} /><dt>Time</dt><dd>{timeLabel(period.starts_at)} – {timeLabel(period.ends_at)}</dd></div>{teaching ? <div><UserRound size={18} /><dt>Teacher</dt><dd>{period.teacher_name ?? "Not assigned"}</dd></div> : null}{period.room ? <div><MapPin size={18} /><dt>Room</dt><dd>{period.room}</dd></div> : null}<div><Repeat2 size={18} /><dt>Repeats</dt><dd>Every {weekday}</dd></div></dl>
      <footer><button type="button" onClick={() => setEditing(true)}>Edit recurring {teaching ? "class" : "period"}</button>{date >= data.school_date ? <Link to={`/principal/timetable/day?${new URLSearchParams({ date, class: period.class_section_id, mode: "edit", return_to: `/principal/timetable?date=${date}&class=${period.class_section_id}` })}`}>Change only this date</Link> : null}</footer>
    </div>}
  </PlannerDialog>;
}

export function PlannerPublishSheet({ data, draft, onClose, onPublished }: { data: ScheduleScreen; draft: ScheduleVersion; onClose: () => void; onPublished: () => void }) {
  const term = data.terms.find((item) => item.id === draft.term_id)!;
  const schoolClass = data.classes.find((item) => item.id === draft.class_section_id)!;
  const minimum = [shiftDate(data.school_date, 1), term.starts_on].sort().at(-1)!;
  const [start, setStart] = useState(draft.starts_on < minimum ? minimum : draft.starts_on);
  const [end, setEnd] = useState(draft.ends_on);
  const [revision, setRevision] = useState(draft.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missing = draft.periods.filter((item) => item.slot_type === "class" && !item.teacher_user_id).length;
  const publish = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let nextRevision = revision;
      if (start !== draft.starts_on || end !== draft.ends_on) {
        const saved = await scheduleCommand(`${draft.id}/save`, data.school_id, { expected_revision: revision, starts_on: start, ends_on: end, periods: draft.periods.map(cleanPeriod) });
        nextRevision = saved.revision ?? (await getScheduleSettings(term.id)).versions.find((item) => item.id === draft.id)!.revision;
        setRevision(nextRevision);
      }
      await scheduleCommand(`${draft.id}/publish`, data.school_id, { expected_revision: nextRevision });
      onPublished(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The timetable could not be published."); } finally { setBusy(false); }
  };
  return <PlannerDialog title="Publish timetable" subtitle={schoolClass.name} onClose={onClose} busy={busy}><form className="planner-lesson-form" onSubmit={(event) => void publish(event)}>
    <p>{draft.periods.length} weekly periods. Staff and families will receive the updated timetable.</p>
    <div className="planner-form-pair"><label>From<TemporalInput type="date" required min={minimum} max={term.ends_on} value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Until<TemporalInput type="date" required min={start} max={term.ends_on} value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
    {missing ? <p role="alert" className="planner-form-error">Assign teachers to {missing} {missing === 1 ? "class" : "classes"} before publishing.</p> : null}
    {error ? <p role="alert" className="planner-form-error">{error}</p> : null}
    <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Keep editing</button><button type="submit" disabled={busy || missing > 0 || !draft.periods.length}>{busy ? "Publishing…" : "Publish timetable"}</button></footer>
  </form></PlannerDialog>;
}
