import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowRight, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, HeartHandshake, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { schoolDateToday } from '../../lib/schoolTime';
import { useOptionalAuth } from '../auth/AuthContext';
import { actionLabels, getPulse, getPulseDetail, outcomeLabels, pulseKey, savePulse, stateLabels, type PulseAction, type PulseDetail, type PulseFollowup, type PulseList, type PulseOutcome, type PulseSignal, type PulseState } from './api';
import './student-pulse.css';

const pct = (value:number|null) => value === null ? 'Not available' : `${Math.round(value)}%`;
const dateLabel = (value:string) => new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${value.slice(0,10)}T12:00:00Z`));
const due = (followup:PulseFollowup|null,today:string) => Boolean(followup && followup.state!=='resolved' && followup.due_on < today);

export default function StudentPulsePage() {
  const auth = useOptionalAuth();
  const location = useLocation();
  const portal = location.pathname.startsWith('/principal') ? 'principal' : 'teacher';
  const school = auth?.user?.active_school_id ?? auth?.memberships.find(m=>m.role===(portal==='principal'?'admin':'staff'))?.school_id;
  const { studentId,termId,subjectId } = useParams();
  const base = `/${portal}/student-pulse`;
  return <OperationsShell portal={portal} active={portal==='principal'?'insights':'more'} title="Student Pulse" backTo={studentId?base:portal==='principal'?'/principal/insights':'/teacher/more'}>
    {auth?.status==='authenticated' && school ? <Workspace key={`${auth.user?.id}:${school}`} school={school} userId={auth.user!.id} base={base} selected={studentId&&termId&&subjectId?[studentId,termId,subjectId].map(encodeURIComponent).join('/'):null}/> : <p role="status">Select your institution to open Student Pulse.</p>}
  </OperationsShell>;
}

function Workspace({school,userId,base,selected}:{school:string;userId:string;base:string;selected:string|null}) {
  const list = useQuery({queryKey:['student-pulse',school,userId],queryFn:()=>getPulse(school),staleTime:30_000,gcTime:0,retry:1,refetchInterval:60_000});
  const detail = useQuery({queryKey:['student-pulse-detail',school,userId,selected],queryFn:()=>getPulseDetail(school,selected!),enabled:Boolean(selected),staleTime:0,gcTime:0,retry:1});
  const current = selected ? detail : list;
  return <div className="pulse">
    {current.isPending ? <section className="pulse-state" role="status" aria-busy="true"><Activity size={26}/><h2>Preparing Student Pulse</h2><p>Checking the available attendance evidence.</p></section> : current.isError ? <section className="pulse-state" role="alert"><h2>Student Pulse could not be loaded</h2><p>{current.error.message}</p><button className="pulse-button" onClick={()=>void current.refetch()}><RefreshCw size={16}/>Try again</button><Link to={base}>Back to all insights</Link></section> : selected && detail.data ? <DetailScreen key={`${selected}:${detail.data.followup?.revision??0}`} data={detail.data} school={school} userId={userId} selected={selected} base={base} today={list.data?.today??schoolDateToday()}/> : list.data ? <PulseOverview data={list.data} base={base} onRefresh={()=>void list.refetch()} refreshing={list.isFetching}/> : null}
  </div>;
}

export function PulseOverview({data,base,onRefresh,refreshing=false}:{data:PulseList;base:string;onRefresh:()=>void;refreshing?:boolean}) {
  const [params,setParams] = useSearchParams();
  const tab = ['attention','followups','classes'].includes(params.get('tab')??'') ? params.get('tab')! : 'attention';
  const query = params.get('q')??'';
  const classId = params.get('class')??'';
  const classes = [...new Map(data.signals.map(row=>[row.class_id,row.class_name])).entries()];
  const awaiting = data.signals.filter(row=>row.flagged&&!row.followup);
  const active = data.signals.filter(row=>row.followup&&row.followup.state!=='resolved');
  const overdue = active.filter(row=>due(row.followup,data.today));
  const filtered = data.signals.filter(row=>(!classId||row.class_id===classId)&&`${row.student_name} ${row.subject_name} ${row.class_name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const visible = filtered.filter(row=>tab==='followups'?Boolean(row.followup):row.flagged&&!row.followup);
  const clusters = [...new Set(filtered.filter(row=>row.flagged).map(row=>`${row.class_id}:${row.term_id}:${row.subject_id}`))].map(key=>filtered.filter(row=>row.flagged&&`${row.class_id}:${row.term_id}:${row.subject_id}`===key)).filter(rows=>new Set(rows.map(row=>row.student_id)).size>=3);
  function filter(key:string,value:string) {setParams(previous=>{const next=new URLSearchParams(previous);if(value) next.set(key,value);else next.delete(key);return next;},{replace:true});}
  return <>
    <header className="pulse-heading"><div><span className="pulse-eyebrow"><Activity size={15}/>Student support</span><h1>A pattern is a reason to check in.</h1><p>Understand the attendance gap. Start a supportive conversation.</p></div><button className="pulse-icon-button" aria-label="Refresh Student Pulse" disabled={refreshing} onClick={onRefresh}><RefreshCw size={18}/></button></header>
    <div className="pulse-metrics"><button onClick={()=>filter('tab','attention')}><span>Need a first check-in</span><strong>{new Set(awaiting.map(row=>row.student_id)).size}</strong><small>Students, not a risk score <ArrowRight size={14}/></small></button><button onClick={()=>filter('tab','followups')}><span>Check-ins underway</span><strong>{active.length}</strong><small>Open subject follow-ups <ArrowRight size={14}/></small></button><button onClick={()=>filter('tab','followups')}><span>Past review date</span><strong>{overdue.length}</strong><small>Follow up with the owner <ArrowRight size={14}/></small></button></div>
    <p className="pulse-source"><ShieldCheck size={16}/><span>Based on recorded term totals, not lesson-by-lesson tracking. Verify source records first; attendance cannot establish intent.</span></p>
    <nav className="pulse-tabs" aria-label="Student Pulse views">{[['attention','Needs attention'],['followups','Follow-ups'],['classes','Class patterns']].map(([value,label])=><button key={value} aria-pressed={tab===value} onClick={()=>filter('tab',value!)}>{label}</button>)}</nav>
    <div className="pulse-filters"><label className="pulse-search"><Search size={17}/><input aria-label="Search student, subject or class" placeholder="Search student or subject" value={query} onChange={e=>filter('q',e.target.value)}/></label><label>Class<select value={classId} onChange={e=>filter('class',e.target.value)}><option value="">All permitted classes</option>{classes.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label></div>
    {tab==='classes' ? <div className="pulse-list">{clusters.length ? clusters.map(rows=><section className="pulse-card" key={`${rows[0]!.class_id}:${rows[0]!.term_id}:${rows[0]!.subject_id}`}><div className="pulse-card-heading"><span className="pulse-badge"><Users size={14}/>Shared attendance gap</span><span>{rows[0]!.class_name}</span></div><h2>{rows.length} students have lower {rows[0]!.subject_name} attendance</h2><p>Review source records, scheduling and classroom experience. This is not an evaluation of the teacher.</p><div className="pulse-cluster-students">{rows.map(row=><Link key={pulseKey(row)} to={`${base}/${pulseKey(row)}`}>{row.student_name}<ArrowRight size={14}/></Link>)}</div></section>) : <Empty title="No shared pattern under these rules" text="A class pattern needs at least three students with an individual subject attendance gap. This does not establish that every student is doing well."/>}</div> : <div className="pulse-list">{visible.length ? visible.sort((a,b)=>Number(due(b.followup,data.today))-Number(due(a.followup,data.today))||(b.gap??0)-(a.gap??0)).map(row=><InsightCard key={pulseKey(row)} row={row} base={base} today={data.today}/>) : <Empty title={query||classId?'No matching insights':tab==='followups'?'No follow-ups yet':'No new gaps under these rules'} text={query||classId?'Try another name or clear the class filter.':tab==='followups'?'Open an attendance pattern, review the evidence and plan a check-in.':'At least five subject sessions and ten other sessions are needed. Missing or inconsistent totals are not treated as absences.'}/>}</div>}
    <details className="pulse-method"><summary>How these review prompts are created</summary><p>Within the same student and term: at least 5 eligible subject sessions, 10 other-subject sessions, 3 not recorded as attended, and attendance at least 20 percentage points below the weighted rate for other subjects. Excused sessions are excluded. These are configurable-in-code review rules, not validated behavioural predictions.</p><p>Lesson dates, attendance recording completeness, consecutive misses, sudden changes and before/after-lunch patterns are not available from term totals. They are not inferred. No alert is sent automatically to families.</p><p>Snapshot retrieved {new Date(data.generated_at).toLocaleString('en-IN')}. This is not the source attendance update time. Current-term active enrolments only.</p></details>
  </>;
}

function Empty({title,text}:{title:string;text:string}) {return <section className="pulse-state"><BookOpen size={27}/><h2>{title}</h2><p>{text}</p></section>;}
function InsightCard({row,base,today}:{row:PulseSignal;base:string;today:string}) {
  return <article className="pulse-card"><div className="pulse-card-heading"><span className={`pulse-badge ${row.followup?.state==='resolved'?'pulse-badge--mint':''}`}>{row.followup?stateLabels[row.followup.state]:'Needs attention'}</span><span>{row.class_name} · {row.term_name}</span></div>
    <h2>{row.student_name}</h2><h3>{row.subject_name} · {row.followup?.state==='resolved'?'Review closed':row.flagged?'Attendance needs a check-in':'Attendance gap no longer meets review rules'}</h3><p>{row.missed} of {row.eligible} eligible sessions are not recorded as attended, while other subjects show {pct(row.other_percentage)} attendance.</p>
    <div className="pulse-comparison"><div><span>{row.subject_name}</span><strong>{pct(row.percentage)}</strong><div className="pulse-track"><i style={{width:`${row.percentage??0}%`}}/></div></div><div><span>Other subjects</span><strong>{pct(row.other_percentage)}</strong><div className="pulse-track pulse-track--mint"><i style={{width:`${row.other_percentage??0}%`}}/></div></div></div>
    <p className="pulse-suggestion"><HeartHandshake size={17}/><span>Ask how the lessons are going and whether learning, classroom or timetable support would help.</span></p>
    <footer>{row.followup?<span className={due(row.followup,today)?'pulse-overdue':''}><CalendarClock size={14}/>{row.followup.owner_name} · {row.followup.state==='resolved'?'Review closed':`Review ${dateLabel(row.followup.due_on)}`}{due(row.followup,today)?' · Overdue':''}</span>:<span>No check-in planned yet</span>}<Link to={`${base}/${pulseKey(row)}`}>Review pattern<ArrowRight size={16}/></Link></footer>
  </article>;
}

function DetailScreen({data,school,userId,selected,base,today}:{data:PulseDetail;school:string;userId:string;selected:string;base:string;today:string}) {
  const [params,setParams] = useSearchParams();
  const view = params.get('view')??'evidence';
  const row=data.signal;
  return <>
    <Link className="pulse-back" to={base}>← All Student Pulse insights</Link>
    <header className="pulse-heading"><div><span className="pulse-eyebrow">{row.class_name} · {row.term_name}</span><h1>{row.student_name}</h1><p>{row.subject_name} attendance · {data.followup?stateLabels[data.followup.state]:row.flagged?'Needs a first check-in':'Review rules not met'}</p></div><span className="pulse-avatar" aria-hidden="true">{row.student_name.split(' ').slice(0,2).map(n=>n[0]).join('')}</span></header>
    <nav className="pulse-tabs" aria-label="Student pattern screens">{[['evidence','Attendance evidence'],['plan','Plan a check-in'],['progress','Progress']].map(([value,label])=><button key={value} aria-pressed={view===value} onClick={()=>setParams({view:value!})}>{label}</button>)}</nav>
    {view==='plan'?<PlanForm data={data} school={school} userId={userId} selected={selected} today={today} onSaved={()=>setParams({view:'progress'})}/>:view==='progress'?<Progress data={data}/>:<>
      <section className="pulse-card pulse-evidence"><span className="pulse-badge">Subject attendance gap · verify records</span><h2>{row.flagged?`${row.student_name} has lower ${row.subject_name} attendance than other subjects`:`${row.student_name} · current ${row.subject_name} attendance`}</h2><p>Term totals show {row.attended} of {row.eligible} eligible {row.subject_name} sessions attended, compared with {pct(row.other_percentage)} across other subjects. {row.excused} excused sessions are excluded.</p><div className="pulse-facts"><div><strong>{pct(row.percentage)}</strong><span>{row.subject_name}</span></div><div><strong>{pct(row.other_percentage)}</strong><span>Other subjects</span></div><div><strong>{row.gap===null?'—':Math.max(0,Math.round(row.gap))} pp</strong><span>Attendance gap</span></div></div><p className="pulse-source"><ShieldCheck size={17}/><span>This is a prompt for human review, not evidence of deliberate skipping or dislike of a teacher.</span></p></section>
      <section className="pulse-card"><h2>Compare the recorded subjects</h2><div className="pulse-subjects">{row.subjects.map(subject=><div key={subject.subject_id}><span>{subject.name}<small>{subject.attended}/{subject.eligible} attended · {subject.excused} excused</small></span><div className={`pulse-track ${subject.subject_id===row.subject_id?'':'pulse-track--mint'}`}><i style={{width:`${subject.percentage??0}%`}}/></div><strong>{pct(subject.percentage)}</strong></div>)}</div></section>
      <section className="pulse-card"><h2>Lesson-by-lesson evidence</h2><p>Dated period records are not available in this source. We cannot say the student missed consecutive lessons, was present before or after the lesson, or repeatedly missed an after-lunch class.</p><p className="pulse-note">Check the original registers, approved leave, cancelled lessons and recording gaps before acting.</p></section>
      <section className="pulse-card pulse-conversation"><h2><HeartHandshake size={20}/>Start with curiosity</h2><p>“How have you been finding {row.subject_name} lessons?”</p><p>“Is anything about the lesson, classroom or timetable making it harder to attend?”</p><p>“What would make the next few classes easier for you?”</p><small>Ask privately. Listen before deciding the cause or involving a guardian.</small></section>
      <button className="pulse-button" disabled={!row.flagged&&!data.followup} onClick={()=>setParams({view:'plan'})}><ClipboardCheck size={17}/>{data.followup?'Update follow-up':'Plan a private check-in'}<ArrowRight size={16}/></button>
    </>}
  </>;
}

function PlanForm({data,school,userId,selected,today,onSaved}:{data:PulseDetail;school:string;userId:string;selected:string;today:string;onSaved:()=>void}) {
  const client=useQueryClient();
  const f=data.followup;
  const [owner,setOwner]=useState(f?.owner_user_id??(data.owners.some(owner=>owner.id===userId)?userId:''));
  const [action,setAction]=useState<PulseAction>(f?.action??'private_check_in');
  const [state,setState]=useState<PulseState>(f?.state??'check_in');
  const [reviewDate,setReviewDate]=useState(f?.due_on??today);
  const [outcome,setOutcome]=useState<PulseOutcome|null>(f?.outcome??null);
  const [reviewed,setReviewed]=useState(false);
  const save=useMutation({mutationFn:()=>savePulse(school,selected,{owner_user_id:owner,action,state,due_on:reviewDate,outcome:state==='resolved'?outcome:null,expected_revision:f?.revision??0,records_reviewed:true}),onSuccess:async result=>{client.setQueryData(['student-pulse-detail',school,userId,selected],result);await client.invalidateQueries({queryKey:['student-pulse',school,userId]});onSaved();}});
  return <form className="pulse-card pulse-form" onSubmit={event=>{event.preventDefault();if(reviewed&&!save.isPending)save.mutate();}}><h2>{f?'Update the follow-up':'Plan a supportive check-in'}</h2><p>Agree one useful next step for {data.signal.student_name}. Keep personal or safeguarding narratives in the restricted-care workflow, not this record.</p>
    <label>Follow-up owner<select required value={owner} onChange={event=>setOwner(event.target.value)}><option value="">Choose an eligible staff member</option>{data.owners.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>Next step<select value={action} onChange={event=>setAction(event.target.value as PulseAction)}>{Object.entries(actionLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <div className="pulse-form-grid"><label>Review date<input type="date" required min={state==='resolved'?undefined:today} value={reviewDate} onChange={event=>setReviewDate(event.target.value)}/></label><label>Follow-up status<select value={state} onChange={event=>setState(event.target.value as PulseState)}>{Object.entries(stateLabels).filter(([value])=>Boolean(f)||value==='check_in').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
    {state==='resolved'?<label>Human-recorded outcome<select required value={outcome??''} onChange={event=>setOutcome(event.target.value as PulseOutcome)}><option value="">Choose the review outcome</option>{Object.entries(outcomeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>:null}
    <label className="pulse-checkbox"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>I reviewed the source records and context. This action is not a finding of deliberate absence.</span></label>
    {save.isError?<p role="alert" className="pulse-error">{save.error.message} <button type="button" onClick={()=>void client.invalidateQueries({queryKey:['student-pulse-detail',school,userId,selected]})}>Refresh latest follow-up</button></p>:null}
    <button className="pulse-button" disabled={!reviewed||!owner||save.isPending} type="submit"><CheckCircle2 size={17}/>{save.isPending?'Saving…':f?'Save follow-up':'Create staff follow-up'}</button><p className="pulse-note">Saved to the institution’s follow-up record. No message is automatically sent to the student, owner or guardian.</p>
  </form>;
}

function Progress({data}:{data:PulseDetail}) {
  const followup=data.followup;
  if (!followup) return <Empty title="No follow-up has been planned" text="Review the evidence and assign a check-in first. Eduera will not mark this pattern resolved automatically."/>;
  const eligible=(data.signal.held-data.signal.excused)-(followup.baseline_held-followup.baseline_excused);
  const attended=data.signal.attended-followup.baseline_attended;
  const inconsistent=data.signal.held<followup.baseline_held||data.signal.attended<followup.baseline_attended||eligible<0||attended>eligible;
  return <><section className="pulse-card"><span className="pulse-badge pulse-badge--mint">{stateLabels[followup.state]}</span><h2>{actionLabels[followup.action]}</h2><p>{followup.owner_name} · Review {dateLabel(followup.due_on)}</p><div className="pulse-source"><CalendarClock size={19}/><span>{inconsistent?'Source totals changed inconsistently. Verify corrections before comparing attendance.':eligible>0?`Since this follow-up opened, the recorded totals increased by ${attended} attended out of ${eligible} eligible sessions.`:'No additional eligible sessions are recorded since this follow-up opened.'}</span></div><p className="pulse-note">This comparison uses cumulative totals. It does not prove that the check-in caused an improvement. Closing a review does not establish improved attendance.</p></section>
    <section className="pulse-card"><h2>Follow-up history</h2><ol className="pulse-timeline">{data.history.map(entry=><li key={entry.revision}><span className="pulse-timeline-dot"/><div><strong>{stateLabels[entry.state]}</strong><p>{actionLabels[entry.action]} · {entry.owner_name}</p>{entry.outcome?<p>{outcomeLabels[entry.outcome]}</p>:null}<small>{entry.actor_name} · {dateLabel(entry.created_at)} · Revision {entry.revision}</small></div></li>)}</ol></section></>;
}
