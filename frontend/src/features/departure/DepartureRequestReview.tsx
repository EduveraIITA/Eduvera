import { useState } from "react";
import type { AdminDeparture,DepartureRequest } from "./api";

export function DepartureRequestReview({request,data,pending,onDecide}:{request:DepartureRequest;data:AdminDeparture;pending:boolean;onDecide:(decision:"approved"|"rejected",note:string)=>Promise<unknown>}) {
  const [open,setOpen]=useState(false);const [note,setNote]=useState("");
  const receiver=data.authorities.find(item=>item.id===request.requested_authority_id);
  const trip=data.trips.find(item=>item.id===request.requested_trip_id);
  const stop=data.routes.flatMap(route=>route.stops).find(item=>item.id===request.requested_stop_id);
  return <>
    {!open?<button type="button" onClick={()=>setOpen(true)}>Review request</button>:<div className="departure-rider-confirm">
      {request.requested_authority_id?<p>Receiver: {receiver?.collector_name??"No longer active — verify with school"}</p>:null}
      {request.external_arrangement?<p>Arrangement: {request.external_arrangement}</p>:null}
      {request.requested_trip_id?<p>Bus: {trip?.route_name??"Trip unavailable"} · {stop?.name??"Stop unavailable"}</p>:null}
      <label>Review note<textarea value={note} onChange={event=>setNote(event.target.value)} minLength={3} maxLength={500} rows={2} placeholder="Record the checks completed or the reason for declining."/></label>
      <div><button type="button" disabled={pending} onClick={()=>setOpen(false)}>Back</button><button type="button" disabled={pending||note.trim().length<3} onClick={()=>void onDecide("rejected",note).catch(()=>undefined)}>Decline</button><button type="button" className="departure-primary" disabled={pending||note.trim().length<3} onClick={()=>void onDecide("approved",note).catch(()=>undefined)}>Approve change</button></div>
    </div>}
  </>;
}
