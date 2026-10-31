import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { schoolDateToday } from "../../lib/schoolTime";
import { FollowupInbox } from "../coordination/FollowupInbox";
import { getResponsibilityAttendanceWorkspace } from "../operations/api";
import { WorkspaceLink } from "../workspace/WorkspaceLink";
import { RelationshipSurfaceResolver } from "../workspace/RelationshipSurfaceResolver";
import { ResponsibilityAttendanceWorkspace } from "./ResponsibilityAttendanceWorkspace";
import "./attendance-insight-routes.css";

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : schoolDateToday();
}

/**
 * Canonical family attendance conversation. The manifest relationship is the
 * navigation grant; the coordination API still re-checks the exact guardian ↔
 * learner relationship for every read and reply.
 */
export function WorkspaceAttendanceFollowupsRoute() {
  const [params] = useSearchParams();
  return <RelationshipSurfaceResolver areaKey="attendance" surfacePrefix="follow-ups" title="Attendance questions" backTo="/areas/attendance">
    {({ relationship, studentId }) => <ResponsibilityAttendanceWorkspace selection={{
      kind: "follow-ups",
      relationship,
      studentId,
    }}>
      <FollowupInbox
        context="guardian"
        studentId={studentId}
        initialFollowupId={params.get("followup") ?? undefined}
        showHeading={false}
      />
    </ResponsibilityAttendanceWorkspace>}
  </RelationshipSurfaceResolver>;
}

function AttendanceThresholdsContent() {
  const [params, setParams] = useSearchParams();
  const date = validDate(params.get("date"));
  const query = useQuery({
    queryKey: ["responsibility-attendance", "thresholds", date],
    queryFn: () => getResponsibilityAttendanceWorkspace("thresholds", date),
  });
  const records = query.data?.thresholds ?? [];
  const label = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${date}T12:00:00+05:30`));

  return <section className="attendance-patterns" aria-label="Learners below the configured attendance minimum">
    <label className="attendance-patterns__date">
      <span><CalendarDays size={17} aria-hidden="true" /> Records through</span>
      <TemporalInput
        type="date"
        value={date}
        onChange={(event) => {
          const next = new URLSearchParams(params);
          next.set("date", event.target.value);
          setParams(next, { replace: true });
        }}
      />
    </label>
    <p className="attendance-patterns__note">
      Term attendance through {label}. Only learners with at least five recorded days are included; missing records are not counted as absences.
    </p>
    {query.isPending ? <p className="attendance-patterns__state" role="status">Loading attendance patterns…</p> : null}
    {query.isError ? <div className="attendance-patterns__state" role="alert">
      <strong>Attendance patterns couldn’t load.</strong>
      <button type="button" onClick={() => void query.refetch()}>Try again</button>
    </div> : null}
    {!query.isPending && !query.isError && records.length === 0
      ? <div className="attendance-patterns__state"><strong>No learner is below the configured minimum in this scope.</strong></div>
      : null}
    {!query.isPending && !query.isError && records.length > 0 ? <ul className="attendance-patterns__list">
      {records.map((record) => <li key={record.id}>
        <WorkspaceLink
          href={`/areas/attendance/registers?class_section_id=${encodeURIComponent(record.class_section_id)}&date=${encodeURIComponent(date)}&student_id=${encodeURIComponent(record.id)}`}
          ariaLabel={`Review ${record.name}, ${record.percentage}% attendance`}
        >
          <span className="attendance-patterns__person">
            <strong>{record.name}</strong>
            <small>{record.class_name} · {record.admission_number}</small>
            <small>{record.recorded_days} recorded days</small>
          </span>
          <span className="attendance-patterns__score">
            <strong>{record.percentage}%</strong>
            <small>Minimum {record.threshold}%</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </WorkspaceLink>
      </li>)}
    </ul> : null}
  </section>;
}

/** Canonical scoped replacement for the old principal threshold page. */
export function WorkspaceAttendanceThresholdsRoute() {
  return <ResponsibilityAttendanceWorkspace selection={{ kind: "thresholds" }}>
    <AttendanceThresholdsContent />
  </ResponsibilityAttendanceWorkspace>;
}
