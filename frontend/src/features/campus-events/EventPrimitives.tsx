import { ArrowRight, CalendarDays, CheckCircle2, Clock3, MapPin, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { CampusEventDto, CampusEventStatus, CampusEventType } from "./types";

export const eventTypeLabels: Record<CampusEventType, string> = {
  annual_function: "Annual function",
  excursion: "Excursion",
  sports: "Sports",
  workshop: "Workshop",
  competition: "Competition",
  assembly: "Assembly",
  ptm: "Parent-teacher meeting",
  club: "Club",
  class_test: "Class test",
  other: "School event",
};

export const eventStatusLabels: Record<CampusEventStatus, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
  completed: "Completed",
};

export function formatEventDate(value: string, withTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function EventStatusBadge({ status }: { status: CampusEventStatus }) {
  return <span className={`campus-event-status is-${status}`}>{eventStatusLabels[status]}</span>;
}

export function eventAudienceLabel(event: CampusEventDto) {
  if (event.audience.mode === "school") return "Whole school";
  if (event.audience.mode === "class_sections") {
    const count = event.audience.class_section_ids.length;
    return `${count} ${count === 1 ? "class" : "classes"}`;
  }
  const count = event.audience.student_ids.length;
  return `${count} selected ${count === 1 ? "student" : "students"}`;
}

export function CampusEventCard({ event, to, dutyLabel }: { event: CampusEventDto; to: string; dutyLabel?: string }) {
  const participant = event.viewer_participants[0];
  return (
    <article className={`campus-event-card campus-event-card--${event.event_type}`}>
      <div className="campus-event-card__date" aria-hidden="true">
        <strong>{new Date(event.starts_at).toLocaleDateString("en-IN", { day: "2-digit" })}</strong>
        <span>{new Date(event.starts_at).toLocaleDateString("en-IN", { month: "short" })}</span>
      </div>
      <div className="campus-event-card__body">
        <div className="campus-event-card__topline">
          <span>{eventTypeLabels[event.event_type]}</span>
          <EventStatusBadge status={event.status} />
        </div>
        <h3>{event.title}</h3>
        <div className="campus-event-card__meta">
          <span><Clock3 size={14} />{formatEventDate(event.starts_at)}</span>
          <span><MapPin size={14} />{event.venue || "Venue to be confirmed"}</span>
        </div>
        <div className="campus-event-card__footer">
          <span><UsersRound size={14} />{dutyLabel ?? eventAudienceLabel(event)}</span>
          {participant ? (
            <span className={`campus-event-card__response is-${event.requires_rsvp ? participant.rsvp_status : "included"}`}>
              {event.requires_rsvp && participant.rsvp_status === "accepted" ? <CheckCircle2 size={13} /> : null}
              {event.requires_rsvp ? (participant.rsvp_status === "pending" ? "Response due" : participant.rsvp_status.replace("_", " ")) : event.participation_requirement === "mandatory" ? "Mandatory" : "Included"}
            </span>
          ) : null}
          <Link to={to} aria-label={`Open ${event.title}`}><span>View details</span><ArrowRight size={16} /></Link>
        </div>
      </div>
    </article>
  );
}

export function EventEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="campus-event-empty" role="status">
      <span><CalendarDays size={24} /></span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}
