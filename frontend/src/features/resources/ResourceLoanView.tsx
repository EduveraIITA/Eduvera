import { useEffect, useRef, useState, type Ref } from "react";
import { CalendarClock, MessageCircle } from "lucide-react";
import { ProductIcon } from "../../components/ProductIcon";
import type { ResourceLoanDetail, ResourceQuestion } from "./resourceApi";
import { ResourceLoanHistory } from "./ResourceLoanHistory";
import { ResourceNoteDialog, type ResourceNoteAction } from "./ResourceNoteDialog";
import { ResourceReturnDialog } from "./ResourceReturnDialog";
import { ResourceCustodyDialog } from "./ResourceCustodyDialog";
import { resourceDate } from "./ResourcePrimitives";

export const resourceStateLabel=(state:ResourceLoanDetail["state"])=>({outstanding:"Out",overdue:"Overdue",returned:"Returned",held:"Held for review"})[state];
export function ResourceLoanView({schoolId,loan,timezone,readOnly,questionId,refresh}: {
  schoolId:string;loan:ResourceLoanDetail;timezone:string;readOnly:boolean;questionId?:string|null;refresh:()=>Promise<unknown>;
}) {
  const [returning,setReturning]=useState<"normal"|"correction"|null>(null),[note,setNote]=useState<{action:ResourceNoteAction;questionId?:string}|null>(null);
  const [custody,setCustody]=useState(false);
  const focus=useRef<HTMLElement|null>(null);
  useEffect(()=>{if(questionId)focus.current?.focus();},[questionId]);
  const outstanding=loan.parts.filter(part=>part.outstanding_quantity>0);
  const openQuestion=loan.questions.some(question=>question.state==="open");
  const hasReturnContext=loan.history.some(receipt=>receipt.action==="return_recorded" || receipt.action==="return_corrected") || loan.questions.some(question=>question.kind==="returned_claim");
  return <>
    <section className="resource-summary" aria-label="Borrowing summary">
      <header className="resource-summary-header"><ProductIcon name="resources" size={32} /><div><h2>{loan.title}</h2><p className="resource-caption">{loan.asset_tag} · <strong className={loan.state==="overdue" ? "resource-overdue" : undefined}>{resourceStateLabel(loan.state)}</strong></p></div></header>
      <dl className="resource-facts"><div><dt>Borrower</dt><dd>{loan.borrower.label}</dd></div><div><dt>Custodian</dt><dd>{loan.custodian.label}</dd></div><div><dt>Issued</dt><dd>{resourceDate(loan.issued_at,timezone)}</dd></div><div><dt>Due back</dt><dd><time className="resource-due-time" dateTime={loan.due_at} title={timezone}><span>{resourceDate(loan.due_at,timezone)}</span><span className="resource-due-time__clock">{new Intl.DateTimeFormat("en-IN",{timeZone:timezone,hour:"numeric",minute:"2-digit"}).format(new Date(loan.due_at))}</span></time></dd></div></dl>
      <div className="resource-actions">{loan.can_record_return && outstanding.length>0 && !readOnly ? <button onClick={()=>setReturning("normal")}>Record return</button> : null}{loan.can_change_due && outstanding.length>0 && !readOnly ? <button className="is-text" onClick={()=>setNote({action:"due"})}><CalendarClock size={16} aria-hidden="true" />Change due date</button> : null}</div>
    </section>
    {loan.can_change_custodian&&!readOnly?<button type="button" className="is-text resource-custody-action" onClick={()=>setCustody(true)}>Change responsibility</button>:null}
    <section className="resource-section"><h3>{outstanding.length ? "Still out" : "Return record"}</h3><ul className="resource-component-list">{loan.parts.map(part=><li key={part.id}><span><strong>{part.label}</strong>{part.quantity>1 ? <small> · {part.quantity} issued</small> : null}</span><span>{part.outstanding_quantity>0 ? `${part.outstanding_quantity} still out` : part.condition==="usable" ? "Received" : part.condition==="damaged" ? "Received · damaged" : "Received · needs checking"}</span></li>)}</ul>{loan.state==="held" ? <p className="resource-caption">The copy is not available while its condition needs review.</p> : null}{loan.can_record_return && hasReturnContext && !readOnly ? <button className="is-text" onClick={()=>setReturning("correction")}>Correct return record</button> : null}</section>
    {loan.can_question && !openQuestion && !readOnly ? <div className="resource-actions"><button className="is-secondary" onClick={()=>setNote({action:"question"})}><MessageCircle size={16} aria-hidden="true" />Question record</button>{outstanding.length ? <button className="is-text" onClick={()=>setNote({action:"returned_claim"})}>I already returned this</button> : null}</div> : null}
    {questionId && !loan.questions.some(question=>question.id===questionId) ? <p role="status" className="resource-caption">This question is not available in your current view.</p> : null}
    {loan.questions.length ? <section className="resource-section" aria-label="Private questions">
      <h3>Questions <span className="resource-caption">Private to borrower and custodian</span></h3>
      {loan.questions.map(question=><ResourceQuestionCard key={question.id} question={question} timezone={timezone} focusRef={question.id===questionId ? focus : undefined}
        canReply={loan.can_reply && !readOnly} canResolve={loan.can_resolve && !readOnly} onAction={action=>setNote({action,questionId:question.id})} />)}
    </section> : null}
    <ResourceLoanHistory loan={loan} timezone={timezone} />
    {returning ? <ResourceReturnDialog schoolId={schoolId} loan={loan} correction={returning==="correction"} refresh={refresh} onClose={()=>setReturning(null)} onSaved={()=>setReturning(null)} /> : null}
    {note ? <ResourceNoteDialog schoolId={schoolId} loan={loan} action={note.action} questionId={note.questionId} refresh={refresh} onClose={()=>setNote(null)} onSaved={()=>setNote(null)} /> : null}
    {custody?<ResourceCustodyDialog schoolId={schoolId} loan={loan} refresh={refresh} onClose={()=>setCustody(false)} />:null}
  </>;
}

function ResourceQuestionCard({question,timezone,focusRef,canReply,canResolve,onAction}: {
  question:ResourceQuestion;timezone:string;focusRef?:Ref<HTMLElement>;canReply:boolean;canResolve:boolean;onAction:(action:"reply"|"resolve")=>void;
}) {
  const open=question.state==="open";
  return <article className="resource-question" ref={focusRef} tabIndex={focusRef ? -1 : undefined} aria-label={question.kind==="returned_claim" ? "Reported return" : "Record question"}>
    <header><strong>{question.kind==="returned_claim" ? "Reported return" : "Record question"}</strong><small className="resource-caption">{open ? "Awaiting review" : "Resolved"}</small></header>
    <p>{question.note}</p>
    {question.claimed_return_at ? <p className="resource-caption">Reported physical return · {resourceDate(question.claimed_return_at,timezone,true)}</p> : null}
    <small className="resource-caption">{question.reporter.label} · {resourceDate(question.created_at,timezone,true)}</small>
    {question.kind==="returned_claim" && open ? <p className="resource-caption">A report is not a confirmed physical return.</p> : null}
    {/* The owner returns newest revisions first. Clock timestamps can tie in a paused Simulation. */}
    {[...question.replies].reverse().map(reply=><div className="resource-question-reply" key={reply.id}>
      <p>{reply.note}</p><small className="resource-caption">{reply.actor_label} · {reply.action==="resolved" ? "Resolved" : "Replied"} {resourceDate(reply.recorded_at,timezone,true)}</small>
    </div>)}
    {open && (canReply || canResolve) ? <div className="resource-actions">
      {canReply ? <button className="is-secondary" onClick={()=>onAction("reply")}>Reply</button> : null}
      {canResolve ? <button className="is-text" onClick={()=>onAction("resolve")}>Resolve question</button> : null}
    </div> : null}
  </article>;
}
