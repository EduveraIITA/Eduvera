import { Bus,Check,Clock3,MapPin } from "lucide-react";
import type { FamilyJourney,MapConfig } from "./api";
import { RideMapPanel } from "./RideMapPanel";

export function journeyMessage(journey:FamilyJourney) {
  if(journey.state==="cancelled")return "Journey cancelled. Confirm the alternative with the school.";
  if(journey.rider_state==="exception")return "School staff are reviewing a journey concern. Contact the school for assistance.";
  if(journey.rider_state==="not_riding")return "Not travelling on this journey.";
  if(journey.rider_state==="dropped")return journey.direction==="to_institution"?"Arrival at school recorded.":"Handover recorded by the assigned attendant.";
  if(journey.state==="completed")return "Journey closed.";
  if(journey.rider_state==="boarded")return journey.state==="in_progress"?"On board. Waiting for a location update from the attendant.":"Boarding recorded. Waiting to depart.";
  return journey.state==="in_progress"?"Journey in progress. Your boarding has not been recorded.":journey.state==="boarding"?"Boarding is open. Waiting for your boarding record.":"Journey scheduled. Boarding has not started.";
}

export function FamilyJourneyCard({journey,map}:{journey:FamilyJourney;map:MapConfig}) {
  const visible=journey.state==="in_progress"&&journey.rider_state==="boarded"&&journey.latitude!==null&&journey.longitude!==null;
  const inbound=journey.direction==="to_institution";
  const time=(value:string|null)=>value?new Date(value).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"Not recorded";
  const status=journey.state==="cancelled"?"Cancelled":journey.rider_state==="exception"?"Needs attention":journey.rider_state==="not_riding"?"Not riding":journey.rider_state==="dropped"?(inbound?"Arrived":"Handed over"):journey.rider_state==="boarded"?(journey.state==="in_progress"?"On the way":"On board"):"Scheduled";
  const state=journey.state==="cancelled"?"cancelled":journey.rider_state;
  return <section className="ride-card" aria-label={`${inbound?"To school":"From school"} journey`}>
    {visible?<RideMapPanel location={{latitude:journey.latitude!,longitude:journey.longitude!,accuracy_metres:journey.accuracy_metres??"0",observed_at:journey.observed_at!}} map={map} fresh={journey.location_fresh}/>:null}
    <div className="ride-information">
      <div className="ride-heading"><span className="ride-icon"><Bus size={23}/></span><div><h2>{journey.route_name}</h2><p>{journey.vehicle_label||journey.provider_name||journey.route_code}</p></div><span className={`departure-state departure-state--${state}`}>{status}</span></div>
      <dl className="ride-facts"><div><dt><MapPin size={16}/>Your stop</dt><dd>{journey.stop_name}</dd></div><div><dt><Clock3 size={16}/>{inbound?"To school":"From school"}</dt><dd>{journey.scheduled_departure_time.slice(0,5)} <small>scheduled</small></dd></div></dl>
      {!visible?<p className={`ride-message ${["exception","cancelled"].includes(state)?"is-concern":""}`}>{journeyMessage(journey)}</p>:null}
      <ol className="ride-milestones" aria-label="Recorded journey progress">
        <li className={journey.boarded_at?"is-recorded":""}><span className="ride-milestone-icon">{journey.boarded_at?<Check size={14}/>:<Bus size={14}/>}</span><div><strong>Boarded</strong><time>{time(journey.boarded_at)}</time></div></li>
        <li className={journey.dropped_at?"is-recorded":""}><span className="ride-milestone-icon">{journey.dropped_at?<Check size={14}/>:<MapPin size={14}/>}</span><div><strong>{inbound?"Arrived at school":"Handed over"}</strong><time>{time(journey.dropped_at)}</time></div></li>
      </ol>
      {visible?<p className="ride-privacy">This is the attendant phone's last observation, not proof of the learner's location. Sharing ends after handover.</p>:null}
    </div>
  </section>;
}
