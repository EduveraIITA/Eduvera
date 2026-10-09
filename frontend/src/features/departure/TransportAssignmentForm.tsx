import { useState } from "react";
import type { AdminDeparture } from "./api";

export function TransportAssignmentForm({data,pending,onSubmit}:{data:AdminDeparture;pending:boolean;onSubmit:(input:Record<string,unknown>)=>void}) {
  const [routeId,setRouteId]=useState(data.routes.find(route=>route.status==="active")?.id??"");
  const [direction,setDirection]=useState("from_institution");
  const stops=data.routes.find(route=>route.id===routeId)?.stops.filter(stop=>stop.direction===direction)??[];
  const localDate=new Intl.DateTimeFormat("en-CA",{timeZone:data.school.timezone}).format(new Date());
  return <form className="departure-form" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);onSubmit({student_id:form.get("student_id"),route_id:routeId,direction,stop_id:form.get("stop_id"),valid_from:form.get("valid_from"),valid_until:form.get("valid_until")||null});}}>
    <label>Learner<select name="student_id" required defaultValue=""><option value="">Choose learner</option>{data.students.map(student=><option key={student.id} value={student.id}>{student.name} · {student.admission_number}</option>)}</select></label>
    <label>Route<select value={routeId} onChange={event=>setRouteId(event.target.value)} required>{data.routes.filter(route=>route.status==="active").map(route=><option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
    <label>Direction<select value={direction} onChange={event=>setDirection(event.target.value)}><option value="from_institution">From school</option><option value="to_institution">To school</option></select></label>
    <label>Stop<select key={`${routeId}:${direction}`} name="stop_id" required defaultValue=""><option value="">Choose stop</option>{stops.map(stop=><option key={stop.id} value={stop.id}>{stop.sequence}. {stop.name}</option>)}</select>{!stops.length?<small>Add stops for this route direction first.</small>:null}</label>
    <label>Starts<input name="valid_from" type="date" min={localDate} defaultValue={localDate} required/></label><label>Ends (optional)<input name="valid_until" type="date" min={localDate}/></label>
    <p className="departure-span">Prepared trips keep their roster. Refresh each affected planned trip and review any retained riders before boarding.</p>
    <button className="departure-primary" disabled={pending||!stops.length}>{pending?"Saving…":"Assign learner"}</button>
  </form>;
}
