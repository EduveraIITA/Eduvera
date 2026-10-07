import { type ReactNode } from "react";
import { TimetableYearOverview } from './TimetableYearOverview';
import { DateNavigation, DateViewSelect } from '../../components/date-navigation/DateNavigation';
import { shiftDatePeriod } from '../../components/date-navigation/dateMath';

import { type TeacherDaySummary } from "../day-plans/api";
import { schoolDateToday } from "../../lib/schoolTime";
import {
  firstOfMonth,
  monthDays,
  visibleStrip,
} from "../day-plans/teacher-date-navigation";
import "../day-plans/day-plans.css";
import "./timetable-navigation.css";

export type TimetableView = "day" | "month" | "year";
export type TimetableSummary = TeacherDaySummary;

// Old Week deep links remain usable, opening the compact seven-day selector.
export function readTimetableView(value: string | null): TimetableView {
  return value === "month" || value === "year" ? value : "day";
}

function summaryErrorMessage(message?: string) {
  if (!message) return undefined;
  if (/Cannot GET|404|not found/i.test(message)) {
    return "The timetable overview is updating.";
  }
  return "The timetable overview could not be loaded.";
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

export function shiftTimetablePeriod(date: string, view: TimetableView, delta: number) {
  return shiftDatePeriod(date, view === 'day' ? 'week' : view, delta);
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
  const dayMap = new Map((error ? [] : summary?.days ?? []).map((day) => [day.date, day]));
  const navigate = (nextDate: string, nextView: TimetableView) => {
    if (onNavigate) onNavigate(nextDate, nextView);
    else {
      onDateChange(nextDate);
      onViewChange(nextView);
    }
  };
  return (
    <section className="schedule-navigation" aria-label="Timetable period">
      <div className="schedule-toolbar">
        <div className="schedule-context">{contextControl ?? <span>{contextLabel}</span>}</div>
        <DateViewSelect value={view} onChange={onViewChange} label="Timetable view" options={['day', 'month', 'year']} />
      </div>
      <DateNavigation date={date} view={view} today={today} onDateChange={onDateChange} onViewChange={onViewChange} onToday={() => navigate(today, 'day')} getDayInfo={day => {
        const item = dayMap.get(day);
        return { label: item ? (item.periods ? `${item.periods} periods` : 'free day') : undefined,
          indicator: item ? <span className="schedule-period-count">{item.periods || '–'}</span> : undefined };
      }}>
        {view === 'month' ? <>
          {summary && !error ? <p className="schedule-calendar-status">Scheduled this month · {monthDays(date).reduce((sum, day) => sum + (dayMap.get(day)?.periods ?? 0), 0)} periods</p> : null}
          {loading ? <p className="schedule-calendar-status" role="status">Updating period totals…</p> : error ? <div className="day-error" role="alert"><p>{summaryErrorMessage(error)}</p>{onRetry ? <button type="button" className="day-secondary" onClick={onRetry}>Try again</button> : null}</div> : null}
        </> : null}
      </DateNavigation>

      {view === "year" ? (
        <div className="schedule-overview">
          {loading ? (
            <div className="day-skeleton" role="status" aria-label="Loading timetable totals"><span /><span /></div>
          ) : error ? (
            <div className="day-error" role="alert"><p>{summaryErrorMessage(error)}</p>{onRetry ? <button className="day-secondary" type="button" onClick={onRetry}>Reload timetable</button> : null}</div>
          ) : (
            <TimetableYearOverview date={date} today={today} summary={summary} onOpenMonth={(month) => navigate(`${month}-01`, "month")} />
          )}
        </div>
      ) : null}
    </section>
  );
}
