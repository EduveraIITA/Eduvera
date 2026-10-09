import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { HomeAction } from "../home-actions/types";

export function PrincipalHomeEvents({ actions }: { actions: HomeAction[] }) {
  const events = actions.filter(action => action.kind === "event_duty" || action.kind === "event_upcoming");
  return <section className="principal-home__section" aria-labelledby="principal-events-title">
    <header><h2 id="principal-events-title">Coming up</h2><Link to="/principal/events">All events<ChevronRight size={15} aria-hidden="true" /></Link></header>
    <div className="principal-home__group">
      {events.length ? <ul className="principal-home__rows principal-home__events">{events.map(event => {
        const date = event.occurs_at ? new Date(event.occurs_at) : null;
        const validDate = date && !Number.isNaN(date.getTime());
        const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...options }).format(date!);
        return <li key={event.id}><Link to={event.href}>
          {validDate ? <time className="principal-home__event-date" dateTime={event.occurs_at!}><span>{format({ month: "short" })}</span><strong>{format({ day: "numeric" })}</strong></time> : null}
          <span className="principal-home__row-copy"><strong>{event.title}</strong><small>{validDate ? format({ weekday: "short", hour: "numeric", minute: "2-digit" }) : "Date to be confirmed"}</small>{event.status_label === "Assigned event duty" ? <small className="principal-home__duty">You have an assigned duty</small> : null}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link></li>;
      })}</ul> : <p className="principal-home__notice">No upcoming events to show.</p>}
    </div>
  </section>;
}
