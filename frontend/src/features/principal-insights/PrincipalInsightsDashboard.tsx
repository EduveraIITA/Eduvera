import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, RefreshCw, Users } from "lucide-react";
import { useOptionalAuth } from "../auth/AuthContext";
import { getPrincipalInsights, type PrincipalInsights } from "./api";
import { AttendanceTrend, InsightBar, money, percent, shortDate } from "./InsightCharts";
import { InsightDetail, type DetailKind } from "./InsightDetail";
import "./principal-insights.css";

export function PrincipalInsightsDashboard({date}:{date:string}) {
  const auth=useOptionalAuth();
  const schoolId=auth?.user?.active_school_id??auth?.memberships.find(m=>m.role==="admin")?.school_id;
  if(auth?.status!=="authenticated"||!schoolId) return null;
  return <Dashboard key={`${auth.user?.id}:${schoolId}`} schoolId={schoolId} date={date}/>;
}

function Dashboard({schoolId,date}:{schoolId:string;date:string}) {
  const [params,setParams]=useSearchParams();
  const days=[14,28,56].includes(Number(params.get("insight_days")))?Number(params.get("insight_days")):28;
  const classId=params.get("insight_class")??"";
  const rawThreshold=Number(params.get("insight_threshold")??50);
  const threshold=Number.isInteger(rawThreshold)&&rawThreshold>=1&&rawThreshold<=99?rawThreshold:50;
  const query=useQuery({queryKey:["principal-insights",schoolId,date,days,classId,threshold],queryFn:()=>getPrincipalInsights(schoolId,date,days,classId,threshold),staleTime:30_000,refetchInterval:60_000,retry:1});
  function setFilter(key:string,value:string){setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);return next;},{replace:true});}
  return <section className="principal-insights" aria-labelledby="principal-insights-heading">
    <header className="principal-insights__heading"><div><span className="principal-insights__eyebrow">School intelligence</span><h2 id="principal-insights-heading">See what needs your attention</h2><p>Patterns, evidence and the next useful action.</p></div><button type="button" className="principal-insights__refresh" aria-label="Refresh principal insights" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={17}/><span>Refresh</span></button></header>
    <div className="principal-insights__filters"><label>Review window<select value={days} onChange={e=>setFilter("insight_days",e.target.value)}><option value="14">Last 14 days</option><option value="28">Last 28 days</option><option value="56">Last 56 days</option></select></label><label>Class<select value={classId} onChange={e=>setFilter("insight_class",e.target.value)}><option value="">Whole institution</option>{query.data?.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Academic review below<select value={threshold} onChange={e=>setFilter("insight_threshold",e.target.value)}>{[...new Set([40,50,60,threshold])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n}% marks</option>)}</select></label></div>
    {query.isPending?<div className="principal-insights__loading" role="status" aria-busy="true"><span/><span/><span/><p>Preparing school insights…</p></div>:null}
    {query.isError?<div className="principal-insights__error" role="alert"><strong>Insights could not be loaded.</strong><p>Your daily overview remains available. Try refreshing, or reset the class filter.</p><button type="button" onClick={()=>void query.refetch()}>Try again</button>{classId?<button type="button" onClick={()=>setFilter("insight_class","")}>Reset class filter</button>:null}</div>:null}
    {query.data&&!query.isError?<InsightContent key={`${date}:${days}:${classId}:${threshold}`} data={query.data}/>:null}
  </section>;
}

function Panel({title,subtitle,children,action}:{title:string;subtitle:string;children:ReactNode;action?:ReactNode}) {
  return <section className="operations-panel principal-insights__panel"><header><div><h3>{title}</h3><p>{subtitle}</p></div></header><div className="principal-insights__panel-body">{children}</div>{action?<footer>{action}</footer>:null}</section>;
}

export function InsightContent({data}:{data:PrincipalInsights}) {
  const [detail,setDetail]=useState<DetailKind|null>(null);
  const gap=data.schedule.reduce((sum,r)=>sum+r.unassigned,0);
  const recorded=data.attendance.recorded,expected=data.attendance.expected;
  const assessments=data.learning.filter(a=>a.assessed>0).sort((a,b)=>b.below/b.assessed-a.below/a.assessed);
  const due=data.fees.reduce((sum,r)=>sum+r.due_paise,0),paid=data.fees.reduce((sum,r)=>sum+r.paid_paise,0);
  const balance=data.fees.reduce((sum,r)=>sum+r.balance_paise,0);
  const open=data.followups.awaiting+data.followups.review;
  return <>
    <p className="principal-insights__freshness">{shortDate(data.period.start)}–{shortDate(data.period.end)} · Updated {new Intl.DateTimeFormat("en-IN",{hour:"numeric",minute:"2-digit",timeZone:data.timezone}).format(new Date(data.generated_at))} · {recorded}/{expected} student-days recorded</p>
    {expected>recorded?<div className="principal-insights__quality"><strong>Some registers are incomplete.</strong> {expected-recorded} student-days are unrecorded. Missing records are not counted as absences.</div>:null}
    <div className="principal-insights__metrics">
      <button type="button" onClick={()=>setDetail("classes")}><span>Recorded attendance</span><strong>{percent(data.attendance.percentage)}</strong><small>{percent(data.attendance.completeness)} data completeness <ArrowRight size={14}/></small></button>
      <button type="button" onClick={()=>setDetail("engagement")}><span>Students to check in with</span><strong>{data.engagement.total}</strong><small>{data.engagement.combined} also missing homework records <ArrowRight size={14}/></small></button>
      <button type="button" onClick={()=>setDetail("followups")}><span>Overdue follow-ups</span><strong>{data.followups.overdue}</strong><small>{open} open {open===1?"conversation":"conversations"} now <ArrowRight size={14}/></small></button>
      <Link to="/principal/timetable"><span>Unassigned periods</span><strong>{gap}</strong><small>Next 7 days · timetable coverage <ArrowRight size={14}/></small></Link>
    </div>
    <section className="principal-insights__brief" aria-labelledby="principal-brief-title"><h3 id="principal-brief-title">Your review brief</h3><div>
      {data.engagement.without_followup>0?<button type="button" onClick={()=>setDetail("unfollowed")}><Users size={19}/><span><strong>{data.engagement.without_followup} {data.engagement.without_followup===1?"student has":"students have"} declining attendance with no open follow-up</strong><small>Ask class teachers to review the reason and whether a check-in is needed.</small></span><ArrowRight size={17}/></button>:null}
      {data.followups.overdue>0?<button type="button" onClick={()=>setDetail("followups")}><CalendarClock size={19}/><span><strong>{data.followups.overdue} {data.followups.overdue===1?"follow-up has passed its deadline":"follow-ups have passed their deadlines"}</strong><small>Review the existing owners and agree the next action.</small></span><ArrowRight size={17}/></button>:null}
      {data.deadlines.length>0?<a href="#principal-deadlines"><BookOpen size={19}/><span><strong>{data.deadlines.length} {data.deadlines.length===1?"class-day has":"class-days have"} three or more deadlines</strong><small>Coordinate homework and assessments across subjects.</small></span><ArrowRight size={17}/></a>:null}
      {!data.engagement.without_followup&&!data.followups.overdue&&!data.deadlines.length?<p><CheckCircle2 size={20}/>No exceptions under these rules. Check completeness before drawing conclusions.</p>:null}
    </div></section>
    <div className="principal-insights__grid">
      <Panel title="Attendance over time" subtitle="Weekly, weighted by recorded student-days" action={<button type="button" onClick={()=>setDetail("classes")}>Compare classes <ArrowRight size={15}/></button>}><AttendanceTrend daily={data.attendance.daily}/><p className="principal-insights__note">Current enrolled cohort. Excused days are excluded; half-days count as 0.5. Partial weeks retain their actual denominator.</p></Panel>
      <Panel title="Learning gaps worth reviewing" subtitle={`Latest published results per assessment · below ${data.threshold}%`} action={<Link to="/principal/assessments">Open assessments <ArrowRight size={15}/></Link>}>
        {assessments.length?assessments.slice(0,5).map(a=><InsightBar key={a.id} label={`${a.class_name} · ${a.subject}`} value={a.below} total={a.assessed} detail={`${a.below}/${a.assessed} below`} tone="warning"/>):<p className="principal-insights__empty">No scored, published assessments in this window. Unpublished and missing results are not treated as zero.</p>}
        <p className="principal-insights__note">Review threshold, not a pass/fail policy. Students may appear in multiple assessments.</p>
        {data.learning.length?<details className="principal-insights__details"><summary>All assessments and participation</summary>{data.learning.map(a=><p key={a.id}>{a.class_name} · {a.title}: {a.below} below threshold; {a.assessed}/{a.roster} scored · published {shortDate(a.published_at)}</p>)}</details>:null}
      </Panel>
      <Panel title="School and home follow-through" subtitle="Current open work and closures in the review window" action={<button type="button" onClick={()=>setDetail("followups")}>Review owners and source records <ArrowRight size={15}/></button>}>
        <InsightBar label="Awaiting family reply" value={data.followups.awaiting} total={Math.max(open,data.followups.resolved,1)} detail={`${data.followups.awaiting} open`}/>
        <InsightBar label="Ready for school review" value={data.followups.review} total={Math.max(open,data.followups.resolved,1)} detail={`${data.followups.review} open`} tone="warning"/>
        <InsightBar label="Resolved in window" value={data.followups.resolved} total={Math.max(open,data.followups.resolved,1)} detail={`${data.followups.resolved} closed`} tone="mint"/>
        <p className="principal-insights__note">Counts are follow-ups, not unique students or a conversion funnel. Resolution does not establish improved attendance.</p>
      </Panel>
      <Panel title="Teaching coverage ahead" subtitle={`7 days from ${shortDate(data.operational_date)} · scheduled periods`} action={<Link to="/principal/timetable">Review timetable <ArrowRight size={15}/></Link>}>
        {data.schedule.length?data.schedule.map(day=><InsightBar key={day.date} label={shortDate(day.date)} value={day.planned-day.unassigned} total={day.planned} detail={`${day.planned-day.unassigned}/${day.planned} assigned`} tone={day.unassigned?"warning":"mint"}/>):<p className="principal-insights__empty">No teaching periods scheduled in the next seven days.</p>}
        <p className="principal-insights__note">{data.schedule.reduce((n,d)=>n+d.cancelled,0)} cancelled periods. Assignment is not evidence that a lesson was delivered.</p>
      </Panel>
    </div>
    <section id="principal-deadlines" className="operations-panel principal-insights__panel"><header><div><h3>Deadline pressure</h3><p>Upcoming class-days with 3+ homework or assessment deadlines</p></div></header><div className="principal-insights__panel-body">
      {data.deadlines.length?<div className="principal-insights__deadline-list">{data.deadlines.map(d=><article key={`${d.class_id}:${d.date}`}><span><strong>{d.class_name}</strong><small>{shortDate(d.date)}</small></span><span>{d.homework} homework · {d.assessments} assessments</span><strong>{d.total} due</strong></article>)}</div>:<p className="principal-insights__empty">No deadline clusters found in the next seven days.</p>}
      <p className="principal-insights__note">Counts show timing conflicts, not estimated hours or assignment difficulty.</p>
    </div></section>
    <details className="operations-panel principal-insights__finance"><summary>Fee collection overview <span>{money(balance)} outstanding as of {shortDate(data.operational_date)}</span></summary><div className="principal-insights__panel-body">
      <p>{money(paid)} allocated against {money(due)} net fees due. Credits and refunds included; future instalments excluded.</p>
      {data.fees.length?[...data.fees].sort((a,b)=>["Due today","1–30 days","31–60 days","61–90 days","91+ days"].indexOf(a.band)-["Due today","1–30 days","31–60 days","61–90 days","91+ days"].indexOf(b.band)).map(f=><InsightBar key={f.band} label={f.band} value={f.balance_paise} total={Math.max(...data.fees.map(r=>r.balance_paise),1)} detail={money(f.balance_paise)}/>):<p className="principal-insights__empty">No fee invoices are due.</p>}<Link to="/principal/fees">Open fee ledger <ArrowRight size={15}/></Link>
    </div></details>
    <details className="principal-insights__method"><summary>How to read these insights</summary><p>Engagement compares {shortDate(data.period.start)}–{shortDate(data.period.end)} with {shortDate(data.period.baseline_start)}–{shortDate(data.period.baseline_end)}. Flags need at least 5 scored days and 80% recording completeness in each window. They suggest a human review, not a diagnosis or prediction.</p><p>Follow-up status, fees and the upcoming schedule reflect current records. Historical attendance uses currently active enrolments and the effective calendar. Topic mastery, verified teaching-time loss, intervention impact, transport causes and reopened complaints need additional structured evidence and are not inferred here. Restricted safeguarding narratives are not included.</p></details>
    {detail?<InsightDetail kind={detail} data={data} onClose={()=>setDetail(null)}/>:null}
  </>;
}
