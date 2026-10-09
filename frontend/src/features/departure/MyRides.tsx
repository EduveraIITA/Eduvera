import { ArrowDownLeft,ArrowUpRight,ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { CollectorTrip } from "./api";

export function rideStatus(trip:CollectorTrip) {
  if(trip.state==="in_progress")return "On the way";
  if(trip.state==="boarding")return "Boarding";
  if(trip.state==="completed")return "Completed";
  if(trip.state==="cancelled")return "Cancelled";
  if(trip.collector_assignment_status==="pending")return "Confirm duty";
  if(trip.collector_assignment_status==="declined")return "Duty declined";
  return trip.controls_available?"Ready to board":"Scheduled";
}

export function MyRides({trips}:{trips:CollectorTrip[]}) {
  const groups=new Map<string,CollectorTrip[]>();
  const rank=(trip:CollectorTrip)=>["boarding","in_progress"].includes(trip.state)?0:trip.service_date===trip.local_date?1:trip.service_date>(trip.local_date??"")?2:3;
  const sorted=[...trips].sort((a,b)=>rank(a)-rank(b)||a.service_date.localeCompare(b.service_date)||a.scheduled_departure_time.localeCompare(b.scheduled_departure_time));
  for(const trip of sorted) {
    const dateLabel=new Intl.DateTimeFormat(undefined,{weekday:"short",day:"numeric",month:"short"}).format(new Date(`${trip.service_date}T12:00:00`));
    const key=["boarding","in_progress"].includes(trip.state)?"In progress":trip.service_date===trip.local_date?"Today":trip.service_date<(trip.local_date??"")?`Past · ${dateLabel}`:dateLabel;
    groups.set(key,[...(groups.get(key)??[]),trip]);
  }
  return <div className="ride-list">{[...groups].map(([label,items])=><section key={label} aria-label={label}><h2>{label}</h2><div className="ride-list-group">{items.map(trip=><Link key={trip.id} to={`/teacher/transport/${trip.id}`} className="ride-list-row">
    <div className="ride-list-time"><strong>{trip.scheduled_departure_time.slice(0,5)}</strong>{trip.direction==="to_institution"?<ArrowDownLeft size={18}/>:<ArrowUpRight size={18}/>}</div>
    <div className="ride-list-content"><h3>{trip.route_name}</h3><p>{trip.direction==="to_institution"?"To school":"From school"} · {trip.roster.length} {trip.roster.length===1?"rider":"riders"}</p><span className={`ride-list-status ${["boarding","in_progress"].includes(trip.state)||trip.controls_available?"is-active":trip.collector_assignment_status==="pending"?"is-pending":""}`}>{rideStatus(trip)}</span></div>
    <ChevronRight size={19} aria-hidden="true"/>
  </Link>)}</div></section>)}</div>;
}
