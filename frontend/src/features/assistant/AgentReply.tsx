import { ArrowRight, Check, FileCheck2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AgentAction, AgentRun } from './agentApi';
import { AssistantText } from './AssistantText';
import { AgentChart } from './AgentChart';
const human=(key:string)=>key.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
function Fields({value,labels}:{value:unknown;labels:Record<string,string>}) {
  if(Array.isArray(value))return <ol className="agent-field-list">{(value as unknown[]).map((item,index)=><li key={index}><Fields value={item} labels={labels}/></li>)}</ol>;
  if(value&&typeof value==='object')return <dl className="agent-fields">{Object.entries(value as Record<string,unknown>).map(([key,item])=><div key={key}><dt>{human(key)}</dt><dd><Fields value={item} labels={labels}/></dd></div>)}</dl>;
  const text=value===null?'Not set':typeof value==='boolean'?(value?'Yes':'No'):typeof value==='string'||typeof value==='number'?String(value):'';
  return <span>{labels[text]??text}</span>;
}
export function ActionReview({action,busy,onDecide}:{action:AgentAction;busy:boolean;onDecide:(id:string,decision:'confirm'|'reject')=>void}) {
  const pending=action.status==='pending';
  const attendance=action.capability==='record_student_attendance'?action.preview:undefined;
  return <section className={`agent-action agent-action--${action.status}`} aria-label="Action review">
    <div className="agent-action__heading"><FileCheck2 size={20} aria-hidden="true"/><strong>{action.title}</strong></div>
    <p className="agent-action__state">{pending?'Review before confirming':human(action.status)}</p>
    {pending?<>
      {attendance?<>
        <p className="agent-action__target">{attendance.student} · {attendance.class_name}</p>
        <dl className="agent-fields">
          <div><dt>Date</dt><dd>{new Date(attendance.date+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}</dd></div>
          <div><dt>Attendance</dt><dd>{human(attendance.previous_status)} <span aria-label="changes to">→</span> <strong>{human(attendance.status)}</strong></dd></div>
          {attendance.reason?<div><dt>Correction reason</dt><dd>{attendance.reason}</dd></div>:null}
          {attendance.remarks!==undefined?<div><dt>Remarks</dt><dd>{attendance.remarks||'None'}</dd></div>:null}
        </dl>
        <p className="agent-caption">{attendance.register_note}</p>
      </>:<>
        {action.input.id?<p className="agent-action__target">{action.labels[action.input.id]??`Record ${action.input.id}`}</p>:null}
        <Fields value={Object.fromEntries(Object.entries(action.input.body??{}).filter(([key])=>key!=='expected_revision'))} labels={action.labels}/>
      </>}
      <p className="agent-caption">No changes yet. This preview expires at {new Date(action.expires_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.</p>
      <div className="agent-action__buttons"><button type="button" disabled={busy} onClick={()=>onDecide(action.id,'reject')}>Dismiss</button><button type="button" className="is-primary" disabled={busy} onClick={()=>onDecide(action.id,'confirm')}><Check size={17} aria-hidden="true"/>{busy?'Checking…':'Confirm'}</button></div>
    </>:<p>{action.receipt?.message??(action.status==='rejected'?'Nothing was changed.':action.status==='expired'?'Ask for a fresh preview.':action.status==='executing'?'Verifying the result…':'Review the record before trying again.')}</p>}
    <Link className="assistant-source-link" to={action.receipt?.href??action.href}>{action.status==='succeeded'?'Verify in app':'Open affected screen'}<ArrowRight size={17} aria-hidden="true"/></Link>
    {action.receipt?.request_id?<details className="agent-receipt"><summary>Action receipt</summary><p>Reference {action.receipt.request_id}</p>{action.receipt.completed_at?<p>{new Date(action.receipt.completed_at).toLocaleString()}</p>:null}</details>:null}
  </section>;
}
export function AgentReply({run,busy,onDecide}:{run:AgentRun;busy:boolean;onDecide:(id:string,decision:'confirm'|'reject')=>void}) {
  return <>
    {run.evidence.filter(source=>source.chart).map(source=><div className="agent-chart-source" key={source.id}><AgentChart chart={source.chart!}/><Link className="assistant-source-link" to={source.href}>Open {source.chart!.scope} analysis<ArrowRight size={17} aria-hidden="true"/></Link></div>)}
    <p className="agent-answer"><AssistantText text={run.status==='running'?run.progress+'…':run.answer}/></p>
    {run.status==='failed'?<p className="agent-caption">No action was automatically retried.</p>:null}
    {run.action?<ActionReview action={run.action} busy={busy} onDecide={onDecide}/>:null}
    {run.evidence.length?<details className="agent-sources"><summary>{run.evidence.length===1?'Source checked':`${run.evidence.length} sources checked`}</summary><ul>{run.evidence.map(source=><li key={source.id}><Link className="assistant-source-link" to={source.href}>{source.title}<ArrowRight size={16} aria-hidden="true"/></Link><small>Checked {new Date(source.retrieved_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></li>)}</ul></details>:null}
  </>;
}
