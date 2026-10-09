import { useState } from "react";
import type { AdminDeparture } from "./api";

type Plan=AdminDeparture["plans"][number];
export function HandoverForm({plan,pending,onSave}:{plan:Plan;pending:boolean;onSave:(input:Record<string,unknown>)=>Promise<unknown>}) {
  const [open,setOpen]=useState(false);
  const [note,setNote]=useState("");
  const [outcome,setOutcome]=useState(plan.mode==="independent_departure"?"departed_independently":"handed_over");
  if(!open) return <button className="departure-primary" onClick={()=>setOpen(true)}>Record handover</button>;
  return <form className="departure-rider-confirm" onSubmit={async event=>{
    event.preventDefault();
    try { await onSave({expected_revision:plan.revision,outcome,evidence_method:"in_person_verification",note,occurred_at:new Date().toISOString()});setOpen(false);setNote(""); }
    catch { /* Keep entered evidence available after the parent displays the error. */ }
  }}>
    <p>{plan.collector_name?`Approved receiver: ${plan.collector_name}`:plan.mode==="independent_departure"?"Independent departure is approved for this date.":"Verify the approved external arrangement before release."}</p>
    <label>Observed outcome<select value={outcome} onChange={event=>setOutcome(event.target.value)}>
      {plan.mode==="independent_departure"?<option value="departed_independently">Departed independently</option>:<option value="handed_over">Handed to approved receiver</option>}
      <option value="refused">Handover refused</option><option value="no_show">Receiver did not arrive</option><option value="escalated">School assistance needed</option>
    </select></label>
    <label>Verification record<textarea required minLength={3} maxLength={500} rows={2} value={note} onChange={event=>setNote(event.target.value)} placeholder="Who was present and what did you verify?"/></label>
    <div><button type="button" disabled={pending} onClick={()=>setOpen(false)}>Cancel</button><button className="departure-primary" disabled={pending||note.trim().length<3}>{pending?"Saving…":"Confirm outcome"}</button></div>
  </form>;
}
