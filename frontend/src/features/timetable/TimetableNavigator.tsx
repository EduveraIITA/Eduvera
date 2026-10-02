import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { dateLabel, type TeacherDaySummary } from "../day-plans/api";
import {
  addSchoolDays,
  compactDayLabel,
  eachDate,
  firstOfMonth,
  groupSummaryByMonth,
  monthDays,
  monthLabel,
  parseSchoolDate,
  shortMonthLabel,
  visibleStrip,
} from "../day-plans/teacher-date-navigation";
import "../day-plans/day-plans.css";

export type TimetableView = "day" | "week" | "month" | "year";
export type TimetableSummary = TeacherDaySummary;

function summaryErrorMessage(message?: string) {
  if (!message) return undefined;
  if (/Cannot GET|404|not found/i.test(message)) {
    return "The timetable overview is updating. The selected day remains available below.";
  }
  return "The timetable overview could not be loaded. The selected day remains available below.";
}

export function timetableSummaryRange(date: string, view: TimetableView) {
  if (view === "year") {
    return { start: `${date.slice(0, 4)}-01-01`, end: `${date.slice(0, 4)}-12-31` };
  }
  const monthStart = firstOfMonth(date);
  const monthEnd = monthDays(date).at(-1) ?? date;
  const strip = visibleStrip(date);
  return {
    start: (strip[0] ?? monthStart) < monthStart ? strip[0]! : monthStart,
    end: (strip.at(-1) ?? monthEnd) > monthEnd ? strip.at(-1)! : monthEnd,
  };
}

function weekDates(date: string) {
  const selected = parseSchoolDate(date);
  const offset = (selected.getUTCDay() + 6) % 7;
  const monday = addSchoolDays(date, -offset);
  return eachDate(monday, addSchoolDays(monday, 6));
}

interface TimetableNavigatorProps {
  date: string;
  view: TimetableView;
  summary?: TimetableSummary;
  loading?: boolean;
  error?: string;
  contextLabel?: string;
  contextControl?: ReactNode;
  onDateChange: (date: string) => void;
  onViewChange: (view: TimetableView) => void;
  onRetry?: () => void;
}

export function TimetableNavigator({
  date,
  view,
  summary,
  loading,
  error,
  contextLabel = "Published timetable",
  contextControl,
  onDateChange,
  onViewChange,
  onRetry,
}: TimetableNavigatorProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const center = () => {
      const selected = strip.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!selected) return;
      const left =
        strip.scrollLeft +
        selected.offsetLeft -
        (strip.clientWidth - selected.clientWidth) / 2;
      if (typeof strip.scrollTo === "function") strip.scrollTo({ left, behavior: "auto" });
      else strip.scrollLeft = left;
    };
    center();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(center);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [date]);

  const dayMap = new Map((summary?.days ?? []).map((day) => [day.date, day]));
  const overviewId = "timetable-period-overview";
  return (
    <section className="teacher-date-navigation" aria-label="Timetable period">
      <div className="teacher-date-board">
        <div className="teacher-date-band">
          {contextControl ? (
            <div className="teacher-date-context teacher-date-context--control">
              <span>{monthLabel(date)}</span>
              {contextControl}
            </div>
          ) : (
            <p className="teacher-date-context">{monthLabel(date)} · {contextLabel}</p>
          )}
          <div className="teacher-day-strip" aria-label="Choose date" ref={stripRef}>
            {visibleStrip(date).map((day) => {
              const label = compactDayLabel(day);
              const item = dayMap.get(day);
              return (
                <button
                  className="teacher-day-chip"
                  key={day}
                  type="button"
                  aria-pressed={day === date}
                  aria-label={`${dateLabel(day)}${item ? `, ${item.periods} periods` : ""}`}
                  onClick={() => onDateChange(day)}
                >
                  <span>{label.weekday}</span>
                  <strong>{label.day}</strong>
                  <small>{item ? (item.periods ? `${item.periods} periods` : "Free") : "…"}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="teacher-date-mode timetable-view-switcher" role="tablist" aria-label="Timetable view">
          {(["day", "week", "month", "year"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              aria-pressed={view === option}
              aria-controls={view === option && option !== "day" ? overviewId : undefined}
              onClick={() => onViewChange(option)}
            >
              {option[0]?.toUpperCase()}{option.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {view !== "day" ? (
        <div className="teacher-calendar-overview" id={overviewId}>
          <header className="teacher-calendar-dialog-header">
            <div>
              <span className="day-eyebrow">{view} view</span>
              <h2>{view === "year" ? `${date.slice(0, 4)} overview` : view === "month" ? monthLabel(date) : "Selected week"}</h2>
            </div>
            <button className="day-icon-button" type="button" aria-label="Return to day view" onClick={() => onViewChange("day")}>
              <X size={18} />
            </button>
          </header>
          {loading ? (
            <div className="day-skeleton" role="status" aria-label="Loading timetable totals"><span /><span /></div>
          ) : error ? (
            <div className="day-error" role="alert"><p>{summaryErrorMessage(error)}</p>{onRetry ? <button className="day-secondary" type="button" onClick={onRetry}>Reload timetable</button> : null}</div>
          ) : view === "week" ? (
            <WeekOverview date={date} summary={summary} onDateChange={onDateChange} />
          ) : view === "month" ? (
            <MonthOverview date={date} summary={summary} onDateChange={onDateChange} />
          ) : (
            <YearOverview date={date} summary={summary} onDateChange={onDateChange} />
          )}
        </div>
      ) : null}
    </section>
  );
}

function WeekOverview({ date, summary, onDateChange }: { date: string; summary?: TimetableSummary; onDateChange: (date: string) => void }) {
  const dayMap = new Map((summary?.days ?? []).map((day) => [day.date, day]));
  const days = weekDates(date);
  const total = days.reduce((sum, day) => sum + (dayMap.get(day)?.periods ?? 0), 0);
  return (
    <div className="teacher-calendar-panel">
      <header><span>{dateLabel(days[0] ?? date)} - {dateLabel(days.at(-1) ?? date)}</span><strong>{total} periods</strong></header>
      <div className="timetable-week-overview" aria-label="Weekly timetable load">
        {days.map((day) => {
          const item = dayMap.get(day);
          const label = compactDayLabel(day);
          return <button key={day} type="button" aria-pressed={day === date} onClick={() => onDateChange(day)}><span>{label.weekday}</span><strong>{label.day}</strong><small>{item?.periods ? `${item.periods} periods` : "Free"}</small></button>;
        })}
      </div>
    </div>
  );
}

function MonthOverview({ date, summary, onDateChange }: { date: string; summary?: TimetableSummary; onDateChange: (date: string) => void }) {
  const dayMap = new Map((summary?.days ?? []).map((day) => [day.date, day]));
  const days = monthDays(date);
  const total = days.reduce((sum, day) => sum + (dayMap.get(day)?.periods ?? 0), 0);
  return (
    <div className="teacher-calendar-panel">
      <header><span>{monthLabel(date)}</span><strong>{total} periods</strong></header>
      <div className="teacher-month-grid" aria-label="Monthly timetable load">
        {days.map((day) => { const item = dayMap.get(day); return <button key={day} type="button" aria-pressed={day === date} onClick={() => onDateChange(day)}><span>{day.slice(-2)}</span><strong>{item?.periods ?? 0}</strong></button>; })}
      </div>
    </div>
  );
}

function YearOverview({ date, summary, onDateChange }: { date: string; summary?: TimetableSummary; onDateChange: (date: string) => void }) {
  const months = groupSummaryByMonth(summary?.days ?? []);
  const max = Math.max(1, ...months.map((month) => month.periods));
  return (
    <div className="teacher-calendar-panel">
      <header><span>{date.slice(0, 4)} overview</span><strong>{summary?.totals.periods ?? 0} periods</strong></header>
      <div className="teacher-year-grid" aria-label="Yearly timetable load">
        {months.map((month) => <button key={month.month} type="button" aria-pressed={date.startsWith(month.month)} onClick={() => onDateChange(`${month.month}-01`)}><span>{shortMonthLabel(month.month)}</span><strong>{month.periods}</strong><em className={`is-load-${Math.max(1, Math.ceil((month.periods / max) * 10))}`} /></button>)}
      </div>
    </div>
  );
}
