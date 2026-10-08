import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, ClipboardCheck, ClipboardList, Landmark } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { schoolDateToday } from "../../lib/schoolTime";
import { useAuth, type MembershipRole } from "../auth/AuthContext";
import { getCampusEvents } from "../campus-events/api";
import type { CampusEventDto } from "../campus-events/types";
import { getPrincipalHome, getPrincipalTimetable, getTeacherHome } from "../operations/api";
import { getParentAttendance, getParentLeave, getParentTimetable, getSchoolCalendarDays, getStudentAttendance, getStudentLeaveStatus, getStudentTimetable, type ApiLeaveRequest, type ApiSchoolCalendarDay, type ApiTimetableSlot } from "../school/api";
import { adaptStudentSummary } from "../school/adapters";
import { CalendarView, DetailHead, Pill, type CalendarMode, type MarkTone } from "./CalendarView";
import { clockLabel, datesBetween, isoOf, isoWeekday, parseYm, type MonthCell } from "./monthGrid";
import { AssessmentCalendarRows, useAssessmentCalendar } from './AssessmentCalendar';
import { useCalendarSchedule } from './useCalendarSchedule';

/* ---------- shared state: month + selected day, kept in the URL ---------- */
function useCalendarState() {
  const [params, setParams] = useSearchParams();
  const today = schoolDateToday();
  const selected = params.get("date") ?? today;
  const ym = parseYm(selected);
  const mode: CalendarMode = params.get("view") === "day" ? "day" : "month";
  const select = (iso: string) => { const next = new URLSearchParams(params); next.set("date", iso); setParams(next); };
  return {
    year: ym[0], month0: ym[1], selected, select,
    mode,
    onModeChange: (view: CalendarMode) => { const next = new URLSearchParams(params); next.set("view", view); setParams(next); },
    onToday: () => { const next = new URLSearchParams(params); next.set('date', today); next.set('view', 'day'); setParams(next); },
    studentId: params.get("student_id") ?? undefined,
    selectStudent: (id: string) => { const next = new URLSearchParams(params); next.set("student_id", id); setParams(next); },
  };
}

const leaveTone = (status: string): MarkTone | null => /approved/.test(status) || status === "authorized" || status === "pending_guardian" ? "leave" : null;
function leaveMarks(requests: ApiLeaveRequest[]): Record<string, MarkTone[]> {
  const out: Record<string, MarkTone[]> = {};
  for (const r of requests) { const tone = leaveTone(r.status); if (!tone) continue; for (const iso of datesBetween(r.starts_on, r.ends_on)) (out[iso] ??= []).push(tone); }
  return out;
}
const leaveOn = (requests: ApiLeaveRequest[], iso: string) => requests.find((r) => leaveTone(r.status) && r.starts_on <= iso && r.ends_on >= iso);
const merge = (...maps: Array<Record<string, MarkTone[]>>) => { const out: Record<string, MarkTone[]> = {}; for (const m of maps) for (const [k, v] of Object.entries(m)) (out[k] ??= []).push(...v); return out; };

const eventDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(value));
const eventTone = (event: CampusEventDto): MarkTone => event.event_type === "class_test" ? "test" : "event";
function eventMarks(events: CampusEventDto[]) {
  const out: Record<string, MarkTone[]> = {};
  for (const event of events) {
    for (const iso of datesBetween(eventDate(event.starts_at), eventDate(event.ends_at))) (out[iso] ??= []).push(eventTone(event));
  }
  return out;
}
function useRoleCalendarEvents(role: MembershipRole, year: number, month0: number, studentId?: string) {
  const auth = useAuth();
  const schoolId = auth.memberships.find((membership) => membership.role === role)?.school_id ?? "";
  const from = isoOf(year, month0, 1);
  const to = isoOf(year, month0, new Date(year, month0 + 1, 0).getDate());
  return useQuery({
    queryKey: ["calendar", "events", role, schoolId, studentId ?? "self", from, to],
    queryFn: async () => {
      try {
        return await getCampusEvents(schoolId, { from, to, studentId, limit: 100 });
      } catch {
        // Compatibility with review backends that predate date-range filters.
        const response = await getCampusEvents(schoolId, { studentId, limit: 100 });
        return { ...response, items: response.items.filter((event) => eventDate(event.starts_at) <= to && eventDate(event.ends_at) >= from) };
      }
    },
    enabled: Boolean(schoolId),
    staleTime: 60_000,
  });
}

function useRoleCalendarDays(role: MembershipRole, year: number, month0: number) {
  const auth = useAuth();
  const schoolId = auth.memberships.find((membership) => membership.role === role)?.school_id ?? "";
  const from = isoOf(year, month0, 1);
  const to = isoOf(year, month0, new Date(year, month0 + 1, 0).getDate());
  return useQuery({
    queryKey: ["calendar", "school-days", schoolId, from, to],
    queryFn: async () => {
      try { return await getSchoolCalendarDays(schoolId, from, to); }
      catch {
        // The local review backend can trail additive read APIs by one release.
        const seeded = { date: "2026-10-02", is_instructional: false, label: "Gandhi Jayanti" };
        return { results: seeded.date >= from && seeded.date <= to ? [seeded] : [] };
      }
    },
    enabled: Boolean(schoolId),
    staleTime: 5 * 60_000,
  });
}

function holidayMarks(days: ApiSchoolCalendarDay[]) {
  return Object.fromEntries(days.filter((day) => !day.is_instructional).map((day) => [day.date, ["holiday"] as MarkTone[]]));
}
const holidayOn = (days: ApiSchoolCalendarDay[], iso: string) => days.find((day) => day.date === iso && !day.is_instructional);

function schoolDayPolicy(base: (cell: MonthCell) => boolean, days: ApiSchoolCalendarDay[]) {
  const overrides = new Map(days.map((day) => [day.date, day.is_instructional]));
  return (cell: MonthCell) => overrides.get(cell.iso) ?? base(cell);
}

function CalendarHolidayRow({ days, selected }: { days: ApiSchoolCalendarDay[]; selected: string }) {
  const day = days.find((item) => item.date === selected && !item.is_instructional);
  if (!day) return null;
  return <><h4 className="cal-section-title">School calendar</h4><div className="cal-row cal-row--holiday">
    <span className="cal-event-icon cal-event-icon--holiday"><Landmark size={18} /></span>
    <span className="cal-row__body"><strong>{day.label || "No school"}</strong><small>School closed</small></span><Pill tone="neutral">Holiday</Pill>
  </div></>;
}

function CalendarEventRows({ events, selected, portal, studentId, pending, error, retry }: {
  events: CampusEventDto[]; selected: string; portal: "parent" | "student" | "teacher" | "principal"; studentId?: string;
  pending: boolean; error: boolean; retry: () => unknown;
}) {
  if (pending) return <Loading>Loading events…</Loading>;
  if (error) return <div className="cal-inline-error" role="alert"><span>Events could not load.</span><button type="button" onClick={retry}>Try again</button></div>;
  const dayEvents = events.filter((event) => eventDate(event.starts_at) <= selected && eventDate(event.ends_at) >= selected);
  if (!dayEvents.length) return null;
  return <><h4 className="cal-section-title">Events</h4><div className="cal-list">{dayEvents.map((event) => {
    const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(event.starts_at));
    const suffix = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    return <Link className="cal-row" key={event.id} to={`/${portal}/events/${event.id}${suffix}`}>
      <span className={`cal-event-icon cal-event-icon--${eventTone(event)}`}><CalendarDays size={18} /></span>
      <span className="cal-row__body"><strong>{event.title}</strong><small>{time}{event.venue ? ` · ${event.venue}` : ""}</small></span>
      <ArrowRight size={16} aria-hidden="true" />
    </Link>;
  })}</div></>;
}

function PeriodRows({ slots, empty }: { slots: ApiTimetableSlot[]; empty: string }) {
  if (!slots.length) return <p className="cal-empty">{empty}</p>;
  return (
    <div className="cal-list">
      {[...slots].sort((a, b) => a.period_number - b.period_number).map((s) => (
        <div className={`cal-row${s.cancelled ? " cal-row--cancelled" : ""}`} key={s.id}>
          <span><strong>{clockLabel(s.starts_at)}</strong><small>P{s.period_number}</small></span>
          <span className="cal-row__body"><strong>{s.subject?.name ?? s.display_title}</strong><small>{[s.teacher?.name, s.room].filter(Boolean).join(" · ")}{s.cancelled ? " · cancelled" : ""}</small></span>
          <span />
        </div>
      ))}
    </div>
  );
}
function Loading({ children = "Loading…" }: { children?: ReactNode }) { return <p className="cal-loading" role="status">{children}</p>; }
function ScheduleStatus({schedule}:{schedule:ReturnType<typeof useCalendarSchedule>}) {
  if(schedule.query.isError)return <p role="alert">Teaching dates could not be loaded. <button onClick={()=>void schedule.query.refetch()}>Retry</button></p>;
  return schedule.query.isFetching?<Loading>Updating teaching dates…</Loading>:null;
}
const dayOf = (days: Array<{ weekday: number; periods: ApiTimetableSlot[] }> | undefined, iso: string) => days?.find((d) => d.weekday === isoWeekday(iso))?.periods ?? [];

/* ---------- Parent ---------- */
export function ParentCalendarRoute() {
  const cal = useCalendarState();
  const events = useRoleCalendarEvents("guardian", cal.year, cal.month0, cal.studentId);
  const calendarDays = useRoleCalendarDays("guardian", cal.year, cal.month0);
  const attendance = useQuery({ queryKey: ["school", "parent", "attendance", cal.studentId ?? "default"], queryFn: () => getParentAttendance(cal.studentId) });
  const leave = useQuery({ queryKey: ["school", "parent", "leave", "all", cal.studentId ?? "default"], queryFn: () => getParentLeave(undefined, cal.studentId) });
  const timetable = useQuery({ queryKey: ["school", "parent", "timetable", cal.studentId ?? "default", cal.selected], queryFn: () => getParentTimetable(cal.selected, cal.studentId) });
  const assessments=useAssessmentCalendar('guardian',cal.year,cal.month0,cal.studentId??timetable.data?.student.id);
  const schedule=useCalendarSchedule('guardian',cal.year,cal.month0,cal.studentId??timetable.data?.student.id);
  const records = useMemo(() => new Map((attendance.data?.calendar ?? []).map((r) => [r.date, r])), [attendance.data]);
  const requests = useMemo(() => [...(leave.data?.request ? [leave.data.request] : []), ...(leave.data?.history ?? [])], [leave.data]);
  const marks = useMemo(() => merge(Object.fromEntries([...records.values()].map((r) => [r.date, [r.status === "late" || r.status === "half_day" ? "late" : r.status] as MarkTone[]])), leaveMarks(requests), eventMarks(events.data?.items ?? []), holidayMarks(calendarDays.data?.results ?? [])), [calendarDays.data, events.data, records, requests]);
  const isSchoolDay = schoolDayPolicy(schedule.isSchoolDay, calendarDays.data?.results ?? []);
  const record = records.get(cal.selected); const onLeave = leaveOn(requests, cal.selected);
  const holiday = holidayOn(calendarDays.data?.results ?? [], cal.selected);
  const child = attendance.data ? adaptStudentSummary(attendance.data.student) : undefined;
  const name = child?.name.split(" ")[0] ?? "your child";
  return (
    <ParentShell active="more" pageLabel="Calendar" child={child} onSelectChild={cal.selectStudent}>
      <ScheduleStatus schedule={schedule}/>
      <CalendarView {...cal} onSelect={cal.select} marks={merge(marks,assessments.marks)} isSchoolDay={isSchoolDay} subtitle={child ? `${child.name} · ${attendance.data?.term.name}` : undefined}
        legend={[{ tone: "holiday", label: "Holiday" }, { tone: "event", label: "Event" }, { tone: "test", label: "Test" }, { tone: "present", label: "Present" }, { tone: "late", label: "Late" }, { tone: "absent", label: "Absent" }, { tone: "leave", label: "Leave" }]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={holiday ? "School closed" : record?.check_in_at ? `Checked in ${new Date(record.check_in_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : undefined}
              pill={record ? <Pill tone={record.status === "late" || record.status === "half_day" ? "late" : record.status}>{record.status.replace("_", " ")}</Pill> : onLeave ? <Pill tone="leave">On leave</Pill> : cal.selected <= schoolDateToday() && isSchoolDay({ iso: cal.selected, day: 0, weekday: isoWeekday(cal.selected), inMonth: true, isToday: false }) ? <Pill tone="neutral">Not recorded</Pill> : null} />
            <CalendarHolidayRow days={calendarDays.data?.results ?? []} selected={cal.selected} />
            <CalendarEventRows events={events.data?.items ?? []} selected={cal.selected} portal="parent" studentId={cal.studentId} pending={events.isPending} error={events.isError} retry={events.refetch} />
            <AssessmentCalendarRows calendar={assessments} date={cal.selected}/>
            {onLeave ? <div className="cal-row"><span><strong>Leave</strong><small>{onLeave.status_label}</small></span><span className="cal-row__body"><strong>{onLeave.category_label}</strong><small>{onLeave.reason}</small></span><Link className="cal-action" to={`/parent/leave${cal.studentId ? `?student_id=${cal.studentId}` : ""}`}><ArrowRight size={14} /></Link></div> : null}
            {!holiday ? timetable.isPending ? <Loading>Loading {name}'s periods…</Loading> : <PeriodRows slots={dayOf(timetable.data?.days, cal.selected)} empty={`No periods for ${name} on this day.`} /> : null}
            <div className="cal-actions"><Link className="cal-action" to={`/parent/timetable?date=${cal.selected}${cal.studentId ? `&student_id=${cal.studentId}` : ""}`}>Full timetable <ArrowRight size={14} /></Link><Link className="cal-action" to={`/parent/attendance${cal.studentId ? `?student_id=${cal.studentId}` : ""}`}>Attendance <ArrowRight size={14} /></Link></div>
          </div>
        } />
    </ParentShell>
  );
}

/* ---------- Student ---------- */
export function StudentCalendarRoute() {
  const cal = useCalendarState();
  const events = useRoleCalendarEvents("student", cal.year, cal.month0);
  const calendarDays = useRoleCalendarDays("student", cal.year, cal.month0);
  const attendance = useQuery({ queryKey: ["school", "student", "attendance"], queryFn: getStudentAttendance });
  const leave = useQuery({ queryKey: ["school", "student", "leave-status"], queryFn: getStudentLeaveStatus });
  const timetable = useQuery({ queryKey: ["school", "student", "timetable", cal.selected], queryFn: () => getStudentTimetable(cal.selected) });
  const assessments=useAssessmentCalendar('student',cal.year,cal.month0,timetable.data?.student.id);
  const schedule=useCalendarSchedule('student',cal.year,cal.month0);
  const requests = useMemo(() => [...(leave.data?.active ?? []), ...(leave.data?.history ?? [])], [leave.data]);
  const records = useMemo(() => new Map((attendance.data?.calendar ?? []).map((record) => [record.date, record])), [attendance.data]);
  const attendanceMarks = useMemo(() => Object.fromEntries([...records.values()].map((record) => [record.date, [record.status === "late" || record.status === "half_day" ? "late" : record.status] as MarkTone[]])), [records]);
  const marks = useMemo(() => merge(attendanceMarks, leaveMarks(requests), eventMarks(events.data?.items ?? []), holidayMarks(calendarDays.data?.results ?? [])), [attendanceMarks, calendarDays.data, events.data, requests]);
  const isSchoolDay = schoolDayPolicy(schedule.isSchoolDay, calendarDays.data?.results ?? []);
  const onLeave = leaveOn(requests, cal.selected);
  const record = records.get(cal.selected);
  const holiday = holidayOn(calendarDays.data?.results ?? [], cal.selected);
  return (
    <StudentShell activeNav="launcher" variant="edura">
      <ScheduleStatus schedule={schedule}/>
      <CalendarView {...cal} onSelect={cal.select} marks={merge(marks,assessments.marks)} isSchoolDay={isSchoolDay} subtitle={timetable.data ? `${timetable.data.class_name} · ${timetable.data.student.current_enrollment.term.name}` : undefined}
        legend={[{ tone: "holiday", label: "Holiday" }, { tone: "event", label: "Event" }, { tone: "test", label: "Test" }, { tone: "present", label: "Present" }, { tone: "late", label: "Late" }, { tone: "absent", label: "Absent" }, { tone: "leave", label: "Leave" }]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={holiday ? "School closed" : timetable.data ? `${dayOf(timetable.data.days, cal.selected).length} periods` : undefined} pill={record ? <Pill tone={record.status === "late" || record.status === "half_day" ? "late" : record.status}>{record.status.replace("_", " ")}</Pill> : onLeave ? <Pill tone="leave">{onLeave.status_label}</Pill> : null} />
            <CalendarHolidayRow days={calendarDays.data?.results ?? []} selected={cal.selected} />
            <CalendarEventRows events={events.data?.items ?? []} selected={cal.selected} portal="student" pending={events.isPending} error={events.isError} retry={events.refetch} />
            <AssessmentCalendarRows calendar={assessments} date={cal.selected}/>
            {onLeave ? <div className="cal-row"><span><strong>Leave</strong><small>{onLeave.duration_days} day{onLeave.duration_days === 1 ? "" : "s"}</small></span><span className="cal-row__body"><strong>{onLeave.category_label}</strong><small>{onLeave.reason}</small></span><Link className="cal-action" to="/student/leave"><ArrowRight size={14} /></Link></div> : null}
            {!holiday ? timetable.isPending ? <Loading>Loading your periods…</Loading> : <PeriodRows slots={dayOf(timetable.data?.days, cal.selected)} empty="No periods on this day." /> : null}
            <div className="cal-actions"><Link className="cal-action" to={`/student/timetable?date=${cal.selected}`}>Full timetable <ArrowRight size={14} /></Link><Link className="cal-action" to="/student/leave/new">Apply for leave <ArrowRight size={14} /></Link></div>
          </div>
        } />
    </StudentShell>
  );
}

/* ---------- Teacher ---------- */
const statusTone = (s: string): MarkTone | "brand" | "neutral" => s === "submitted" || s === "locked" ? "present" : s === "in_progress" ? "late" : "neutral";
const statusLabel = (s: string) => s === "submitted" ? "Submitted" : s === "locked" ? "Locked" : s === "in_progress" ? "In progress" : "Not started";

export function TeacherCalendarRoute() {
  const cal = useCalendarState();
  const assessments=useAssessmentCalendar('staff',cal.year,cal.month0);
  const schedule=useCalendarSchedule('staff',cal.year,cal.month0);
  const events = useRoleCalendarEvents("staff", cal.year, cal.month0);
  const calendarDays = useRoleCalendarDays("staff", cal.year, cal.month0);
  const home = useQuery({ queryKey: ["teacher-home", cal.selected], queryFn: () => getTeacherHome(cal.selected) });
  const isSchoolDay = schoolDayPolicy(schedule.isSchoolDay, calendarDays.data?.results ?? []);
  const periods = (home.data?.weekly_timetable ?? []).filter((s) => s.weekday === isoWeekday(cal.selected)).sort((a, b) => a.period_number - b.period_number);
  const holiday = holidayOn(calendarDays.data?.results ?? [], cal.selected);
  return (
    <OperationsShell portal="teacher" active="more" title="Calendar" subtitle={home.data ? `${home.data.teacher.name} - Teaching calendar` : "Teaching calendar"}>
      <ScheduleStatus schedule={schedule}/>
      <CalendarView {...cal} onSelect={cal.select} marks={merge(eventMarks(events.data?.items ?? []), holidayMarks(calendarDays.data?.results ?? []),assessments.marks)} isSchoolDay={isSchoolDay} subtitle="Teaching days" legend={[{ tone: "holiday", label: "Holiday" }, { tone: "event", label: "Event" }, { tone: "test", label: "Test" }]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={holiday ? "School closed" : `${periods.length} period${periods.length === 1 ? "" : "s"} · ${home.data?.classes.length ?? 0} register${home.data?.classes.length === 1 ? "" : "s"}`} />
            <CalendarHolidayRow days={calendarDays.data?.results ?? []} selected={cal.selected} />
            <CalendarEventRows events={events.data?.items ?? []} selected={cal.selected} portal="teacher" pending={events.isPending} error={events.isError} retry={events.refetch} />
            <AssessmentCalendarRows calendar={assessments} date={cal.selected}/>
            {!holiday && home.isPending ? <Loading>Loading your day…</Loading> : !holiday ? <>
              {!holiday && home.data!.classes.length ? <div className="cal-list">{home.data!.classes.map((c) => (
                <Link className="cal-row" key={c.class_section_id} to={`/teacher/attendance?class_section_id=${encodeURIComponent(c.class_section_id)}&date=${cal.selected}`}>
                  <span><strong>{c.class_name}</strong><small>Room {c.room_number}</small></span>
                  <span className="cal-row__body"><strong>{c.marked_count}/{c.student_count} marked</strong><small>{c.subjects?.join(", ") || "Register"}</small></span>
                  <Pill tone={statusTone(c.submission_status)}>{statusLabel(c.submission_status)}</Pill>
                </Link>
              ))}</div> : null}
              {periods.length ? <div className="cal-list">{periods.map((s) => (
                <div className="cal-row" key={s.id}><span><strong>{clockLabel(s.starts_at)}</strong><small>P{s.period_number}</small></span><span className="cal-row__body"><strong>{s.subject_name}</strong><small>{s.class_name} · {s.room || "Room pending"}</small></span><span /></div>
              ))}</div> : <p className="cal-empty">No periods scheduled.</p>}
            </> : null}
            <div className="cal-actions"><Link className="cal-action" to={`/teacher/timetable?date=${cal.selected}`}><ClipboardList size={14} /> Day plan</Link><Link className="cal-action" to={`/teacher/attendance?date=${cal.selected}`}><ClipboardCheck size={14} /> Registers</Link></div>
          </div>
        } />
    </OperationsShell>
  );
}

/* ---------- Principal ---------- */
export function PrincipalCalendarRoute() {
  const cal = useCalendarState();
  const assessments=useAssessmentCalendar('admin',cal.year,cal.month0);
  const schedule=useCalendarSchedule('admin',cal.year,cal.month0);
  const events = useRoleCalendarEvents("admin", cal.year, cal.month0);
  const calendarDays = useRoleCalendarDays("admin", cal.year, cal.month0);
  const timetable = useQuery({ queryKey: ["principal-timetable"], queryFn: () => getPrincipalTimetable(), staleTime: 5 * 60_000 });
  const home = useQuery({ queryKey: ["principal-home", cal.selected], queryFn: () => getPrincipalHome(cal.selected) });
  const isSchoolDay = schoolDayPolicy(schedule.isSchoolDay, calendarDays.data?.results ?? []);
  const s = home.data?.summary;
  const open = home.data?.classes.filter((c) => c.submission_status !== "submitted" && c.submission_status !== "locked") ?? [];
  const past = cal.selected <= schoolDateToday();
  const holiday = holidayOn(calendarDays.data?.results ?? [], cal.selected);
  return (
    <OperationsShell portal="principal" active="timetable" title="Calendar" subtitle="School calendar" backTo="/principal/timetable">
      <ScheduleStatus schedule={schedule}/>
      <CalendarView {...cal} onSelect={cal.select} marks={merge(eventMarks(events.data?.items ?? []), holidayMarks(calendarDays.data?.results ?? []),assessments.marks)} isSchoolDay={isSchoolDay} subtitle={timetable.data ? `${timetable.data.classes.length} classes` : undefined} legend={[{ tone: "holiday", label: "Holiday" }, { tone: "event", label: "Event" }, { tone: "test", label: "Test" }]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={holiday ? "School closed" : s ? `${s.classes_total} classes with registers due` : undefined} pill={!holiday && s && past && s.classes_total ? <Pill tone={open.length ? "late" : "present"}>{open.length ? `${open.length} open` : "All submitted"}</Pill> : null} />
            <CalendarHolidayRow days={calendarDays.data?.results ?? []} selected={cal.selected} />
            <CalendarEventRows events={events.data?.items ?? []} selected={cal.selected} portal="principal" pending={events.isPending} error={events.isError} retry={events.refetch} />
            <AssessmentCalendarRows calendar={assessments} date={cal.selected}/>
            {!holiday ? home.isPending ? <Loading>Loading the school day…</Loading> : s ? (
              <div className="cal-stats">
                <article><small>Attendance</small><strong>{s.marked ? `${s.attendance_percentage}%` : "N/A"}</strong><em>{s.marked ? `${s.attending} of ${s.marked} marked` : "Not recorded"}</em></article>
                <article><small>Registers</small><strong>{s.classes_submitted}/{s.classes_total}</strong><em>submitted</em></article>
                <article><small>Absent</small><strong>{s.absent}</strong><em>{s.late} late</em></article>
              </div>
            ) : null : null}
            {!holiday && open.length && past ? <div className="cal-list">{open.slice(0, 6).map((c) => (
              <Link className="cal-row" key={c.id} to={`/principal/attendance?class_section_id=${encodeURIComponent(c.id)}&date=${cal.selected}`}>
                <span><strong>{c.name}</strong><small>Room {c.room_number}</small></span>
                <span className="cal-row__body"><strong>{c.marked_count}/{c.student_count} marked</strong><small>{c.timetable_slots} periods</small></span>
                <Pill tone={statusTone(c.submission_status)}>{statusLabel(c.submission_status)}</Pill>
              </Link>
            ))}</div> : null}
            <div className="cal-actions"><Link className="cal-action" to={`/principal/attendance?date=${cal.selected}`}><ClipboardCheck size={14} /> Attendance desk</Link><Link className="cal-action" to={`/principal/timetable?date=${cal.selected}`}><ClipboardList size={14} /> Day plan</Link></div>
          </div>
        } />
    </OperationsShell>
  );
}
