import { shiftDate } from '../calendar/monthGrid';
import { activityInterval, activityTime, campusDate, purposeLabels } from './activityExperience';
import type { ActivityOccurrence } from './api';
import './activity-agenda.css';

function duration(start: string, end: string) {
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return [hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ');
}

/** A finite, date-grouped projection of the same authorized occurrence page. */
export function ActivityAgenda({ occurrences, from, today, timezone, filtered, onSelect }: {
  occurrences: ActivityOccurrence[]; from: string; today: string; timezone: string;
  filtered: boolean; onSelect: (item: ActivityOccurrence) => void;
}) {
  const groups = new Map<string, ActivityOccurrence[]>();
  const dayOf = (item: ActivityOccurrence) => campusDate(new Date(item.starts_at), timezone);
  for (const item of [...occurrences].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id))) {
    if (item.state === 'cancelled') continue;
    // A shift already in progress belongs to the first requested day, not a hidden prior day.
    const day = dayOf(item) < from ? from : dayOf(item);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const weekday = new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'long' });
  return <section className="activity-timetable-agenda" aria-label="Agenda activities on this page">
    {groups.size ? [...groups].map(([day, items]) => <section key={day} aria-labelledby={`agenda-${day}`}>
      <h3 id={`agenda-${day}`}><time dateTime={day}>{dateLabel.format(new Date(`${day}T12:00:00Z`))}</time><span>{day === today ? 'Today' : day === shiftDate(today, 1) ? 'Tomorrow' : weekday.format(new Date(`${day}T12:00:00Z`))}</span></h3>
      <ul>{items.map(item => {
        const continues = dayOf(item) < from;
        const overnight = campusDate(new Date(item.ends_at), timezone) !== dayOf(item);
        const place = item.space_label || item.location_label || (item.location_kind === 'online' ? 'Online' : '');
        return <li key={item.id}><button type="button" onClick={() => onSelect(item)}>
          <span className="activity-timetable-agenda__time"><time dateTime={item.starts_at} aria-label={activityInterval(item.starts_at, item.ends_at, timezone)}>{continues ? 'Ongoing' : activityTime(item.starts_at, timezone)}</time><small>{duration(item.starts_at, item.ends_at)}</small></span>
          <span className="activity-timetable-agenda__content"><strong>{item.title}</strong><small>{[purposeLabels[item.purpose], place].filter(Boolean).join(' · ')}</small>{continues || overnight ? <small>{continues ? `Started ${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(new Date(item.starts_at))} · ` : ''}{activityInterval(item.starts_at, item.ends_at, timezone)}</small> : null}</span>
        </button></li>;
      })}</ul>
    </section>) : <p className="activity-caption">{filtered ? 'No activities match your search on this page.' : 'No scheduled activities in this date range.'}</p>}
  </section>;
}
