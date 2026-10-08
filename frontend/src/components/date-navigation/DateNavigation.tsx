import { useId, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { schoolDateToday } from '../../lib/schoolTime';
import { DateGrid, type DateDayInfo } from './DateGrid';
import { longDateLabel, monthDateLabel, shortDateLabel, shiftDatePeriod, type DateView } from './dateMath';
import './date-navigation.css';

export function DateViewSelect<T extends DateView>({ value, onChange, label, options }: {
  value: T; onChange: (view: T) => void; label: string; options: readonly T[];
}) {
  return <label className="date-view-select"><span className="sr-only">{label}</span>
    <select className="date-view-select__input" value={value} onChange={event => onChange(event.target.value as T)}>{options.map(view => <option key={view} value={view}>{view[0]!.toUpperCase()}{view.slice(1)}</option>)}</select>
    <ChevronDown size={16} aria-hidden="true" />
  </label>;
}

/** One interaction language; compact daily queues omit the seven-day strip.
 * Returning false from onDateChange keeps unsaved-work guards authoritative.
 * onToday, when supplied, updates date and view atomically (e.g. URL state).
 */
export function DateNavigation({ date, view, onDateChange, onViewChange, onToday, compact = false, today = schoolDateToday(), getDayInfo, children }: {
  date: string; view: DateView; onDateChange: (date: string) => void | boolean;
  onViewChange?: (view: 'day' | 'month') => void; onToday?: () => void;
  compact?: boolean; today?: string; getDayInfo?: (date: string) => DateDayInfo; children?: ReactNode;
}) {
  const id = useId();
  const dateInput = useRef<HTMLInputElement>(null);
  const expanded = view === 'month';
  const period = view === 'day' ? (compact ? 'day' : 'week') : view;
  const toggle = () => onViewChange?.(expanded ? 'day' : 'month');
  const goToday = () => {
    if (onToday) onToday();
    else if (onDateChange(today) !== false) onViewChange?.('day');
  };
  const headingLabel = view === 'year' ? date.slice(0, 4) : compact && !expanded ? shortDateLabel(date) : monthDateLabel(date);
  return <div className={`date-navigation${compact ? ' date-navigation--compact' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape' && expanded && event.target !== dateInput.current) { event.preventDefault(); onViewChange?.('day'); dateInput.current?.focus(); }
  }}>
    <div className="date-navigation__toolbar">
      <label className="date-navigation__heading">
        <span aria-hidden="true">{headingLabel}</span><ChevronDown size={16} aria-hidden="true" />
        <input ref={dateInput} className="date-navigation__input" type="date" aria-label="Choose date" value={date} onChange={event => { if (event.target.value) onDateChange(event.target.value); }} />
      </label>
      <div className="date-navigation__actions">
        {date !== today ? <button type="button" aria-label={`Go to today, ${longDateLabel(today)}`} onClick={goToday}>Today</button> : null}
        <button type="button" aria-label={`Previous ${period}`} onClick={() => onDateChange(shiftDatePeriod(date, period, -1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" aria-label={`Next ${period}`} onClick={() => onDateChange(shiftDatePeriod(date, period, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
    </div>
    <div id={id} hidden={view === 'year' || (compact && !expanded)}>
      {view !== 'year' && (!compact || expanded) ? <>
        <DateGrid date={date} today={today} view={view} onChange={onDateChange} getDayInfo={getDayInfo} />
        {children}
        <span className="sr-only" aria-live="polite">{longDateLabel(date)}{date === today ? ', today' : ''}</span>
        <button className="date-navigation__toggle" type="button" aria-label={expanded ? 'Collapse calendar' : 'Expand calendar'} aria-expanded={expanded} aria-controls={id} onClick={toggle}>
          {expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
      </> : null}
    </div>
  </div>;
}
