import { useRef,useState,type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commitEnrollment,reviewEnrollment,type EnrollmentInput,type EnrollmentOption,type EnrollmentReview } from "./api";
import { GuardianPicker } from "./GuardianPicker";
const readable=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
export function EnrollmentForm({schoolId,options,onCancel,onSaved}:{schoolId:string;options:EnrollmentOption[];onCancel:()=>void;onSaved:(name:string)=>void}) {
  const first=options[0]!; const cache=useQueryClient(); const heading=useRef<HTMLHeadingElement>(null);
  const [input,setInput]=useState<EnrollmentInput>({school_id:schoolId,first_name:"",last_name:"",admission_number:"",date_of_birth:"",class_section_id:first.class_section_id,term_id:first.term_id,roll_number:first.next_roll,enrolled_on:first.today<first.starts_on?first.starts_on:first.today>first.ends_on?first.ends_on:first.today,guardian:{mode:"new",first_name:"",last_name:"",phone:"",email:""},relationship:"guardian",can_authorize_leave:false});
  const [review,setReview]=useState<EnrollmentReview|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [confirmed,setConfirmed]=useState(false);
  const option=options.find(o=>o.class_section_id===input.class_section_id&&o.term_id===input.term_id)!;
  const submit=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError("");try{setReview(await reviewEnrollment(input));setConfirmed(false);requestAnimationFrame(()=>heading.current?.focus());}catch(e){setError(e instanceof Error?e.message:"Could not review the enrollment.");}finally{setBusy(false);}};
  const save=async()=>{if(!review||!confirmed)return;setBusy(true);setError("");try{await commitEnrollment(review.id);await Promise.all([cache.invalidateQueries({queryKey:["school","people"]}),cache.invalidateQueries({queryKey:["principal-home"]}),cache.invalidateQueries({queryKey:["teacher-attendance"]}),cache.invalidateQueries({queryKey:["teacher-home"]})]);onSaved(`${review.input.first_name} ${review.input.last_name}`.trim());}catch(e){setError(e instanceof Error?e.message:"Could not save. The reviewed details are still here.");}finally{setBusy(false);}};
  return <section className="people-panel">
    <header className="people-heading"><div><span className="people-muted">Student enrollment</span><h2 ref={heading} tabIndex={-1}>{review?"Review before saving":"Add a student"}</h2></div><button type="button" className="people-secondary" disabled={busy} onClick={onCancel}>Cancel</button></header>
    {error?<p className="people-error" role="alert">{error}</p>:null}
    {review?<div className="people-review">
      <dl><div><dt>Student</dt><dd>{review.input.first_name} {review.input.last_name}</dd></div><div><dt>Admission number</dt><dd>{review.input.admission_number}</dd></div><div><dt>Date of birth</dt><dd>{readable(review.input.date_of_birth)}</dd></div><div><dt>Placement</dt><dd>{review.class_name} · Roll {review.input.roll_number} · {review.term_name}</dd></div><div><dt>Enrolled from</dt><dd>{readable(review.input.enrolled_on)}</dd></div><div><dt>Primary guardian</dt><dd>{review.guardian.name} · {review.input.relationship}<small>{review.guardian.phone}</small><small>{review.input.guardian.mode==="existing"?"Existing guardian record":"New guardian record"}</small></dd></div><div><dt>Leave authorization</dt><dd>{review.input.can_authorize_leave?"Permitted":"Not granted"}</dd></div></dl>
      {review.warnings.map(w=><p className="people-warning" key={w}>{w}</p>)}
      <p className="people-muted">No login credentials or attendance marks will be created. The guardian relationship is not collection permission.</p>
      <label className="people-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I have verified the student details and guardian relationship.</label>
      <footer><button type="button" className="people-secondary" disabled={busy} onClick={()=>{setReview(null);setError("");}}>Edit details</button><button type="button" className="people-primary" disabled={busy||!confirmed} onClick={()=>void save()}>{busy?"Saving enrollment…":"Confirm enrollment"}</button></footer>
    </div>:<form className="people-form" onSubmit={e=>void submit(e)}><fieldset disabled={busy} className="people-fieldset"><legend>Student details</legend><div className="people-form-grid">
      <label>Student first name<input required maxLength={150} value={input.first_name} onChange={e=>setInput({...input,first_name:e.target.value})}/></label>
      <label>Student last name<input maxLength={150} value={input.last_name} onChange={e=>setInput({...input,last_name:e.target.value})}/></label>
      <label>Admission number<input required minLength={2} maxLength={64} pattern="[A-Za-z0-9/\-]+" value={input.admission_number} onChange={e=>setInput({...input,admission_number:e.target.value})}/></label>
      <label>Date of birth<input required type="date" min="1900-01-01" max={option.today} value={input.date_of_birth} onChange={e=>setInput({...input,date_of_birth:e.target.value})}/></label>
      <label>Class and term<select value={`${input.class_section_id}:${input.term_id}`} onChange={e=>{const next=options.find(o=>`${o.class_section_id}:${o.term_id}`===e.target.value)!;setInput({...input,class_section_id:next.class_section_id,term_id:next.term_id,roll_number:next.next_roll});}}>{options.map(o=><option key={`${o.class_section_id}:${o.term_id}`} value={`${o.class_section_id}:${o.term_id}`}>{o.class_name} · {o.term_name}</option>)}</select></label>
      <label>Roll number<input required type="number" min={1} max={32767} value={input.roll_number} onChange={e=>setInput({...input,roll_number:Number(e.target.value)})}/></label>
      <label>Enrolled from<input required type="date" min={option.starts_on} max={option.ends_on} value={input.enrolled_on} onChange={e=>setInput({...input,enrolled_on:e.target.value})}/></label>
    </div></fieldset>
    <GuardianPicker schoolId={schoolId} value={input.guardian} onChange={guardian=>setInput({...input,guardian})}/>
    <label>Relationship to student<select value={input.relationship} onChange={e=>setInput({...input,relationship:e.target.value as EnrollmentInput["relationship"]})}><option value="guardian">Guardian</option><option value="mother">Mother</option><option value="father">Father</option></select></label>
    <label className="people-confirm"><input type="checkbox" checked={input.can_authorize_leave} onChange={e=>setInput({...input,can_authorize_leave:e.target.checked})}/>Allow this guardian to authorize leave requests</label>
    <p className="people-muted">A student or guardian can be enrolled without an app account.</p><button className="people-primary" type="submit" disabled={busy||(input.guardian.mode==="existing"&&!input.guardian.id)}>{busy?"Checking details…":"Review enrollment"}</button>
    </form>}
  </section>;
}
