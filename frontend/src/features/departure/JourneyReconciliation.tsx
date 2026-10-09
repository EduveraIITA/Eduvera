import { useMutation,useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { closeManagedJourney,reconcileJourneyRider,type JourneyDetail } from "./api";

export function JourneyReconciliation({schoolId,data}:{schoolId:string;data:JourneyDetail}) {
  const client=useQueryClient();const [open,setOpen]=useState(false);const [error,setError]=useState("");
  const {trip,roster}=data;const unresolved=roster.filter(rider=>["expected","boarded","exception"].includes(rider.state));
  const [studentId,setStudentId]=useState(unresolved[0]?.student_id??"");
  const [note,setNote]=useState("");
  const selected=unresolved.find(rider=>rider.student_id===studentId)??unresolved[0];
  const mutation=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),onSuccess:async()=>{setNote("");setError("");await client.invalidateQueries({queryKey:["departure"]});},onError:cause=>{setError(cause instanceof Error?cause.message:"The record could not be saved.");void client.invalidateQueries({queryKey:["departure"]});}});
  if(["completed","cancelled"].includes(trip.state)) return null;
  const canCancel=["planned","boarding"].includes(trip.state)&&!roster.some(rider=>["boarded","exception"].includes(rider.state));
  const canClose=trip.state==="in_progress"&&!unresolved.length;
  return <section className="departure-panel"><header><h2>School review</h2><button type="button" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>{open?"Close review":"Review outcomes"}</button></header>
    {open?<form className="departure-form" onSubmit={event=>{event.preventDefault();if(!selected)return;const form=new FormData(event.currentTarget);mutation.mutate(()=>reconcileJourneyRider(schoolId,trip.id,selected.student_id,{state:form.get("outcome"),expected_revision:selected.revision,note}));}}>
      <p className="departure-span">Confirm the facts with the attendant and school before correcting a missing outcome. This does not record new boarding or replace a completed handover.</p>
      {selected&&["boarding","in_progress"].includes(trip.state)?<>
        <label>Learner<select value={selected.student_id} onChange={event=>{setStudentId(event.target.value);setNote("");}}>{unresolved.map(rider=><option key={rider.student_id} value={rider.student_id}>{rider.student_name} · {rider.state.replaceAll("_"," ")}</option>)}</select></label>
        <label>Confirmed outcome<select name="outcome" key={selected.student_id+":"+selected.revision} required defaultValue=""><option value="" disabled>Choose verified outcome</option>
          {selected.boarded_at&&trip.state==="in_progress"?<option value="dropped">{trip.direction==="to_institution"?"Received at school":"Handed to verified receiver"}</option>:null}
          {!selected.boarded_at?<option value="not_riding">Did not travel</option>:null}
          {selected.state!=="exception"?<option value="exception">Needs investigation</option>:null}
        </select></label>
      </>:null}
      <label className="departure-span">Review record<textarea value={note} onChange={event=>setNote(event.target.value)} minLength={3} maxLength={500} required rows={3} placeholder="Who confirmed the outcome, and what was verified?"/></label>
      {selected&&["boarding","in_progress"].includes(trip.state)?<button className="departure-primary" disabled={mutation.isPending||note.trim().length<3}>Save verified outcome</button>:null}
      {canClose||canCancel?<button type="button" disabled={mutation.isPending||note.trim().length<3} onClick={()=>mutation.mutate(()=>closeManagedJourney(schoolId,trip.id,canClose?"complete":"cancel",{expected_revision:trip.revision,note}))}>{canClose?"Close reconciled journey":"Cancel unoccupied journey"}</button>:null}
      {error?<p className="departure-error departure-span" role="alert">{error}</p>:null}
    </form>:null}
  </section>;
}
