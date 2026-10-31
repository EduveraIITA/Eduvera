import { Link } from 'react-router-dom';
import { PlannerDialog } from '../planner/PlannerLessonSheet';
import { activityInterval, activityTime } from '../activities/activityExperience';
import { calendarCategoryLabels } from './CalendarEntryList';
import type { CalendarEntry } from './campusCalendarSources';

export function CalendarEntryDetail({ entry, timezone, onClose, canManagePublication = false, onCorrect, onCancel }: {
  entry: CalendarEntry; timezone: string; onClose: () => void; canManagePublication?: boolean; onCorrect?: () => void; onCancel?: () => void;
}) {
  const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  const publication = entry.category === 'milestones' ? entry.publication : undefined;
  const linkLabel = entry.category === 'events' ? 'Open event' : entry.category === 'assessments' ? 'Open assessments' : entry.category === 'services' ? 'View service change' : 'View campus date';
  return <PlannerDialog title={entry.title} onClose={onClose}>
    <div className="campus-calendar-detail">
      <p className={`campus-calendar-type campus-calendar-type--${entry.category}`}>{entry.categoryLabel || calendarCategoryLabels[entry.category]}</p>
      <dl><div><dt>When</dt><dd>{dateLabel(entry.startsOn)}{entry.endsOn !== entry.startsOn ? ` – ${dateLabel(entry.endsOn)}` : ''}{entry.allDay ? ' · All day' : entry.startsAt ? <small>{entry.endsAt ? activityInterval(entry.startsAt, entry.endsAt, timezone) : activityTime(entry.startsAt, timezone)} · {timezone}</small> : null}</dd></div>
        {entry.location ? <div><dt>Where</dt><dd>{entry.location}</dd></div> : null}
        {entry.status ? <div><dt>Status</dt><dd>{entry.status}</dd></div> : null}
        {publication?.state === 'cancelled' && publication.cancellation_reason ? <div><dt>Cancellation reason</dt><dd>{publication.cancellation_reason}</dd></div> : null}</dl>
      {entry.summary ? <p>{entry.summary}</p> : null}
      {publication && publication.revision > 1 ? <p className="activity-caption">Current version {publication.revision}</p> : null}
      {entry.href ? <Link className="activity-primary" to={entry.href}>{linkLabel}</Link> : null}
      {canManagePublication && publication?.state === 'published' ? <div className="campus-calendar-detail-actions">
        {onCorrect ? <button type="button" onClick={onCorrect}>Correct date</button> : null}{onCancel ? <button type="button" onClick={onCancel}>Cancel date</button> : null}
      </div> : null}
      <p className="activity-caption">{publication ? 'Publishing a date does not change teaching, bookings, payments or results.' : 'Changes are maintained in the original record.'}</p>
    </div>
  </PlannerDialog>;
}
