import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { schoolDateToday } from "../../lib/schoolTime";
import {
  getTeacherDay,
  getTeacherSummary,
  timeLabel,
  dateLabel,
  type DayPeriod,
} from "./api";
import { TimetableNavigator, timetableSummaryRange, readTimetableView, type TimetableView } from "../timetable/TimetableNavigator";
import { CoverageResponse } from "./CoverageResponse";
import "./day-plans.css";
export default function TeacherDayPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || schoolDateToday();
  const view = readTimetableView(params.get("view"));
  const setDate = (nextDate: string) => {
    const next = new URLSearchParams(params);
    next.set("date", nextDate);
    setParams(next);
  };
  const setView = (nextView: TimetableView) => {
    const next = new URLSearchParams(params);
    next.set("view", nextView);
    setParams(next);
  };
  const setSelection = (nextDate: string, nextView: TimetableView) => {
    const next = new URLSearchParams(params);
    next.set("date", nextDate);
    next.set("view", nextView);
    setParams(next);
  };
  return (
    <OperationsShell
      portal="teacher"
      active="timetable"
      title="Your teaching day"
      subtitle="Timetable"
      contentHasHeading
    >
      <div className="day-workspace">
        <h1 className="sr-only">My timetable</h1>
        <TeacherDayPanel date={date} view={view} onDateChange={setDate} onViewChange={setView} onNavigate={setSelection} />
      </div>
    </OperationsShell>
  );
}
export function TeacherDayPanel({
  date,
  view = "day",
  onDateChange,
  onViewChange,
  onNavigate,
  compact = false,
}: {
  date: string;
  view?: TimetableView;
  onDateChange?: (date: string) => void;
  onViewChange?: (view: TimetableView) => void;
  onNavigate?: (date: string, view: TimetableView) => void;
  compact?: boolean;
}) {
  const auth = useAuth(),
    client = useQueryClient();
  const schools = auth.memberships.filter((m) => m.role === "staff");
  const [selected, setSelected] = useState("");
  const schoolId = selected || schools[0]?.school_id || "";
  const [responding, setResponding] = useState<DayPeriod | null>(null);
  const query = useQuery({
    queryKey: ["school", "day-plans", "teacher", schoolId, date],
    queryFn: () => getTeacherDay(schoolId, date),
    enabled: !!schoolId,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["school", "day-plans"] });
  };
  const rows = query.data?.periods ?? [];
  const visible = compact
    ? rows.filter(
        (p) =>
          !p.cancelled && ["pending", "declined"].includes(p.coverage_status),
      )
    : rows;
  const schoolControl = schools.length > 1 ? (
    <label>
      <span className="sr-only">School</span>
      <select value={schoolId} onChange={(event) => setSelected(event.target.value)}>
        {schools.map((school) => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}
      </select>
    </label>
  ) : undefined;
  return (
    <>
      {!compact && onDateChange && onViewChange ? (
        <TeacherDateNavigator
          date={date}
          view={view}
          schoolId={schoolId}
          contextControl={schoolControl}
          onDateChange={onDateChange}
          onViewChange={onViewChange}
          onNavigate={onNavigate}
        />
      ) : null}
      {view !== "year" || compact ? <section className="day-panel">
        <header className="day-heading">
          <div>
            <span className="day-eyebrow">{dateLabel(date)}</span>
            <h2>
              {compact ? "Coverage requests" : "Published teaching schedule"}
            </h2>
          </div>
          {compact ? (
            <Link
              to={`/teacher/timetable?date=${date}`}
              className="day-secondary"
            >
              My day <ArrowRight size={15} />
            </Link>
          ) : null}
        </header>
        {compact ? schoolControl : null}
        {query.isPending ? (
          <div
            className="day-skeleton"
            role="status"
            aria-label="Loading teaching schedule"
          >
            <span />
            <span />
          </div>
        ) : query.isError ? (
          <div className="day-error" role="alert">
            <p>{query.error.message}</p>
            <button
              className="day-secondary"
              onClick={() => void query.refetch()}
            >
              Try again
            </button>
          </div>
        ) : visible.length ? (
          <ol className="day-teaching-list">
            {visible.map((p) => (
              <li key={p.id} className={p.cancelled ? "is-cancelled" : ""}>
                <div className="day-teaching-time">
                  <strong>{timeLabel(p.starts_at)}</strong>
                  <small>P{p.period_number}</small>
                </div>
                <div className="day-teaching-content">
                  <header>
                    <span className="day-eyebrow">{p.class_name}</span>
                    <span
                      className={`day-status is-${p.cancelled ? "cancelled" : p.coverage_status}`}
                    >
                      {p.cancelled
                        ? "Cancelled"
                        : p.coverage_status === "pending"
                          ? "Your response needed"
                          : p.coverage_status === "accepted"
                            ? "You accepted"
                            : p.coverage_status === "declined"
                              ? "Unavailable · school notified"
                              : "Scheduled"}
                    </span>
                  </header>
                  <h3>{p.title}</h3>
                  <div className="day-period-meta">
                    <span>
                      <Clock3 size={14} />
                      {timeLabel(p.starts_at)}-{timeLabel(p.ends_at)}
                    </span>
                    {p.room ? (
                      <span>
                        <MapPin size={14} />
                        {p.room}
                      </span>
                    ) : null}
                  </div>
                  {p.materials.length && !p.cancelled ? (
                    <p>Bring: {p.materials.join(" · ")}</p>
                  ) : null}
                  {p.notice ? <p className="day-muted">{p.notice}</p> : null}
                  {p.owner_name && p.coverage_status !== "not_required" ? (
                    <small className="day-muted">
                      Coordinated by {p.owner_name}
                    </small>
                  ) : null}
                  {!p.cancelled &&
                  ["pending", "declined", "accepted"].includes(
                    p.coverage_status,
                  ) &&
                  (date > (query.data?.context.today ?? date) ||
                    (date === query.data?.context.today &&
                      p.ends_at.slice(0, 5) >
                        query.data.context.local_time)) ? (
                    <div className="day-actions">
                      <button
                        className={
                          p.coverage_status === "pending"
                            ? "day-primary"
                            : "day-secondary"
                        }
                        onClick={() => setResponding(p)}
                      >
                        {p.coverage_status === "pending"
                          ? "Respond to assignment"
                          : "Update response"}
                      </button>
                    </div>
                  ) : null}
                  {!p.cancelled &&
                  p.slot_type !== "break" &&
                  ["not_required", "accepted"].includes(p.coverage_status) &&
                  date <= (query.data?.context.today ?? date) ? (
                    <div className="day-actions">
                      <Link
                        className="day-secondary"
                        to={`/teacher/attendance?class_section_id=${p.class_section_id}&date=${date}`}
                      >
                        Open class register <ArrowRight size={15} />
                      </Link>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="day-empty">
            <CalendarDays size={24} />
            <p>
              {compact
                ? "No coverage requests need your response."
                : "No teaching periods assigned for this date."}
            </p>
          </div>
        )}
        {responding ? (
          <CoverageResponse
            key={responding.id}
            schoolId={schoolId}
            period={rows.find((p) => p.id === responding.id) ?? responding}
            onClose={() => setResponding(null)}
            onSaved={refresh}
          />
        ) : null}
      </section> : null}
    </>
  );
}

function TeacherDateNavigator({
  date,
  view,
  schoolId,
  contextControl,
  onDateChange,
  onViewChange,
  onNavigate,
}: {
  date: string;
  view: TimetableView;
  schoolId: string;
  contextControl?: ReactNode;
  onDateChange: (date: string) => void;
  onViewChange: (view: TimetableView) => void;
  onNavigate?: (date: string, view: TimetableView) => void;
}) {
  const range = timetableSummaryRange(date, view);
  const summary = useQuery({
    queryKey: [
      "school",
      "day-plans",
      "teacher-summary",
      schoolId,
      range.start,
      range.end,
    ],
    queryFn: () => getTeacherSummary(schoolId, range.start, range.end),
    enabled: !!schoolId,
  });
  return (
    <TimetableNavigator
      date={date}
      view={view}
      summary={summary.data}
      loading={summary.isPending}
      error={summary.isError ? summary.error.message : undefined}
      contextLabel="My teaching schedule"
      contextControl={contextControl}
      onDateChange={onDateChange}
      onViewChange={onViewChange}
      onNavigate={onNavigate}
      onRetry={() => void summary.refetch()}
    />
  );
}
