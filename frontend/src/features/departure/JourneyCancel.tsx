import { useState } from "react";
export function JourneyCancel({pending,onCancel}:{pending:boolean;onCancel:(reason:string)=>Promise<unknown>}) {
  const [open,setOpen]=useState(false);const [reason,setReason]=useState("");
  if(!open)return <button type="button" onClick={()=>setOpen(true)}>Cancel journey</button>;
  return <form className="departure-rider-confirm" onSubmit={async event=>{event.preventDefault();try{await onCancel(reason);setOpen(false);}catch{/* Parent reports failure; retain reason. */}}}>
    <p>Families will see the cancellation. School operations must arrange an alternative departure.</p>
    <label>Cancellation reason<textarea required minLength={3} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <div><button type="button" disabled={pending} onClick={()=>setOpen(false)}>Keep journey</button><button disabled={pending||reason.trim().length<3}>Confirm cancellation</button></div>
  </form>;
}
