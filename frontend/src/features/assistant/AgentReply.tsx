import { ArrowRight, Check, CheckCircle2, Clock3, ShieldAlert, TriangleAlert, X, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MouseEventHandler } from 'react';
import type { AgentAction, AgentRun } from './agentApi';
import { AssistantText } from './AssistantText';
import { AgentChart } from './AgentChart';
const human=(key:string)=>key.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
const chartLink=(title:string)=>/attendance/i.test(title)?'View attendance':/(?:result|score)/i.test(title)?'View results':'View details';
const actionTarget=(action:AgentAction)=>action.capability==='record_student_attendance'
  ? [action.preview?.student,action.preview?.class_name].filter(Boolean).join(' · ')
  : action.capability==='record_attendance' ? action.preview?.class_name??'Class attendance'
  : action.input.id ? action.labels[action.input.id]??'Affected record' : '';
const expiry=(value:string)=>new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function Fields({value,labels}:{value:unknown;labels:Record<string,string>}) {
  if(Array.isArray(value))return <ol className="agent-field-list">{(value as unknown[]).map((item,index)=><li key={index}><Fields value={item} labels={labels}/></li>)}</ol>;
  if(value&&typeof value==='object')return <dl className="agent-fields">{Object.entries(value as Record<string,unknown>).map(([key,item])=><div key={key}><dt>{human(key)}</dt><dd><Fields value={item} labels={labels}/></dd></div>)}</dl>;
  const text=value===null?'Not set':typeof value==='boolean'?(value?'Yes':'No'):typeof value==='string'||typeof value==='number'?String(value):'';
  return <span>{labels[text]??text}</span>;
}
export function ActionReviewNotice({action,to,state,onOpen,onClose}:{action:AgentAction;to:string;state?:{assistantReturnTo:string;assistantScrollY:number};onOpen?:MouseEventHandler<HTMLAnchorElement>;onClose:()=>void}) {
  const target=actionTarget(action);
  const descriptionId=`agent-action-${action.id}-notice`;
  return <aside className="assistant-approval" aria-labelledby={`agent-action-${action.id}-notice-title`} aria-describedby={descriptionId} aria-live="polite">
    <div className="assistant-approval__bar">
      <span className="assistant-approval__icon" aria-hidden="true"><ShieldAlert size={18}/></span>
      <strong>Review needed</strong>
      <button type="button" aria-label="Close chat" onClick={onClose}><X size={18} aria-hidden="true"/></button>
    </div>
    <Link className="assistant-approval__link" to={to} state={state} onClick={onOpen}>
      <span><strong id={`agent-action-${action.id}-notice-title`}>{action.title}</strong>{target?<small>{target}</small>:null}</span>
      <ArrowRight size={19} aria-hidden="true"/>
    </Link>
    <p id={descriptionId}>{action.contract?.summary??'Nothing has changed.'} Review before <time dateTime={action.expires_at}>{expiry(action.expires_at)}</time>.</p>
  </aside>;
}
export function ActionReview({action,busy,onDecide}:{action:AgentAction;busy:boolean;onDecide:(id:string,decision:'confirm'|'reject')=>void}) {
  const pending=action.status==='pending';
  const attendance=action.capability==='record_student_attendance'?action.preview:undefined;
  const classAttendance=action.capability==='record_attendance'?action.preview:undefined;
  const target=actionTarget(action);
  const headingId=`agent-action-${action.id}-title`;
  const StateIcon=pending?ShieldAlert:action.status==='succeeded'?CheckCircle2:['failed','uncertain','stale'].includes(action.status)?TriangleAlert:action.status==='rejected'?XCircle:Clock3;
  return <section className={`agent-action agent-action--${action.status}`} aria-labelledby={headingId}>
    <header className="agent-action__heading"><span className="agent-action__icon"><StateIcon size={20} aria-hidden="true"/></span><div><p className="agent-action__state">{pending?'Review required':action.status==='succeeded'?'Completed':human(action.status)}</p><h3 id={headingId}>{action.title}</h3></div></header>
    <div className="agent-action__body">{pending?<>
      {target?<p className="agent-action__target">{target}</p>:null}
      {attendance?<>
        <dl className="agent-action__facts">
          <div><dt>Date</dt><dd>{new Date(attendance.date+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}</dd></div>
          {attendance.reason?<div><dt>Correction reason</dt><dd>{attendance.reason}</dd></div>:null}
          {attendance.remarks!==undefined?<div><dt>Remarks</dt><dd>{attendance.remarks||'None'}</dd></div>:null}
        </dl>
        <div className="agent-action__change" role="group" aria-label={`Attendance changes from ${human(attendance.previous_status??'not_marked')} to ${human(attendance.status??'not_marked')}`}>
          <div><span>Current</span><strong>{human(attendance.previous_status??'not_marked')}</strong></div><ArrowRight size={18} aria-hidden="true"/><div><span>After confirmation</span><strong>{human(attendance.status??'not_marked')}</strong></div>
        </div>
        <p className="agent-action__impact">{attendance.register_note}</p>
      </>:classAttendance?<>
        <dl className="agent-action__facts">
          <div><dt>Date</dt><dd>{new Date(classAttendance.date+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'})}</dd></div>
          {classAttendance.reason?<div><dt>Reason</dt><dd>{classAttendance.reason}</dd></div>:null}
        </dl>
        <div className="agent-action__records" role="group" aria-label={`${classAttendance.records?.length??0} attendance records`}>
          <p>{classAttendance.records?.length??0} {classAttendance.records?.length===1?'student':'students'}</p>
          <ul>{classAttendance.records?.map((record,index)=><li key={`${record.student}-${index}`}><span><strong>{record.student}</strong>{record.remarks?<small>{record.remarks}</small>:null}</span><b>{human(record.status??'not_marked')}</b></li>)}</ul>
        </div>
        <p className="agent-action__impact">{classAttendance.register_note}</p>
      </>:<>
        <Fields value={Object.fromEntries(Object.entries(action.input.body??{}).filter(([key])=>key!=='expected_revision'))} labels={action.labels}/>
        {action.contract?.summary?<p className="agent-action__impact">{action.contract.summary}</p>:null}
      </>}
      <div className="agent-action__guard" role="status"><Clock3 size={18} aria-hidden="true"/><p><strong>Nothing has changed.</strong><span> Expires at <time dateTime={action.expires_at}>{expiry(action.expires_at)}</time>.</span></p></div>
      <div className="agent-action__buttons"><button type="button" disabled={busy} onClick={()=>onDecide(action.id,'reject')}>Dismiss</button><button type="button" className="is-primary" disabled={busy} onClick={()=>onDecide(action.id,'confirm')}><Check size={17} aria-hidden="true"/>{busy?'Checking…':action.contract?.confirmation_label??'Confirm'}</button></div>
    </>:<p className="agent-action__message">{action.receipt?.message??(action.status==='rejected'?'Nothing was changed.':action.status==='expired'?'Ask for a fresh preview.':action.status==='executing'?'Verifying the result…':'Review the record before trying again.')}</p>}
    <Link className="assistant-source-link" to={action.receipt?.href??action.href}>{action.status==='succeeded'?'Verify in app':'Open affected screen'}<ArrowRight size={17} aria-hidden="true"/></Link>
    {action.receipt?.request_id?<details className="agent-receipt"><summary>Action receipt</summary><p>Reference {action.receipt.request_id}</p>{action.receipt.completed_at?<p>{new Date(action.receipt.completed_at).toLocaleString()}</p>:null}</details>:null}
    </div>
  </section>;
}
export function AgentReply({run,busy,onDecide}:{run:AgentRun;busy:boolean;onDecide:(id:string,decision:'confirm'|'reject')=>void}) {
  const chartSources=run.evidence.filter(source=>source.chart);
  const otherSources=run.evidence.filter(source=>!source.chart);
  const answerChart=chartSources.length===1?chartSources[0]!.chart:undefined;
  const running=run.status==='running';
  return <>
    <div className="agent-answer"><AssistantText text={running?run.progress+'…':run.answer} chart={running?undefined:answerChart}/></div>
    {chartSources.map(source=><div className="agent-chart-source" key={source.id}><AgentChart chart={source.chart!}/><div className="assistant-source-row"><Link className="assistant-source-link" to={source.href}>{chartLink(source.chart!.title)}<ArrowRight size={17} aria-hidden="true"/></Link><time dateTime={source.retrieved_at}>Checked {new Date(source.retrieved_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</time></div></div>)}
    {run.status==='failed'?<p className="agent-caption">No action was automatically retried.</p>:null}
    {run.action?<ActionReview action={run.action} busy={busy} onDecide={onDecide}/>:null}
    {otherSources.length?<details className="agent-sources"><summary>{otherSources.length===1?'Source checked':`${otherSources.length} sources checked`}</summary><ul>{otherSources.map(source=><li key={source.id}><Link className="assistant-source-link" to={source.href}>{source.title}<ArrowRight size={16} aria-hidden="true"/></Link><small>Checked {new Date(source.retrieved_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></li>)}</ul></details>:null}
  </>;
}
