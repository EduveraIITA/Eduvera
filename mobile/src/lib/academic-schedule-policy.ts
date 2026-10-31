import type { TeacherDay, TeacherDaySummary } from '../../../packages/contracts/src/wire/features/day-plans/api';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
import { nativeCalendarShiftDay, nativeCalendarValidDate } from './native-calendar';
export type AcademicTeacherPeriod=TeacherDay['periods'][number];
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function academicTeacherRead(school:string,date:string){return `/api/v1/day-plans/teacher?${new URLSearchParams({school_id:school,date})}`;}
export function academicTeacherDay(value:TeacherDay,date:string,actor:string) {
  if(!value||value.date!==date||!nativeCalendarValidDate(date)||!nativeCalendarValidDate(value.context?.today)||!/^\d{2}:\d{2}/.test(value.context.local_time)||!Array.isArray(value.periods)||new Set(value.periods.map(row=>row.id)).size!==value.periods.length||value.periods.some(row=>!uuid(row.id)||row.teacher_user_id!==actor))throw new Error('The teaching schedule did not match this exact date and assigned teacher.');
  return value;
}
export function academicCoverageAvailable(day:TeacherDay,period:AcademicTeacherPeriod,actor:string) {
  return period.teacher_user_id===actor&&!period.cancelled&&!!period.day_plan_id&&!!period.plan_version&&['pending','accepted','declined'].includes(period.coverage_status)
    &&Number.isSafeInteger(period.response_revision)&&period.response_revision>=0&&(day.date>day.context.today||day.date===day.context.today&&period.ends_at.slice(0,5)>day.context.local_time);
}
export function academicCoverageFingerprint(period:AcademicTeacherPeriod) {return JSON.stringify([period.id,period.day_plan_id,period.plan_version,period.class_section_id,period.teacher_user_id,period.cancelled,period.starts_at,period.ends_at,period.coverage_status,period.response_revision]);}
export function academicCoverageBody(source:AcademicTeacherPeriod,day:TeacherDay,actor:string,school:string,status:string,note:string) {
  const current=day.periods.find(row=>row.id===source.id);
  if(!current||!academicCoverageAvailable(day,current,actor)||academicCoverageFingerprint(current)!==academicCoverageFingerprint(source))throw new Error('This published assignment or response changed. Your note is kept; close this review and open the current assignment.');
  if(!['accepted','declined'].includes(status)||note.trim().length>500||status==='declined'&&!note.trim())throw new Error('Explain why you are unavailable, using at most 500 characters.');
  return {school_id:school,expected_revision:source.response_revision,status,note:note.trim(),source:'app'};
}
export function academicCoverageActionAllowed(record:NativePendingAction,scope:NativePendingScope) {
  try {
    const match=/^\/api\/v1\/day-plans\/periods\/([0-9a-f-]{36})\/respond$/i.exec(record.endpoint),source=record.source;
    if(!match||!uuid(match[1])||record.domain!=='schedule'||record.method!=='POST'||record.replayPolicy!=='same_request'||record.payload.kind!=='json'||source?.kind!=='academic_coverage_response'||source.sourceId!==match[1]||!Number.isSafeInteger(source.revision)||source.revision<0||record.scope.actorId!==scope.actorId||record.scope.schoolId!==scope.schoolId||record.scope.mode!==scope.mode||record.scope.namespaceId!==scope.namespaceId||record.scope.origin!==scope.origin)return false;
    const body=JSON.parse(record.payload.body) as Record<string,unknown>,read=new URL(record.refreshPath,'https://thatcampus.invalid'),owner=new URL(record.ownerHref,'https://thatcampus.invalid');
    return body.school_id===scope.schoolId&&body.expected_revision===source.revision&&body.idempotency_key===record.clientId&&body.source==='app'&&['accepted','declined'].includes(String(body.status))&&typeof body.note==='string'&&body.note.length<=500&&(body.status!=='declined'||!!body.note.trim())
      &&Object.keys(body).every(key=>['school_id','expected_revision','idempotency_key','status','note','source'].includes(key))
      &&read.origin==='https://thatcampus.invalid'&&read.pathname==='/api/v1/day-plans/teacher'&&read.searchParams.getAll('school_id').length===1&&read.searchParams.get('school_id')===scope.schoolId&&read.searchParams.getAll('date').length===1&&nativeCalendarValidDate(read.searchParams.get('date')??'')&&[...read.searchParams.keys()].every(key=>['school_id','date'].includes(key))
      &&owner.origin==='https://thatcampus.invalid'&&owner.pathname==='/areas/timetable/schedule'&&['source','date','coverage'].every(key=>owner.searchParams.getAll(key).length===1)&&owner.searchParams.get('source')==='academic'&&owner.searchParams.get('date')===read.searchParams.get('date')&&owner.searchParams.get('coverage')===source.sourceId&&(!owner.searchParams.has('school')||owner.searchParams.getAll('school').length===1&&owner.searchParams.get('school')===scope.schoolId);
  }catch{return false;}
}
export function academicCoverageReceipt(value:unknown,action:NativePendingAction) {
  if(!academicCoverageActionAllowed(action,action.scope))throw new Error('The retained coverage response is not bound to its exact source.');
  const result=value as Record<string,unknown>|null,body=JSON.parse((action.payload as {body:string}).body) as Record<string,unknown>;
  if(!result||result.id!==action.source!.sourceId||result.status!==body.status||result.response_revision!==Number(body.expected_revision)+1)throw new Error('The exact teacher coverage response was not confirmed.');
  return action.refreshPath;
}
export function academicSummaryRange(date:string,view:string) {
  if(view==='year')return {start:`${date.slice(0,4)}-01-01`,end:`${date.slice(0,4)}-12-31`};
  const first=date.slice(0,7)+'-01',next=new Date(`${first}T12:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);const last=next.toISOString().slice(0,10),before=nativeCalendarShiftDay(date,-7),after=nativeCalendarShiftDay(date,7);
  return {start:before<first?before:first,end:after>last?after:last};
}
export function academicSummaryMonths(summary:TeacherDaySummary) {
  const months=new Map<string,{date:string;periods:number;pending:number;declined:number;cancelled:number}>();
  for(const day of summary.days){const key=day.date.slice(0,7),row=months.get(key)??{date:key+'-01',periods:0,pending:0,declined:0,cancelled:0};for(const field of ['periods','pending','declined','cancelled'] as const)row[field]+=day[field];months.set(key,row);}
  return [...months.values()];
}
export function academicTeachingHref(period:AcademicTeacherPeriod,date:string) {
  if(!period.teaching_session_href)return null;
  try{const url=new URL(period.teaching_session_href,'https://thatcampus.invalid');return url.origin==='https://thatcampus.invalid'&&url.pathname==='/areas/timetable/session'&&url.searchParams.get('date')===date&&url.searchParams.get('class_section_id')===period.class_section_id&&Number(url.searchParams.get('period_number'))===period.period_number?url.pathname+url.search:null;}catch{return null;}
}
