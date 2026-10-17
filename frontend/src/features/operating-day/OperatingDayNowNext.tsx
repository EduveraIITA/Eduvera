import { ArrowRight, Clock3, DoorOpen, MapPin, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { OperatingDayProjection, OperatingDaySession } from "../operations/api";
import "./operating-day.css";

function localTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));
}

function SessionRow({ session, timeZone }: { session: OperatingDaySession; timeZone: string }) {
  const content = <>
    <time>{localTime(session.starts_at, timeZone)}</time>
    <span>
      <strong>{session.subject_label || session.title}</strong>
      <small>
        {session.class_label}
        {session.space_label ? <><MapPin size={12} aria-hidden="true" />{session.space_label}</> : null}
        {session.teacher ? <><UserRound size={12} aria-hidden="true" />{session.teacher.label}</> : null}
      </small>
    </span>
    {session.target_path ? <ArrowRight size={17} aria-hidden="true" /> : null}
  </>;
  return session.target_path
    ? <Link className="operating-day__session" to={session.target_path}>{content}</Link>
    : <div className="operating-day__session">{content}</div>;
}

export function OperatingDayNowNext({ day, showCampus = false }: { day?: OperatingDayProjection | null; showCampus?: boolean }) {
  if (!day) return null;
  const focus = day.now.length ? day.now : day.next;
  const heading = day.now.length ? "Happening now" : day.next.length ? "Up next" : "Teaching day complete";
  return <section className="operating-day" aria-labelledby="operating-day-heading">
    <header>
      <span className={`operating-day__environment is-${day.environment.kind}`}>{day.environment.label}</span>
      <div>
        <Clock3 size={17} aria-hidden="true" />
        <h2 id="operating-day-heading">{heading}</h2>
      </div>
      <small>Updated {localTime(day.as_of, day.institution.timezone)}</small>
    </header>
    {focus.length ? <div className="operating-day__sessions">{focus.map((session) => <SessionRow key={session.id} session={session} timeZone={day.institution.timezone} />)}</div> : (
      <p className="operating-day__empty">No more scheduled sessions for this day.</p>
    )}
    <footer>
      <span><strong>{day.summary.completed_sessions}/{day.summary.scheduled_sessions}</strong><small>sessions complete</small></span>
      <span><strong>{day.summary.registers_submitted}/{day.summary.registers_expected}</strong><small>registers submitted</small></span>
      {showCampus ? <span><strong><DoorOpen size={14} /> {day.summary.gate_entries} in · {day.summary.gate_exits} out</strong><small>accepted gate records</small></span> : null}
    </footer>
    {day.contradictions.length ? <Link className="operating-day__review" to="/principal/campus?panel=activity">
      {day.contradictions.length} cross-check {day.contradictions.length === 1 ? "needs" : "need"} review <ArrowRight size={15} />
    </Link> : null}
  </section>;
}
