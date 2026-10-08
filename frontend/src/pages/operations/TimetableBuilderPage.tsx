import { useLayoutEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarOff, CalendarRange, ChevronRight, Clock3, Copy, Plus, Settings2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { CopyTimetableDayInput, CurriculumTargetInput, NewTimetableSlot, PrincipalTimetableResponse, SchoolClosureInput } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { TimetableCoverage } from "./TimetableCoverage";
import { CopyDaySheet, CurriculumTargetSheet, SchoolCalendarSheet, SlotEditorSheet, nextSlot } from "./TimetableBuilderSheets";
import "./timetable-builder.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
function addDays(value: string, amount: number) {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}
function weekdayFor(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 6 ? day : 1;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function clock(value: string) {
  const [hour = "0", minute = "00"] = value.slice(0, 5).split(":");
  const number = Number(hour);
  return `${number % 12 || 12}:${minute} ${number >= 12 ? "PM" : "AM"}`;
}

export interface TimetableBuilderProps {
  data: PrincipalTimetableResponse;
  onTermChange: (termId: string) => void;
  onCreate: (slot: NewTimetableSlot) => Promise<void>;
  onUpdate: (id: string, slot: NewTimetableSlot) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCopy: (input: CopyTimetableDayInput) => Promise<{ copied: true; periods_created: number; target_weekdays: number[] }>;
  onSaveTarget: (input: CurriculumTargetInput) => Promise<void>;
  onCreateClosure: (input: SchoolClosureInput) => Promise<void>;
  onDeleteClosure: (date: string, revision: number, reason: string) => Promise<void>;
}

export function PrincipalTimetablePage({ data, onTermChange, onCreate, onUpdate, onDelete, onCopy, onSaveTarget, onCreateClosure, onDeleteClosure }: TimetableBuilderProps) {
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<PrincipalTimetableResponse["slots"][number] | "new" | null>(null);
  const [copying, setCopying] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [targetSubjectId, setTargetSubjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const selectedTerm = data.terms.find((term) => term.id === data.selected_term_id);
  const requestedDate = params.get("date");
  const validDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && addDays(requestedDate, 0) === requestedDate;
  const entryDate = validDate && selectedTerm && requestedDate >= selectedTerm.starts_on && requestedDate <= selectedTerm.ends_on ? requestedDate : data.school_date;
  const requestedDay = Number(params.get("day"));
  const weekday = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 6 ? requestedDay : weekdayFor(entryDate);
  const coverageOpen = params.get("settings") === "coverage";
  useLayoutEffect(() => {
    document.scrollingElement?.scrollTo?.({ top: 0, behavior: "instant" });
  }, [coverageOpen]);
  const selectedClass = data.classes.find((item) => item.id === params.get("class")) ?? data.classes[0];
  const classSlots = useMemo(() => data.slots.filter((item) => item.class_section_id === selectedClass?.id), [data.slots, selectedClass?.id]);
  const daySlots = useMemo(() => classSlots.filter((item) => item.weekday === weekday).sort((a, b) => a.period_number - b.period_number), [classSlots, weekday]);
  const conflictingIds = useMemo(() => new Set(data.conflicts.flatMap((item) => [item.first_slot_id, item.second_slot_id])), [data.conflicts]);
  const classConflicts = classSlots.filter((item) => conflictingIds.has(item.id));
  const selectedCoverage = data.coverage.filter((item) => item.class_section_id === selectedClass?.id);
  const coverageGaps = selectedCoverage.filter((item) => item.target_minutes !== null && item.projected_minutes < item.target_minutes);
  const targetCoverage = selectedCoverage.find((item) => item.subject_id === targetSubjectId);
  const targetSubject = data.subjects.find((item) => item.id === targetSubjectId);
  const nextClosure = data.calendar_exceptions.find((item) => !item.is_instructional && item.date >= data.school_date);
  const returnParams = new URLSearchParams();
  for (const key of ["school", "date", "class", "view"]) if (params.has(key)) returnParams.set(key, params.get(key)!);
  if (selectedClass) returnParams.set("class", selectedClass.id);
  const backTo = `/principal/timetable${returnParams.size ? `?${returnParams}` : ""}`;
  const editorParams = new URLSearchParams(params);
  editorParams.delete("settings");
  const editorTo = `/principal/timetable/weekly${editorParams.size ? `?${editorParams}` : ""}`;
  const updateUrl = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    setParams(next);
    setMessage("");
  };

  if (!selectedTerm) return <OperationsShell portal="principal" active="timetable" title="Edit timetable" backTo={backTo}><section className="timetable-builder__empty-page"><CalendarRange size={28} /><h2>No academic term</h2><p>Create an academic term before editing the timetable.</p></section></OperationsShell>;
  // Dates only provide a return path to daily planning. Editing changes the weekly pattern.
  const dayOffset = (new Date(`${entryDate}T12:00:00Z`).getUTCDay() + 6) % 7;
  const focusedDate = addDays(entryDate, weekday - 1 - dayOffset);
  const dailyParams = new URLSearchParams(returnParams);
  dailyParams.set("date", focusedDate);
  dailyParams.set("view", "day");
  const canAdjustDate = focusedDate >= selectedTerm.starts_on && focusedDate <= selectedTerm.ends_on;

  return <OperationsShell portal="principal" active="timetable" title={coverageOpen ? "Coverage targets" : "Edit timetable"} backTo={coverageOpen ? editorTo : backTo}>
    <div className="timetable-builder">
      <section className="timetable-builder__selector" aria-label="Timetable selection">
        <div className="timetable-builder__fields">
          <label>Class<select value={selectedClass?.id ?? ""} disabled={!data.classes.length} onChange={(event) => { updateUrl({ class: event.target.value }); setTargetSubjectId(null); }}>
            {data.classes.length ? data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}{data.slots.some((slot) => slot.class_section_id === item.id && conflictingIds.has(slot.id)) ? " · Conflicts" : ""}</option>) : <option value="">No classes</option>}
          </select></label>
          <label>Term<select value={selectedTerm.id} onChange={(event) => { setMessage(""); onTermChange(event.target.value); }}>{data.terms.map((term) => <option key={term.id} value={term.id}>{term.name} · {term.academic_year}</option>)}</select></label>
          {!coverageOpen ? <div className="timetable-builder__applies"><span>Applies to</span><strong>Every week in this term</strong></div> : null}
        </div>
        {!coverageOpen ? <p className="timetable-builder__term-dates">{dateLabel(selectedTerm.starts_on)} – {dateLabel(selectedTerm.ends_on)}</p> : null}
        {!coverageOpen ? <nav className="timetable-builder__days" aria-label="School week">{DAYS.map((day, index) => {
          const number = index + 1;
          const count = classSlots.filter((item) => item.weekday === number).length;
          const conflicts = classConflicts.some((item) => item.weekday === number);
          return <button key={day} type="button" aria-pressed={weekday === number} aria-label={`${day}, ${count} period${count === 1 ? "" : "s"}${conflicts ? ", conflicts need review" : ""}`} onClick={() => updateUrl({ day: String(number) })}>
            <span>{day.slice(0, 3)}</span>{conflicts ? <AlertTriangle size={13} aria-hidden="true" /> : null}
          </button>;
        })}</nav> : null}
      </section>

      {message ? <p className="timetable-builder__message" role="status">{message}</p> : null}
      {!selectedClass ? <section className="timetable-builder__empty-page"><h2>No classes yet</h2><p>Add a class in school records to begin.</p></section> : coverageOpen ? <TimetableCoverage rows={selectedCoverage} subjects={data.subjects} onSelect={setTargetSubjectId} /> : <>
        {classConflicts.length ? <div className="timetable-builder__alert" role="status"><AlertTriangle size={18} /><span>{classConflicts.length} periods in this class need conflict review. Check the marked days.</span></div> : null}
        <section className="timetable-builder__schedule" aria-labelledby="focused-day-heading">
          <header>
            <div><h2 id="focused-day-heading">{DAYS[weekday - 1]}</h2><p>Repeats weekly in {selectedTerm.name}</p></div>
            <div>{daySlots.length ? <button className="is-secondary" type="button" aria-label="Copy day" onClick={() => setCopying(true)}><Copy size={17} aria-hidden="true" /></button> : null}<button type="button" onClick={() => { setMessage(""); setEditing("new"); }}><Plus size={17} aria-hidden="true" />Add period</button></div>
          </header>
          {daySlots.length ? <ol className="timetable-builder__periods">{daySlots.map((item) => <li key={item.id} className={conflictingIds.has(item.id) ? "has-conflict" : ""}><button type="button" onClick={() => { setMessage(""); setEditing(item); }} aria-label={`Edit period ${item.period_number}, ${item.display_title}`}>
            <span className="timetable-builder__period-number">P{item.period_number}</span>
            <span className="timetable-builder__period-copy"><strong>{item.display_title}</strong><small>{clock(item.starts_at)} - {clock(item.ends_at)}</small>{item.teacher_name || item.room || item.slot_type === "class" ? <small>{[item.teacher_name ?? (item.slot_type === "class" ? "Teacher unassigned" : ""), item.room].filter(Boolean).join(" · ")}</small> : null}{conflictingIds.has(item.id) ? <small className="timetable-builder__conflict-label"><AlertTriangle size={13} aria-hidden="true" />Allocation conflict</small> : null}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button></li>)}</ol> : <div className="timetable-builder__empty-day"><Clock3 size={24} /><h3>No periods yet</h3><p>Add a period to this day.</p></div>}
        </section>

        <nav className="timetable-builder__settings" aria-label="Timetable settings">
          <button type="button" onClick={() => { setCalendarOpen(true); setMessage(""); }}><CalendarOff size={19} aria-hidden="true" /><span><strong>School dates</strong>{nextClosure ? <small>{nextClosure.label} · {dateLabel(nextClosure.date)}</small> : null}</span><ChevronRight size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => updateUrl({ settings: "coverage" })}><Settings2 size={19} aria-hidden="true" /><span><strong>Coverage targets</strong></span>{coverageGaps.length ? <small className="timetable-builder__gap-count">{coverageGaps.length} gaps</small> : null}<ChevronRight size={18} aria-hidden="true" /></button>
          {canAdjustDate ? <Link to={`/principal/timetable?${dailyParams}`}><CalendarClock size={19} aria-hidden="true" /><span><strong>Change one date only</strong><small>{dateLabel(focusedDate)}</small></span><ChevronRight size={18} aria-hidden="true" /></Link> : null}
        </nav>
      </>}

      {editing && selectedClass ? <SlotEditorSheet key={editing === "new" ? `new-${selectedClass.id}-${weekday}` : editing.id} data={data} selectedClass={selectedClass}
        initial={editing === "new" ? nextSlot(daySlots, selectedClass, selectedTerm.id, weekday) : { ...editing, term_id: selectedTerm.id, title: editing.subject_id ? "" : editing.display_title, teacher_designation: "Subject Teacher" }}
        editingId={editing === "new" ? null : editing.id} onClose={() => setEditing(null)}
        onSave={async (value) => { if (editing === "new") await onCreate(value); else await onUpdate(editing.id, value); setEditing(null); setMessage(editing === "new" ? "Period added." : "Period updated."); }}
        onDelete={editing === "new" ? undefined : async () => { await onDelete(editing.id); setEditing(null); setMessage("Period removed."); }} /> : null}
      {copying && selectedClass ? <CopyDaySheet className={selectedClass.name} termId={selectedTerm.id} classSectionId={selectedClass.id} sourceWeekday={weekday} sourceDay={DAYS[weekday - 1] ?? "Selected day"} days={DAYS} filledDays={new Set(classSlots.map((item) => item.weekday))} onClose={() => setCopying(false)} onCopy={async (input) => { const result = await onCopy(input); setCopying(false); setMessage(`${result.periods_created} periods copied.`); return result; }} /> : null}
      {targetCoverage && targetSubject && selectedClass ? <CurriculumTargetSheet key={`${selectedClass.id}-${targetSubject.id}-${targetCoverage.revision ?? 0}`} term={selectedTerm} selectedClass={selectedClass} subject={targetSubject} coverage={targetCoverage} onClose={() => setTargetSubjectId(null)} onSave={async (input) => { await onSaveTarget(input); setTargetSubjectId(null); setMessage(`${targetSubject.name} target saved.`); }} /> : null}
      {calendarOpen ? <SchoolCalendarSheet key={`${selectedTerm.id}-${data.calendar_exceptions.map((item) => `${item.id}:${item.revision}`).join(",")}`} term={selectedTerm} schoolDate={data.school_date} exceptions={data.calendar_exceptions} onClose={() => setCalendarOpen(false)} onCreate={async (input) => { await onCreateClosure(input); setCalendarOpen(false); setMessage("School closure added."); }} onDelete={async (date, revision, reason) => { await onDeleteClosure(date, revision, reason); setCalendarOpen(false); setMessage("School closure removed."); }} /> : null}
    </div>
  </OperationsShell>;
}
