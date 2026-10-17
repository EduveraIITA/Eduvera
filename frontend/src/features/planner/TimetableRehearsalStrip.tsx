import { ChevronRight, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import type { TimetableRehearsalIndicator } from "./rehearsal";
import "./timetable-rehearsal.css";

function rehearsalTime(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
}

function rehearsalNextStep(value: string | null) {
  if (!value) return "School day complete";
  const milliseconds = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Rehearsal updating";
  const seconds = Math.ceil(milliseconds / 1_000);
  return seconds < 60 ? `Next step in ${seconds} sec` : `Next step in ${Math.ceil(seconds / 60)} min`;
}

export function TimetableRehearsalStrip({
  rehearsal,
  showCampusLink = false,
}: {
  rehearsal: TimetableRehearsalIndicator;
  showCampusLink?: boolean;
}) {
  const current = rehearsalTime(rehearsal.simulatedAt, rehearsal.timeZone);
  return <section className={`planner-rehearsal planner-rehearsal--${rehearsal.status}`} aria-live="polite" aria-label={`${rehearsal.label}, read-only`}>
    <Clock3 aria-hidden="true" size={18} />
    <div className="planner-rehearsal__state">
      <strong>{rehearsal.label}<em>Read-only</em></strong>
      <span>{current ? `${current} · ` : ""}{rehearsal.phaseLabel}</span>
    </div>
    <span className="planner-rehearsal__next">{rehearsalNextStep(rehearsal.nextChangeAt)}</span>
    {showCampusLink ? <Link to={rehearsal.campusPath}>Campus View<ChevronRight aria-hidden="true" size={16} /></Link> : null}
  </section>;
}
