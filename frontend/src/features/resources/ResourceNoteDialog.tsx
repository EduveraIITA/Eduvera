import { useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { applicationNow } from "../simulation/applicationTime";
import { askResourceQuestion, changeResourceDue, getResourceLoan, replyResourceQuestion, resolveResourceQuestion, type ResourceLoanDetail } from "./resourceApi";
import { resourceInputInstant, resourceInputTime, resourceInputZone } from "./resourceTime";
import { ResourceWriteFeedback } from "./ResourceWriteFeedback";
import { useResourceCommand } from "./useResourceCommand";

export type ResourceNoteAction="due"|"question"|"returned_claim"|"reply"|"resolve";
const titles:Record<ResourceNoteAction,string>={due:"Change due date",question:"Question this record",returned_claim:"Report an earlier return",reply:"Reply to question",resolve:"Resolve question"};
export function ResourceNoteDialog({schoolId,loan,action,questionId,refresh,onClose,onSaved}: {
  schoolId:string;loan:ResourceLoanDetail;action:ResourceNoteAction;questionId?:string;refresh:()=>Promise<unknown>;onClose:()=>void;onSaved:()=>void;
}) {
  const [current,setCurrent]=useState(loan),[note,setNote]=useState(""),[due,setDue]=useState(()=>resourceInputTime(loan.due_at));
  const [reportedReturn,setReportedReturn]=useState(()=>resourceInputTime(applicationNow(),"instant"));
  const [error,setError]=useState(""),[reviewing,setReviewing]=useState(false);
  const write=useResourceCommand({schoolId,loanId:loan.id,refresh,onAccepted:onSaved});
  const submit=(event:FormEvent)=>{
    event.preventDefault();setError("");
    if(!note.trim()){setError(action==="due" ? "Add the reason for this change." : "Add a short note.");return;}
    let dueAt="";if(action==="due")try{dueAt=resourceInputInstant(due);}catch{setError("Choose the new due date.");return;}
    if(action==="due" && (Date.parse(dueAt)<=Date.parse(current.issued_at) || Date.parse(dueAt)===Date.parse(current.due_at))){setError("Choose a changed due time after the item was issued.");return;}
    let claimedReturnAt:string|null=null;if(action==="returned_claim")try{claimedReturnAt=resourceInputInstant(reportedReturn);}catch{setError("Choose when you returned the item.");return;}
    if(claimedReturnAt && (Date.parse(claimedReturnAt)<Date.parse(current.issued_at) || Date.parse(claimedReturnAt)>applicationNow().getTime())){setError("Reported return must be between issue and the current time.");return;}
    const expected_revision=current.revision,text=note.trim();
    void write.execute(command_id=>{
      const body={command_id,expected_revision};
      if(action==="due")return changeResourceDue(schoolId,loan.id,{...body,due_at:dueAt,reason:text});
      if(action==="reply")return replyResourceQuestion(schoolId,loan.id,questionId!,{...body,note:text});
      if(action==="resolve")return resolveResourceQuestion(schoolId,loan.id,questionId!,{...body,note:text});
      return askResourceQuestion(schoolId,loan.id,{...body,kind:action,note:text,claimed_return_at:claimedReturnAt});
    },{loanId:loan.id,expectedRevision:expected_revision});
  };
  const review=async()=>{
    setReviewing(true);setError("");
    try{setCurrent(await getResourceLoan(schoolId,loan.id));write.clearObsolete();}
    catch(cause){setError(cause instanceof Error ? cause.message : "The current record could not be loaded.");}
    finally{setReviewing(false);}
  };
  const permitted=action==="due" ? current.can_change_due : action==="reply" || action==="resolve" ? (action==="reply" ? current.can_reply : current.can_resolve) && current.questions.some(question=>question.id===questionId && question.state==="open") : current.can_question;
  const locked=write.locked || reviewing;
  const pending=write.busy || Boolean(write.recovery) || reviewing;
  return <PlannerDialog title={titles[action]} subtitle={loan.title} busy={pending} onClose={onClose}><form className="resource-form" onSubmit={submit}>
    <fieldset disabled={locked}>
      {action==="due" ? <><label>New due date<TemporalInput type="datetime-local" required value={due} onChange={event=>setDue(event.target.value)} /></label><p className="resource-caption">Time shown in {resourceInputZone()}.</p></> : null}
      {action==="returned_claim" ? <p className="resource-caption">The item stays out until the custodian confirms its return.</p> : action==="question" ? <p className="resource-caption">Private to you and the custodian.</p> : action==="resolve" ? <p className="resource-caption">Resolving the question does not record a physical return.</p> : null}
      {action==="returned_claim" ? <><label>Returned on<TemporalInput type="datetime-local" step="any" required value={reportedReturn} onChange={event=>setReportedReturn(event.target.value)} /></label><p className="resource-caption">Time shown in {resourceInputZone()}.</p></> : null}
      <label>{action==="due" ? "Reason" : action==="returned_claim" ? "Return details" : "Your note"}<textarea autoFocus required minLength={3} maxLength={action==="due" ? 1000 : 2000} rows={3} value={note} onChange={event=>setNote(event.target.value)} /></label>
    </fieldset>
    {!permitted ? <p role="alert" className="resource-error">This action is no longer available on the current record.</p> : null}
    {error ? <p role="alert" className="resource-error">{error}</p> : null}<ResourceWriteFeedback write={write} onReview={()=>void review()} />
    <footer><button type="button" className="is-secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" disabled={locked || !permitted || note.trim().length<3}>{write.busy ? "Saving…" : action==="due" ? "Save due date" : action==="resolve" ? "Resolve question" : action==="reply" ? "Send reply" : "Send to custodian"}</button></footer>
  </form></PlannerDialog>;
}
