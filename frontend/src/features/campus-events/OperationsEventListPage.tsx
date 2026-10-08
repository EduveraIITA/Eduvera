import { CheckCircle2, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { EventEmptyState, EventStatusBadge, formatEventDate } from "./EventPrimitives";
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
  const prefix = portal === "principal" ? "/principal" : "/teacher";

  return (
    <OperationsShell
      portal={portal}
      active="events"
      title={portal === "principal" ? "Events & activities" : "Assigned events"}
      subtitle={portal === "principal" ? "Whole-school event operations" : "Assigned event duties"}
      contentHasHeading
    >
      <div className="campus-events-page operations-stack campus-events-directory">
        <div className="workspace-list-toolbar">
          <select aria-label="Filter events" value={view} onChange={event=>onViewChange(event.target.value as EventView)}><option value="upcoming">Upcoming · {upcoming}</option><option value="draft">Drafts · {drafts}</option><option value="past">Past · {eventsForView(events,"past",now).length}</option></select>
          <Link className="workspace-add-link" aria-label={portal === "principal" ? "Create event" : "Schedule class test"} to={`${prefix}/events/new`}><Plus size={18}/>{portal === "principal" ? "New event" : "Class test"}</Link>
        </div>
        <section className="campus-event-collection" aria-label="Events">
          {visible.length ? (
            <div className="event-directory-rows">
              {visible.map(event=>{
                const openRegisters=event.sessions.filter(session=>session.attendance_mode!=="none"&&session.state==="open").length;
                return <Link key={event.id} to={`${prefix}/events/${event.id}`} aria-label={`Open ${event.title}`}>
                  <span className="event-directory-date" aria-hidden="true"><b>{new Date(event.starts_at).toLocaleDateString("en-IN",{day:"numeric",timeZone:"Asia/Kolkata"})}</b><small>{new Date(event.starts_at).toLocaleDateString("en-IN",{month:"short",timeZone:"Asia/Kolkata"})}</small></span>
                  <span className="event-directory-copy"><strong>{event.title}</strong><small>{formatEventDate(event.starts_at)}</small><small>{event.venue||"Venue to be confirmed"}</small><span><EventStatusBadge status={event.status}/>{openRegisters>0?<em>{openRegisters} open register{openRegisters===1?"":"s"}</em>:null}</span></span><ChevronRight size={18}/>
                </Link>;
              })}
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
