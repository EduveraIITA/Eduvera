import { useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { applicationNow } from "../simulation/applicationTime";
import { getResourceLoan, returnResource, type ResourceCondition, type ResourceLoanDetail } from "./resourceApi";
import { ResourceWriteFeedback } from "./ResourceWriteFeedback";
import { resourceInputInstant, resourceInputTime, resourceInputZone } from "./resourceTime";
import { useResourceCommand } from "./useResourceCommand";

export function ResourceReturnDialog({schoolId,loan,correction=false,refresh,onClose,onSaved}: {
  schoolId:string;loan:ResourceLoanDetail;correction?:boolean;refresh:()=>Promise<unknown>;onClose:()=>void;onSaved:()=>void;
}) {
  const [current,setCurrent]=useState(loan),[observed,setObserved]=useState(()=>resourceInputTime(applicationNow(),"instant"));
  const [reason,setReason]=useState(""),[supersedes,setSupersedes]=useState("");
  const [received,setReceived]=useState<Record<string,{quantity:number;condition:ResourceCondition}>>({});
  const [reviewing,setReviewing]=useState(false),[error,setError]=useState("");
  const write=useResourceCommand({schoolId,loanId:loan.id,refresh,onAccepted:onSaved});
  const replaced=new Set(current.history.flatMap(receipt=>receipt.supersedes_receipt_id ? [receipt.supersedes_receipt_id] : []));
  const returns=current.history.filter(receipt=>["return_recorded","return_corrected"].includes(receipt.action) && !replaced.has(receipt.id));
  const original=returns.find(receipt=>receipt.id===supersedes),missingTarget=Boolean(supersedes && !original);
  const parts=current.parts.map(part=>({...part,receivable_quantity:part.outstanding_quantity+(original?.parts.find(entry=>entry.part_id===part.id)?.quantity ?? 0)})).filter(part=>part.receivable_quantity>0);
  const chooseReceipt=(id:string)=>{
    setSupersedes(id);setError("");const receipt=returns.find(entry=>entry.id===id);
    setReceived(Object.fromEntries(receipt?.parts.map(part=>[part.part_id,{quantity:part.quantity,condition:part.condition}]) ?? []));
    setObserved(resourceInputTime(receipt?.observed_at ?? applicationNow(),"instant"));
  };
  const submit=(event:FormEvent)=>{
    event.preventDefault();setError("");
    if(missingTarget)return;
    if(!original && !Object.values(received).some(part=>part.quantity>0)){setError("Choose what you received.");return;}
    let observedAt:string;try{observedAt=resourceInputInstant(observed);}catch{setError("Choose when the items were received.");return;}
    if(Date.parse(observedAt)<Date.parse(current.issued_at) || Date.parse(observedAt)>applicationNow().getTime()){setError("Receipt time must be between issue and the current time.");return;}
    if(correction && reason.trim().length<3){setError("Add the reason for this correction.");return;}
    const body={expected_revision:current.revision,observed_at:observedAt,reason:reason.trim(),correction,
      ...(supersedes ? {supersedes_receipt_id:supersedes} : {}),
      parts:Object.entries(received).filter(([,value])=>value.quantity>0).map(([part_id,value])=>({part_id,...value}))};
    void write.execute(command_id=>returnResource(schoolId,loan.id,{...body,command_id}),{loanId:loan.id,expectedRevision:current.revision});
  };
  const review=async()=>{
    setReviewing(true);setError("");
    try{
      const next=await getResourceLoan(schoolId,loan.id);setCurrent(next);
      // Retain choices, but never silently increase a quantity after another return.
      const nextOriginal=next.history.find(receipt=>receipt.id===supersedes && !next.history.some(later=>later.supersedes_receipt_id===receipt.id));
      setReceived(previous=>Object.fromEntries(Object.entries(previous).map(([id,value])=>[id,{...value,quantity:Math.min(value.quantity,(next.parts.find(part=>part.id===id)?.outstanding_quantity ?? 0)+(nextOriginal?.parts.find(part=>part.part_id===id)?.quantity ?? 0))}])));
      write.clearObsolete();
    }catch(cause){setError(cause instanceof Error ? cause.message : "The current record could not be loaded.");}
    finally{setReviewing(false);}
  };
  const locked=write.locked || reviewing;
  const pending=write.busy || Boolean(write.recovery) || reviewing;
  return <PlannerDialog title={correction ? "Correct return record" : "Record return"} subtitle={loan.title} busy={pending} onClose={onClose}>
    <form className="resource-form" onSubmit={submit}>
      <fieldset disabled={locked}>
        {correction ? <label>Return to correct<select value={supersedes} onChange={event=>chooseReceipt(event.target.value)}><option value="">Add a missed return</option>{missingTarget ? <option value={supersedes} disabled>Earlier receipt is no longer current</option> : null}{returns.map(receipt=><option value={receipt.id} key={receipt.id}>{receipt.actor_label} · {new Date(receipt.recorded_at).toLocaleString()}</option>)}</select></label> : null}
        <p className="resource-caption">{original ? "Keep only what was actually received in this return. Unticking all parts reopens them. The original receipt stays in history." : "Select only what you have received. Anything missing stays out."}</p>
        {missingTarget ? <p role="alert" className="resource-error">That return has changed. Choose its current receipt before continuing.</p> : null}
        {!parts.length ? <p role="status">Nothing remains to return.</p> : parts.map(part=><section key={part.id} className="resource-return-part">
          <label className="resource-check"><input type="checkbox" checked={Boolean(received[part.id])} onChange={event=>setReceived(previous=>{
            const next={...previous};if(event.target.checked)next[part.id]={quantity:part.receivable_quantity,condition:"usable"};else delete next[part.id];return next;
          })} /><span><strong>{part.label}</strong><small className="resource-caption">{original ? `${original.parts.find(entry=>entry.part_id===part.id)?.quantity ?? 0} in the earlier receipt` : `${part.outstanding_quantity} still out`}</small></span></label>
          {received[part.id] ? <div className="resource-pair"><label>Received<input type="number" required min={original ? 0 : 1} max={part.receivable_quantity} step={1} value={received[part.id]!.quantity} onChange={event=>setReceived(previous=>({...previous,[part.id]:{...previous[part.id]!,quantity:Number(event.target.value)}}))} /></label><label>Condition<select value={received[part.id]!.condition} onChange={event=>setReceived(previous=>({...previous,[part.id]:{...previous[part.id]!,condition:event.target.value as ResourceCondition}}))}><option value="usable">Usable</option><option value="damaged">Damaged</option><option value="held">Needs checking</option></select></label></div> : null}
        </section>)}
        <label>Received on<TemporalInput type="datetime-local" step="any" required value={observed} onChange={event=>setObserved(event.target.value)} /></label>
        <p className="resource-caption">Time shown in {resourceInputZone()}. The recording time is kept separately.</p>
        <label>{correction ? "Correction reason" : "Return note"}<textarea required={correction} minLength={correction ? 3 : undefined} maxLength={1000} rows={2} value={reason} onChange={event=>setReason(event.target.value)} placeholder={correction ? "What was missed?" : "Optional"} /></label>
      </fieldset>
      {error ? <p role="alert" className="resource-error">{error}</p> : null}
      <ResourceWriteFeedback write={write} onReview={()=>void review()} />
      <footer><button type="button" className="is-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" disabled={locked || !current.can_record_return || missingTarget || (!original && (!parts.length || !Object.values(received).some(part=>part.quantity>0)))}>{write.busy ? "Recording…" : correction ? "Save correction" : "Record received"}</button></footer>
    </form>
  </PlannerDialog>;
}
