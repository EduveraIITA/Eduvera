import { useQuery } from '@tanstack/react-query';
import { useAuth,type MembershipRole } from '../auth/AuthContext';
import { getParentTimetableSummary,getStudentTimetableSummary } from '../school/api';
import { getAdminSummary,getTeacherSummary } from '../day-plans/api';
import { isoOf,type MonthCell } from './monthGrid';
export function useCalendarSchedule(role:MembershipRole,year:number,month:number,student?:string) {
  const auth=useAuth();const school=auth.memberships.find(m=>m.role===role)?.school_id??'';
  const start=isoOf(year,month,1),end=isoOf(year,month,new Date(year,month+1,0).getDate());
  const query=useQuery({queryKey:['calendar','schedule',role,school,student,start,end],queryFn:()=>role==='admin'?getAdminSummary(school,start,end):role==='staff'?getTeacherSummary(school,start,end):role==='guardian'?getParentTimetableSummary(start,end,start,student):getStudentTimetableSummary(start,end,start),enabled:!!school&&(role!=='guardian'||!!student)});
  return {query,isSchoolDay:(cell:MonthCell)=>(query.data?.days.find(d=>d.date===cell.iso)?.periods??0)>0};
}
