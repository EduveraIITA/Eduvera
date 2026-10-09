import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getJourneyDetail } from "./api";
import { riderLabel } from "./JourneyRoster";
import { LiveMap } from "./LiveMap";
import { JourneyReconciliation } from "./JourneyReconciliation";
import "./departure.css";

export default function JourneyDetailPage() {
  const auth=useAuth();const {tripId=""}=useParams();const membership=auth.memberships.find(member=>member.role==="admin"&&member.school_id===auth.user?.active_school_id)??auth.memberships.find(member=>member.role==="admin");const schoolId=membership?.school_id??"";
  const query=useQuery({queryKey:["departure","journey",auth.user?.id,schoolId,tripId],queryFn:()=>getJourneyDetail(schoolId,tripId),enabled:Boolean(schoolId&&tripId),refetchInterval:10_000});
  if(!schoolId)return <LiveRouteError error={new Error("Select an institution with transport management access.")} onRetry={auth.refresh}/>;
  if(query.isPending)return <ScreenLoading/>;
  if(query.error||!query.data)return <LiveRouteError error={query.error??new Error("Journey unavailable.")} onRetry={query.refetch}/>;
  const {trip,roster,history,location,map,location_fresh:fresh}=query.data;
  const unresolved=roster.filter(rider=>["expected","boarded","exception"].includes(rider.state));
  return <OperationsShell portal="principal" active="more" title="Journey details" schoolName={membership?.school_name} backTo="/principal/departure?section=trips"><div className="departure-page">
    <section className="departure-status"><div><span>{trip.service_date} · {trip.scheduled_departure_time.slice(0,5)} · {trip.direction==="to_institution"?"To school":"From school"}</span><h2>{trip.route_name}</h2><p>{trip.vehicle_label} · {trip.collector_name}</p></div><span className={`departure-state departure-state--${trip.state}`}>{trip.state.replaceAll("_"," ")}</span></section>
    {trip.collector_assignment_status!=="accepted"?<p className="departure-warning">Duty {trip.collector_assignment_status}. <Link to="/principal/departure?section=roster">Review duty coverage</Link></p>:null}
    {location?<section className="departure-panel"><header><h2>{fresh?"Recent phone location":"Location delayed"}</h2><small>{new Date(location.observed_at).toLocaleTimeString()}</small></header><LiveMap latitude={Number(location.latitude)} longitude={Number(location.longitude)} accuracy={Number(location.accuracy_metres)} tileUrl={map.tile_url} attribution={map.attribution}/></section>:trip.state==="in_progress"?<p className="departure-warning">No recent location received. Contact the assigned attendant; the rider register remains the operational record.</p>:null}
    <section className="departure-panel"><header><h2>{roster.length} riders</h2><span>{unresolved.length} unresolved</span></header><div className="departure-rider-list">{roster.map(rider=><article key={rider.student_id}><div><strong>{rider.student_name}</strong><small>{rider.stop_sequence}. {rider.stop_name}</small></div><span className={`departure-state departure-state--${rider.state}`}>{riderLabel(rider.state,trip.direction==="to_institution")}</span>{rider.outcome_note?<p className="departure-rider-note">{rider.outcome_note}</p>:null}</article>)}</div></section>
    <JourneyReconciliation key={trip.id} schoolId={schoolId} data={query.data}/>
    <section className="departure-panel"><header><h2>Journey history</h2></header><ol className="departure-history">{history.map(event=><li key={event.id}><strong>{event.action.replaceAll("."," · ").replaceAll("_"," ")}</strong><time>{new Date(event.created_at).toLocaleString()}</time>{typeof event.metadata.note==="string"?<p>{event.metadata.note}</p>:null}</li>)}</ol></section>
  </div></OperationsShell>;
}
