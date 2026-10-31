import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { ActivityPagination } from "./ActivityPagination";
import { activityInterval } from "./activityExperience";
import { getActivityRegisterHistoryActivities, getActivityRegisterHistoryEvidence,
  type ActivityRegister, type AttendanceHistoryActivity } from "./api";
import "./attendance-history.css";

export function attendanceHistoryStatus(value: string | null) {
  return value === null ? "Not recorded" : ({ half_day: "Half day", no_show: "No show", checked_out: "Checked out", left_early: "Left early" } as Record<string, string>)[value]
    ?? `${value.charAt(0).toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}
const defaultReasons = new Set(["Initial participation decision", "Explicit configured policy became due", "Explicit configured check-in acceptance",
  "Participant reported their own check-in", "Accepted own evidence under the explicitly approved institution rule"]);
const peopleLabel = (activity: AttendanceHistoryActivity) => activity.people_count === 1 && activity.person_name
  ? activity.person_name : `${activity.people_count} ${activity.people_count === 1 ? "person" : "people"}`;
export function attendanceActivityTitle(activity: AttendanceHistoryActivity) {
  const actor = activity.actor_name;
  const actions: Record<string, string> = { submit: "submitted the register", finalize: "finalized the register", reopen: "reopened the register for correction",
    evidence: "reported attendance evidence", evidence_review: "reviewed attendance evidence", self_report: "reported their own check-in", automatic_evidence: "accepted a reported check-in" };
  if (activity.action === "automatic_finalize") return `${actor} · Register finalized automatically`;
  if (actions[activity.action]) return `${actor} ${actions[activity.action]}`;
  if (activity.decision_count) {
    if (activity.correction_count) return `${actor} corrected attendance for ${peopleLabel(activity)}`;
    if (activity.note_count === activity.decision_count) return `${actor} updated ${activity.people_count === 1 ? "a note" : "notes"} for ${peopleLabel(activity)}`;
    const uniform = Object.entries(activity.status_counts).find(([, count]) => count === activity.people_count);
    if (activity.decision_count === activity.people_count && uniform) return `${actor} marked ${peopleLabel(activity)} ${attendanceHistoryStatus(uniform[0]).toLowerCase()}`;
    return `${actor} updated attendance for ${peopleLabel(activity)}`;
  }
  return `${actor} ${activity.action === "marks" ? "saved the register" : "recorded an attendance update"}`;
}
function historyTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function Evidence({ schoolId, registerId, activity, timeZone }: { schoolId: string; registerId: string; activity: AttendanceHistoryActivity; timeZone: string }) {
  const environment = useExecutionEnvironment();
  const [open, setOpen] = useState(false), [page, setPage] = useState(1);
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId, "history-evidence", registerId, activity.id, page]),
    queryFn: () => getActivityRegisterHistoryEvidence(schoolId, registerId, activity.id, page), enabled: open, retry: false });
  const denied = query.isError;
  return <details className="attendance-history-evidence" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{activity.people_count ? `View ${activity.people_count === 1 ? "person" : `${activity.people_count} people`} & evidence` : "View evidence"}</summary>
    {open ? query.isPending ? <p role="status">Loading individual evidence…</p> : denied ? <div role="alert"><p>Individual evidence could not be loaded.</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div> : <>
      <p className="attendance-history-caption">Original evidence for this activity. Counts above include the whole activity, not just this evidence page.</p>
      <ul>{query.data?.history.map(item => <li key={item.id}>
        <strong>{item.name ?? ({ submit: "Register submitted", marks: "Register saved", finalize: "Register finalized", reopen: "Register reopened" } as Record<string, string>)[item.action] ?? "Recorded action"}</strong>
        {item.person_id ? <p>{attendanceHistoryStatus(item.previous_status)} → {attendanceHistoryStatus(item.status)}</p> : null}
        {item.reason && (item.previous_status !== null || !defaultReasons.has(item.reason)) ? <p>{item.reason}</p> : null}
        {item.remarks ? <p>Note: {item.remarks}</p> : null}
        <details className="attendance-history-audit"><InfoSummary>Original record</InfoSummary><dl>
          <div><dt>Recorded by</dt><dd>{item.actor_name}</dd></div>
          <div><dt>Recorded at</dt><dd><time dateTime={item.recorded_at}>{historyTime(item.recorded_at, timeZone)}</time><br />{item.recorded_at_exact ?? item.recorded_at}</dd></div>
          {item.capture_channel ? <div><dt>Source</dt><dd>{item.capture_channel.replaceAll("_", " ")}</dd></div> : null}
          {item.observed_at ? <div><dt>Observed at</dt><dd>{item.observed_at_exact ?? item.observed_at}</dd></div> : null}
          {item.reason ? <div><dt>Original reason</dt><dd>{item.reason}</dd></div> : null}
          {item.previous_remarks ? <div><dt>Previous note</dt><dd>{item.previous_remarks}</dd></div> : null}
          <div><dt>Audit reference</dt><dd>{item.id}</dd></div><div><dt>Register revision</dt><dd>{item.register_revision}</dd></div>
        </dl></details>
      </li>)}</ul>
      <ActivityPagination page={query.data?.page ?? page} pages={query.data?.total_pages ?? 1} total={query.data?.total ?? 0}
        label="evidence entries" singularLabel="evidence entry" onPage={setPage} />
    </> : null}
  </details>;
}
export function ActivityRegisterHistory({ schoolId, register, onClose }: { schoolId: string; register: ActivityRegister["register"]; onClose: () => void }) {
  const environment = useExecutionEnvironment();
  const [page, setPage] = useState(1);
  const sessionDate = new Intl.DateTimeFormat("en", { timeZone: register.time_zone, day: "numeric", month: "short", year: "numeric" }).format(new Date(register.starts_at));
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["activities", schoolId, "history-activities", register.id, page]),
    queryFn: () => getActivityRegisterHistoryActivities(schoolId, register.id, page), retry: false });
  return <PlannerDialog title="Attendance history" onClose={onClose}><div className="attendance-history-stream">
    <header className="attendance-history-context"><p>{register.title} · {register.state === "locked" ? "Final" : register.state === "submitted" ? "Submitted" : "Draft"}</p>
      <p>{register.source_kind === "daily_class" ? `Daily register · ${sessionDate}`
        : `${sessionDate} · ${activityInterval(register.starts_at, register.ends_at, register.time_zone)}`}{register.place_label ? ` · ${register.place_label}` : ""}</p></header>
    {query.isPending ? <p role="status">Loading attendance activity…</p> : query.isError ? <div role="alert"><p>Attendance history could not be loaded.</p><button type="button" onClick={() => void query.refetch()}>Try again</button></div> : <>
      <ol>{query.data.activities.map(activity => {
        const statuses = Object.entries(activity.status_counts).filter(([, count]) => count > 0);
        return <li key={activity.id}>
          <strong>{attendanceActivityTitle(activity)}</strong>
          <time dateTime={activity.recorded_at}>{historyTime(activity.recorded_at, register.time_zone)}</time>
          {activity.decision_count === 1 && activity.correction_count ? <p>{attendanceHistoryStatus(activity.previous_status)} → {attendanceHistoryStatus(activity.status)}</p>
            : activity.decision_count > 0 && (statuses.length > 1 || activity.action === "submit") ? <p>Updated marks: {statuses.map(([status, count]) => `${count} ${attendanceHistoryStatus(status).toLowerCase()}`).join(" · ")}</p> : null}
          {activity.reason && (activity.correction_count > 0 || activity.action === "reopen" || !defaultReasons.has(activity.reason)) ? <p>{activity.reason}</p> : null}
          <Evidence schoolId={schoolId} registerId={register.id} activity={activity} timeZone={register.time_zone} />
        </li>;
      })}</ol>
      {!query.data.activities.length ? <p>No attendance activity has been saved yet.</p> : null}
      <ActivityPagination page={query.data.page} pages={query.data.total_pages} total={query.data.total} label="activities" singularLabel="activity" onPage={setPage} />
    </>}
  </div></PlannerDialog>;
}
