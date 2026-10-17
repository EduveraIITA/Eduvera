import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronDown, History, MoveRight, UserMinus } from "lucide-react";
import { commitEnrollmentChange, getEnrollmentLifecycle, reviewEnrollmentChange, type DirectoryStudent, type EnrollmentChangeAction, type EnrollmentChangeReview, type EnrollmentOption } from "./api";

const actionCopy:Record<EnrollmentChangeAction,{label:string;description:string;confirm:string}>={
  move_class:{label:"Move to another class",description:"Keep this term and move the student to a different class today.",confirm:"Move student"},
  withdraw:{label:"Withdraw",description:"End the current enrollment while preserving the complete school record.",confirm:"Withdraw student"},
  transfer_out:{label:"Transfer out",description:"Record that the student is leaving for another institution.",confirm:"Record transfer"},
};
const actionValues:readonly EnrollmentChangeAction[]=["move_class","withdraw","transfer_out"];
const exitLabels={class_move:"Moved class",withdrawn:"Withdrawn",transferred_out:"Transferred out",term_completed:"Term completed"} as const;
function formatDate(value:string|null){return value?new Date(`${value}T00:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"Not recorded";}

export function StudentEnrollmentLifecycle({schoolId,student,options}:{schoolId:string;student:DirectoryStudent;options:EnrollmentOption[]}) {
  const client=useQueryClient();
  const lifecycle=useQuery({queryKey:["school","people","lifecycle",schoolId,student.id],queryFn:()=>getEnrollmentLifecycle(schoolId,student.id)});
  const [editing,setEditing]=useState(false);const [action,setAction]=useState<EnrollmentChangeAction>("move_class");
  const [targetId,setTargetId]=useState("");const [roll,setRoll]=useState("");const [reason,setReason]=useState("");
  const [review,setReview]=useState<EnrollmentChangeReview|null>(null);const [saved,setSaved]=useState("");
  const current=lifecycle.data?.current;
  const targets=useMemo(()=>options.filter(option=>current&&option.term_id===current.term_id&&option.class_section_id!==current.class_section_id),[current,options]);
  const selectedTarget=targets.find(option=>option.class_section_id===targetId);
  const preview=useMutation({mutationFn:()=>{
    if(!current) throw new Error("This student has no active enrollment.");
    const common={school_id:schoolId,expected_enrollment_id:current.id,expected_revision:current.revision,effective_on:lifecycle.data!.today,reason};
    return reviewEnrollmentChange(student.id,action==="move_class"?{...common,action,target_class_section_id:targetId,target_term_id:current.term_id,roll_number:Number(roll)}:{...common,action});
  },onSuccess:setReview});
  const commit=useMutation({mutationFn:()=>commitEnrollmentChange(review!.id),onSuccess:async(result)=>{
    setSaved(result.action==="move_class"?"Class movement recorded.":result.action==="withdraw"?"Withdrawal recorded.":"Transfer-out recorded.");
    setReview(null);setEditing(false);setReason("");setTargetId("");setRoll("");
    await Promise.all([client.invalidateQueries({queryKey:["school","people"]}),client.invalidateQueries({queryKey:["school","people","lifecycle",schoolId,student.id]})]);
  }});
  const chooseTarget=(id:string)=>{setTargetId(id);const target=targets.find(option=>option.class_section_id===id);setRoll(target?String(target.next_roll):"");};
  if(lifecycle.isPending) return <section className="people-enrollment" aria-label="Enrollment"><p role="status">Loading enrollment history…</p></section>;
  if(lifecycle.isError) return <section className="people-enrollment" aria-label="Enrollment"><p role="alert" className="people-error">Enrollment history could not load. <button type="button" onClick={()=>void lifecycle.refetch()}>Try again</button></p></section>;
  return <section className="people-enrollment" aria-labelledby="student-enrollment-title">
    <div className="people-enrollment__heading"><div><span className="people-eyebrow">Connected record</span><h3 id="student-enrollment-title">Enrollment</h3></div>{current&&!editing&&!review?<button type="button" className="people-secondary" onClick={()=>{setEditing(true);setSaved("");}}>Change</button>:null}</div>
    {saved?<p className="people-success" role="status"><Check size={17}/>{saved} Connected rosters will update automatically.</p>:null}
    {current?<div className="people-current-enrollment"><span className="people-current-enrollment__icon" aria-hidden="true">{current.class_name.replace("Class ","")}</span><div><strong>{current.class_name}</strong><small>{current.term_name} · Roll {current.roll_number}</small></div><span className="people-status-pill">Current</span></div>:<div className="people-empty people-empty--compact"><UserMinus size={20}/><div><strong>No current enrollment</strong><p>The student record and history remain available.</p></div></div>}
    {editing&&!review&&current?<form className="people-lifecycle-form" onSubmit={event=>{event.preventDefault();preview.mutate();}}>
      <fieldset><legend>What is changing?</legend>{actionValues.map(value=><label key={value} className={action===value?"is-selected":""}><input type="radio" name="action" value={value} checked={action===value} onChange={()=>setAction(value)}/><span><strong>{actionCopy[value].label}</strong><small>{actionCopy[value].description}</small></span></label>)}</fieldset>
      {action==="move_class"?<div className="people-lifecycle-form__grid"><label>New class<select required value={targetId} onChange={event=>chooseTarget(event.target.value)}><option value="">Choose a class</option>{targets.map(option=><option key={option.class_section_id} value={option.class_section_id}>{option.class_name}</option>)}</select></label><label>Roll number<input required type="number" min="1" max="32767" value={roll} onChange={event=>setRoll(event.target.value)}/></label></div>:null}
      {action==="move_class"&&!targets.length?<p className="people-hint">No other class is available in {current.term_name}. Use class promotion for the next term.</p>:null}
      <label>Reason<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder={action==="move_class"?"Why is the class changing?":"Record the reason for the school history"}/></label>
      <p className="people-hint">Effective today, {formatDate(lifecycle.data.today)}. Existing attendance, results, fees, and guardian links are preserved.</p>
      {preview.isError?<p role="alert" className="people-error">{preview.error instanceof Error?preview.error.message:"The change could not be reviewed."}</p>:null}
      <div className="people-form-actions"><button type="button" className="people-secondary" onClick={()=>{setEditing(false);setReason("");}}>Cancel</button><button type="submit" className="people-primary" disabled={preview.isPending||(action==="move_class"&&(!selectedTarget||!roll))}>{preview.isPending?"Reviewing…":"Review impact"}<ArrowRight size={17}/></button></div>
    </form>:null}
    {review?<div className="people-lifecycle-review" role="region" aria-labelledby="lifecycle-review-title"><span className="people-eyebrow">Confirm before applying</span><h4 id="lifecycle-review-title">{actionCopy[review.input.action].label}</h4>
      <p>{review.input.action==="move_class"?<>{review.current.class_name} <MoveRight size={16}/> <strong>{review.target?.class_name}</strong></>:<>The current enrollment in <strong>{review.current.class_name}</strong> will end today.</>}</p>
      <ul><li><strong>{review.impact.submitted_registers}</strong><span>submitted attendance registers return to draft</span></li><li><strong>{review.impact.assessments}</strong><span>upcoming assessment records stay connected</span></li><li><strong>{review.impact.transport_assignments+review.impact.departure_plans}</strong><span>transport or departure plans stay connected</span></li></ul>
      <p className="people-hint">Nothing is deleted. The previous placement remains in history and this decision is audited.</p>
      {commit.isError?<p role="alert" className="people-error">{commit.error instanceof Error?commit.error.message:"The change could not be saved."}</p>:null}
      <div className="people-form-actions"><button type="button" className="people-secondary" onClick={()=>setReview(null)}>Back</button><button type="button" className="people-primary" disabled={commit.isPending} onClick={()=>commit.mutate()}>{commit.isPending?"Saving…":actionCopy[review.input.action].confirm}</button></div>
    </div>:null}
    {lifecycle.data.history.length?<details className="people-enrollment-history"><summary><span><History size={17}/>Enrollment history</span><ChevronDown size={17}/></summary><ol>{lifecycle.data.history.map(item=><li key={item.id}><span className="people-history-dot"/><div><strong>{item.class_name} · Roll {item.roll_number}</strong><small>{item.term_name} · From {formatDate(item.enrolled_on)}{item.inactive_from?` to ${formatDate(item.inactive_from)}`:""}</small>{item.exit_kind?<p>{exitLabels[item.exit_kind]} · {item.exit_reason}</p>:null}</div></li>)}</ol></details>:null}
  </section>;
}
