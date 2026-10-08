import { monthDateLabel, visibleDates } from '../../components/date-navigation/dateMath';
import { groupSummaryByMonth } from '../day-plans/teacher-date-navigation';
import type { TimetableSummary } from './TimetableNavigator';
import './timetable-year.css';

/** Year summarises scheduled periods by month. Calendar dates and daily
 * schedules belong only to Month/Day views. */
export function TimetableYearOverview({ date, today, summary, onOpenMonth }: {
  date: string; today: string; summary?: TimetableSummary; onOpenMonth: (month: string) => void;
}) {
  const year = date.slice(0, 4);
  const totals = new Map(groupSummaryByMonth(summary?.days ?? []).map(month => [month.month, month.periods]));
  return <div className="timetable-year" role="group" aria-label={`${year} timetable months`}>
    {Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      const first = `${month}-01`;
      const days = visibleDates(first, 'month');
      const monthName = monthDateLabel(first).replace(` ${year}`, '');
      const known = summary && summary.start <= days.at(-1)! && summary.end >= first;
      const periods = known ? totals.get(month) ?? 0 : undefined;
      const isCurrentMonth = month === today.slice(0, 7);
      return <button type="button" key={month} className={`timetable-year__month${isCurrentMonth ? ' is-current-month' : ''}`}
        aria-pressed={date.startsWith(month)}
        aria-label={`${monthName}, ${periods === undefined ? 'totals unavailable' : `${periods} periods`}${isCurrentMonth ? ', current month' : ''}, open month view`}
        onClick={() => onOpenMonth(month)}>
        <span className="timetable-year__name">{monthName}</span>
        <strong className="timetable-year__count">{periods ?? '—'}</strong>
        <small className="timetable-year__caption">{periods === undefined ? 'Not loaded' : 'periods'}</small>
      </button>;
    })}
  </div>;
}
