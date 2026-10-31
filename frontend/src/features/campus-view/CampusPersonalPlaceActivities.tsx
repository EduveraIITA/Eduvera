import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { portalReturnState } from "../navigation/portalReturnState";
import { sessionActionHref } from "../teaching-sessions/api";
import { personalJourneyTime } from "./personalJourney";
import type { CampusPersonalDestination } from "./personalJourney.types";

export function CampusPersonalPlaceActivities({ activities, spaceId, capacity, timezone, localDate }: {
  activities: CampusPersonalDestination[]; spaceId: string; capacity: number | null | undefined; timezone: string; localDate: string;
}) {
  const location = useLocation();
  const ordered = [...activities].sort((left, right) => (left.starts_at ?? "9999").localeCompare(right.starts_at ?? "9999"));
  const rows = (items: CampusPersonalDestination[]) => <ul>{items.map(item => {
    const href = sessionActionHref(item.target_path);
    const content = <span><strong>{item.title}</strong><small>{personalJourneyTime(item, timezone, localDate)}{item.space_id !== spaceId && item.place_label ? ` · ${item.place_label}` : ""}</small></span>;
    return <li key={item.id}>{href ? <Link className="campus-personal-activity-link" to={href} state={portalReturnState(`${location.pathname}${location.search}`, href)} aria-label={`${item.title}, ${item.action_label}`}>{content}<ChevronRight size={17} aria-hidden="true" /></Link> : <div className="campus-personal-activity-link">{content}</div>}</li>;
  })}</ul>;
  return <div className="campus-personal-place-activities" aria-label="Your activity at this place"><h3>Your activity here</h3>
    {capacity !== null && capacity !== undefined ? <p>Published capacity: {capacity}</p> : null}
    {ordered.length ? <>{rows(ordered.slice(0, 2))}{ordered.length > 2 ? <details className="campus-personal-more-activities"><summary>More activities · {ordered.length - 2}</summary>{rows(ordered.slice(2))}</details> : null}</> : <p>No current or upcoming activity is assigned to you here. This does not indicate whether the place is occupied.</p>}
  </div>;
}
