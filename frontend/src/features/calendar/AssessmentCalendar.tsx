import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth, type MembershipRole } from '../auth/AuthContext';
import { isoOf } from './monthGrid';
import type { MarkTone } from './CalendarView';
interface Item {id:string;title:string;date:string;scheduled_at:string;subject_name:string;class_name:string;venue:string;}
export function useAssessmentCalendar(role:MembershipRole,year:number,month:number,student?:string) {
  const auth=useAuth();const membership=auth.memberships.find(m=>m.role===role);const school=membership?.school_id;
  const from=isoOf(year,month,1),to=isoOf(year,month,new Date(year,month+1,0).getDate());
  const family=role==='guardian'||role==='student';
  const allowed=role==='admin'||family||membership?.permissions?.includes('assessments.view');
  const query=useQuery({queryKey:['calendar','assessments',school,role,student,from,to],queryFn:()=>apiFetch<{items:Item[]}>(`/api/v1/schools/${school}/assessments/calendar/?${new URLSearchParams({from,to,...(student?{student_id:student}:{})})}`),enabled:!!school&&!!allowed&&(!family||!!student)});
  const marks:Record<string,MarkTone[]>={};for(const item of query.data?.items??[])marks[item.date]=['test'];
  return {query,marks,enabled:!!school&&!!allowed&&(!family||!!student)};
}
export function AssessmentCalendarRows({calendar,date}:{calendar:ReturnType<typeof useAssessmentCalendar>;date:string}) {
  if(!calendar.enabled)return null;
  if(calendar.query.isError)return <p role="alert">Assessment dates could not be loaded. <button onClick={()=>void calendar.query.refetch()}>Retry</button></p>;
  if(calendar.query.isPending)return <p className="cal-loading" role="status">Loading assessment dates…</p>;
  const items=calendar.query.data?.items.filter(i=>i.date===date)??[];
  if(!items.length)return null;
  return <><h4 className="cal-section-title">Assessments</h4><div className="cal-list">{items.map(i=><div className="cal-row" key={i.id}><span className="cal-event-icon cal-event-icon--test"><ClipboardCheck size={18}/></span><span className="cal-row__body"><strong>{i.title}</strong><small>{i.subject_name} · {i.class_name}{i.venue?` · ${i.venue}`:''}</small></span></div>)}</div></>;
}
