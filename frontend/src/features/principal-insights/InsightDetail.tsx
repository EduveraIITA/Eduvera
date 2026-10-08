import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { PrincipalInsights } from "./api";
import { percent } from "./InsightCharts";

export type DetailKind="engagement"|"unfollowed"|"followups"|"classes";
export function InsightDetail({kind,data,onClose}:{kind:DetailKind;data:PrincipalInsights;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{const dialog=ref.current,previous=document.activeElement as HTMLElement|null;dialog?.showModal?.();return()=>{dialog?.close?.();previous?.focus();};},[]);
  const title={engagement:"Students to check in with",unfollowed:"Declining attendance without an open follow-up",followups:"Attendance follow-up queue",classes:"Class attendance and completeness"}[kind];
  const students=kind==="unfollowed"?data.engagement.without_followup_students:data.engagement.students;
  return <dialog ref={ref} className="principal-insights-dialog" aria-labelledby={id} onCancel={event=>{event.preventDefault();onClose();}}>
    <header><h2 id={id}>{title}</h2><button type="button" autoFocus onClick={onClose} aria-label="Close insight details"><X size={20}/></button></header>
    <div className="principal-insights-dialog__body">
      {kind==="engagement"||kind==="unfollowed"?<><p>At least a 10 percentage-point attendance decline, 5 scored days and 80% recording completeness in each comparison window. Homework is a recorded-completion signal, not proof of non-submission.</p><p>{students.length} shown; up to 50 highest-priority students are returned. Open follow-ups reflect current status.</p>
        {students.length?students.map(s=><article key={s.id}><strong>{s.name} · {s.class_name}</strong><span>{percent(s.previous)} → {percent(s.current)} · {s.change} percentage points</span><span>{s.missing_homework} homework items without completion · {s.open_followups} open follow-ups</span><Link to={`/principal/attendance?class_section_id=${s.class_id}&date=${data.period.end}`}>Review class register</Link></article>):<p>No students meet these review rules.</p>}</>:null}
      {kind==="followups"?<><p>Current open queue, ordered by overdue status. {data.followups.details.length} shown of {data.followups.awaiting+data.followups.review} open follow-ups.</p>{data.followups.details.map(f=><article key={f.id}><strong>{f.student_name}</strong><span>{f.state==="in_review"?"School review":"Awaiting reply"}{f.overdue?" · Overdue":""}</span><span>Owner: {f.owner}</span><Link to={`/principal/attendance?class_section_id=${f.class_id}&date=${f.attendance_date}`}>Open source register</Link></article>)}<Link to="/principal#attendance-followups" onClick={onClose}>Open follow-up conversations</Link></>:null}
      {kind==="classes"?<><p>Weighted attendance from recorded, non-excused student-days. Missing attendance remains unrecorded.</p>{data.attendance.classes.map(c=><article key={c.id}><strong>{c.name} · {percent(c.percentage)}</strong><span>{c.recorded} / {c.expected} student-days recorded · {percent(c.completeness)} completeness</span><Link to={`/principal/attendance?class_section_id=${c.id}&date=${data.period.end}`}>Review register</Link></article>)}</>:null}
    </div>
  </dialog>;
}
