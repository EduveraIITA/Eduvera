import { ChevronRight } from 'lucide-react';
import { ActivityPagination } from '../activities/ActivityPagination';
import { activityTime } from '../activities/activityExperience';
import type { CalendarCategory, CalendarEntry } from './campusCalendarSources';

export const calendarCategoryLabels: Record<CalendarCategory, string> = {
  milestones: 'Dates & deadlines', dates: 'Campus dates', events: 'Events', assessments: 'Assessments', services: 'Service changes',
};
export function CalendarEntryList({ entries, from, timezone, page, onPage, onSelect, empty }: {
  entries: CalendarEntry[]; from: string; timezone: string; page: number; onPage: (page: number) => void;
  onSelect: (entry: CalendarEntry) => void; empty: string;
}) {
  const size = 8, pages = Math.max(1, Math.ceil(entries.length / size));
  const current = Math.min(page, pages);
  const groups = new Map<string, CalendarEntry[]>();
  for (const entry of entries.slice((current - 1) * size, current * size)) {
    const day = entry.startsOn < from ? from : entry.startsOn;
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  return <>
    {groups.size ? [...groups].map(([date, items]) => <section className="campus-calendar-date-group" key={date} aria-labelledby={`calendar-group-${date}`}>
      <h3 id={`calendar-group-${date}`}><time dateTime={date}>{new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`))}</time></h3>
      <ul>{items.map(entry => <li key={entry.id}><button type="button" onClick={() => onSelect(entry)}>
        <span className="campus-calendar-entry-time">{entry.startsOn < from ? 'Ongoing' : entry.allDay ? 'All day' : entry.startsAt ? <time dateTime={entry.startsAt}>{activityTime(entry.startsAt, timezone)}</time> : 'Date'}{entry.endsOn !== entry.startsOn ? <small>Through {new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${entry.endsOn}T12:00:00Z`))}</small> : null}</span>
        <span className="campus-calendar-entry-body"><strong>{entry.title}</strong><small><span className={`campus-calendar-type campus-calendar-type--${entry.category}`}>{entry.categoryLabel || calendarCategoryLabels[entry.category]}</span>{entry.location ? ` · ${entry.location}` : ''}</small>{entry.status ? <small className={entry.status.toLowerCase().includes('cancel') ? 'campus-calendar-cancelled' : undefined}>{entry.status}</small> : null}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button></li>)}</ul>
    </section>) : <p className="campus-calendar-empty">{empty}</p>}
    {entries.length > size ? <ActivityPagination page={current} pages={pages} total={entries.length} onPage={onPage} label="important dates" singularLabel="important date" /> : null}
  </>;
}
