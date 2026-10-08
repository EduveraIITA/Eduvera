import { apiFetch } from '../../lib/api';
export type PulseState = 'check_in' | 'monitoring' | 'resolved';
export type PulseAction = 'private_check_in' | 'academic_support' | 'classroom_review' | 'timetable_review' | 'verify_records';
export type PulseOutcome = 'support_agreed' | 'records_corrected' | 'review_complete';
export interface PulseFollowup {
  id:string; owner_user_id:string; owner_name:string; state:PulseState; action:PulseAction;
  due_on:string; outcome:PulseOutcome|null; revision:number;
  baseline_held:number; baseline_attended:number; baseline_excused:number; created_at:string; updated_at:string;
}
export interface PulseSubject { subject_id:string; name:string; held:number; attended:number; excused:number; eligible:number; percentage:number|null }
export interface PulseSignal {
  student_id:string; student_name:string; class_id:string; class_name:string; term_id:string; term_name:string;
  subject_id:string; subject_name:string; held:number; attended:number; excused:number; eligible:number; missed:number;
  percentage:number|null; other_percentage:number|null; gap:number|null; flagged:boolean; subjects:PulseSubject[]; followup:PulseFollowup|null;
}
export interface PulseList { school_id:string; today:string; generated_at:string; source:string; signals:PulseSignal[] }
export interface PulseDetail {
  signal:PulseSignal; followup:PulseFollowup|null; owners:Array<{id:string;name:string}>;
  history:Array<{revision:number;state:PulseState;action:PulseAction;due_on:string;outcome:PulseOutcome|null;created_at:string;actor_name:string;owner_name:string}>;
}
export interface PulseCommand { owner_user_id:string; expected_revision:number; state:PulseState; action:PulseAction; due_on:string; outcome:PulseOutcome|null; records_reviewed:true }
const endpoint = (school:string) => `/api/v1/schools/${encodeURIComponent(school)}/student-pulse`;
export const getPulse = (school:string) => apiFetch<PulseList>(endpoint(school));
export const getPulseDetail = (school:string,key:string) => apiFetch<PulseDetail>(`${endpoint(school)}/${key}`);
export const savePulse = (school:string,key:string,body:PulseCommand) => apiFetch<PulseDetail>(`${endpoint(school)}/${key}`,{method:'PUT',body:JSON.stringify(body)});
export const pulseKey = (row:PulseSignal) => [row.student_id,row.term_id,row.subject_id].map(encodeURIComponent).join('/');
export const actionLabels:Record<PulseAction,string> = {private_check_in:'Private student check-in',academic_support:'Agree academic support',classroom_review:'Review classroom experience',timetable_review:'Check timetable or access barriers',verify_records:'Verify attendance records'};
export const stateLabels:Record<PulseState,string> = {check_in:'Check-in planned',monitoring:'Monitoring',resolved:'Review closed'};
export const outcomeLabels:Record<PulseOutcome,string> = {support_agreed:'Support agreed',records_corrected:'Records corrected',review_complete:'Review completed'};
