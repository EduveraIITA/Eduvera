import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { CalendarOff, Check, Copy, LoaderCircle, Save, Trash2, X } from "lucide-react";
import type { CopyTimetableDayInput, CurriculumTargetInput, NewTimetableSlot, PrincipalTimetableResponse, SchoolClosureInput } from "../../features/operations/api";

function useSheetFocus(closeRef: RefObject<HTMLButtonElement | null>, onClose: () => void, busy: boolean) {
  const current = useRef({ onClose, busy });
  useEffect(() => { current.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement;
    const sheet = closeRef.current?.closest(".timetable-sheet");
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!current.current.busy) current.current.onClose();
      }
      if (event.key !== "Tab" || !sheet) return;
      const controls = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [closeRef]);
}

function addMinutes(value: string, minutes: number) {
  const [hour = "8", minute = "0"] = value.slice(0, 5).split(":");
  const total = Number(hour) * 60 + Number(minute) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function nextSlot(
  periods: PrincipalTimetableResponse["slots"],
  selectedClass: PrincipalTimetableResponse["classes"][number],
  termId: string,
  weekday: number,
): NewTimetableSlot {
  const latest = [...periods].sort((a, b) => a.period_number - b.period_number).at(-1);
  const startsAt = latest ? addMinutes(latest.ends_at, 5) : "08:00";
  return {
    term_id: termId,
    class_section_id: selectedClass.id,
    subject_id: null,
    teacher_user_id: null,
    weekday,
    period_number: (latest?.period_number ?? 0) + 1,
    starts_at: startsAt,
    ends_at: addMinutes(startsAt, 45),
    slot_type: "class",
    title: "",
    room: selectedClass.room_number,
    teacher_designation: "Subject Teacher",
  };
}

interface SlotEditorProps {
  data: PrincipalTimetableResponse;
  selectedClass: PrincipalTimetableResponse["classes"][number];
  initial: NewTimetableSlot;
  editingId: string | null;
  onClose: () => void;
  onSave: (slot: NewTimetableSlot) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function SlotEditorSheet({ data, selectedClass, initial, editingId, onClose, onSave, onDelete }: SlotEditorProps) {
  const [slot, setSlot] = useState<NewTimetableSlot>({ ...initial, starts_at: initial.starts_at.slice(0, 5), ends_at: initial.ends_at.slice(0, 5) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useSheetFocus(closeRef, onClose, busy);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(slot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The period could not be saved.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete || !window.confirm("Remove this period from the repeating timetable?")) return;
    setBusy(true);
    setError("");
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The period could not be removed.");
      setBusy(false);
    }
  };

  return <div className="timetable-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="timetable-sheet" role="dialog" aria-modal="true" aria-labelledby="slot-editor-heading">
      <header><div><span>{selectedClass.name}</span><h2 id="slot-editor-heading">{editingId ? "Edit period" : "Add period"}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close period editor"><X size={20} /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        <div className="timetable-sheet__compact-grid">
          <label>Period<input type="number" min="1" max="20" required value={slot.period_number} onChange={(event) => setSlot({ ...slot, period_number: Number(event.target.value) })} /></label>
          <label>Type<select value={slot.slot_type} onChange={(event) => setSlot({ ...slot, slot_type: event.target.value as NewTimetableSlot["slot_type"] })}><option value="class">Class</option><option value="break">Break</option><option value="activity">Activity</option></select></label>
          <label>Starts<input type="time" required value={slot.starts_at} onChange={(event) => setSlot({ ...slot, starts_at: event.target.value })} /></label>
          <label>Ends<input type="time" required value={slot.ends_at} onChange={(event) => setSlot({ ...slot, ends_at: event.target.value })} /></label>
        </div>
        {slot.slot_type === "class" ? <>
          <label>Subject<select required value={slot.subject_id ?? ""} onChange={(event) => setSlot({ ...slot, subject_id: event.target.value || null })}><option value="" disabled>Choose subject</option>{data.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Teacher<select value={slot.teacher_user_id ?? ""} onChange={(event) => setSlot({ ...slot, teacher_user_id: event.target.value || null })}><option value="">Assign later</option>{data.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </> : <label>{slot.slot_type === "break" ? "Break name" : "Activity name"}<input required value={slot.title} placeholder={slot.slot_type === "break" ? "Lunch break" : "Assembly"} onChange={(event) => setSlot({ ...slot, title: event.target.value, subject_id: null, teacher_user_id: null })} /></label>}
        <label>Room<input required={slot.slot_type === "class"} value={slot.room} placeholder="Room or location" onChange={(event) => setSlot({ ...slot, room: event.target.value })} /></label>
        {error ? <p className="timetable-sheet__error" role="alert">{error}</p> : null}
        <footer>{onDelete ? <button className="is-danger" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />Remove</button> : <span />}<button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{busy ? "Saving" : "Save period"}</button></footer>
      </form>
    </section>
  </div>;
}

interface CopyDayProps {
  className: string;
  termId: string;
  classSectionId: string;
  sourceWeekday: number;
  sourceDay: string;
  days: readonly string[];
  filledDays: Set<number>;
  onClose: () => void;
  onCopy: (input: CopyTimetableDayInput) => Promise<{ copied: true; periods_created: number; target_weekdays: number[] }>;
}

export function CopyDaySheet({ className, termId, classSectionId, sourceWeekday, sourceDay, days, filledDays, onClose, onCopy }: CopyDayProps) {
  const [targets, setTargets] = useState<number[]>([]);
  const [replace, setReplace] = useState(false);
  const [reason, setReason] = useState(`Copy ${sourceDay} pattern for ${className}.`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useSheetFocus(closeRef, onClose, busy);
  const selectedFilled = targets.some((day) => filledDays.has(day));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onCopy({ term_id: termId, class_section_id: classSectionId, source_weekday: sourceWeekday, target_weekdays: targets, replace, reason });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The day could not be copied.");
      setBusy(false);
    }
  };

  return <div className="timetable-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="timetable-sheet timetable-copy-sheet" role="dialog" aria-modal="true" aria-labelledby="copy-day-heading">
      <header><div><span>{className}</span><h2 id="copy-day-heading">Copy {sourceDay}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close copy day"><X size={20} /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset><legend>Copy to</legend><div className="timetable-copy-sheet__days">{days.map((day, index) => {
          const number = index + 1;
          if (number === sourceWeekday) return null;
          const selected = targets.includes(number);
          return <button key={day} type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} onClick={() => setTargets(selected ? targets.filter((item) => item !== number) : [...targets, number])}><span>{selected ? <Check size={15} /> : null}{day}</span><small>{filledDays.has(number) ? "Already planned" : "Empty"}</small></button>;
        })}</div></fieldset>
        {selectedFilled ? <label className="timetable-copy-sheet__check"><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} /><span><strong>Replace existing periods</strong><small>Only the selected days for {className} will be replaced.</small></span></label> : null}
        <label>Reason<textarea rows={2} required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {error ? <p className="timetable-sheet__error" role="alert">{error}</p> : null}
        <footer><button className="is-secondary" type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !targets.length || (selectedFilled && !replace)}>{busy ? <LoaderCircle className="spin" size={17} /> : <Copy size={17} />}{busy ? "Copying" : `Copy to ${targets.length || 0} day${targets.length === 1 ? "" : "s"}`}</button></footer>
      </form>
    </section>
  </div>;
}

interface CurriculumTargetSheetProps {
  term: PrincipalTimetableResponse["terms"][number];
  selectedClass: PrincipalTimetableResponse["classes"][number];
  subject: PrincipalTimetableResponse["subjects"][number];
  coverage: PrincipalTimetableResponse["coverage"][number];
  onClose: () => void;
  onSave: (input: CurriculumTargetInput) => Promise<void>;
}

const hoursLabel = (minutes: number) => `${Math.round(minutes / 6) / 10}h`;

export function CurriculumTargetSheet({ term, selectedClass, subject, coverage, onClose, onSave }: CurriculumTargetSheetProps) {
  const [hours, setHours] = useState(coverage.target_minutes === null ? "" : String(Math.round(coverage.target_minutes / 6) / 10));
  const [reason, setReason] = useState(`Set ${subject.name} time for ${selectedClass.name}.`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useSheetFocus(closeRef, onClose, busy);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const minutes = Math.round(Number(hours) * 60);
    if (!Number.isFinite(minutes) || minutes < 30) {
      setError("Enter at least 0.5 hours for this term.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        term_id: term.id, class_section_id: selectedClass.id, subject_id: subject.id,
        target_minutes: minutes, expected_revision: coverage.revision ?? 0, reason,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The curriculum target could not be saved.");
      setBusy(false);
    }
  };
  return <div className="timetable-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="timetable-sheet timetable-target-sheet" role="dialog" aria-modal="true" aria-labelledby="target-heading">
      <header><div><span>{selectedClass.name} · {term.name}</span><h2 id="target-heading">{subject.name}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close subject target"><X size={20} /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        <div className="timetable-target-sheet__projection">
          <span><small>Projected</small><strong>{hoursLabel(coverage.projected_minutes)}</strong></span>
          <span><small>Weekly plan</small><strong>{coverage.weekly_periods} period{coverage.weekly_periods === 1 ? "" : "s"}</strong></span>
        </div>
        <label>Target hours for the term<input type="number" inputMode="decimal" min="0.5" max="2000" step="0.5" required value={hours} placeholder="45" onChange={(event) => setHours(event.target.value)} /></label>
        <p className="timetable-sheet__hint">Projected hours use the effective schedule and exclude school closures.</p>
        <label>Reason<textarea rows={2} required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {error ? <p className="timetable-sheet__error" role="alert">{error}</p> : null}
        <footer><button className="is-secondary" type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{busy ? "Saving" : "Save target"}</button></footer>
      </form>
    </section>
  </div>;
}

interface SchoolCalendarSheetProps {
  term: PrincipalTimetableResponse["terms"][number];
  schoolDate: string;
  exceptions: PrincipalTimetableResponse["calendar_exceptions"];
  onClose: () => void;
  onCreate: (input: SchoolClosureInput) => Promise<void>;
  onDelete: (date: string, revision: number, reason: string) => Promise<void>;
}

const closureKindLabel: Record<SchoolClosureInput["kind"], string> = {
  public_holiday: "Public holiday",
  local_holiday: "School holiday",
  emergency_closure: "Emergency closure",
};

function nextIsoDate(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

export function SchoolCalendarSheet({ term, schoolDate, exceptions, onClose, onCreate, onDelete }: SchoolCalendarSheetProps) {
  const earliestDate = schoolDate < term.starts_on ? term.starts_on : schoolDate;
  const closedDates = new Set(exceptions.filter((item) => !item.is_instructional).map((item) => item.date));
  let defaultDate = earliestDate;
  while (closedDates.has(defaultDate) && defaultDate < term.ends_on) defaultDate = nextIsoDate(defaultDate);
  const [input, setInput] = useState<SchoolClosureInput>({ term_id: term.id, starts_on: defaultDate, ends_on: defaultDate, kind: "public_holiday", label: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<PrincipalTimetableResponse["calendar_exceptions"][number] | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useSheetFocus(closeRef, onClose, busy);
  const upcoming = exceptions.filter((item) => !item.is_instructional && item.date >= schoolDate);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onCreate(input); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The school closure could not be saved."); setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    if (removalReason.trim().length < 3) { setError("Add a reason for removing this closure."); return; }
    setBusy(true); setError("");
    try { await onDelete(removing.date, removing.revision, removalReason); setRemoving(null); setRemovalReason(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The school closure could not be removed."); setBusy(false); }
  };
  return <div className="timetable-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="timetable-sheet timetable-calendar-sheet" role="dialog" aria-modal="true" aria-labelledby="school-calendar-heading">
      <header><div><span>{term.name}</span><h2 id="school-calendar-heading">School dates</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close school dates"><X size={20} /></button></header>
      <form onSubmit={(event) => void submit(event)}>
        <label>Type<select value={input.kind} onChange={(event) => setInput({ ...input, kind: event.target.value as SchoolClosureInput["kind"] })}>{Object.entries(closureKindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="timetable-sheet__compact-grid">
          <label>Starts<input type="date" min={earliestDate} max={term.ends_on} required value={input.starts_on} onChange={(event) => setInput({ ...input, starts_on: event.target.value, ends_on: event.target.value > input.ends_on ? event.target.value : input.ends_on })} /></label>
          <label>Ends<input type="date" min={input.starts_on} max={term.ends_on} required value={input.ends_on} onChange={(event) => setInput({ ...input, ends_on: event.target.value })} /></label>
        </div>
        <label>Name<input required minLength={3} maxLength={160} value={input.label} placeholder={input.kind === "emergency_closure" ? "Campus closure" : "Holiday name"} onChange={(event) => setInput({ ...input, label: event.target.value })} /></label>
        <label>Reason<textarea rows={2} required minLength={3} maxLength={500} value={input.reason} placeholder="Reason shown in the school record" onChange={(event) => setInput({ ...input, reason: event.target.value })} /></label>
        {error ? <p className="timetable-sheet__error" role="alert">{error}</p> : null}
        <button className="timetable-calendar-sheet__save" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <CalendarOff size={17} />}{busy ? "Saving" : "Close selected date"}</button>
        <section className="timetable-calendar-sheet__upcoming" aria-labelledby="upcoming-closures-heading">
          <header><h3 id="upcoming-closures-heading">Upcoming closures</h3><span>{upcoming.length}</span></header>
          {upcoming.length ? <ul>{upcoming.map((item) => <li key={item.id}>
            <div><strong>{item.label}</strong><small>{dateLabelForSheet(item.date)} · {item.kind === "emergency_closure" ? "Emergency" : item.kind === "local_holiday" ? "School holiday" : "Public holiday"}</small></div>
            {removing?.id === item.id ? <div className="timetable-calendar-sheet__remove"><label>Removal reason<input autoFocus minLength={3} value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} /></label><span><button className="is-secondary" type="button" onClick={() => setRemoving(null)}>Keep</button><button className="is-danger" type="button" disabled={busy} onClick={() => void remove()}>Remove</button></span></div> : <button type="button" className="is-danger" onClick={() => { setError(""); setRemoving(item); setRemovalReason(""); }} aria-label={`Remove ${item.label} on ${item.date}`}><Trash2 size={16} /></button>}
          </li>)}</ul> : <p>No future closures in this term.</p>}
        </section>
        <footer><span /><button className="is-secondary" type="button" onClick={onClose}>Done</button></footer>
      </form>
    </section>
  </div>;
}

function dateLabelForSheet(value: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00+05:30`));
}
