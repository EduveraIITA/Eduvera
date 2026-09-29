import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  MapPin,
  X,
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
  type TeacherDaySummary,
} from "./api";
import {
  compactDayLabel,
  firstOfMonth,
  groupSummaryByMonth,
  monthDays,
  monthLabel,
  shortMonthLabel,
  summaryRange,
  visibleStrip,
  type TeacherCalendarView,
} from "./teacher-date-navigation";
import { CoverageResponse } from "./CoverageResponse";
import "./day-plans.css";
export default function TeacherDayPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || schoolDateToday();
  const setDate = (nextDate: string) => {
    const next = new URLSearchParams(params);
    next.set("date", nextDate);
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
        <TeacherDayPanel date={date} onDateChange={setDate} />
      </div>
    </OperationsShell>
  );
}
export function TeacherDayPanel({
  date,
  onDateChange,
  compact = false,
}: {
  date: string;
  onDateChange?: (date: string) => void;
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
  return (
    <>
      {!compact && onDateChange ? (
        <TeacherDateNavigator
          date={date}
          schoolId={schoolId}
          onDateChange={onDateChange}
        />
      ) : null}
      <section className="day-panel">
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
        {schools.length > 1 ? (
          <label>
            School
            <select
              value={schoolId}
              onChange={(e) => setSelected(e.target.value)}
            >
              {schools.map((s) => (
                <option key={s.school_id} value={s.school_id}>
                  {s.school_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
                      {timeLabel(p.starts_at)}–{timeLabel(p.ends_at)}
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
      </section>
    </>
  );
}

function TeacherDateNavigator({
  date,
  schoolId,
  onDateChange,
}: {
  date: string;
  schoolId: string;
  onDateChange: (date: string) => void;
}) {
  const [calendarView, setCalendarView] = useState<TeacherCalendarView | null>(
    null,
  );
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const centerSelectedDate = () => {
      const selected = strip.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) return;
      const item = selected.getBoundingClientRect();
      const container = strip.getBoundingClientRect();
      strip.scrollTo({
        left: strip.scrollLeft + item.left - container.left - (strip.clientWidth - item.width) / 2,
        behavior: "auto",
      });
    };
    centerSelectedDate();
    const observer = new ResizeObserver(centerSelectedDate);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [date]);
  const range = summaryRange(date, calendarView ?? "month");
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
  const days = summary.data?.days ?? [];
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const openCalendar = (view: TeacherCalendarView) => {
    setCalendarView((current) => (current === view ? null : view));
  };
  return (
    <div className="teacher-date-navigation">
      <div className="teacher-date-board">
        <div className="teacher-date-band">
          <p className="teacher-date-context">{monthLabel(date)}</p>
          <div className="teacher-day-strip" aria-label="Teaching days" ref={stripRef}>
            {visibleStrip(date).map((day) => (
              <DayStripButton
                key={day}
                day={day}
                active={day === date}
                summary={dayMap.get(day)}
                onDateChange={onDateChange}
              />
            ))}
          </div>
        </div>
        <div className="teacher-date-mode" role="group" aria-label="Calendar view">
          <Link to="/teacher/timetable/weekly">Week</Link>
          {(["month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={calendarView === option}
              aria-expanded={calendarView === option}
              aria-controls={calendarView === option ? "teacher-calendar-overview" : undefined}
              onClick={() => openCalendar(option)}
            >
              {option === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
      </div>
      {calendarView ? (
        <div className="teacher-calendar-overview" id="teacher-calendar-overview">
          <header className="teacher-calendar-dialog-header">
            <div>
              <span className="day-eyebrow">
                {calendarView === "month" ? "Monthly view" : "Yearly view"}
              </span>
              <h2>
                {calendarView === "month"
                  ? monthLabel(date)
                  : `${date.slice(0, 4)} overview`}
              </h2>
            </div>
            <button
              className="day-icon-button"
              type="button"
              aria-label="Close calendar view"
              onClick={() => setCalendarView(null)}
            >
              <X size={18} />
            </button>
          </header>
          {summary.isPending ? (
            <div className="day-skeleton" role="status" aria-label="Loading teaching totals">
              <span />
              <span />
            </div>
          ) : summary.isError ? (
            <div className="day-error" role="alert">
              <p>{summary.error.message}</p>
              <button
                className="day-secondary"
                type="button"
                onClick={() => void summary.refetch()}
              >
                Reload calendar
              </button>
            </div>
          ) : calendarView === "month" ? (
            <TeacherMonthView
              date={date}
              summary={summary.data}
              onDateChange={(nextDate) => {
                onDateChange(nextDate);
                setCalendarView(null);
              }}
            />
          ) : (
            <TeacherYearView
              date={date}
              summary={summary.data}
              onDateChange={(nextDate) => {
                onDateChange(nextDate);
                setCalendarView(null);
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function DayStripButton({
  day,
  active,
  summary,
  onDateChange,
}: {
  day: string;
  active: boolean;
  summary?: TeacherDaySummary["days"][number];
  onDateChange: (date: string) => void;
}) {
  const label = compactDayLabel(day);
  return (
    <button
      className="teacher-day-chip"
      type="button"
      aria-pressed={active}
      aria-label={`${dateLabel(day)}${summary ? `, ${summary.periods} periods` : ""}`}
      onClick={() => onDateChange(day)}
    >
      <span>{label.weekday}</span>
      <strong>{label.day}</strong>
      <small>{summary ? summary.periods ? `${summary.periods} periods` : "Free" : "…"}</small>
      {summary?.pending ? <i>{summary.pending}</i> : null}
    </button>
  );
}

function TeacherMonthView({
  date,
  summary,
  onDateChange,
}: {
  date: string;
  summary?: TeacherDaySummary;
  onDateChange: (date: string) => void;
}) {
  const dayMap = new Map((summary?.days ?? []).map((day) => [day.date, day]));
  const days = monthDays(date);
  return (
    <div className="teacher-calendar-panel">
      <header>
        <span>{monthLabel(date)}</span>
        <strong>{summary?.totals.periods ?? 0} periods</strong>
      </header>
      <div className="teacher-month-grid" aria-label="Monthly teaching load">
        {days.map((day) => {
          const item = dayMap.get(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={day === date}
              onClick={() => onDateChange(day)}
            >
              <span>{day.slice(-2)}</span>
              <strong>{item?.periods ?? 0}</strong>
              {item?.pending ? <i>{item.pending}</i> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeacherYearView({
  date,
  summary,
  onDateChange,
}: {
  date: string;
  summary?: TeacherDaySummary;
  onDateChange: (date: string) => void;
}) {
  const months = groupSummaryByMonth(summary?.days ?? []);
  const max = Math.max(1, ...months.map((month) => month.periods));
  return (
    <div className="teacher-calendar-panel">
      <header>
        <span>{date.slice(0, 4)} overview</span>
        <strong>{summary?.totals.periods ?? 0} periods</strong>
      </header>
      <div className="teacher-year-grid" aria-label="Yearly teaching load">
        {months.map((month) => (
          <button
            key={month.month}
            type="button"
            aria-pressed={date.startsWith(month.month)}
            onClick={() => onDateChange(firstOfMonth(`${month.month}-01`))}
          >
            <span>{shortMonthLabel(month.month)}</span>
            <strong>{month.periods}</strong>
            <em
              className={`is-load-${Math.max(1, Math.ceil((month.periods / max) * 10))}`}
            />
            {month.pending ? <i>{month.pending}</i> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
