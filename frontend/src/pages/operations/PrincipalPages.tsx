import { PrincipalInsightsDashboard } from "../../features/principal-insights/PrincipalInsightsDashboard";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, CalendarDays, CheckCircle2 } from "lucide-react";
import type { PrincipalHomeResponse } from "../../features/operations/api";
import { OperationsShell } from "./OperationsShell";
import { AttendanceWorkspacePage } from "./AttendanceWorkspacePage";
import { FollowupInbox } from "../../features/coordination/FollowupInbox";
import { HomeActionDeck, HomeActionSpotlight } from "../../features/home-actions/HomeActionDeck";

export function PrincipalHomePage({ data, date, onDateChange }: { data: PrincipalHomeResponse; date: string; onDateChange: (date: string) => void }) {
  const coverage = data.summary.classes_total ? Math.round(data.summary.classes_submitted * 100 / data.summary.classes_total) : 100;
  const selectedDateLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00+05:30`));
  const [primaryAction, ...remainingActions] = data.home_actions ?? [];
  return <OperationsShell portal="principal" active="home" title="Overview">
    <div className="operations-stack principal-home">
      <section className="teacher-home__day principal-home__hero" aria-labelledby="principal-home-heading">
        <header>
          <div><h2 id="principal-home-heading">{selectedDateLabel}</h2></div>
          <label><span className="sr-only">Choose date</span><CalendarDays size={18} aria-hidden="true" /><input type="date" aria-label="Choose date" value={date} onChange={(event) => onDateChange(event.target.value)} /></label>
        </header>
        <div className="teacher-home__day-summary">
          <div>
            <strong>{data.summary.classes_total ? `${data.summary.classes_submitted} of ${data.summary.classes_total} registers` : "No registers due"}</strong>
            <span>{data.summary.classes_total ? `${data.summary.marked} of ${data.summary.students} students marked, ${data.summary.absent} absent and ${data.summary.late} late` : "No scheduled attendance is required for this date"}</span>
          </div>
          {data.summary.classes_total ? <b>{coverage}%</b> : <CheckCircle2 size={25} aria-label="Day clear" />}
        </div>
        {data.summary.classes_total ? <div className="teacher-home__progress" aria-label={`${coverage}% of class registers submitted`}><i style={{ width: `${coverage}%` }} /></div> : null}
        {primaryAction ? <HomeActionSpotlight action={primaryAction} tone="brand" /> : <div className="teacher-home__caught-up" role="status"><CheckCircle2 size={20} aria-hidden="true" /><span><strong>Operations are clear</strong><small>No school action needs your attention right now.</small></span></div>}
      </section>
      <PrincipalInsightsDashboard date={date} />
      <HomeActionDeck actions={remainingActions.slice(0, 4)} title="Later" variant="quiet" />
      <FollowupInbox context="staff" hideWithoutOpenFollowups />
      {data.exceptions.length ? <section className="operations-panel principal-exceptions"><header><h2>Attendance exceptions</h2><b>Minimum 5 recorded days</b></header><div>{data.exceptions.map((student) => <article key={student.id}><span className="exception-score">{student.percentage}%</span><span><strong>{student.name}</strong><small>{student.class_name} - {student.admission_number}</small></span><span><small>School threshold</small><strong>{student.threshold}%</strong></span></article>)}</div></section> : null}
      <section className="operations-panel principal-class-coverage"><header><h2>Class register coverage</h2><Link className="operations-action-link" to={`/principal/attendance?date=${date}`}>Attendance desk <ArrowRight size={15}/></Link></header>{data.classes.length ? <div className="principal-table"><div className="principal-table__head"><span>Class</span><span>Register</span><span>Attendance</span><span>Timetable</span><span/></div>{data.classes.map((item) => { const assignmentMismatch = item.submission_authorized === false; const scheduleMismatch = item.can_mark === false && (item.marked_count > 0 || item.submission_status !== "not_started"); const mismatch = assignmentMismatch || scheduleMismatch; return <article key={item.id}><span><strong>{item.name}</strong><small>{item.room_number || "Room pending"}</small></span><span><b className={`submission-chip is-${mismatch ? "upcoming" : item.can_mark === false ? "upcoming" : item.submission_status}`}>{assignmentMismatch ? "assignment mismatch" : scheduleMismatch ? "schedule mismatch" : item.can_mark === false ? "upcoming" : item.submission_status.replace("_", " ")}</b><small>{item.marked_count}/{item.student_count} marked</small></span><span><strong>{item.attendance_percentage}%</strong><small>{item.absent_count} absent - {item.late_count} late</small></span><span><strong>{item.timetable_slots} slots</strong><small>{item.unassigned_slots ? `${item.unassigned_slots} unassigned` : "Fully assigned"}</small></span>{item.can_mark === false && !mismatch ? <span className="teacher-class-list__inactive">Opens on this date</span> : <Link className="operations-action-link" to={`/principal/attendance?class_section_id=${item.id}&date=${date}`}>{mismatch ? "Review record" : "Review"} <ArrowRight size={15}/></Link>}</article>; })}</div> : <div className="operations-empty"><CalendarCheck size={24}/><div><strong>No class registers due</strong><p>The published timetable has no attendance-eligible lessons for this date.</p></div></div>}</section>
    </div>
  </OperationsShell>;
}

export function PrincipalAttendancePage({ data, date, onDateChange }: { data: PrincipalHomeResponse; date: string; onDateChange: (date: string) => void }) {
  return <AttendanceWorkspacePage portal="principal" classes={data.classes} date={date} onDateChange={onDateChange} />;
}
