import { useEffect, useRef, useState, type FormEvent } from "react";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { publishClassPractice, type ClassPracticeList } from "./classPracticeApi";

export function ClassPracticeComposer({data,onClose,onAccepted}:{data:ClassPracticeList;onClose:()=>void;onAccepted:(id:string)=>void}){
  const [title,setTitle]=useState(""),[body,setBody]=useState(""),[date,setDate]=useState(data.today),[due,setDue]=useState(""),[term,setTerm]=useState(data.terms[0]?.id??""),[subject,setSubject]=useState(data.can_publish_general?"":data.subjects[0]?.id??"");
  const [review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[dirty,setDirty]=useState(false);
  const source=useRef(crypto.randomUUID()),command=useRef(crypto.randomUUID()),active=useRef(true),inFlight=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const guard=useUnsavedChangesGuard(dirty||busy,"Discard this unpublished practice? A publication already accepted by the server remains available.");
  const change=()=>{setDirty(true);command.current=crypto.randomUUID();setError("");};
  // A callback from an earlier actor/world must never navigate the new workspace.
  const close=()=>{if(!busy&&guard())onClose();};
  const submit=async(event:FormEvent)=>{event.preventDefault();if(inFlight.current)return;if(!review){setReview(true);return;}inFlight.current=true;setBusy(true);setError("");
    try{const accepted=await publishClassPractice({command_id:command.current,practice_id:source.current,class_section_id:data.class_section.id,term_id:term,subject_id:subject||null,date,title,body,due_at:due?new Date(due).toISOString():null});if(!active.current)return;setDirty(false);onAccepted(accepted.id);}
    catch(cause){if(active.current)setError(cause instanceof Error?cause.message:"Publication was not confirmed. Keep this form and retry.");}finally{inFlight.current=false;if(active.current)setBusy(false);}};
  return <PlannerDialog title={review?"Review practice":"Add practice"} busy={busy} onClose={close}><form className="class-practice-form" onSubmit={event=>void submit(event)}>
    <p className="class-practice-caption">{data.class_section.label}</p>
    {review?<><h3>{title}</h3><p className="class-practice-body">{body}</p><p>{date}{due?` · Due ${new Date(due).toLocaleString()}`:" · No due date"}</p><p className="class-practice-caption">Published instructions stay unchanged. Completion is reported by the learner or guardian.</p></>:<fieldset disabled={busy}>
      <label>Title<input required autoFocus maxLength={180} value={title} onChange={event=>{change();setTitle(event.target.value);}}/></label>
      <label>Instructions<textarea required rows={5} maxLength={4000} value={body} onChange={event=>{change();setBody(event.target.value);}}/></label>
      <div className="class-practice-fields"><label>Date<TemporalInput type="date" required value={date} onChange={event=>{change();setDate(event.target.value);}}/></label><label>Due <span className="class-practice-caption">Optional · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span><TemporalInput type="datetime-local" value={due} onChange={event=>{change();setDue(event.target.value);}}/></label></div>
      <label>Term<select required value={term} onChange={event=>{change();setTerm(event.target.value);}}>{data.terms.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {data.subjects.length?<label>Subject {data.can_publish_general?<span className="class-practice-caption">Optional</span>:null}<select required={!data.can_publish_general} value={subject} onChange={event=>{change();setSubject(event.target.value);}}>{data.can_publish_general?<option value="">Class practice</option>:null}{data.subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}
    </fieldset>}
    {error?<p role="alert">{error}</p>:null}
    <footer><button type="button" className="is-secondary" disabled={busy} onClick={()=>review?setReview(false):close()}>{review?"Back":"Cancel"}</button><button type="submit" disabled={busy||!term}>{busy?"Publishing…":review?"Publish practice":"Review"}</button></footer>
  </form></PlannerDialog>;
}
