import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, ClipboardList } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { StudentShell } from "../../pages/student/StudentShell";
import { schoolDateToday } from "../../lib/schoolTime";
import { getPrincipalHome, getPrincipalTimetable, getTeacherHome } from "../operations/api";
import { getParentAttendance, getParentLeave, getParentTimetable, getStudentLeaveStatus, getStudentTimetable, type ApiLeaveRequest, type ApiTimetableSlot } from "../school/api";
import { adaptStudentSummary } from "../school/adapters";
import { CalendarView, DetailHead, Pill, type MarkTone } from "./CalendarView";
import { clockLabel, datesBetween, isoWeekday, parseYm, shiftMonth, type MonthCell } from "./monthGrid";

/* ---------- shared state: month + selected day, kept in the URL ---------- */
function useCalendarState() {
  const [params, setParams] = useSearchParams();
  const today = schoolDateToday();
  const selected = params.get("date") ?? today;
  const [ym, setYm] = useState<[number, number]>(() => parseYm(selected));
  const select = (iso: string) => { const next = new URLSearchParams(params); next.set("date", iso); setParams(next); setYm(parseYm(iso)); };
  return {
    year: ym[0], month0: ym[1], selected, select,
    onMonthChange: (delta: number) => setYm(([y, m]) => shiftMonth(y, m, delta)),
    onToday: () => select(today),
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
/* School days come from which weekdays carry periods; Sunday is never a school day. */
const schoolDaysFrom = (weekdays: Iterable<number>) => { const set = new Set(weekdays); return (cell: MonthCell) => cell.weekday !== 7 && (set.size ? set.has(cell.weekday) : cell.weekday <= 6); };

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
const dayOf = (days: Array<{ weekday: number; periods: ApiTimetableSlot[] }> | undefined, iso: string) => days?.find((d) => d.weekday === isoWeekday(iso))?.periods ?? [];

/* ---------- Parent ---------- */
export function ParentCalendarRoute() {
  const cal = useCalendarState();
  const attendance = useQuery({ queryKey: ["school", "parent", "attendance", cal.studentId ?? "default"], queryFn: () => getParentAttendance(cal.studentId) });
  const leave = useQuery({ queryKey: ["school", "parent", "leave", "all", cal.studentId ?? "default"], queryFn: () => getParentLeave(undefined, cal.studentId) });
  const timetable = useQuery({ queryKey: ["school", "parent", "timetable", cal.studentId ?? "default", cal.selected], queryFn: () => getParentTimetable(cal.selected, cal.studentId) });
  const records = useMemo(() => new Map((attendance.data?.calendar ?? []).map((r) => [r.date, r])), [attendance.data]);
  const requests = useMemo(() => [...(leave.data?.request ? [leave.data.request] : []), ...(leave.data?.history ?? [])], [leave.data]);
  const marks = useMemo(() => merge(Object.fromEntries([...records.values()].map((r) => [r.date, [r.status === "late" || r.status === "half_day" ? "late" : r.status] as MarkTone[]])), leaveMarks(requests)), [records, requests]);
  const isSchoolDay = schoolDaysFrom((timetable.data?.days ?? []).filter((d) => d.periods.length).map((d) => d.weekday));
  const record = records.get(cal.selected); const onLeave = leaveOn(requests, cal.selected);
  const child = attendance.data ? adaptStudentSummary(attendance.data.student) : undefined;
  const name = child?.name.split(" ")[0] ?? "your child";
  return (
    <ParentShell active="more" pageLabel="Calendar" child={child} onSelectChild={cal.selectStudent}>
      <CalendarView {...cal} onSelect={cal.select} marks={marks} isSchoolDay={isSchoolDay} subtitle={child ? `${child.name} · ${attendance.data?.term.name}` : undefined}
        legend={[{ tone: "present", label: "Present" }, { tone: "late", label: "Late" }, { tone: "absent", label: "Absent" }, { tone: "excused", label: "Excused" }, { tone: "leave", label: "Leave" }]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={record?.check_in_at ? `Checked in ${new Date(record.check_in_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : undefined}
              pill={record ? <Pill tone={record.status === "late" || record.status === "half_day" ? "late" : record.status as MarkTone}>{record.status.replace("_", " ")}</Pill> : onLeave ? <Pill tone="leave">On leave</Pill> : cal.selected <= schoolDateToday() && isSchoolDay({ iso: cal.selected, day: 0, weekday: isoWeekday(cal.selected), inMonth: true, isToday: false }) ? <Pill tone="neutral">Not recorded</Pill> : null} />
            {onLeave ? <div className="cal-row"><span><strong>Leave</strong><small>{onLeave.status_label}</small></span><span className="cal-row__body"><strong>{onLeave.category_label}</strong><small>{onLeave.reason}</small></span><Link className="cal-action" to={`/parent/leave${cal.studentId ? `?student_id=${cal.studentId}` : ""}`}><ArrowRight size={14} /></Link></div> : null}
            {timetable.isPending ? <Loading>Loading {name}'s periods…</Loading> : <PeriodRows slots={dayOf(timetable.data?.days, cal.selected)} empty={`No periods for ${name} on this day.`} />}
            <div className="cal-actions"><Link className="cal-action" to={`/parent/timetable?date=${cal.selected}${cal.studentId ? `&student_id=${cal.studentId}` : ""}`}>Full timetable <ArrowRight size={14} /></Link><Link className="cal-action" to={`/parent/attendance${cal.studentId ? `?student_id=${cal.studentId}` : ""}`}>Attendance <ArrowRight size={14} /></Link></div>
          </div>
        } />
    </ParentShell>
  );
}

/* ---------- Student ---------- */
export function StudentCalendarRoute() {
  const cal = useCalendarState();
  const leave = useQuery({ queryKey: ["school", "student", "leave-status"], queryFn: getStudentLeaveStatus });
  const timetable = useQuery({ queryKey: ["school", "student", "timetable", cal.selected], queryFn: () => getStudentTimetable(cal.selected) });
  const requests = useMemo(() => [...(leave.data?.active ?? []), ...(leave.data?.history ?? [])], [leave.data]);
  const marks = useMemo(() => leaveMarks(requests), [requests]);
  const isSchoolDay = schoolDaysFrom((timetable.data?.days ?? []).filter((d) => d.periods.length).map((d) => d.weekday));
  const onLeave = leaveOn(requests, cal.selected);
  return (
    <StudentShell activeNav="launcher" variant="edura">
      <CalendarView {...cal} onSelect={cal.select} marks={marks} isSchoolDay={isSchoolDay} subtitle={timetable.data ? `${timetable.data.class_name} · ${timetable.data.student.current_enrollment.term.name}` : undefined}
        legend={[{ tone: "leave", label: "Leave" }]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={timetable.data ? `${dayOf(timetable.data.days, cal.selected).length} periods` : undefined} pill={onLeave ? <Pill tone="leave">{onLeave.status_label}</Pill> : null} />
            {onLeave ? <div className="cal-row"><span><strong>Leave</strong><small>{onLeave.duration_days} day{onLeave.duration_days === 1 ? "" : "s"}</small></span><span className="cal-row__body"><strong>{onLeave.category_label}</strong><small>{onLeave.reason}</small></span><Link className="cal-action" to="/student/leave"><ArrowRight size={14} /></Link></div> : null}
            {timetable.isPending ? <Loading>Loading your periods…</Loading> : <PeriodRows slots={dayOf(timetable.data?.days, cal.selected)} empty="No periods on this day." />}
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
  const home = useQuery({ queryKey: ["teacher-home", cal.selected], queryFn: () => getTeacherHome(cal.selected) });
  const weekdays = useMemo(() => new Set((home.data?.weekly_timetable ?? []).map((s) => s.weekday)), [home.data]);
  const isSchoolDay = schoolDaysFrom(weekdays);
  const periods = (home.data?.weekly_timetable ?? []).filter((s) => s.weekday === isoWeekday(cal.selected)).sort((a, b) => a.period_number - b.period_number);
  return (
    <OperationsShell portal="teacher" active="more" title="Calendar" subtitle={home.data ? `${home.data.teacher.name} - Teaching calendar` : "Teaching calendar"}>
      <CalendarView {...cal} onSelect={cal.select} marks={{}} isSchoolDay={isSchoolDay} subtitle="Teaching days" legend={[]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={`${periods.length} period${periods.length === 1 ? "" : "s"} · ${home.data?.classes.length ?? 0} register${home.data?.classes.length === 1 ? "" : "s"}`} />
            {home.isPending ? <Loading>Loading your day…</Loading> : <>
              {home.data!.classes.length ? <div className="cal-list">{home.data!.classes.map((c) => (
                <Link className="cal-row" key={c.class_section_id} to={`/teacher/attendance?class_section_id=${encodeURIComponent(c.class_section_id)}&date=${cal.selected}`}>
                  <span><strong>{c.class_name}</strong><small>Room {c.room_number}</small></span>
                  <span className="cal-row__body"><strong>{c.marked_count}/{c.student_count} marked</strong><small>{c.subjects?.join(", ") || "Register"}</small></span>
                  <Pill tone={statusTone(c.submission_status)}>{statusLabel(c.submission_status)}</Pill>
                </Link>
              ))}</div> : null}
              {periods.length ? <div className="cal-list">{periods.map((s) => (
                <div className="cal-row" key={s.id}><span><strong>{clockLabel(s.starts_at)}</strong><small>P{s.period_number}</small></span><span className="cal-row__body"><strong>{s.subject_name}</strong><small>{s.class_name} · {s.room || "Room pending"}</small></span><span /></div>
              ))}</div> : <p className="cal-empty">No periods scheduled.</p>}
            </>}
            <div className="cal-actions"><Link className="cal-action" to={`/teacher/timetable?date=${cal.selected}`}><ClipboardList size={14} /> Day plan</Link><Link className="cal-action" to={`/teacher/attendance?date=${cal.selected}`}><ClipboardCheck size={14} /> Registers</Link></div>
          </div>
        } />
    </OperationsShell>
  );
}

/* ---------- Principal ---------- */
export function PrincipalCalendarRoute() {
  const cal = useCalendarState();
  const timetable = useQuery({ queryKey: ["principal-timetable"], queryFn: getPrincipalTimetable, staleTime: 5 * 60_000 });
  const home = useQuery({ queryKey: ["principal-home", cal.selected], queryFn: () => getPrincipalHome(cal.selected) });
  const weekdays = useMemo(() => new Set((timetable.data?.slots ?? []).map((s) => s.weekday)), [timetable.data]);
  const isSchoolDay = schoolDaysFrom(weekdays);
  const s = home.data?.summary;
  const open = home.data?.classes.filter((c) => c.submission_status !== "submitted" && c.submission_status !== "locked") ?? [];
  const past = cal.selected <= schoolDateToday();
  return (
    <OperationsShell portal="principal" active="more" title="Calendar" subtitle="School calendar">
      <CalendarView {...cal} onSelect={cal.select} marks={{}} isSchoolDay={isSchoolDay} subtitle={timetable.data ? `${timetable.data.classes.length} classes · ${weekdays.size}-day week` : undefined} legend={[]}
        detail={
          <div className="cal-detail">
            <DetailHead iso={cal.selected} sub={s ? `${s.classes_total} classes with registers due` : undefined} pill={s && past && s.classes_total ? <Pill tone={open.length ? "late" : "present"}>{open.length ? `${open.length} open` : "All submitted"}</Pill> : null} />
            {home.isPending ? <Loading>Loading the school day…</Loading> : s ? (
              <div className="cal-stats">
                <article><small>Attendance</small><strong>{s.marked ? `${s.attendance_percentage}%` : "—"}</strong><em>{s.marked ? `${s.attending} of ${s.marked} marked` : "nothing marked"}</em></article>
                <article><small>Registers</small><strong>{s.classes_submitted}/{s.classes_total}</strong><em>submitted</em></article>
                <article><small>Absent</small><strong>{s.absent}</strong><em>{s.late} late</em></article>
              </div>
            ) : null}
            {open.length && past ? <div className="cal-list">{open.slice(0, 6).map((c) => (
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
