import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronLeft, ChevronRight, RefreshCw, Repeat2, UserRoundCheck } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  assignTripCollector,
  createTransportServicePattern,
  decideDutySwap,
  generateTransportTrips,
  refreshTransportRoster,
  type AdminDeparture,
  type TransportTrip,
} from "./api";

const indiaToday=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
const read=(form:FormData,key:string)=>{const value=form.get(key);return typeof value==="string"?value.trim():"";};
const iso=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
const addDays=(value:Date,days:number)=>new Date(value.getFullYear(),value.getMonth(),value.getDate()+days);
const startOfWeek=(value:string)=>{const date=new Date(`${value}T12:00:00`);const weekday=date.getDay()||7;return addDays(date,1-weekday);};
const dateLabel=(value:string)=>new Intl.DateTimeFormat("en-IN",{weekday:"short",day:"numeric",month:"short"}).format(new Date(`${value}T12:00:00`));
const timeLabel=(value:string)=>new Intl.DateTimeFormat("en-IN",{hour:"numeric",minute:"2-digit"}).format(new Date(`2020-01-01T${value.slice(0,5)}:00`));
const directionLabel=(value:string)=>value==="to_institution"?"To institution":"From institution";

export function TransportDutyPlanner({schoolId,data}:{schoolId:string;data:AdminDeparture}){
  const client=useQueryClient();
  const [week,setWeek]=useState(()=>startOfWeek(indiaToday()));
  const [showPattern,setShowPattern]=useState(false);
  const [assignmentTrip,setAssignmentTrip]=useState<TransportTrip|null>(null);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const dates=useMemo(()=>Array.from({length:7},(_,index)=>iso(addDays(week,index))),[week]);
  const run=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),onSuccess:async()=>{setError("");setAssignmentTrip(null);await client.invalidateQueries({queryKey:["departure"]});},onError:cause=>setError(cause instanceof Error?cause.message:"The transport plan could not be updated.")});
  const tripsByDate=useMemo(()=>new Map(dates.map(day=>[day,data.trips.filter(trip=>trip.service_date===day)])),[data.trips,dates]);

  const prepareWeek=()=>run.mutate(async()=>{const result=await generateTransportTrips(schoolId,{from_date:dates[0],to_date:dates[6]}) as {created_count?:number;existing_count?:number};setMessage(`${result.created_count??0} trips prepared · ${result.existing_count??0} already existed`);return result;});
  const createPattern=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);run.mutate(async()=>{const result=await createTransportServicePattern(schoolId,{route_id:read(form,"route_id"),label:read(form,"label"),direction:read(form,"direction"),weekdays:form.getAll("weekdays").map(Number),departure_time:read(form,"departure_time"),primary_collector_user_id:read(form,"primary"),backup_collector_user_id:read(form,"backup")||null,valid_from:read(form,"valid_from"),valid_until:read(form,"valid_until")||null});setShowPattern(false);setMessage("Service pattern saved. Prepare a week when the roster is ready.");return result;});};

  return <section className="departure-panel departure-duty-planner">
    <header><div><span>Duty planner</span><h2>Weekly trips and rosters</h2></div><CalendarDays size={22}/></header>
    <div className="departure-planner-toolbar">
      <div className="departure-week-nav"><button type="button" aria-label="Previous week" onClick={()=>setWeek(addDays(week,-7))}><ChevronLeft/></button><strong>{dateLabel(dates[0]!)} – {dateLabel(dates[6]!)}</strong><button type="button" aria-label="Next week" onClick={()=>setWeek(addDays(week,7))}><ChevronRight/></button></div>
      <div><button type="button" onClick={()=>setWeek(startOfWeek(indiaToday()))}>Current week</button><button type="button" onClick={()=>setShowPattern(value=>!value)}><Repeat2/>New schedule</button><button type="button" className="departure-primary" disabled={run.isPending||!data.patterns.length} onClick={prepareWeek}><CalendarDays/>Prepare week</button></div>
    </div>

    {showPattern?<form className="departure-form departure-pattern-form" onSubmit={createPattern}>
      <label>Schedule name<input name="label" placeholder="South route afternoon" minLength={2} required/></label>
      <label>Route<select name="route_id" required>{data.routes.map(route=><option value={route.id} key={route.id}>{route.name}</option>)}</select></label>
      <label>Direction<select name="direction"><option value="from_institution">From institution</option><option value="to_institution">To institution</option></select></label>
      <label>Departure time<input name="departure_time" type="time" defaultValue="15:30" required/></label>
      <fieldset className="departure-mode-options departure-span"><legend>Operating days</legend>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day,index)=><label key={day}><input type="checkbox" name="weekdays" value={index+1} defaultChecked={index<6}/>{day}</label>)}</fieldset>
      <label>Primary collector<select name="primary" required>{data.collectors.map(person=><option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
      <label>Backup collector<select name="backup"><option value="">No backup</option>{data.collectors.map(person=><option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
      <label>Starts<input name="valid_from" type="date" defaultValue={indiaToday()} required/></label>
      <label>Ends<input name="valid_until" type="date" min={indiaToday()}/></label>
      <div className="departure-form-actions"><button type="button" onClick={()=>setShowPattern(false)}>Cancel</button><button className="departure-primary" disabled={run.isPending}>Save schedule</button></div>
    </form>:null}

    {data.patterns.length?<div className="departure-pattern-strip" aria-label="Active transport schedules">{data.patterns.map(pattern=><article key={pattern.id}><div><strong>{pattern.label}</strong><small>{pattern.route_name} · {timeLabel(pattern.departure_time)}</small></div><span>{pattern.weekdays.map(day=>["","M","T","W","T","F","S","S"][day]).join(" ")}</span><small>{pattern.primary_collector_name}{pattern.backup_collector_name?` · backup ${pattern.backup_collector_name}`:""}</small></article>)}</div>:<p className="departure-empty">Create a service schedule, then prepare the week.</p>}

    <div className="departure-week-grid">{dates.map(day=>{const trips=tripsByDate.get(day)??[];return <section key={day} className={day===indiaToday()?"is-today":""}><header><strong>{dateLabel(day)}</strong><span>{trips.length} {trips.length===1?"trip":"trips"}</span></header>{trips.length?trips.map(trip=><article key={trip.id} className="departure-duty-card"><div className="departure-duty-time"><strong>{timeLabel(trip.scheduled_departure_time)}</strong><small>{directionLabel(trip.direction)}</small></div><div className="departure-duty-main"><strong>{trip.route_name}</strong><small>{trip.collector_name}{trip.backup_collector_name?` · backup ${trip.backup_collector_name}`:""}</small><div><span className={`departure-state departure-state--${trip.collector_assignment_status}`}>{trip.collector_assignment_status}</span><span>{trip.roster_count} riders</span></div></div>{trip.state==="planned"?<div className="departure-duty-actions"><button type="button" title="Refresh roster" aria-label={`Refresh ${trip.route_name} roster`} onClick={()=>run.mutate(()=>refreshTransportRoster(schoolId,trip.id,trip.revision))}><RefreshCw/></button><button type="button" title="Assign staff" aria-label={`Assign ${trip.route_name} staff`} onClick={()=>setAssignmentTrip(trip)}><UserRoundCheck/></button></div>:<span className={`departure-state departure-state--${trip.state}`}>{trip.state.replaceAll("_"," ")}</span>}</article>):<p>No scheduled trip</p>}</section>})}</div>

    {assignmentTrip?<form className="departure-form departure-inline-assignment" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);run.mutate(()=>assignTripCollector(schoolId,assignmentTrip.id,{collector_user_id:read(form,"collector"),backup_collector_user_id:read(form,"backup")||null,expected_revision:assignmentTrip.revision,note:read(form,"note")}));}}><div className="departure-span"><strong>Assign {assignmentTrip.route_name}</strong><small>{dateLabel(assignmentTrip.service_date)} · {timeLabel(assignmentTrip.scheduled_departure_time)}</small></div><label>Primary<select name="collector" defaultValue={assignmentTrip.assigned_collector_user_id}>{data.collectors.map(person=><option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>Backup<select name="backup" defaultValue={assignmentTrip.backup_collector_user_id??""}><option value="">No backup</option>{data.collectors.map(person=><option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label className="departure-span">Reason<input name="note" defaultValue="Duty assigned by transport operations" minLength={3} required/></label><div className="departure-form-actions"><button type="button" onClick={()=>setAssignmentTrip(null)}>Cancel</button><button className="departure-primary">Send assignment</button></div></form>:null}

    {data.swaps.length?<div className="departure-swap-queue"><h3>Duty changes</h3>{data.swaps.map(swap=><article key={swap.id}><Repeat2/><div><strong>{swap.requester_name} → {swap.target_name}</strong><small>{swap.requester_route_name} · {dateLabel(swap.requester_service_date)}{swap.request_type==="exchange"?` ↔ ${swap.target_route_name} · ${dateLabel(swap.target_service_date!)}`:" · cover"}</small><p>{swap.reason}</p></div><span className={`departure-state departure-state--${swap.status}`}>{swap.status}</span>{swap.status==="accepted"?<div><button type="button" disabled={run.isPending} onClick={()=>run.mutate(()=>decideDutySwap(schoolId,swap.id,{decision:"declined_by_school",expected_revision:swap.revision,note:"School operations did not approve this change"}))}>Decline</button><button type="button" className="departure-primary" disabled={run.isPending} onClick={()=>run.mutate(()=>decideDutySwap(schoolId,swap.id,{decision:"approved",expected_revision:swap.revision,note:"Duty change approved by school operations"}))}><Check/>Approve</button></div>:<small>Waiting for colleague</small>}</article>)}</div>:null}
    {message?<p className="departure-success" role="status">{message}</p>:null}{error?<p className="departure-error" role="alert">{error}</p>:null}
  </section>;
}
