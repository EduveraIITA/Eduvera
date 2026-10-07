import { useEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { addDays, longDateLabel, mondayOffset, shiftDatePeriod, visibleDates } from './dateMath';
import './date-navigation.css';

export interface DateDayInfo { label?: string; indicator?: ReactNode; muted?: boolean }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DateGrid({ date, today, view, onChange, getDayInfo }: {
  date: string; today: string; view: 'day' | 'month';
  onChange: (date: string) => void;
  getDayInfo?: (date: string) => DateDayInfo;
}) {
  const root = useRef<HTMLDivElement>(null);
  const keyboardTarget = useRef<string | null>(null);
  const days = visibleDates(date, view);
  const dayInfo = new Map(days.map(day => [day, getDayInfo?.(day)]));
  const hasIndicators = [...dayInfo.values()].some(info => Boolean(info?.indicator));
  useEffect(() => {
    if (keyboardTarget.current === date) root.current?.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
    keyboardTarget.current = null;
  }, [date]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string;
    switch (event.key) {
      case 'ArrowLeft': next = addDays(day, -1); break;
      case 'ArrowRight': next = addDays(day, 1); break;
      case 'ArrowUp': next = addDays(day, -7); break;
      case 'ArrowDown': next = addDays(day, 7); break;
      case 'Home': next = addDays(day, -mondayOffset(day)); break;
      case 'End': next = addDays(day, 6 - mondayOffset(day)); break;
      case 'PageUp': next = shiftDatePeriod(day, 'month', -1); break;
      case 'PageDown': next = shiftDatePeriod(day, 'month', 1); break;
      default: return;
    }
    event.preventDefault();
    keyboardTarget.current = next;
    onChange(next);
  };
  return <div className="date-navigation__dates" ref={root}>
    <div className="date-navigation__weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
    <div className="date-navigation__grid" role="group" aria-label="Choose date">
      {view === 'month' ? Array.from({ length: mondayOffset(days[0]!) }, (_, index) => <span className="date-navigation__spacer" key={index} aria-hidden="true" />) : null}
      {days.map(day => {
        const info = dayInfo.get(day);
        const isToday = day === today;
        return <button type="button" key={day} data-date={day}
          className={`date-navigation__day${isToday ? ' is-today' : ''}${info?.muted ? ' is-muted' : ''}`}
          aria-label={`${longDateLabel(day)}${info?.label ? `, ${info.label}` : ''}${isToday ? ', today' : ''}`}
          aria-pressed={day === date} aria-current={isToday ? 'date' : undefined}
          tabIndex={day === date ? 0 : -1} onKeyDown={event => onKeyDown(event, day)} onClick={() => onChange(day)}>
          <strong>{Number(day.slice(-2))}</strong>
          {hasIndicators ? <span className="date-navigation__indicator" aria-hidden="true">{info?.indicator}</span> : null}
        </button>;
      })}
    </div>
  </div>;
}
