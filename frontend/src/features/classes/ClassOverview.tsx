import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { clockLabel } from "../calendar/monthGrid";
import { getTeacherDay } from "../day-plans/api";
import type { TeacherAttendanceResponse, TeacherClassSummary } from "../operations/api";
import { ClassLoadState, classStatus } from "./classWorkspace";

export function ClassOverview({ cls, date, schoolId, canSeeTimetable, canRecord, register }: {
  cls: TeacherClassSummary; date: string; schoolId: string; canSeeTimetable: boolean; canRecord: boolean; register?: TeacherAttendanceResponse;
}) {
  const day = useQuery({ queryKey: ["school", "day-plans", "teacher", schoolId, date], queryFn: () => getTeacherDay(schoolId, date), enabled: canSeeTimetable && Boolean(schoolId) });
  const periods = day.data?.periods.filter(p => p.class_section_id === cls.class_section_id).sort((a, b) => a.period_number - b.period_number) ?? [];
  const canMark = canRecord && cls.can_mark !== false && register?.availability?.can_mark !== false && Boolean(register) && register?.register.state !== "locked";
  const status = register ? classStatus({ ...cls, submission_status: register.register.state === "draft" ? cls.submission_status : register.register.state }) : classStatus(cls);
  return <>
    <dl className="classes-facts classes-group">
      <div><dt>Your subjects</dt><dd>{cls.subjects?.filter(Boolean).join(", ") || "Not specified"}</dd></div>
      <div><dt>Room</dt><dd>{cls.room_number || "Not assigned"}</dd></div>
      <div><dt>Term</dt><dd>{cls.term_name} · {cls.academic_year}</dd></div>
      {register?.class.board ? <div><dt>Board</dt><dd>{register.class.board}</dd></div> : null}
      {cls.assigned_teachers?.length ? <div><dt>Teaching team</dt><dd>{cls.assigned_teachers.join(", ")}</dd></div> : null}
    </dl>
    <nav className="classes-group" aria-label="Class actions">
      <Link className="classes-action" to={`/teacher/attendance?class_section_id=${encodeURIComponent(cls.class_section_id)}&date=${date}`}><ClipboardCheck size={20} aria-hidden="true" /><span><strong>{canMark && cls.submission_status === "not_started" ? "Take attendance" : "Open register"}</strong><small>{status}</small></span><ChevronRight size={20} aria-hidden="true" /></Link>
      {canSeeTimetable ? <Link className="classes-action" to={`/teacher/timetable?date=${date}`}><CalendarDays size={20} aria-hidden="true" /><span>Your timetable</span><ChevronRight size={20} aria-hidden="true" /></Link> : null}
    </nav>
    {cls.availability_reason ? <p className="classes-caption">{cls.availability_reason}</p> : null}
    {canSeeTimetable && schoolId ? <section aria-labelledby="class-lessons-title">
      <h2 className="classes-section-title" id="class-lessons-title">Your lessons</h2>
      {day.isPending ? <ClassLoadState loading label="Loading lessons" /> : day.error ? <ClassLoadState label="Could not load lessons." retry={() => void day.refetch()} /> : !periods.length ? <p className="classes-empty">No lessons with this class on this date.</p> : <div className="classes-group">{periods.map(p => <article className="classes-lesson" key={p.id}>
        <div className="classes-lesson__time"><strong>P{p.period_number}</strong><span>{clockLabel(p.starts_at)}</span><span>{clockLabel(p.ends_at)}</span></div>
        <div><h3>{p.title}</h3><p>{[p.room, p.teacher_name].filter(Boolean).join(" · ")}</p>
          {p.cancelled ? <p className="classes-lesson__warning">Cancelled</p> : p.coverage_status === "pending" ? <p className="classes-lesson__warning">Cover pending</p> : p.coverage_status === "accepted" ? <p>Cover accepted</p> : null}
          {p.materials.length ? <p><strong>Bring:</strong> {p.materials.join(", ")}</p> : null}
          {p.notice ? <p className="classes-lesson__notice">{p.notice}</p> : null}
        </div>
      </article>)}</div>}
    </section> : null}
  </>;
}
