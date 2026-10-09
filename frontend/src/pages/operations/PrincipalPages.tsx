import { ArrowRight, ChevronDown } from "lucide-react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { PrincipalHomeResponse } from "../../features/operations/api";
import { PrincipalHomeOverview } from "../../features/principal-home/PrincipalHomeOverview";
import { schoolDateToday } from "../../lib/schoolTime";
import { OperationsShell } from "./OperationsShell";
import { AttendanceWorkspacePage } from "./AttendanceWorkspacePage";
import "../../features/principal-home/principal-home.css";

export function PrincipalHomePage({ data, date, onDateChange }: { data: PrincipalHomeResponse; date: string; onDateChange: (date: string) => void }) {
  const location = useLocation();
  // Preserve existing notification and saved conversation links.
  if (location.hash === "#attendance-followups") return <Navigate to={`/principal/followups?date=${date}`} replace />;
  const { classes_total: total, classes_submitted: submitted, students, marked, absent, late } = data.summary;
  const today = schoolDateToday();
  const dateLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "long" }).format(new Date(`${date}T12:00:00+05:30`));
  return <OperationsShell portal="principal" active="home" title="Overview">
    <div className="operations-stack principal-home principal-home--focused">
      <div className="principal-home__toolbar">
        <div className="principal-home__date-controls">
          <label><span>{dateLabel}</span><ChevronDown size={15} aria-hidden="true" /><input type="date" aria-label="Choose date" value={date} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} /></label>
          {date !== today ? <button type="button" onClick={() => onDateChange(today)}>Today</button> : null}
        </div>
        <Link to={`/principal/timetable?date=${date}&from=overview`}>Timetable<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      <section className="teacher-home__day principal-home__snapshot" aria-label={`Daily snapshot for ${dateLabel}`}>
        {total ? <dl>
          <div><dt>Students marked</dt><dd>{marked}<span> / {students}</span></dd></div>
          <div><dt>Registers submitted</dt><dd>{submitted}<span> / {total}</span></dd></div>
        </dl> : <p>No registers due for this date.</p>}
        {marked > 0 ? <p>{absent} absent · {late} late in marked records</p> : null}
      </section>
      <PrincipalHomeOverview data={data} date={date} />
    </div>
  </OperationsShell>;
}

export function PrincipalAttendancePage({ data, date, onDateChange }: { data: PrincipalHomeResponse; date: string; onDateChange: (date: string) => void }) {
  return <AttendanceWorkspacePage portal="principal" classes={data.classes} date={date} onDateChange={onDateChange} />;
}
