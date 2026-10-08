import { apiFetch } from '../../lib/api';
import type { PrincipalTimetableResponse } from '../operations/api';
export interface SchedulePeriod { id:string; weekday:number; period_number:number; starts_at:string; ends_at:string; subject_id:string|null; teacher_user_id:string|null; title:string; slot_type:'class'|'break'|'activity'; room:string; }
export interface ScheduleVersion { id:string; class_section_id:string; term_id:string; state:'draft'|'published'; starts_on:string; ends_on:string; revision:number; baseline:boolean; periods:SchedulePeriod[]; }
export interface ScheduleScreen extends PrincipalTimetableResponse { school_id:string; versions:ScheduleVersion[]; }
export const getScheduleSettings=(term?:string)=>apiFetch<ScheduleScreen>(`/api/v1/schedule-planning${term?`?term_id=${encodeURIComponent(term)}`:''}`);
export function scheduleCommand(path:string,school:string,body:Record<string,unknown>) {
  return apiFetch<{id?:string;term_id?:string;revision?:number}>(`/api/v1/schedule-planning/${path}`,{method:'POST',body:JSON.stringify({school_id:school,idempotency_key:crypto.randomUUID(),...body})});
}
// API responses include relational metadata; mutation contracts intentionally do not.
export function cleanPeriod(p:SchedulePeriod):SchedulePeriod { return {id:p.id,weekday:p.weekday,period_number:p.period_number,starts_at:p.starts_at,ends_at:p.ends_at,subject_id:p.subject_id,teacher_user_id:p.teacher_user_id,title:p.title,slot_type:p.slot_type,room:p.room}; }
