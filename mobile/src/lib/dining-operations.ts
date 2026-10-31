import type { DiningService } from '../../../packages/contracts/src/wire/features/dining/diningApi';
import type { DiningPlan, DiningPlanDay, DiningPlanDayInput, DiningPlanDate } from '../../../packages/contracts/src/wire/features/dining/diningPlanApi';
import type { RecordedCommand } from './recorded-command';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export const diningCalendarDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(`${v}T12:00:00Z`))&&new Date(`${v}T12:00:00Z`).toISOString().slice(0,10)===v;
export const diningShiftDate=(v:string,n:number)=>{if(!diningCalendarDate(v))throw new Error('Choose a valid calendar date.');return new Date(Date.parse(`${v}T12:00:00Z`)+n*86400000).toISOString().slice(0,10);};
export function diningWeeklyDay(day:DiningPlanDay,menuMode:'native'|'reference'):DiningPlanDayInput{
 const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
 if(!Number.isInteger(day.weekday)||day.weekday<1||day.weekday>7||!uuid(day.operator_person_id)||day.operator.id!==day.operator_person_id||day.space_id!==null&&(!uuid(day.space_id)||day.place?.id!==day.space_id)||!clock.test(day.starts_at)||!clock.test(day.ends_at)||![0,1].includes(day.end_day_offset)||(day.end_day_offset?day.ends_at>day.starts_at:day.ends_at<=day.starts_at)||!['reject','earlier','later'].includes(day.start_fold)||!['reject','earlier','later'].includes(day.end_fold)||typeof day.menu_text!=='string'||day.menu_text.length>4000)throw new Error('Review each weekday, operator and a serving window up to 24 hours.');
 return{weekday:day.weekday,starts_at:day.starts_at,ends_at:day.ends_at,end_day_offset:day.end_day_offset,operator_person_id:day.operator_person_id,space_id:day.space_id,menu_text:menuMode==='native'?day.menu_text.trim():'',start_fold:day.start_fold,end_fold:day.end_fold};
}
export function diningWeeklyBody(service:DiningService|undefined,plan:DiningPlan|undefined,input:{label:string;timezone:string;startsOn:string;endsOn:string;days:DiningPlanDay[];note:string}){
 if(plan?!plan.allowed_actions.includes('save'):!service?.allowed_actions.includes('create_plan'))throw new Error('The current responsible person cannot save this weekly draft.');
 try{new Intl.DateTimeFormat('en',{timeZone:input.timezone});}catch{throw new Error('Confirm this campus timezone before planning a weekly menu.');}
 if(!diningCalendarDate(input.startsOn)||input.endsOn&&(!diningCalendarDate(input.endsOn)||input.endsOn<input.startsOn)||input.label.trim().length<2||input.label.trim().length>100||input.days.length<1||input.days.length>7||new Set(input.days.map(d=>d.weekday)).size!==input.days.length||input.note.length>2000)throw new Error('Review the label, first/last dates and unique weekdays.');
 return{...(plan?{id:plan.id}:{}),expected_revision:plan?.revision??0,service_id:plan?.service_id??service!.id,service_expected_revision:plan?.service_revision??service!.revision,label:input.label.trim(),timezone:plan?.timezone??input.timezone,starts_on:input.startsOn,ends_on:input.endsOn||null,days:input.days.map(day=>diningWeeklyDay(day,plan?.menu_mode??service!.menu_mode)),note:input.note.trim()};
}
export function diningDateCommandValid(command:RecordedCommand,body:Record<string,unknown>){
 const tail=command.path.slice(command.root.length),match=/^\/plans\/([0-9a-f-]{36})\/dates\/(\d{4}-\d{2}-\d{2})\/actions$/i.exec(tail);
 if(command.domain!=='dining'||!match||!uuid(match[1])||!diningCalendarDate(match[2]!)||command.method!=='POST'||!uuid(command.sourceId)||!['session','plan'].includes(command.kind??'')||body.command_id!==command.key||!uuid(body.expected_plan_version_id)||!positive(body.expected_plan_revision)||body.expected_session_revision!==0||!['open','publish_changes','cancel'].includes(String(body.action))||typeof body.note!=='string'||body.note.length>2000||Object.keys(body).some(k=>!['command_id','expected_plan_version_id','expected_plan_revision','expected_session_revision','action','note','menu_text','starts_at','ends_at','space_id'].includes(k)))return false;
 if(command.kind==='plan'&&(body.action!=='cancel'||command.sourceId!==body.expected_plan_version_id))return false;
 return body.action==='publish_changes'?typeof body.menu_text==='string'&&body.menu_text.length<=4000&&typeof body.starts_at==='string'&&Number.isFinite(Date.parse(body.starts_at))&&typeof body.ends_at==='string'&&Date.parse(body.ends_at)>Date.parse(body.starts_at)&&Date.parse(body.ends_at)-Date.parse(body.starts_at)<=86400000&&(body.space_id===null||uuid(body.space_id)):!['menu_text','starts_at','ends_at','space_id'].some(k=>k in body);
}
export function diningDateBody(date:DiningPlanDate,input:{action:'open'|'publish_changes'|'cancel';note:string;now:string;startsAt?:string;endsAt?:string;menu?:string;spaceId?:string|null}){
 if(!date.allowed_actions.includes(input.action)||date.cancelled_for_date||input.action==='open'&&(!date.starts_at||!date.ends_at)||input.action==='cancel'&&input.note.trim().length<3||input.action==='publish_changes'&&input.note.trim().length<3)throw new Error('Review this current dated menu and the reason for this action.');
 if(input.action==='open'&&(!Number.isFinite(Date.parse(input.now))||(Date.parse(input.now)<Date.parse(date.starts_at!)||Date.parse(input.now)>=Date.parse(date.ends_at!))&&input.note.trim().length<3))throw new Error('Give a reason for opening outside published hours.');
 const body={expected_plan_version_id:date.plan_version_id,expected_plan_revision:date.plan_revision,expected_session_revision:0,action:input.action,note:input.note.trim(),...(input.action==='publish_changes'?{menu_text:date.menu_mode==='native'?(input.menu??'').trim():'',starts_at:input.startsAt,ends_at:input.endsAt,space_id:input.spaceId??null}:{})};
 return body;
}
export function diningDateObsolete(command:RecordedCommand,error:unknown){
 const err=error as {status?:unknown;details?:{error?:{code?:unknown;fields?:{dining_obsolete?:Record<string,unknown>}}}},proof=err?.details?.error?.fields?.dining_obsolete;let body:Record<string,unknown>;try{body=JSON.parse(command.body);}catch{return false;}
 if(!diningDateCommandValid(command,body)||err.status!==409||err.details?.error?.code!=='dining_obsolete'||proof?.confirmation!=='permanently_inapplicable'||proof.receipt_state!=='absent'||proof.command_id!==command.key||proof.source_id!==body.expected_plan_version_id||proof.expected_revision!==body.expected_plan_revision||!positive(proof.current_revision))return false;
 return proof.reason==='stream_advanced'&&proof.current_revision>Number(body.expected_plan_revision)||proof.reason==='plan_superseded'&&proof.expected_plan_version_id===body.expected_plan_version_id&&uuid(proof.current_plan_version_id)&&proof.current_plan_version_id!==body.expected_plan_version_id;
}
