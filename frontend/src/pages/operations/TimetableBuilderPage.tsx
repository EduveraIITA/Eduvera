import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, BookOpenCheck, CalendarClock, CalendarOff, CalendarRange, CheckCircle2, Clock3, Copy, Pencil, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { CopyTimetableDayInput, CurriculumTargetInput, NewTimetableSlot, PrincipalTimetableResponse, SchoolClosureInput } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { CopyDaySheet, CurriculumTargetSheet, SchoolCalendarSheet, SlotEditorSheet, nextSlot } from "./TimetableBuilderSheets";
import "./timetable-builder.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    .format(new Date(`${value}T12:00:00+05:30`));
}

function clock(value: string) {
  const [hour = "0", minute = "00"] = value.slice(0, 5).split(":");
  const number = Number(hour);
  return `${number % 12 || 12}:${minute} ${number >= 12 ? "PM" : "AM"}`;
}

function hours(minutes: number) {
  return `${Math.round(minutes / 6) / 10}h`;
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
  const [classId, setClassId] = useState(data.classes[0]?.id ?? "");
  const [weekday, setWeekday] = useState(1);
  const [view, setView] = useState<"build" | "coverage">("build");
  const [editing, setEditing] = useState<PrincipalTimetableResponse["slots"][number] | "new" | null>(null);
  const [copying, setCopying] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [targetSubjectId, setTargetSubjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const selectedTerm = data.terms.find((term) => term.id === data.selected_term_id);

  const selectedClass = data.classes.find((item) => item.id === classId) ?? data.classes[0];
  const classSlots = useMemo(() => data.slots.filter((item) => item.class_section_id === selectedClass?.id), [data.slots, selectedClass?.id]);
  const daySlots = useMemo(() => classSlots.filter((item) => item.weekday === weekday).sort((a, b) => a.period_number - b.period_number), [classSlots, weekday]);
  const conflictingIds = useMemo(() => new Set(data.conflicts.flatMap((item) => [item.first_slot_id, item.second_slot_id])), [data.conflicts]);
  const dayConflictCount = daySlots.filter((item) => conflictingIds.has(item.id)).length;
  const plannedClassDays = data.classes.reduce((count, item) => count + new Set(data.slots.filter((slot) => slot.class_section_id === item.id).map((slot) => slot.weekday)).size, 0);
  const totalClassDays = data.classes.length * DAYS.length;
  const trackedCoverage = data.coverage.filter((item) => item.target_minutes !== null);
  const coverageGaps = trackedCoverage.filter((item) => item.projected_minutes < item.target_minutes!);
  const targetedClassIds = new Set(trackedCoverage.map((item) => item.class_section_id));
  const readyClasses = [...targetedClassIds].filter((id) => !coverageGaps.some((item) => item.class_section_id === id)).length;
  const selectedCoverage = data.coverage.filter((item) => item.class_section_id === selectedClass?.id);
  const visibleCoverage = selectedCoverage.filter((item) => item.weekly_periods > 0 || item.target_minutes !== null);
  const targetCoverage = selectedCoverage.find((item) => item.subject_id === targetSubjectId);
  const targetSubject = data.subjects.find((item) => item.id === targetSubjectId);
  const nextClosure = data.calendar_exceptions.find((item) => !item.is_instructional && item.date >= data.school_date);

  if (!selectedTerm) {
    return <OperationsShell portal="principal" active="timetable" title="Manage timetable"><section className="timetable-builder__empty-page"><CalendarRange size={28} /><h1>No academic term</h1><p>Create an academic term before managing the timetable.</p></section></OperationsShell>;
  }

  const startNew = () => {
    setMessage("");
    setEditing("new");
  };

  return (
    <OperationsShell portal="principal" active="timetable" title="Manage timetable" contentHasHeading>
      <main className="timetable-builder">
        <header className="timetable-builder__title">
          <div><Link to="/principal/timetable"><ArrowLeft size={15} />Published timetable</Link><h1>Manage timetable</h1></div>
          <label>Term<select value={selectedTerm.id} onChange={(event) => onTermChange(event.target.value)}>{data.terms.map((term) => <option key={term.id} value={term.id}>{term.name} - {term.academic_year}</option>)}</select></label>
        </header>

        <section className="timetable-builder__summary" aria-label="Timetable progress">
          <div><CalendarRange size={22} /><span><strong>{selectedTerm.name}</strong><small>{dateLabel(selectedTerm.starts_on)} - {dateLabel(selectedTerm.ends_on)}</small></span></div>
          {view === "build" ? <dl>
            <div><dt>Class days</dt><dd>{plannedClassDays}/{totalClassDays}</dd></div>
            <div><dt>Periods</dt><dd>{data.slots.length}</dd></div>
            <div className={data.conflicts.length ? "is-warning" : ""}><dt>Conflicts</dt><dd>{data.conflicts.length}</dd></div>
          </dl> : <dl>
            <div><dt>Classes ready</dt><dd>{readyClasses}</dd></div>
            <div className={coverageGaps.length ? "is-warning" : ""}><dt>Subject gaps</dt><dd>{coverageGaps.length}</dd></div>
            <div><dt>Targets set</dt><dd>{trackedCoverage.length}</dd></div>
          </dl>}
        </section>

        <div className="timetable-builder__tools">
          <button type="button" onClick={() => { setCalendarOpen(true); setMessage(""); }}><CalendarOff size={18} /><span><strong>School dates</strong><small>{nextClosure ? `Next: ${nextClosure.label}, ${dateLabel(nextClosure.date)}` : "Holidays and closures"}</small></span></button>
          <Link to={`/principal/timetable?date=${encodeURIComponent(data.school_date)}`}><CalendarClock size={18} /><span><strong>Adjust a date</strong><small>Cover, move or cancel periods</small></span></Link>
        </div>

        <div className="timetable-builder__view-switch" role="tablist" aria-label="Timetable view">
          <button type="button" role="tab" aria-selected={view === "build"} className={view === "build" ? "is-active" : ""} onClick={() => { setView("build"); setMessage(""); }}>Weekly plan</button>
          <button type="button" role="tab" aria-selected={view === "coverage"} className={view === "coverage" ? "is-active" : ""} onClick={() => { setView("coverage"); setMessage(""); }}>Term coverage</button>
        </div>

        <section className="timetable-builder__scope" aria-labelledby="class-picker-heading">
          <header><h2 id="class-picker-heading">Choose class</h2><span>{view === "build" ? selectedClass?.room_number || "Room not assigned" : `${selectedCoverage.filter((item) => item.target_minutes !== null && item.projected_minutes < item.target_minutes).length} gaps`}</span></header>
          <div className="timetable-builder__classes" role="list">
            {data.classes.map((item) => {
              const filled = new Set(data.slots.filter((slot) => slot.class_section_id === item.id).map((slot) => slot.weekday)).size;
              const gaps = data.coverage.filter((row) => row.class_section_id === item.id && row.target_minutes !== null && row.projected_minutes < row.target_minutes).length;
              const targets = data.coverage.filter((row) => row.class_section_id === item.id && row.target_minutes !== null).length;
              return <button key={item.id} type="button" className={item.id === selectedClass?.id ? "is-active" : ""} aria-pressed={item.id === selectedClass?.id} onClick={() => { setClassId(item.id); setMessage(""); }}><strong>{item.name}</strong><small>{view === "build" ? `${filled}/${DAYS.length} days` : targets ? gaps ? `${gaps} gap${gaps === 1 ? "" : "s"}` : "On target" : "No targets"}</small></button>;
            })}
          </div>
        </section>

        {view === "build" ? <><nav className="timetable-builder__days" aria-label="School week">
          {DAYS.map((day, index) => {
            const dayNumber = index + 1;
            const count = classSlots.filter((item) => item.weekday === dayNumber).length;
            return <button key={day} type="button" className={weekday === dayNumber ? "is-active" : ""} aria-current={weekday === dayNumber ? "date" : undefined} onClick={() => { setWeekday(dayNumber); setMessage(""); }}><span>{day.slice(0, 3)}</span><strong>{count}</strong></button>;
          })}
        </nav>

        {data.conflicts.length ? <div className="timetable-builder__alert" role="status"><AlertTriangle size={18} /><span><strong>{data.conflicts.length} conflict{data.conflicts.length === 1 ? "" : "s"} need review</strong><small>Conflicting periods are marked in the schedule.</small></span></div> : <div className="timetable-builder__clear" role="status"><CheckCircle2 size={18} /><span>No teacher or room conflicts</span></div>}

        <section className="timetable-builder__schedule" aria-labelledby="focused-day-heading">
          <header>
            <div><span>{selectedClass?.name}</span><h2 id="focused-day-heading">{DAYS[weekday - 1]}</h2><p>{daySlots.length ? `${daySlots.length} periods in the repeating weekly plan` : "No periods planned"}</p></div>
            <div>{daySlots.length ? <button className="is-secondary" type="button" onClick={() => setCopying(true)}><Copy size={16} />Copy day</button> : null}<button type="button" onClick={startNew}><Plus size={17} />Add period</button></div>
          </header>
          {message ? <p className="timetable-builder__message" role="status">{message}</p> : null}
          {daySlots.length ? <ol className="timetable-builder__periods">{daySlots.map((item) => <li key={item.id} className={conflictingIds.has(item.id) ? "has-conflict" : ""}>
            <span className="timetable-builder__period-number">P{item.period_number}</span>
            <span className="timetable-builder__period-copy"><strong>{item.display_title}</strong><small>{item.teacher_name ?? "Teacher unassigned"}</small><small><Clock3 size={13} />{clock(item.starts_at)} - {clock(item.ends_at)}<i>{item.room || "Room pending"}</i></small></span>
            <button type="button" onClick={() => { setMessage(""); setEditing(item); }} aria-label={`Edit period ${item.period_number}, ${item.display_title}`}><Pencil size={16} /></button>
          </li>)}</ol> : <div className="timetable-builder__empty-day"><Clock3 size={24} /><h3>Build {DAYS[weekday - 1]}</h3><p>Add the first period, or choose another day to copy once a pattern exists.</p><button type="button" onClick={startNew}><Plus size={17} />Add first period</button></div>}
          {dayConflictCount ? <p className="timetable-builder__day-warning"><AlertTriangle size={15} />{dayConflictCount} period{dayConflictCount === 1 ? "" : "s"} on this day conflict with another allocation.</p> : null}
        </section></> : <section className="timetable-builder__coverage" aria-labelledby="coverage-heading">
          <header>
            <div><span>{selectedClass?.name}</span><h2 id="coverage-heading">Subject coverage</h2></div>
            <label>Add target<select value="" onChange={(event) => { if (event.target.value) setTargetSubjectId(event.target.value); }}><option value="">Choose subject</option>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
          </header>
          {message ? <p className="timetable-builder__message" role="status">{message}</p> : null}
          {visibleCoverage.length ? <ul>{visibleCoverage.map((row) => {
            const subject = data.subjects.find((item) => item.id === row.subject_id);
            if (!subject) return null;
            const gap = row.target_minutes === null ? null : row.target_minutes - row.projected_minutes;
            const ratio = row.target_minutes ? Math.min(100, Math.round(row.projected_minutes * 100 / row.target_minutes)) : 0;
            return <li key={row.subject_id}><button type="button" onClick={() => setTargetSubjectId(row.subject_id)}>
              <span className="timetable-builder__coverage-copy"><strong>{subject.name}</strong><small>{hours(row.projected_minutes)} projected · {row.weekly_periods} per week</small></span>
              <span className={`timetable-builder__coverage-status ${gap === null ? "is-unset" : gap > 0 ? "is-gap" : "is-ready"}`}>{gap === null ? "Set target" : gap > 0 ? `${hours(gap)} short` : "On target"}</span>
              {row.target_minutes !== null ? <span className="timetable-builder__coverage-progress"><i style={{ width: `${ratio}%` }} /><small>{hours(row.projected_minutes)} of {hours(row.target_minutes)}</small></span> : null}
            </button></li>;
          })}</ul> : <div className="timetable-builder__empty-day"><BookOpenCheck size={24} /><h3>No subject plan yet</h3><p>Add periods in the weekly plan or choose a subject target above.</p></div>}
        </section>}

        {editing && selectedClass ? <SlotEditorSheet
          key={editing === "new" ? `new-${selectedClass.id}-${weekday}` : editing.id}
          data={data}
          selectedClass={selectedClass}
          initial={editing === "new" ? nextSlot(daySlots, selectedClass, selectedTerm.id, weekday) : { ...editing, term_id: selectedTerm.id, title: editing.subject_id ? "" : editing.display_title, teacher_designation: "Subject Teacher" }}
          editingId={editing === "new" ? null : editing.id}
          onClose={() => setEditing(null)}
          onSave={async (value) => { if (editing === "new") await onCreate(value); else await onUpdate(editing.id, value); setEditing(null); setMessage(editing === "new" ? "Period added." : "Period updated."); }}
          onDelete={editing === "new" ? undefined : async () => { await onDelete(editing.id); setEditing(null); setMessage("Period removed."); }}
        /> : null}
        {copying && selectedClass ? <CopyDaySheet className={selectedClass.name} termId={selectedTerm.id} classSectionId={selectedClass.id} sourceWeekday={weekday} sourceDay={DAYS[weekday - 1] ?? "Selected day"} days={DAYS} filledDays={new Set(classSlots.map((item) => item.weekday))} onClose={() => setCopying(false)} onCopy={async (input) => { const result = await onCopy(input); setCopying(false); setMessage(`${result.periods_created} periods copied.`); return result; }} /> : null}
        {targetCoverage && targetSubject && selectedClass ? <CurriculumTargetSheet
          key={`${selectedClass.id}-${targetSubject.id}-${targetCoverage.revision ?? 0}`}
          term={selectedTerm} selectedClass={selectedClass} subject={targetSubject} coverage={targetCoverage}
          onClose={() => setTargetSubjectId(null)}
          onSave={async (input) => { await onSaveTarget(input); setTargetSubjectId(null); setMessage(`${targetSubject.name} target saved.`); }}
        /> : null}
        {calendarOpen ? <SchoolCalendarSheet
          key={`${selectedTerm.id}-${data.calendar_exceptions.map((item) => `${item.id}:${item.revision}`).join(",")}`}
          term={selectedTerm} schoolDate={data.school_date} exceptions={data.calendar_exceptions}
          onClose={() => setCalendarOpen(false)}
          onCreate={async (input) => { await onCreateClosure(input); setCalendarOpen(false); setMessage("School closure added."); }}
          onDelete={async (date, revision, reason) => { await onDeleteClosure(date, revision, reason); setCalendarOpen(false); setMessage("School closure removed."); }}
        /> : null}
      </main>
    </OperationsShell>
  );
}
