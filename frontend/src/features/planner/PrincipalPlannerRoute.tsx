import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpen, CalendarDays, CalendarOff, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, LoaderCircle, Plus, Repeat2, Settings2, UsersRound, X,
} from "lucide-react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { SchoolCalendarSheet } from "../../pages/operations/TimetableBuilderSheets";
import { createSchoolClosure, deleteSchoolClosure } from "../operations/api";
import { cleanPeriod, getScheduleSettings, scheduleCommand, type SchedulePeriod, type ScheduleScreen } from "../schedule-planning/api";
import { getCampusEvents } from "../campus-events/api";
import type { CampusEventDto } from "../campus-events/types";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { isoWeekday, monthCells, monthLabel, shiftDate, shiftIsoMonth } from "../calendar/monthGrid";
import { CalendarAttentionGate, type CalendarAttentionTarget } from "../calendar/CalendarRoutes";
import { PlannerTimeline, type TimelineMove, type TimelineSlot } from "./PlannerTimeline";
import { PlannerDialog, PlannerLessonSheet, PlannerPublishSheet } from "./PlannerLessonSheet";
import "../../pages/operations/timetable-builder.css";
import "./principal-planner.css";

type PlannerView = "day" | "week" | "month";
type CreateKind = "class" | "closure" | null;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function safeView(value: string | null): PlannerView {
  return value === "day" || value === "month" ? value : "week";
}

function dateAtNoon(iso: string) {
  return new Date(`${iso}T12:00:00`);
}

function formatDate(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-IN", options).format(dateAtNoon(iso));
}

function startOfWeek(iso: string) {
  return shiftDate(iso, 1 - isoWeekday(iso));
}

export function plannerDates(selected: string, view: PlannerView) {
  if (view === "day") return [selected];
  if (view === "week") {
    const start = startOfWeek(selected);
    return Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
  }
  const [year, month] = selected.split("-").map(Number);
  return monthCells(year!, month! - 1).map((cell) => cell.iso);
}

function rangeInstant(date: string, end = false) {
  return new Date(`${date}T${end ? "23:59:59.999" : "00:00:00"}+05:30`).toISOString();
}

function activeVersion(data: ScheduleScreen, classId: string, date: string) {
  return data.versions
    .filter((version) => version.class_section_id === classId && version.state === "published" && version.starts_on <= date && version.ends_on >= date)
    .sort((left, right) => Number(left.baseline) - Number(right.baseline) || right.starts_on.localeCompare(left.starts_on))[0];
}

export interface PlannerPeriod extends SchedulePeriod {
  class_section_id: string;
  class_name: string;
  teacher_name: string | null;
  display_title: string;
  version_id: string | null;
  version_state: "draft" | "published" | null;
}

export function effectivePeriodsForDate(data: ScheduleScreen, date: string, classFilter = "all"): PlannerPeriod[] {
  if (data.calendar_exceptions.some((item) => item.date === date && !item.is_instructional)) return [];
  const weekday = isoWeekday(date);
  return data.classes.flatMap<PlannerPeriod>((schoolClass) => {
    if (classFilter !== "all" && classFilter !== schoolClass.id) return [];
    const draft = data.versions.find((version) => version.class_section_id === schoolClass.id && version.state === "draft" && version.starts_on <= date && version.ends_on >= date);
    const version = draft ?? activeVersion(data, schoolClass.id, date);
    if (version) return version.periods.filter((period) => period.weekday === weekday).map((period) => ({
      ...period,
      class_section_id: schoolClass.id,
      class_name: schoolClass.name,
      teacher_name: data.teachers.find((teacher) => teacher.id === period.teacher_user_id)?.name ?? null,
      display_title: data.subjects.find((subject) => subject.id === period.subject_id)?.name ?? period.title,
      version_id: version.id,
      version_state: version.state,
    }));
    return data.slots.filter((slot) => slot.class_section_id === schoolClass.id && slot.weekday === weekday).map((slot) => ({
      id: slot.id,
      class_section_id: slot.class_section_id,
      class_name: slot.class_name,
      subject_id: slot.subject_id,
      teacher_user_id: slot.teacher_user_id,
      teacher_name: slot.teacher_name,
      weekday: slot.weekday,
      period_number: slot.period_number,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      title: slot.display_title,
      display_title: slot.display_title,
      version_id: null,
      version_state: "published" as const,
      slot_type: slot.slot_type,
      room: slot.room,
    }));
  }).sort((left, right) => left.starts_at.localeCompare(right.starts_at) || left.class_name.localeCompare(right.class_name));
}

function eventOccursOn(event: CampusEventDto, date: string) {
  return event.starts_at.slice(0, 10) <= date && event.ends_at.slice(0, 10) >= date;
}

function PlannerToolbar({ selected, view, onDate, onView }: { selected: string; view: PlannerView; onDate: (date: string) => void; onView: (view: PlannerView) => void }) {
  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const move = (direction: -1 | 1) => onDate(view === "month" ? shiftIsoMonth(selected, direction) : shiftDate(selected, step * direction));
  const label = view === "day"
    ? formatDate(selected, { day: "numeric", month: "long", year: "numeric" })
    : view === "week"
      ? `${formatDate(startOfWeek(selected), { day: "numeric", month: "short" })} – ${formatDate(shiftDate(startOfWeek(selected), 6), { day: "numeric", month: "short", year: "numeric" })}`
      : monthLabel(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1);
  return <div className="planner-toolbar">
    <div className="planner-toolbar__date">
      <strong>{label}</strong>
      <button type="button" aria-label={`Previous ${view}`} onClick={() => move(-1)}><ChevronLeft size={19} /></button>
      <button type="button" className="planner-toolbar__today" onClick={() => onDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }))}>Today</button>
      <button type="button" aria-label={`Next ${view}`} onClick={() => move(1)}><ChevronRight size={19} /></button>
    </div>
    <div className="planner-toolbar__views" role="radiogroup" aria-label="Planner view">
      {(["day", "week", "month"] as const).map((item) => <button key={item} type="button" role="radio" aria-checked={view === item} onClick={() => onView(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}
    </div>
  </div>;
}

function NewMenu({ selected, returnTo, classId, onCreate }: { selected: string; returnTo: string; classId?: string; onCreate: (kind: Exclude<CreateKind, null>) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const eventParams = new URLSearchParams({ starts_at: `${selected}T09:00`, ends_at: `${selected}T12:00`, return_to: returnTo });
  return <details ref={ref} className="planner-new">
    <summary><Plus size={17} />New<ChevronDown size={15} /></summary>
    <div className="planner-new__menu">
      <button type="button" onClick={() => { ref.current?.removeAttribute("open"); onCreate("class"); }}><Repeat2 size={18} /><span><strong>Recurring class</strong><small>Choose a subject, teacher and repeat</small></span></button>
      <Link to={`/principal/events/new?${eventParams}`} onClick={() => ref.current?.removeAttribute("open")}><CalendarDays size={18} /><span><strong>Event or activity</strong><small>Plan a school event</small></span></Link>
      <button type="button" onClick={() => { ref.current?.removeAttribute("open"); onCreate("closure"); }}><CalendarOff size={18} /><span><strong>Holiday or closure</strong><small>Close one or more school dates</small></span></button>
      <Link to={`/principal/timetable/day?${new URLSearchParams({ date: selected, view: "day", mode: "edit", ...(classId ? { class: classId } : {}), return_to: returnTo })}`} onClick={() => ref.current?.removeAttribute("open")}><Clock3 size={18} /><span><strong>One-day change</strong><small>Adjust only {formatDate(selected, { day: "numeric", month: "short" })}</small></span></Link>
    </div>
  </details>;
}

function MonthBoard({ selected, data, events, classFilter, onSelect, onPlan, onOpen, onMove, onLesson, onGroup }: { selected: string; data: ScheduleScreen; events: CampusEventDto[]; classFilter: string; onSelect: (date: string) => void; onPlan: (slot: TimelineSlot) => void; onOpen: (href: string) => void; onMove: (move: TimelineMove) => Promise<boolean>; onLesson: (period: PlannerPeriod, date: string) => void; onGroup: (date: string, start: string) => void }) {
  const year = Number(selected.slice(0, 4));
  const month = Number(selected.slice(5, 7)) - 1;
  const cells = monthCells(year, month, data.school_date);
  return <>
    <div className="planner-month__weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="planner-month">
      {cells.map((cell) => {
        const closure = data.calendar_exceptions.find((item) => item.date === cell.iso && !item.is_instructional);
        const periods = effectivePeriodsForDate(data, cell.iso, classFilter);
        const dayEvents = events.filter((event) => eventOccursOn(event, cell.iso) && event.status !== "cancelled");
        const classEntries = classFilter === "all"
          ? periods.length ? [{ id: `classes:${cell.iso}`, label: `${periods.length} scheduled classes`, tone: "class" }] : []
          : periods.slice(0, 2).map((period) => ({ id: `${period.class_section_id}:${period.id}`, label: `${period.class_name} · ${period.display_title}`, tone: "class" }));
        const entries = [...dayEvents.map((event) => ({ id: event.id, label: event.title, tone: "event" })), ...classEntries];
        return <button type="button" key={cell.iso} className={`${cell.inMonth ? "" : "is-outside"}${cell.iso === selected ? " is-selected" : ""}`} onClick={() => onSelect(cell.iso)} aria-label={`${formatDate(cell.iso, { day: "numeric", month: "long" })}, ${closure ? closure.label : `${periods.length} classes, ${dayEvents.length} events`}`}>
          <time>{cell.day}</time>
          {closure ? <span className="planner-month__closure">{closure.label}</span> : entries.slice(0, 3).map((entry) => <span key={entry.id} className={`planner-month__item planner-month__item--${entry.tone}`}>{entry.label}</span>)}
          {!closure && entries.length > 3 ? <small>+{entries.length - 3} more</small> : null}
        </button>;
      })}
    </div>
    <div className="planner-month__selected">
      <h2>{formatDate(selected, { weekday: "long", day: "numeric", month: "long" })}</h2>
      <PlannerTimeline dates={[selected]} selected={selected} periodsForDate={(date) => effectivePeriodsForDate(data, date, classFilter)} events={events} closures={data.calendar_exceptions} grouped={classFilter === "all"} onSelectDate={onSelect} onPlan={onPlan} onOpen={onOpen} onMove={onMove} onLesson={onLesson} onGroup={onGroup} />
    </div>
  </>;
}

function nextSchoolDate(data: ScheduleScreen, selected: string) {
  const term = data.terms.find((item) => item.id === data.selected_term_id)!;
  const tomorrow = shiftDate(data.school_date, 1);
  return [selected > data.school_date ? selected : tomorrow, term.starts_on].sort().at(-1)!;
}

function SlotPlanSheet({ slot, returnTo, classId, onClose, onRecurring }: { slot: TimelineSlot; returnTo: string; classId?: string; onClose: () => void; onRecurring: () => void }) {
  const eventParams = new URLSearchParams({ starts_at: `${slot.date}T${slot.startsAt}`, ends_at: `${slot.date}T${slot.endsAt}`, return_to: returnTo });
  const dayParams = new URLSearchParams({ date: slot.date, view: "day", mode: "edit", start: slot.startsAt, end: slot.endsAt, return_to: returnTo, ...(classId ? { class: classId } : {}) });
  return <PlannerDialog title="Plan this time" subtitle={`${formatDate(slot.date, { weekday: "short", day: "numeric", month: "short" })} · ${slot.startsAt}–${slot.endsAt}`} onClose={onClose}>
      <div className="planner-choice-list">
        <button type="button" onClick={onRecurring}><Repeat2 size={20} /><span><strong>Recurring class</strong><small>Repeat weekly in a timetable draft</small></span><ChevronRight size={18} /></button>
        <Link to={`/principal/events/new?${eventParams}`}><CalendarDays size={20} /><span><strong>Event or activity</strong><small>Use this date and time</small></span><ChevronRight size={18} /></Link>
        <Link to={`/principal/timetable/day?${dayParams}`}><Clock3 size={20} /><span><strong>One-day change</strong><small>Change only this school day</small></span><ChevronRight size={18} /></Link>
      </div>
  </PlannerDialog>;
}

function RecurringClassSheet({ data, selectedDate, initialSlot, initialClassId, onClose, onSaved }: { data: ScheduleScreen; selectedDate: string; initialSlot?: TimelineSlot | null; initialClassId?: string; onClose: () => void; onSaved: (message: string) => void }) {
  const term = data.terms.find((item) => item.id === data.selected_term_id)!;
  const startingClass = data.classes.find((item) => item.id === initialClassId) ?? data.classes[0];
  const [classId, setClassId] = useState(startingClass?.id ?? "");
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(data.teachers[0]?.id ?? "");
  const [days, setDays] = useState<number[]>([isoWeekday(initialSlot?.date ?? selectedDate)]);
  const [start, setStart] = useState(initialSlot?.startsAt ?? "09:00");
  const [end, setEnd] = useState(initialSlot?.endsAt ?? "09:45");
  const [room, setRoom] = useState(startingClass?.room_number ?? "");
  const [startsOn, setStartsOn] = useState(nextSchoolDate(data, initialSlot?.date ?? selectedDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!days.length) return setError("Choose at least one weekday.");
    if (end <= start) return setError("The class must end after it starts.");
    setBusy(true); setError("");
    try {
      let draft = data.versions.find((version) => version.class_section_id === classId && version.state === "draft");
      if (!draft) {
        const created = await scheduleCommand("drafts", data.school_id, { term_id: term.id, class_section_id: classId, starts_on: startsOn, ends_on: term.ends_on });
        const fresh = await getScheduleSettings(term.id);
        draft = fresh.versions.find((version) => version.id === created.id) ?? fresh.versions.find((version) => version.class_section_id === classId && version.state === "draft");
      }
      if (!draft) throw new Error("The timetable draft was prepared, but could not be reopened. Refresh and try again.");
      const subject = data.subjects.find((item) => item.id === subjectId);
      const additions = days.map((weekday) => ({
        id: crypto.randomUUID(), weekday,
        period_number: Math.max(0, ...draft.periods.filter((period) => period.weekday === weekday).map((period) => period.period_number)) + 1,
        starts_at: start, ends_at: end, subject_id: subjectId, teacher_user_id: teacherId,
        title: subject?.name ?? "Class", slot_type: "class" as const, room,
      }));
      await scheduleCommand(`${draft.id}/save`, data.school_id, { expected_revision: draft.revision, starts_on: draft.starts_on, ends_on: draft.ends_on, periods: [...draft.periods, ...additions] });
      onSaved(`${subject?.name ?? "Class"} was added to the ${data.classes.find((item) => item.id === classId)?.name} draft. Review and publish when the week is ready.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The recurring class could not be added.");
    } finally { setBusy(false); }
  };
  return <PlannerDialog title="New recurring class" onClose={onClose} busy={busy}>
      <form className="planner-lesson-form planner-sheet-form" onSubmit={(event) => void submit(event)}>
        <div className="planner-sheet__grid">
          <label>Class<select required value={classId} onChange={(event) => { const value = event.target.value; setClassId(value); setRoom(data.classes.find((item) => item.id === value)?.room_number ?? ""); }}><option value="" disabled>Choose class</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Subject<select required value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="" disabled>Choose subject</option>{data.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Teacher<select required value={teacherId} onChange={(event) => setTeacherId(event.target.value)}><option value="" disabled>Choose teacher</option>{data.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Room<input required value={room} onChange={(event) => setRoom(event.target.value)} /></label>
        </div>
        <fieldset><legend>Repeats on</legend><div className="planner-sheet__days">{WEEKDAYS.map((day, index) => <button key={day} type="button" aria-pressed={days.includes(index + 1)} onClick={() => setDays(days.includes(index + 1) ? days.filter((item) => item !== index + 1) : [...days, index + 1].sort())}>{day}</button>)}</div></fieldset>
        <div className="planner-sheet__grid">
          <label>Starts<TemporalInput type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>Ends<TemporalInput type="time" required value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <label>Effective from<TemporalInput type="date" min={nextSchoolDate(data, term.starts_on)} max={term.ends_on} required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
          <div className="planner-sheet__readonly"><span>Repeats until</span><strong>{formatDate(term.ends_on, { day: "numeric", month: "short", year: "numeric" })}</strong></div>
        </div>
        {data.versions.some((version) => version.class_section_id === classId && version.state === "draft") ? <p className="planner-sheet__notice">This class already has a draft. The new periods will be added there.</p> : null}
        {error ? <p className="planner-sheet__error" role="alert">{error}</p> : null}
        <footer><button type="button" className="is-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !classId || !subjectId || !teacherId}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{busy ? "Adding" : "Add to draft"}</button></footer>
      </form>
  </PlannerDialog>;
}

export function PrincipalPlannerRoute() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const view = safeView(params.get("view"));
  const termId = params.get("term") ?? undefined;
  const dataQuery = useQuery({ queryKey: ["principal-timetable", "planner", termId], queryFn: () => getScheduleSettings(termId) });
  const selected = params.get("date") ?? dataQuery.data?.school_date ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const classFilter = params.get("class") ?? "all";
  const dates = plannerDates(selected, view);
  const eventsQuery = useQuery({
    queryKey: ["campus-events", "planner", dataQuery.data?.school_id, dates[0], dates.at(-1)],
    queryFn: () => getCampusEvents(dataQuery.data!.school_id, { from: rangeInstant(dates[0]!), to: rangeInstant(dates.at(-1)!, true), limit: 100 }),
    enabled: Boolean(dataQuery.data?.school_id),
  });
  const [create, setCreate] = useState<CreateKind>(null);
  const [slotIntent, setSlotIntent] = useState<TimelineSlot | null>(null);
  const [recurringSlot, setRecurringSlot] = useState<TimelineSlot | null>(null);
  const [message, setMessage] = useState("");
  const [moveError, setMoveError] = useState("");
  const [lesson, setLesson] = useState<{ period: PlannerPeriod; date: string } | null>(null);
  const [group, setGroup] = useState<{ date: string; startsAt: string } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const setContext = (changes: Record<string, string>) => { const next = new URLSearchParams(params); Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key)); setParams(next, { replace: true }); };
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ["principal-timetable"] }); await dataQuery.refetch(); };
  const eventItems = eventsQuery.data?.items ?? [];
  const loading = dataQuery.isPending || (Boolean(dataQuery.data) && eventsQuery.isPending);
  const error = dataQuery.error ?? eventsQuery.error;
  const errorArea = dataQuery.error ? "schedule" : eventsQuery.error ? "events" : null;
  const data = dataQuery.data;
  const classDraft = data?.versions.find((version) => version.class_section_id === classFilter && version.state === "draft");
  const reviewDraft = data?.versions.find((version) => version.state === "draft" && version.id === (reviewId ?? params.get("review")));
  const linkedPeriod = data && params.has("period") ? effectivePeriodsForDate(data, selected, classFilter).find((period) => period.id === params.get("period")) : undefined;
  const activeLesson = lesson ?? (linkedPeriod ? { period: linkedPeriod, date: selected } : null);
  const openLesson = (period: PlannerPeriod, date: string) => { setGroup(null); setLesson({ period, date }); };
  const openGroup = (date: string, startsAt: string) => setGroup({ date, startsAt });
  const attentionTarget: CalendarAttentionTarget = {
    selected,
    notificationId: params.get("attention_notification_id") ?? undefined,
    changeId: params.get("calendar_change_id") ?? undefined,
    changeKind: params.get("calendar_change_kind") === "created" || params.get("calendar_change_kind") === "removed"
      ? params.get("calendar_change_kind") as "created" | "removed"
      : undefined,
    changeRevision: Number(params.get("calendar_revision")) || undefined,
    recordRevision: Number(params.get("calendar_record_revision")) || undefined,
  };
  const showDay = (date: string) => setContext({ date, ...(view === "month" ? {} : { view }) });
  const movePeriod = async (move: TimelineMove) => {
    if (!data) return false;
    const draft = data.versions.find((version) => version.state === "draft" && version.periods.some((period) => period.id === move.periodId));
    const period = draft?.periods.find((item) => item.id === move.periodId);
    if (!draft || !period) return false;
    const weekday = isoWeekday(move.date);
    const occupiedNumbers = draft.periods.filter((item) => item.id !== period.id && item.weekday === weekday).map((item) => item.period_number);
    const periodNumber = weekday === period.weekday && !occupiedNumbers.includes(period.period_number) ? period.period_number : Math.max(0, ...occupiedNumbers) + 1;
    setMoveError("");
    try {
      const periods = draft.periods.map((item) => cleanPeriod(item.id === period.id ? { ...item, weekday, period_number: periodNumber, starts_at: move.startsAt, ends_at: move.endsAt } : item));
      await scheduleCommand(`${draft.id}/save`, data.school_id, { expected_revision: draft.revision, starts_on: draft.starts_on, ends_on: draft.ends_on, periods });
      setMessage("Class time updated in the draft.");
      await refresh();
      return true;
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : "The class could not be moved.");
      return false;
    }
  };
  return <OperationsShell portal="principal" active="timetable" title="Timetable" pageTitleTrailing={<div className="principal-planner__actions" aria-label="Timetable actions"><Link className="planner-settings" aria-label="Academic settings" to={`/principal/timetable/weekly?${params}`}><Settings2 size={19} /></Link><NewMenu selected={selected} returnTo={`/principal/timetable?${params}`} classId={classFilter === "all" ? undefined : classFilter} onCreate={(kind) => { setRecurringSlot(null); setCreate(kind); }} /></div>}>
    <div className="principal-planner">
      {data ? <CalendarAttentionGate target={attentionTarget} days={data.calendar_exceptions} loaded={dataQuery.isSuccess} /> : null}
      {data ? <>
        <PlannerToolbar selected={selected} view={view} onDate={(date) => setContext({ date })} onView={(nextView) => setContext({ view: nextView })} />
        <div className="planner-filter-row">
          <label><UsersRound size={16} /><span className="sr-only">Filter by class</span><select value={classFilter} onChange={(event) => setContext({ class: event.target.value === "all" ? "" : event.target.value })}><option value="all">All classes</option>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {classDraft ? <button className="planner-draft-action" aria-label="Review draft timetable" type="button" onClick={() => setReviewId(classDraft.id)}>Draft <span>Review</span><ChevronRight size={15} /></button> : null}
        </div>
      </> : null}
      {message ? <div className="planner-success" role="status"><BookOpen size={18} /><span>{message}</span><button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}><X size={16} /></button></div> : null}
      {moveError ? <div className="planner-error planner-error--compact" role="alert"><span>{moveError}</span><button type="button" onClick={() => setMoveError("")}>Dismiss</button></div> : null}
      {data && params.has("period") && !linkedPeriod ? <div className="planner-error planner-error--compact" role="alert"><span>This linked lesson is no longer in the current timetable.</span><button type="button" onClick={() => setContext({ period: "" })}>Dismiss</button></div> : null}
      {loading ? <div className="planner-loading" role="status"><LoaderCircle className="spin" size={22} />Loading timetable…</div> : error ? <div className="planner-error" role="alert"><strong>The {errorArea === "events" ? "event calendar" : "school schedule"} could not be loaded.</strong><span>{error instanceof Error ? error.message : "Try again."}</span><button type="button" onClick={() => { void dataQuery.refetch(); void eventsQuery.refetch(); }}>Try again</button></div> : data ? view === "month" ? <MonthBoard selected={selected} data={data} events={eventItems} classFilter={classFilter} onSelect={showDay} onPlan={(slot) => { showDay(slot.date); setSlotIntent(slot); }} onOpen={(href) => navigate(href)} onMove={movePeriod} onLesson={openLesson} onGroup={openGroup} /> :
        <PlannerTimeline dates={dates} selected={selected} periodsForDate={(date) => effectivePeriodsForDate(data, date, classFilter)} events={eventItems} closures={data.calendar_exceptions} grouped={classFilter === "all"} onSelectDate={(date) => setContext({ date })} onPlan={(slot) => { showDay(slot.date); setSlotIntent(slot); }} onOpen={(href) => navigate(href)} onMove={movePeriod} onLesson={openLesson} onGroup={openGroup} /> : null}
      {data && activeLesson ? <PlannerLessonSheet key={`${activeLesson.period.id}:${activeLesson.date}`} data={data} period={activeLesson.period} date={activeLesson.date} onClose={() => { setLesson(null); if (params.has("period")) setContext({ period: "" }); }} onSaved={(value) => { setMessage(value); void refresh(); }} /> : null}
      {data && reviewDraft ? <PlannerPublishSheet data={data} draft={reviewDraft} onClose={() => { setReviewId(null); if (params.has("review")) setContext({ review: "" }); }} onPublished={() => { setMessage("Timetable published."); void refresh(); }} /> : null}
      {data && group ? <PlannerDialog title="Classes this period" subtitle={`${formatDate(group.date, { weekday: "short", day: "numeric", month: "short" })} · ${group.startsAt.slice(0, 5)}`} onClose={() => setGroup(null)}><div className="planner-choice-list">{effectivePeriodsForDate(data, group.date).filter((period) => period.starts_at === group.startsAt).map((period) => <button type="button" key={period.id} onClick={() => { setContext({ class: period.class_section_id }); openLesson(period, group.date); }}><BookOpen size={19} /><span><strong>{period.class_name} · {period.display_title}</strong><small>{period.teacher_name ?? period.room}</small></span><ChevronRight size={18} /></button>)}</div></PlannerDialog> : null}
      {slotIntent ? <SlotPlanSheet slot={slotIntent} returnTo={`/principal/timetable?${params}`} classId={classFilter === "all" ? undefined : classFilter} onClose={() => setSlotIntent(null)} onRecurring={() => { setRecurringSlot(slotIntent); setSlotIntent(null); setCreate("class"); }} /> : null}
      {data && create === "class" ? <RecurringClassSheet data={data} selectedDate={selected} initialSlot={recurringSlot} initialClassId={classFilter === "all" ? undefined : classFilter} onClose={() => { setCreate(null); setRecurringSlot(null); }} onSaved={(value) => { setMessage(value); void refresh(); }} /> : null}
      {data && create === "closure" && data.terms.find((term) => term.id === data.selected_term_id) ? <SchoolCalendarSheet term={data.terms.find((term) => term.id === data.selected_term_id)!} schoolDate={data.school_date} exceptions={data.calendar_exceptions} onClose={() => setCreate(null)} onCreate={async (input) => { await createSchoolClosure(input); await refresh(); setCreate(null); setMessage(`${input.label} was added to the school calendar.`); }} onDelete={async (date, revision, reason) => { await deleteSchoolClosure(date, revision, reason); await refresh(); }} /> : null}
    </div>
  </OperationsShell>;
}

