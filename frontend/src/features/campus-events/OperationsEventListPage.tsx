import { CalendarCheck2, CalendarClock, CheckCircle2, Plus, ShieldCheck, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { CampusEventCard, EventEmptyState } from "./EventPrimitives";
import type { CampusEventDto } from "./types";
import "./campus-events.css";

type EventView = "upcoming" | "draft" | "past";

function eventsForView(events: CampusEventDto[], view: EventView, now: number) {
  return events.filter((event) => {
    if (view === "draft") return event.status === "draft";
    if (view === "past") return event.status === "completed" || event.status === "cancelled" || new Date(event.ends_at).getTime() < now;
    return event.status === "published" && new Date(event.ends_at).getTime() >= now;
  });
}

export function OperationsEventListPage({
  portal,
  events,
  view,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onViewChange,
}: {
  portal: "teacher" | "principal";
  events: CampusEventDto[];
  view: EventView;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onViewChange: (view: EventView) => void;
}) {
  const [now] = useState(() => Date.now());
  const visible = eventsForView(events, view, now).sort((first, second) => first.starts_at.localeCompare(second.starts_at));
  const upcoming = eventsForView(events, "upcoming", now).length;
  const drafts = eventsForView(events, "draft", now).length;
  const awaitingRegisters = events.reduce((count, event) => count + event.sessions.filter((session) => session.attendance_mode !== "none" && session.state === "open").length, 0);
  const prefix = portal === "principal" ? "/principal" : "/teacher";

  return (
    <OperationsShell
      portal={portal}
      active="events"
      title="Events & activities"
      subtitle={portal === "principal" ? "Whole-school event operations" : "Assigned event duties"}
      contentHasHeading
    >
      <div className="campus-events-page operations-stack">
        <section className="campus-events-ops-hero">
          <div>
            <h1>{portal === "principal" ? "Events and activities" : "Assigned events"}</h1>
          </div>
          <Link className="campus-event-primary" to={portal === "principal" ? "/principal/events/new" : "/teacher/events/new"}><Plus size={17} />{portal === "principal" ? "Create event" : "Schedule class test"}</Link>
        </section>

        <section className="campus-event-metrics" aria-label="Event operations summary">
          <article><span><CalendarClock size={18} /></span><small>Upcoming</small><strong>{upcoming}</strong></article>
          <article><span><UsersRound size={18} /></span><small>Participants</small><strong>{events.reduce((sum, event) => sum + event.counts.participants, 0)}</strong></article>
          <article><span><CalendarCheck2 size={18} /></span><small>Open registers</small><strong>{awaitingRegisters}</strong></article>
          <article><span><ShieldCheck size={18} /></span><small>Drafts</small><strong>{drafts}</strong></article>
        </section>

        <section className="campus-event-collection" aria-labelledby="campus-event-list-title">
          <header>
            <div><h2 id="campus-event-list-title">{view === "upcoming" ? "Upcoming events" : view === "draft" ? "Draft events" : "Past events"}</h2></div>
            <div className="campus-event-tabs" role="tablist" aria-label="Filter events">
              {(["upcoming", "draft", "past"] as EventView[]).map((item) => (
                <button key={item} type="button" role="tab" aria-selected={view === item} className={view === item ? "is-active" : ""} onClick={() => onViewChange(item)}>
                  {item === "upcoming" ? `Upcoming ${upcoming}` : item === "draft" ? `Drafts ${drafts}` : "Past"}
                </button>
              ))}
            </div>
          </header>
          {visible.length ? (
            <div className="campus-event-list">
              {visible.map((event) => <CampusEventCard key={event.id} event={event} to={`${prefix}/events/${event.id}`} dutyLabel={portal === "teacher" ? "Assigned activity" : undefined} />)}
            </div>
          ) : (
            <EventEmptyState
              title={view === "draft" ? "No event drafts" : view === "past" ? "No past events yet" : "No upcoming events"}
              detail={hasMore ? "More school events are available. Load the next page to continue this view." : view === "draft" ? "Create an event when the next school activity is ready to plan." : "Events in this view will appear here when they are available."}
            />
          )}
          {hasMore && onLoadMore ? <button className="campus-event-load-more" type="button" disabled={loadingMore} aria-busy={loadingMore} onClick={onLoadMore}>{loadingMore ? "Loading more events..." : "Load more events"}</button> : null}
          {view === "past" && visible.some((event) => event.status === "completed") ? <p className="campus-event-policy-note"><CheckCircle2 size={15} />Completed event registers are retained with their audit history and never change academic attendance.</p> : null}
        </section>
      </div>
    </OperationsShell>
  );
}

export type { EventView };
