import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { requestDepartureChange, withdrawDepartureRequest, type DepartureMode, type FamilyDeparture } from "./api";
import { FamilyJourneyCard } from "./FamilyJourneyCard";
const labels:Record<DepartureMode,string>={guardian_pickup:"Guardian pickup",authorized_collector:"Authorized collector",independent_departure:"Independent departure",school_transport:"School bus",external_transport:"Family or external transport"};

export function FamilyDepartureContent({data,actorId}:{data:FamilyDeparture;actorId:string}) {
  const client=useQueryClient();const [open,setOpen]=useState(false);const [error,setError]=useState("");
  const [mode,setMode]=useState<DepartureMode>(data.policy.enabled_modes.find(item=>item!=="school_transport")??"guardian_pickup");
  const mutation=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),onSuccess:async()=>{setOpen(false);setError("");await client.invalidateQueries({queryKey:["departure"]});},onError:cause=>{setError(cause instanceof Error?cause.message:"The change could not be saved.");void client.invalidateQueries({queryKey:["departure"]});}});
  const requiresReceiver=["guardian_pickup","authorized_collector"].includes(mode);
  const authorities=data.authorities.filter(item=>item.kind===(mode==="guardian_pickup"?"guardian":"collector"));
  const pending=data.requests.find(request=>request.status==="submitted"&&request.service_date===data.service_date);
  const onJourney=data.journeys.some(journey=>journey.direction==="from_institution"&&(journey.rider_state==="boarded"||journey.rider_state==="exception"));
  const canChange=!onJourney&&data.can_request&&data.policy.enabled&&data.service_date>=data.local_date&&!["completed","cancelled"].includes(data.plan?.state??"")&&data.policy.enabled_modes.some(item=>item!=="school_transport");
  const journeys=[...data.journeys].sort((a,b)=>Number(b.state==="in_progress"&&b.rider_state==="boarded")-Number(a.state==="in_progress"&&a.rider_state==="boarded"));
  return <>
    {!data.policy.enabled?<p className="departure-warning" role="status">Online departure coordination is disabled. Confirm arrangements with the school office.</p>:null}
    {journeys.map(journey=><FamilyJourneyCard key={journey.id} journey={journey} map={data.map}/>)}
    <section className="ride-arrangement"><div><span>Departure arrangement</span><h2>{data.plan?labels[data.plan.mode]:"Not arranged"}</h2>{data.plan?.external_arrangement?<p>{data.plan.external_arrangement}</p>:!data.plan?<p>Confirm departure with the school office.</p>:null}</div>{data.plan?<span className={`departure-state departure-state--${data.plan.state}`}>{data.plan.state.replaceAll("_"," ")}</span>:null}</section>
    {onJourney&&data.can_request?<p className="departure-privacy-note">For a change while the journey is underway or needs attention, contact the school office.</p>:null}
    {error?<p className="departure-error" role="alert">{error}</p>:null}
    {canChange&&!pending?<button type="button" className="departure-primary" onClick={()=>setOpen(value=>!value)}>{open?"Close request":"Request a departure change"}</button>:null}
    {open&&canChange&&!pending?<section className="departure-panel"><form className="departure-form" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);mutation.mutate(()=>requestDepartureChange({student_id:data.student.id,service_date:data.service_date,mode,authority_id:requiresReceiver?form.get("authority_id"):null,external_arrangement:mode==="external_transport"?form.get("external_arrangement"):"",reason:form.get("reason")}));}}>
      <p className="departure-span">For {data.service_date}. Same-day requests close at {data.policy.change_cutoff.slice(0,5)} school time. The requested arrangement is not approved until school review.</p>
      <label>Arrangement<select value={mode} onChange={event=>setMode(event.target.value as DepartureMode)}>{data.policy.enabled_modes.filter(item=>item!=="school_transport").map(item=><option value={item} key={item}>{labels[item]}</option>)}</select></label>
      {requiresReceiver?<label>Approved receiver<select name="authority_id" key={`${mode}:${data.service_date}`} required defaultValue=""><option value="">Choose receiver</option>{authorities.map(item=><option value={item.id} key={item.id}>{item.name}{item.phone_last4?` · •••• ${item.phone_last4}`:""}</option>)}</select>{!authorities.length?<small>The school must verify a receiver for this date first.</small>:null}</label>:null}
      {mode==="external_transport"?<label>External arrangement<input name="external_arrangement" required minLength={3} maxLength={300}/></label>:null}
      <label className="departure-span">Reason<textarea name="reason" minLength={3} maxLength={500} rows={3} required/></label>
      <button className="departure-primary" disabled={mutation.isPending||(requiresReceiver&&!authorities.length)}>{mutation.isPending?"Submitting…":"Submit for review"}</button>
    </form></section>:null}
    {data.can_request&&data.requests.length?<section className="departure-panel"><header><h2>Change requests</h2></header><div className="departure-request-list">{data.requests.map(request=><article key={request.id}><div><strong>{labels[request.requested_mode]}</strong><small>{request.service_date} · {request.status.replaceAll("_"," ")}</small><p>{request.reason}</p>{request.decision_note?<p>School response: {request.decision_note}</p>:null}</div>{request.status==="submitted"&&request.requester_user_id===actorId?<button disabled={mutation.isPending} onClick={()=>mutation.mutate(()=>withdrawDepartureRequest(request.id,request.revision))}>Withdraw request</button>:null}</article>)}</div></section>:null}
  </>;
}
