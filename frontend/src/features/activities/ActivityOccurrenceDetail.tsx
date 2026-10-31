import { Link } from "react-router-dom";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { activityInterval, purposeLabels } from "./activityExperience";
import type { ActivityOccurrence } from "./api";

export function ActivityOccurrenceDetail({ occurrence, planning, onClose }: { occurrence: ActivityOccurrence; planning: boolean; onClose: () => void }) {
  const owningAction = occurrence.source === "event" ? "Open event" : occurrence.source === "examination" ? "Open examination" : null;
  return <PlannerDialog title={occurrence.title} onClose={onClose}>
    <div className="activity-form">
      <dl className="activity-review">
        <div><dt>When</dt><dd>{occurrence.local_date} · {activityInterval(occurrence.starts_at, occurrence.ends_at, occurrence.timezone)}<small>{occurrence.timezone}</small></dd></div>
        <div><dt>Purpose</dt><dd>{purposeLabels[occurrence.purpose]}</dd></div>
        <div><dt>Place</dt><dd>{occurrence.space_label || occurrence.location_label || (occurrence.location_kind === "online" ? "Online" : "Not assigned")}</dd></div>
        <div><dt>Scheduled people in your scope</dt><dd>{occurrence.participants.map((person) => `${person.label}${person.attendance_expected === false ? " (activity lead, not on the attendance register)" : ""}`).join(", ") || "No scheduled people available in this scope"}</dd></div>
        <div><dt>Attendance</dt><dd>{occurrence.attendance_mode === "none" ? "Not required" : "Participant register"}</dd></div>
      </dl>
      {occurrence.location_url ? <a className="activity-text-button" href={occurrence.location_url} target="_blank" rel="noopener noreferrer">Open joining link</a> : null}
      <p>This is the published expectation. It does not prove presence or work completion.</p>
      {occurrence.state === "expected" && occurrence.teaching_session_href?.startsWith("/areas/timetable/session?") ? <Link className="activity-primary" to={occurrence.teaching_session_href}>Open session</Link> : null}
      {owningAction ? occurrence.source_href ? <Link className="activity-primary" to={occurrence.source_href}>{owningAction}</Link> : null
        : occurrence.source === "academic" ? <Link className="activity-primary" to={planning && occurrence.source_href ? occurrence.source_href : `/areas/timetable/schedule?${new URLSearchParams({ date: occurrence.local_date, source: "academic" })}`}>{planning ? "Open academic timetable" : "Open lesson details"}</Link>
          : occurrence.attendance_mode === "roll_call" && occurrence.can_open_register ? <Link className="activity-text-button" to={`/areas/attendance/registers?${new URLSearchParams({ date: occurrence.local_date, occurrence_id: occurrence.id })}`}>Open participant register</Link> : null}
    </div>
  </PlannerDialog>;
}
