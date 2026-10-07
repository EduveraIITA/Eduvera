import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, CalendarDays, ChevronDown, ChevronUp, ClipboardCheck, MapPin, Megaphone, Package, StickyNote, Users } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { apiFetch } from "../../lib/api";
import { schoolDateToday, shiftSchoolDate } from "../../lib/schoolTime";
import { useAuth } from "../auth/AuthContext";
import { Pill } from "../calendar/CalendarView";
import { clockLabel } from "../calendar/monthGrid";
import { getTeacherDay, type TeacherDay } from "../day-plans/api";
import { getTeacherAttendance, getTeacherHome, type TeacherClassSummary, type TeacherRosterStudent } from "../operations/api";
import type { ApiDiaryItem } from "../school/api";
import "./classes.css";

type Tab = "students" | "materials" | "notes";
type Period = TeacherDay["periods"][number];

const statusLabel = (s: TeacherClassSummary["submission_status"]) => s === "submitted" ? "Submitted" : s === "locked" ? "Locked" : s === "in_progress" ? "In progress" : "Not started";
const statusTone = (s: TeacherClassSummary["submission_status"]) => s === "submitted" || s === "locked" ? "present" : s === "in_progress" ? "late" : "neutral";
const markClass = (s: TeacherRosterStudent["status"]) => s === "present" ? "present" : s === "absent" ? "absent" : s === "late" || s === "half_day" ? "late" : s === "excused" ? "excused" : "unmarked";
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));

/* The class diary is enrolment-scoped, so any student in the class returns the
   class's homework, notes and announcements; staff may read it for their school. */
const classDiary = (studentId: string, from: string, to: string) =>
  apiFetch<{ results: ApiDiaryItem[] }>(`/api/v1/diary/?${new URLSearchParams({ student_id: studentId, date_from: from, date_to: to })}`);

/* Photo-gallery roster: one rounded portrait per student, ring coloured by today's mark. */
function Gallery({ roster }: { roster: TeacherRosterStudent[] }) {
  const counts = roster.reduce((acc, s) => { const k = markClass(s.status); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return (
    <div className="cls-section">
      <div className="cls-roster__summary">
        <span><i className="cal-dot cal-dot--present" />{counts.present ?? 0} present</span>
        <span><i className="cal-dot cal-dot--late" />{counts.late ?? 0} late</span>
        <span><i className="cal-dot cal-dot--absent" />{counts.absent ?? 0} absent</span>
        <span><i className="cal-dot cal-dot--excused" />{counts.excused ?? 0} excused</span>
        {counts.unmarked ? <span><i className="cal-dot" />{counts.unmarked} unmarked</span> : null}
      </div>
      <ul className="cls-gallery" aria-label="Students">
        {[...roster].sort((a, b) => a.roll_number - b.roll_number).map((s) => (
          <li key={s.id} className={`cls-portrait cls-portrait--${markClass(s.status)}`} title={`${s.name} · ${s.status ? s.status.replace("_", " ") : "not marked"}`}>
            <span className="cls-portrait__ring"><span className="cls-portrait__photo">{s.avatar_url ? <img src={s.avatar_url} alt="" loading="lazy" /> : initials(s.name)}</span><b>{s.roll_number}</b></span>
            <strong>{s.name}</strong>
            <small>{s.status ? s.status.replace("_", " ") : "not marked"}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Today's periods for this class from the published day plan: materials, notices, cover. */
function Materials({ periods, planned }: { periods: Period[]; planned: boolean }) {
  if (!planned) return <p className="cls-roster__note">No day plan published for this class on this date.</p>;
  if (!periods.length) return <p className="cls-roster__note">This class has no periods with you on this date.</p>;
  return (
    <div className="cls-section">
      {periods.map((p) => (
        <article className={`cls-period${p.cancelled ? " is-cancelled" : ""}`} key={p.id}>
          <div className="cls-period__head">
            <span><strong>{clockLabel(p.starts_at)}</strong><small>P{p.period_number}</small></span>
            <span className="cls-period__title"><strong>{p.title}</strong><small>{[p.room, p.teacher_name].filter(Boolean).join(" · ")}{p.cancelled ? " · cancelled" : ""}</small></span>
            {p.coverage_status === "pending" ? <Pill tone="late">Cover pending</Pill> : p.coverage_status === "accepted" ? <Pill tone="present">Cover accepted</Pill> : null}
          </div>
          {p.materials.length ? <ul className="cls-materials">{p.materials.map((m, i) => <li key={i}><Package size={12} />{m}</li>)}</ul> : <p className="cls-period__none">No materials listed.</p>}
          {p.notice ? <p className="cls-period__notice"><Megaphone size={12} /> {p.notice}</p> : null}
        </article>
      ))}
    </div>
  );
}

/* Class notes: the diary entries posted to this class in the last two weeks. */
function Notes({ items }: { items: ApiDiaryItem[] }) {
  if (!items.length) return <p className="cls-roster__note">Nothing posted to this class in the last two weeks.</p>;
  const icon = (t: ApiDiaryItem["item_type"]) => t === "homework" ? BookOpen : t === "announcement" ? Megaphone : StickyNote;
  return (
    <div className="cls-section">
      {[...items].sort((a, b) => (a.date < b.date ? 1 : -1)).map((d) => { const Icon = icon(d.item_type); return (
        <article className={`cls-note cls-note--${d.item_type}`} key={d.id}>
          <span className="cls-note__icon"><Icon size={16} /></span>
          <div className="cls-note__body">
            <div className="cls-note__top"><strong>{d.title}</strong><small>{fmtDay(d.date)}</small></div>
            <small>{[d.item_type_label, d.subject?.name, d.author_name].filter(Boolean).join(" · ")}{d.due_at ? ` · due ${fmtDay(d.due_at)}` : ""}</small>
            {d.body ? <p>{d.body}</p> : null}
            {d.requires_acknowledgement ? <em>{d.acknowledged ? "Acknowledged at home" : "Awaiting acknowledgement"}</em> : null}
          </div>
        </article>
      ); })}
    </div>
  );
}

function ClassDetail({ cls, date, periods, planned }: { cls: TeacherClassSummary; date: string; periods: Period[]; planned: boolean }) {
  const [tab, setTab] = useState<Tab>("students");
  const roster = useQuery({ queryKey: ["teacher-attendance", cls.class_section_id, date], queryFn: () => getTeacherAttendance(cls.class_section_id, date) });
  const anchor = roster.data?.roster[0]?.id;
  const notes = useQuery({ queryKey: ["class-diary", cls.class_section_id, date], enabled: Boolean(anchor), queryFn: () => classDiary(anchor!, shiftSchoolDate(-14, date), date) });
  const materialCount = periods.reduce((n, p) => n + p.materials.length, 0);
  return (
    <div className="cls-detail">
      <div className="cls-tabs" role="tablist" aria-label={`${cls.class_name} sections`}>
        <button type="button" role="tab" aria-selected={tab === "students"} onClick={() => setTab("students")}><Users size={14} /> Students <b>{cls.student_count}</b></button>
        <button type="button" role="tab" aria-selected={tab === "materials"} onClick={() => setTab("materials")}><Package size={14} /> Materials <b>{materialCount}</b></button>
        <button type="button" role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}><StickyNote size={14} /> Notes <b>{notes.data?.results.length ?? "…"}</b></button>
      </div>
      {tab === "students" ? (roster.isPending ? <p className="cls-roster__note" role="status">Loading students…</p> : roster.error || !roster.data ? <p className="cls-roster__note" role="alert">Could not load the roster.</p> : <Gallery roster={roster.data.roster} />)
        : tab === "materials" ? <Materials periods={periods} planned={planned} />
        : notes.isPending && anchor ? <p className="cls-roster__note" role="status">Loading notes…</p> : <Notes items={notes.data?.results ?? []} />}
    </div>
  );
}

/* My classes: every class the teacher is responsible for on a date. Each card
   opens into the room: who is there, what to bring, what was posted. */
export default function TeacherClassesPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? schoolDateToday();
  const [openId, setOpenId] = useState<string | null>(null);
  const schoolId = auth.memberships.find((m) => m.role === "staff")?.school_id ?? "";
  const home = useQuery({ queryKey: ["teacher-home", date], queryFn: () => getTeacherHome(date) });
  const day = useQuery({ queryKey: ["school", "day-plans", "teacher", schoolId, date], queryFn: () => getTeacherDay(schoolId, date), enabled: Boolean(schoolId) });
  const setDate = (next: string) => { const updated = new URLSearchParams(params); updated.set("date", next); setParams(updated); setOpenId(null); };
  const classes = home.data?.classes ?? [];
  const students = classes.reduce((n, c) => n + Number(c.student_count), 0);
  const periodsFor = (classId: string) => (day.data?.periods ?? []).filter((p) => p.class_section_id === classId).sort((a, b) => a.period_number - b.period_number);
  const isPlanned = (classId: string) => (day.data?.periods ?? []).some((p) => p.class_section_id === classId && p.day_plan_id);

  return (
    <OperationsShell portal="teacher" active="more" title="My classes" subtitle={home.data ? `${home.data.teacher.name} - Class view` : "Class view"}>
      <div className="operations-stack">
        <section className="operations-hero operations-hero--teacher">
          <div>
            <span>Assigned classes</span>
            <h2>{home.isPending ? "Loading…" : `${classes.length} ${classes.length === 1 ? "class" : "classes"} · ${students} students`}</h2>
          </div>
          <label>Date<input type="date" value={date} max={schoolDateToday()} onChange={(e) => setDate(e.target.value)} /></label>
        </section>

        {home.isPending ? <p className="cls-empty" role="status">Loading your classes…</p>
          : home.error ? <p className="cls-empty" role="alert">{home.error.message}</p>
          : classes.length === 0 ? <section className="operations-panel"><div className="cls-empty">No classes on this date. Pick another day above.</div></section>
          : (
            <section className="cls-list" aria-label="Your classes">
              {classes.map((c) => {
                const open = openId === c.class_section_id;
                const periods = periodsFor(c.class_section_id);
                return (
                  <article className={`operations-panel cls-card${open ? " is-open" : ""}`} key={c.class_section_id}>
                    <button type="button" className="cls-card__head" aria-expanded={open} onClick={() => setOpenId(open ? null : c.class_section_id)}>
                      <span className="cls-card__badge">{c.grade}{c.section}</span>
                      <span className="cls-card__title">
                        <strong>{c.class_name}</strong>
                        <small><MapPin size={11} /> Room {c.room_number || "TBD"}{c.subjects?.length ? ` · ${c.subjects.join(", ")}` : ""}{c.assignment_kind === "substitute" ? " · cover" : ""}</small>
                      </span>
                      <Pill tone={statusTone(c.submission_status)}>{statusLabel(c.submission_status)}</Pill>
                      {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    <div className="cls-card__stats">
                      <span><Users size={13} /> {c.student_count} students</span>
                      <span><ClipboardCheck size={13} /> {c.marked_count} marked · {c.attending_count} present · {c.absent_count} absent</span>
                      {periods.length ? <span><CalendarDays size={13} /> {periods.map((p) => `P${p.period_number} ${clockLabel(p.starts_at)}`).join(", ")}</span> : null}
                    </div>
                    <div className="cls-card__actions">
                      <Link className="cal-action" to={`/teacher/attendance?class_section_id=${encodeURIComponent(c.class_section_id)}&date=${date}`}><ClipboardCheck size={14} /> {c.submission_status === "not_started" ? "Take attendance" : "Open register"}</Link>
                      <Link className="cal-action" to={`/teacher/timetable?date=${date}`}><CalendarDays size={14} /> Day plan <ArrowRight size={12} /></Link>
                    </div>
                    {open ? <ClassDetail cls={c} date={date} periods={periods} planned={isPlanned(c.class_section_id)} /> : null}
                  </article>
                );
              })}
            </section>
          )}
      </div>
    </OperationsShell>
  );
}
