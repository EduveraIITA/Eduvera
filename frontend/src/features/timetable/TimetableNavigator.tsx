import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";

import { dateLabel, type TeacherDaySummary } from "../day-plans/api";
import { schoolDateToday } from "../../lib/schoolTime";
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
  onNavigate?: (date: string, view: TimetableView) => void;
  onRetry?: () => void;
  today?: string;
}

function compactCurrentDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(parseSchoolDate(date));
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
  onNavigate,
  onRetry,
  today = schoolDateToday(),
}: TimetableNavigatorProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const center = () => {
      const selected = strip.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!selected) return;
      const left =
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
  const navigate = (nextDate: string, nextView: TimetableView) => {
    if (onNavigate) onNavigate(nextDate, nextView);
    else {
      onDateChange(nextDate);
      onViewChange(nextView);
    }
  };
  return (
    <section className="teacher-date-navigation" aria-label="Timetable period">
      <div className="teacher-date-board">
        <div className="teacher-date-band">
          <div className="teacher-date-context-row">
            {contextControl ? (
              <div className="teacher-date-context teacher-date-context--control">
                <span>{monthLabel(date)}</span>
                {contextControl}
              </div>
            ) : (
              <p className="teacher-date-context">{monthLabel(date)} · {contextLabel}</p>
            )}
            <button className="teacher-today-jump" type="button" aria-current={date === today ? "date" : undefined} aria-label={`Go to today, ${dateLabel(today)}`} onClick={() => onDateChange(today)}>
              Today · {compactCurrentDate(today)}
            </button>
          </div>
          <div className="teacher-day-strip" aria-label="Choose date" ref={stripRef}>
            {visibleStrip(date).map((day) => {
              const label = compactDayLabel(day);
              const item = dayMap.get(day);
              const isToday = day === today;
              return (
                <button
                  className={`teacher-day-chip${isToday ? " is-today" : ""}`}
                  key={day}
                  type="button"
                  aria-pressed={day === date}
                  aria-label={`${dateLabel(day)}${item ? `, ${item.periods} periods` : ""}${isToday ? ", today" : ""}`}
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
            <WeekOverview date={date} today={today} summary={summary} onOpenDay={(day) => navigate(day, "day")} />
          ) : view === "month" ? (
            <MonthOverview date={date} today={today} summary={summary} onOpenDay={(day) => navigate(day, "day")} />
          ) : (
            <YearOverview date={date} today={today} summary={summary} onOpenMonth={(month) => navigate(`${month}-01`, "month")} />
          )}
        </div>
      ) : null}
    </section>
  );
}

function WeekOverview({ date, today, summary, onOpenDay }: { date: string; today: string; summary?: TimetableSummary; onOpenDay: (date: string) => void }) {
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
          return <button className={day === today ? "is-today" : undefined} key={day} type="button" aria-pressed={day === date} aria-label={`${dateLabel(day)}, ${item?.periods ? `${item.periods} periods` : "free day"}${day === today ? ", today" : ""}, open day view`} onClick={() => onOpenDay(day)}><span>{label.weekday}</span><strong>{label.day}</strong><small>{item?.periods ? `${item.periods} periods` : "Free"}</small></button>;
        })}
      </div>
    </div>
  );
}

function MonthOverview({ date, today, summary, onOpenDay }: { date: string; today: string; summary?: TimetableSummary; onOpenDay: (date: string) => void }) {
  const dayMap = new Map((summary?.days ?? []).map((day) => [day.date, day]));
  const days = monthDays(date);
  const total = days.reduce((sum, day) => sum + (dayMap.get(day)?.periods ?? 0), 0);
  const firstDay = days[0] ? parseSchoolDate(days[0]).getUTCDay() : 1;
  const mondayOffset = (firstDay + 6) % 7;
  return (
    <div className="teacher-calendar-panel">
      <header><span>{monthLabel(date)}</span><strong>{total} periods</strong></header>
      <div className="teacher-month-calendar" aria-label={`${monthLabel(date)} timetable calendar`}>
        <div className="teacher-month-weekdays" aria-hidden="true">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="teacher-month-grid">
          {Array.from({ length: mondayOffset }, (_, index) => <span className="teacher-month-grid__spacer" key={`spacer-${index}`} aria-hidden="true" />)}
          {days.map((day) => {
            const item = dayMap.get(day);
            const periods = item?.periods ?? 0;
            return (
              <button
                className={day === today ? "is-today" : undefined}
                key={day}
                type="button"
                aria-pressed={day === date}
                aria-label={`${dateLabel(day)}, ${periods ? `${periods} periods` : 'free day'}${day === today ? ', today' : ''}, open day view`}
                onClick={() => onOpenDay(day)}
              >
                <strong>{Number(day.slice(-2))}</strong>
                <small>{periods ? periods : '–'}</small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function YearOverview({ date, today, summary, onOpenMonth }: { date: string; today: string; summary?: TimetableSummary; onOpenMonth: (month: string) => void }) {
  const year = date.slice(0, 4);
  const summaryMonths = new Map(groupSummaryByMonth(summary?.days ?? []).map((month) => [month.month, month]));
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    return summaryMonths.get(key) ?? { month: key, periods: 0, classes: 0, pending: 0, cancelled: 0 };
  });
  const max = Math.max(1, ...months.map((month) => month.periods));
  return (
    <div className="teacher-calendar-panel">
      <header><span>{year} overview</span><strong>{summary?.totals.periods ?? 0} periods</strong></header>
      <div className="teacher-year-chart" aria-label={`${year} timetable load by month`}>
        <div className="teacher-year-chart__head" aria-hidden="true"><span>Month</span><span>Scheduled load</span><span>Periods</span></div>
        {months.map((month) => {
          const load = Math.round((month.periods / max) * 100);
          const isCurrentMonth = month.month === today.slice(0, 7);
          return (
            <button
              className={isCurrentMonth ? "is-current-month" : undefined}
              key={month.month}
              type="button"
              aria-pressed={date.startsWith(month.month)}
              aria-label={`${shortMonthLabel(month.month)}, ${month.periods} periods${isCurrentMonth ? ", current month" : ""}, open month view`}
              onClick={() => onOpenMonth(month.month)}
            >
              <span>{shortMonthLabel(month.month)}</span>
              <i><em style={{ '--timetable-month-load': `${load}%` } as CSSProperties} /></i>
              <strong>{month.periods}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
