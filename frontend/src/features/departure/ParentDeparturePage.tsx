import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, CheckCircle2, Clock3, MapPin, Route, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ParentShell } from "../../pages/parent/ParentShell";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { getFamilyDeparture, requestDepartureChange, type DepartureMode } from "./api";
import { LiveMap } from "./LiveMap";
import "./departure.css";

const labels:Record<DepartureMode,string>={guardian_pickup:"Guardian pickup",authorized_collector:"Authorized collector",independent_departure:"Independent departure",school_transport:"School bus",external_transport:"Family or external transport"};
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
const formValue=(form:FormData,key:string)=>{const entry=form.get(key);return typeof entry==="string"?entry.trim():"";};

export default function ParentDeparturePage(){
  const [params,setParams]=useSearchParams(); const studentId=params.get("student_id")??undefined; const queryClient=useQueryClient();
  const query=useQuery({queryKey:["departure","family",studentId??"default"],queryFn:()=>getFamilyDeparture(studentId),refetchInterval:(q)=>q.state.data?.trip?.state==="in_progress"?10_000:false});
  const [open,setOpen]=useState(false); const [error,setError]=useState("");
  const mutation=useMutation({mutationFn:requestDepartureChange,onSuccess:async()=>{setOpen(false);setError("");await queryClient.invalidateQueries({queryKey:["departure","family"]});},onError:(cause)=>setError(cause instanceof Error?cause.message:"Request could not be submitted.")});
  if(query.isPending)return <ScreenLoading/>; if(query.error||!query.data)return <LiveRouteError error={query.error??new Error("Departure information is unavailable.")} onRetry={query.refetch}/>;
  const data=query.data; const plan=data.plan; const trip=data.trip; const child={id:data.student.id,name:`${data.student.first_name} ${data.student.last_name}`.trim(),grade:data.student.grade??"",section:data.student.section??"",board:"",rollNumber:"",avatarUrl:data.student.avatar_url};
  const location=trip?.latitude&&trip.longitude?{lat:Number(trip.latitude),lng:Number(trip.longitude),accuracy:Number(trip.accuracy_metres??0)}:null;
  return <ParentShell active="more" pageLabel="Departure" backTo="/parent/more" child={child} selectedChildId={data.student.id} childOptions={data.children.map(item=>({id:item.id,name:`${item.first_name} ${item.last_name}`.trim(),grade:item.grade??"",section:item.section??"",avatarUrl:item.avatar_url}))} onSelectChild={(id)=>{const next=new URLSearchParams(params);next.set("student_id",id);setParams(next);}}>
    <div className="departure-page">
      <section className="departure-status" aria-labelledby="departure-status-title">
        <div><span>Today</span><h2 id="departure-status-title">{plan?labels[plan.mode]:"No departure plan"}</h2>{!plan?<p>Contact the school office before dismissal.</p>:null}</div>
        <span className={`departure-state departure-state--${plan?.state??"missing"}`}>{plan?.state==="completed"?<CheckCircle2/>:plan?.mode==="school_transport"?<Bus/>:<ShieldCheck/>}{plan?.state??"Not set"}</span>
      </section>

      {plan?.mode==="school_transport"&&trip?<section className="departure-panel departure-journey">
        <header><div><span>School transport</span><h2>{trip.route_name}</h2><p>{trip.vehicle_label||trip.provider_name||trip.route_code} · Drop at {trip.stop_name}</p></div><b className={`departure-state departure-state--${trip.rider_state}`}>{trip.rider_state.replaceAll("_"," ")}</b></header>
        {location&&trip.state==="in_progress"&&trip.rider_state==="boarded"?<>
          <LiveMap latitude={location.lat} longitude={location.lng} accuracy={location.accuracy} tileUrl={data.map.tile_url} attribution={data.map.attribution}/>
          <div className={`departure-location-age ${trip.location_fresh?"is-live":"is-stale"}`}><MapPin size={16}/><strong>{trip.location_fresh?"Location updating":"Location is delayed"}</strong><span>{trip.observed_at?new Date(trip.observed_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"Waiting for collector"}{trip.accuracy_metres?` · ±${Math.round(Number(trip.accuracy_metres))} m`:""}</span></div>
        </>:<div className="departure-map-empty"><Bus size={28}/><strong>{trip.rider_state==="dropped"?"Drop-off completed":trip.state==="in_progress"?"Location appears after boarding":"Journey has not departed"}</strong><span>Precise location is visible only while your child is on this trip.</span></div>}
      </section>:null}

      <section className="departure-panel departure-arrangement"><header><div><span>Approved arrangement</span><h2>{plan?labels[plan.mode]:"School review needed"}</h2></div><Clock3 size={21}/></header>
        {plan?.mode==="external_transport"?<p>{plan.external_arrangement}</p>:null}
        {data.request?<p className="departure-pending"><Clock3 size={16}/>Change request awaiting school review: {labels[data.request.requested_mode]}</p>:null}
        <button type="button" className="departure-primary" disabled={Boolean(data.request)} onClick={()=>setOpen(value=>!value)}>Request a change</button>
      </section>

      {open?<section className="departure-panel"><header><div><span>Change request</span><h2>Different arrangement</h2></div><Route size={21}/></header><form className="departure-form" onSubmit={(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const requestedMode=formValue(form,"mode") as DepartureMode;const requiresReceiver=["guardian_pickup","authorized_collector"].includes(requestedMode);mutation.mutate({student_id:data.student.id,service_date:formValue(form,"service_date"),mode:requestedMode,authority_id:requiresReceiver?(formValue(form,"authority_id")||null):null,external_arrangement:formValue(form,"external_arrangement"),reason:formValue(form,"reason")});}}>
        <label>Date<input name="service_date" type="date" min={today()} defaultValue={today()} required/></label>
        <label>Arrangement<select name="mode" required defaultValue={data.policy.enabled_modes.find(item=>item!=="school_transport")}>{data.policy.enabled_modes.filter(item=>item!=="school_transport").map(item=><option value={item} key={item}>{labels[item]}</option>)}</select></label>
        {data.authorities.length?<label>Approved receiver<select name="authority_id" defaultValue={data.authorities[0]?.id}>{data.authorities.map(item=><option value={item.id} key={item.id}>{item.name}{item.phone_last4?` · •••• ${item.phone_last4}`:""}</option>)}</select></label>:<p className="departure-warning">The school must verify a collector before approving an adult pickup.</p>}
        <label>External arrangement, if selected<input name="external_arrangement" maxLength={300} placeholder="Service or family arrangement"/></label>
        <label>Reason<textarea name="reason" minLength={3} maxLength={500} rows={3} required/></label>
        {error?<p className="departure-error" role="alert">{error}</p>:null}<div className="departure-form-actions"><button type="button" onClick={()=>setOpen(false)}>Cancel</button><button className="departure-primary" disabled={mutation.isPending}>{mutation.isPending?"Submitting…":"Submit for review"}</button></div>
      </form></section>:null}
    </div>
  </ParentShell>;
}
