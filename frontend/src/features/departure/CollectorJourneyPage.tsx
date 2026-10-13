import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Check, Repeat2 } from "lucide-react";
import { useEffect,useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MyRides } from "./MyRides";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useAuth } from "../auth/AuthContext";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getCollectorDeparture, requestDutySwap, respondDutySwap, tripAction, updateRider } from "./api";
import { CollectorRideCard } from "./CollectorRideCard";
import { JourneyCancel } from "./JourneyCancel";
import { JourneyRoster } from "./JourneyRoster";
import { useJourneyTracking } from "./useJourneyTracking";
import "./departure.css";

const formValue=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==="string"?value.trim():"";};
const expectedRevision=(value:string|null)=>{const revision=Number(value);return Number.isInteger(revision)&&revision>0?revision:null;};

export default function CollectorJourneyPage(){
  const auth=useAuth();const client=useQueryClient();const {tripId}=useParams<{tripId:string}>();const [params]=useSearchParams();const focusedSwapId=params.get("swap");const focusedSwapRevision=params.get("swap_revision");const attentionNotificationId=params.get("attention_notification_id");
  const query=useQuery({queryKey:["departure","collector",auth.user?.id,focusedSwapId],queryFn:()=>getCollectorDeparture(focusedSwapId??undefined),refetchInterval:15_000});
  const [error,setError]=useState("");const [showSwap,setShowSwap]=useState(false);const [swapType,setSwapType]=useState<"cover"|"exchange">("cover");const [targetUser,setTargetUser]=useState("");
  const mutation=useMutation({mutationFn:async(fn:()=>Promise<unknown>)=>fn(),onSuccess:async()=>{setError("");await Promise.all([client.invalidateQueries({queryKey:["departure"]}),client.invalidateQueries({queryKey:["attention"]}),client.invalidateQueries({queryKey:["requests"]})]);},onError:cause=>{setError(cause instanceof Error?cause.message:"Journey could not be updated.");void client.invalidateQueries({queryKey:["departure"]});}});
  const data=query.data;const trip=data?.trips.find(item=>item.id===tripId);
  const tracker=useJourneyTracking(trip?.id,trip?.state==="in_progress"&&trip.collector_assignment_status==="accepted"&&!query.error,()=>void client.invalidateQueries({queryKey:["departure"]}),data?.tracking.min_interval_seconds);
  const opensAt=trip?.controls_open_at;const refetch=query.refetch;
  useEffect(()=>{if(!opensAt)return;const delay=new Date(opensAt).getTime()-Date.now();if(delay<0||delay>2_147_000_000)return;const timer=window.setTimeout(()=>void refetch(),delay+100);return()=>window.clearTimeout(timer);},[opensAt,refetch]);
  useEffect(()=>{if(!focusedSwapId)return;const frame=window.requestAnimationFrame(()=>{const target=document.getElementById(`attention-transport-swap-${focusedSwapId}`);target?.scrollIntoView?.({behavior:"smooth",block:"center"});target?.focus({preventScroll:true});});return()=>window.cancelAnimationFrame(frame);},[focusedSwapId,data?.swaps.length]);

  const submitSwap=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();if(!trip)return;const form=new FormData(event.currentTarget);mutation.mutate(()=>requestDutySwap({requester_trip_id:trip.id,request_type:swapType,target_user_id:formValue(form,"target_user"),target_trip_id:swapType==="exchange"?formValue(form,"target_trip"):null,reason:formValue(form,"reason")}),{onSuccess:()=>setShowSwap(false)});};

  if(query.isPending)return <ScreenLoading/>;if(query.error||!data)return <LiveRouteError error={query.error??new Error("Assigned journeys are unavailable.")} onRetry={query.refetch}/>;
  const focusedSwapRecord=focusedSwapId?data.swaps.find(swap=>swap.id===focusedSwapId):undefined;
  const focusedExpectedRevision=expectedRevision(focusedSwapRevision);
  const focusedRevisionMatches=!focusedSwapRevision||focusedSwapRecord?.revision===focusedExpectedRevision;
  const focusedSwap=focusedSwapRecord&&focusedRevisionMatches&&focusedSwapRecord.target_user_id===auth.user?.id&&focusedSwapRecord.status==="submitted"&&focusedSwapRecord.self_service_open===true?focusedSwapRecord:undefined;
  const exactSwapAttention=Boolean(attentionNotificationId&&focusedSwapRecord&&focusedExpectedRevision
    && focusedSwapRecord.revision===focusedExpectedRevision
    && ((focusedSwapRecord.status==="submitted"&&focusedSwapRecord.target_user_id===auth.user?.id&&focusedSwapRecord.self_service_open===true)
      || (["accepted","rejected"].includes(focusedSwapRecord.status)&&focusedSwapRecord.requester_user_id===auth.user?.id)
      || (["approved","declined_by_school"].includes(focusedSwapRecord.status)
        && [focusedSwapRecord.requester_user_id,focusedSwapRecord.target_user_id].includes(auth.user?.id??""))));
  const staleSwapAttention=Boolean(attentionNotificationId&&focusedSwapId&&!exactSwapAttention);
  const attentionState=exactSwapAttention?<AttentionOpenAcknowledgement/>:staleSwapAttention
    ?<AttentionTargetUnavailable message="This duty change changed after the alert was created. It was not marked as opened."/>:null;
  const staleSwap=focusedSwapId&&!focusedSwapRecord?<section className="departure-attention-state" role="alert"><strong>Duty change unavailable</strong><p>This request is no longer available to your account.</p></section>:null;
  const focusedSwapHistory=focusedSwapRecord&&!focusedSwap?<section className="departure-panel departure-swap-history"><div className="departure-swap-queue"><article id={`attention-transport-swap-${focusedSwapRecord.id}`} tabIndex={-1} className="is-attention-target"><Repeat2/><div><strong>{focusedRevisionMatches?focusedSwapRecord.status==="declined_by_school"?"Duty change declined":`Duty change ${focusedSwapRecord.status}`:"Duty change updated"}</strong><small>{focusedSwapRecord.requester_route_name} · {focusedSwapRecord.requester_service_date}{focusedSwapRecord.target_route_name?` ↔ ${focusedSwapRecord.target_route_name}`:""}</small><p>{!focusedRevisionMatches?"This request changed after this notification.":focusedSwapRecord.decision_note||focusedSwapRecord.response_note||focusedSwapRecord.reason}</p></div></article></div></section>:null;
  const coverRequests=data.swaps.some(swap=>swap.target_user_id===auth.user?.id&&swap.status==="submitted"&&swap.self_service_open===true)?<section className="departure-panel"><header><div><h2>Cover requests</h2></div><Repeat2/></header><div className="departure-swap-queue">{data.swaps.filter(swap=>swap.target_user_id===auth.user?.id&&swap.status==="submitted"&&swap.self_service_open===true).map(swap=>{const focused=swap.id===focusedSwapId;return <article key={swap.id} id={`attention-transport-swap-${swap.id}`} tabIndex={focused?-1:undefined} className={focused?"is-attention-target":undefined}><Repeat2/><div><strong>{swap.requester_name} requests {swap.request_type}</strong><small>{swap.requester_route_name} · {swap.requester_service_date}{swap.target_route_name?` ↔ ${swap.target_route_name}`:""}</small><p>{swap.reason}</p></div><div><button type="button" disabled={mutation.isPending} onClick={()=>mutation.mutate(()=>respondDutySwap(swap.id,{decision:"rejected",expected_revision:swap.revision,note:"Unable to take this duty"}))}>Decline</button><button type="button" className="departure-primary" disabled={mutation.isPending} onClick={()=>mutation.mutate(()=>respondDutySwap(swap.id,{decision:"accepted",expected_revision:swap.revision,note:"Duty change accepted for school approval"}))}>Accept</button></div></article>})}</div></section>:null;
  if(!tripId)return <OperationsShell portal="teacher" active="more" title="My rides" backTo="/teacher/more">{attentionState}<div className="departure-page departure-page--collector"><MyRides trips={data.trips}/>{staleSwap}{focusedSwapHistory}{coverRequests}{!data.trips.length?<section className="departure-panel departure-empty"><Bus size={28}/><h2>No assigned rides</h2><p>Rides appear here when the school assigns your duty.</p></section>:null}{error?<p className="departure-error" role="alert">{error}</p>:null}</div></OperationsShell>;
  return <OperationsShell portal="teacher" active="more" title="Transport & departure" schoolName={trip?.school_name??auth.memberships.find(item=>item.role==="staff")?.school_name} backTo="/teacher/transport">{attentionState}<div className="departure-page departure-page--collector">

    {!trip?coverRequests:null}
    {trip?staleSwap:null}
    {!trip?<section className="departure-panel departure-empty"><Bus size={28}/><h2>Ride unavailable</h2><p>This ride is no longer in your assigned rides.</p><Link to="/teacher/transport">Back to my rides</Link></section>:<>
      <CollectorRideCard trip={trip} map={data.map} tracker={tracker}/>
      {coverRequests}

      {trip.state==="planned"&&trip.collector_assignment_status!=="accepted"?<section className="departure-panel departure-assignment-response"><header><div><h2>{trip.collector_assignment_status==="pending"?"Can you cover this journey?":"Duty declined"}</h2></div><span className={`departure-state departure-state--${trip.collector_assignment_status}`}>{trip.collector_assignment_status}</span></header>{trip.collector_assignment_status==="pending"?<div><p>Check the route and riders below, then confirm your duty.</p><button type="button" disabled={mutation.isPending} onClick={()=>mutation.mutate(()=>tripAction(trip.id,"decline",trip.revision,"Unable to cover this journey"))}>Decline</button><button type="button" className="departure-primary" disabled={mutation.isPending} onClick={()=>mutation.mutate(()=>tripAction(trip.id,"accept",trip.revision,"Duty reviewed and accepted"))}><Check/>Accept duty</button></div>:<p className="departure-warning">School operations must assign another collector before this trip can start.</p>}</section>:null}


      {trip.state==="planned"&&trip.collector_assignment_status==="accepted"&&trip.duty_change_available?<section className="departure-panel departure-duty-change"><header><button type="button" aria-expanded={showSwap} onClick={()=>setShowSwap(value=>!value)}><Repeat2/>{showSwap?"Close duty change":"Request a duty change"}</button></header>{showSwap?<form className="departure-form" onSubmit={submitSwap}><label>Change type<select value={swapType} onChange={event=>setSwapType(event.target.value as "cover"|"exchange")}><option value="cover">Colleague covers my trip</option><option value="exchange">Exchange two trips</option></select></label><label>Colleague<select name="target_user" required value={targetUser} onChange={event=>setTargetUser(event.target.value)}><option value="">Choose colleague</option>{data.colleagues.filter(person=>person.school_id===trip.school_id).map(person=><option value={person.id} key={person.id}>{person.name}</option>)}</select></label>{swapType==="exchange"?<label className="departure-span">Their trip<select name="target_trip" required><option value="">Choose trip</option>{data.swap_candidates.filter(item=>item.assigned_collector_user_id===targetUser).map(item=><option value={item.id} key={item.id}>{item.service_date} · {item.route_name} · {item.scheduled_departure_time.slice(0,5)}</option>)}</select></label>:null}<label className="departure-span">Reason<textarea name="reason" rows={2} minLength={3} maxLength={500} required/></label><button className="departure-primary" disabled={mutation.isPending}>Send to colleague</button></form>:data.swaps.some(swap=>swap.requester_trip_id===trip.id&&["submitted","accepted"].includes(swap.status))?<p className="departure-pending"><Repeat2/>A duty change is awaiting {data.swaps.find(swap=>swap.requester_trip_id===trip.id)?.status==="submitted"?"your colleague":"school approval"}.</p>:null}</section>:null}



      {trip.collector_assignment_status==="accepted"&&(trip.state==="boarding"||(trip.state==="in_progress"&&!trip.roster.some(r=>["expected","boarded","exception"].includes(r.state)))||(trip.state==="planned"&&trip.controls_available))?<section className="departure-panel" aria-label="Journey actions"><div className="departure-trip-controls">
        {trip.state==="planned"&&trip.collector_assignment_status==="accepted"?<button className="departure-primary" disabled={mutation.isPending||!trip.controls_available} onClick={()=>mutation.mutate(()=>tripAction(trip.id,"boarding",trip.revision))}>Open boarding</button>:null}
        {trip.state==="boarding"?<button className="departure-primary" disabled={mutation.isPending||trip.roster.some(r=>r.state==="exception"||(trip.direction==="from_institution"&&r.state==="expected"))} onClick={()=>mutation.mutate(()=>tripAction(trip.id,"start",trip.revision))}>Depart and begin journey</button>:null}
        {trip.state==="in_progress"?<button disabled={mutation.isPending||trip.roster.some(item=>["expected","boarded","exception"].includes(item.state))} onClick={()=>mutation.mutate(()=>tripAction(trip.id,"complete",trip.revision))}>Complete trip</button>:null}
        {["planned","boarding"].includes(trip.state)&&trip.collector_assignment_status==="accepted"&&!trip.roster.some(rider=>["boarded","exception"].includes(rider.state))?<JourneyCancel key={trip.id} pending={mutation.isPending} onCancel={reason=>mutation.mutateAsync(()=>tripAction(trip.id,"cancel",trip.revision,reason))}/>:null}
      </div>
      {trip.state==="boarding"&&trip.roster.some(rider=>rider.state==="exception"||(trip.direction==="from_institution"&&rider.state==="expected"))?<p className="departure-warning">Account for every learner and resolve concerns below before departure.</p>:null}
      {trip.state==="in_progress"&&trip.roster.some(rider=>["boarded","expected","exception"].includes(rider.state))?<p className="departure-privacy-note">Record each learner’s arrival, handover or non-travel outcome before closing this journey.</p>:null}
      </section>:null}
      {error?<p className="departure-error" role="alert">{error}</p>:null}

      <JourneyRoster key={trip.id} trip={trip} pending={mutation.isPending} onRecord={async(rider,state,note)=>{await mutation.mutateAsync(()=>updateRider(trip.id,rider.student_id,{state,expected_revision:rider.revision,note}));}}/>

    </>}
  </div></OperationsShell>;
}
