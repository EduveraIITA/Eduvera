import { Bus,Clock3,MapPin,Navigation,Pause } from "lucide-react";
import type { CollectorTrip,MapConfig } from "./api";
import { RideMapPanel } from "./RideMapPanel";
import type { useJourneyTracking } from "./useJourneyTracking";
import { coordinates, riderStops, stopFocus } from "./stopFocus";

export function CollectorRideCard({trip,map,tracker}:{trip:CollectorTrip;map:MapConfig;tracker:ReturnType<typeof useJourneyTracking>}) {
  const active=trip.state==="in_progress";
  const location=active?trip.latest_location:null;
  const fresh=trip.location_fresh===true;
  const next=stopFocus(trip,riderStops(trip)).group;
  const stops=(trip.stops??[]).flatMap(stop=>{const point=coordinates(stop);return point?[{...point,id:stop.id,name:stop.name,sequence:stop.sequence,focused:next?.stop.id===stop.id}]:[];});
  return <section className="ride-card" aria-label="Selected journey">
    {location?<RideMapPanel location={location} map={map} fresh={fresh} stops={stops}/>:null}
    <div className="ride-information">
      <div className="ride-heading"><span className="ride-icon"><Bus size={23}/></span><div><h2>{trip.route_name}</h2><p>{trip.vehicle_label||trip.provider_name||trip.route_code}</p></div><span className={`departure-state departure-state--${trip.state}`}>{active?"On the way":trip.state==="planned"?"Scheduled":trip.state.replaceAll("_"," ")}</span></div>
      <dl className="ride-facts"><div><dt><Clock3 size={16}/>{trip.direction==="to_institution"?"To school":"From school"}</dt><dd>{trip.scheduled_departure_time.slice(0,5)} <small>scheduled</small></dd></div><div><dt><MapPin size={16}/>{active?"Next stop to review":"Service date"}</dt><dd>{active?(next?.stop.name??"All riders resolved"):new Intl.DateTimeFormat(undefined,{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${trip.service_date}T12:00:00`))}</dd></div></dl>
      {active?<div className="ride-tracking">
        <div className="ride-tracking-actions">
          <p className={`ride-tracking-status ${tracker.status==="unavailable"?"is-concern":""}`} role="status"><Navigation size={17} aria-hidden="true"/><span>{tracker.message||"Location starts automatically with this ride."}</span></p>
          {tracker.running?<button type="button" aria-label="Pause location sharing" onClick={tracker.stop}><Pause size={17} aria-hidden="true"/>Pause</button>:tracker.message?<button type="button" aria-label={tracker.status==="unavailable"?"Retry location sharing":"Resume location sharing"} onClick={()=>void tracker.start()}>{tracker.status==="unavailable"?"Retry":"Resume"}</button>:null}
        </div>
        <p className="ride-privacy">Keep this screen open. Location is visible to families only while their child is on board.</p>
      </div>:null}
      {trip.state==="planned"&&!trip.controls_available?<p className="ride-message">Boarding opens 30 minutes before departure. For urgent changes, contact school operations.</p>:null}
    </div>
  </section>;
}
