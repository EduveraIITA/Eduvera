import type { AdminDeparture, DepartureMode } from '../../../packages/contracts/src/wire/features/departure/api';
import type { NativePendingAction } from './native-pending-action';
import { diningCalendarDate } from './dining-operations';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function departureAuthorityBody(data:AdminDeparture,input:{student:string;kind:'guardian'|'other';guardian:string;first:string;last:string;phone:string;from:string;until:string;note:string;verified:boolean}){
 if(!input.verified||!data.students.some(p=>p.id===input.student)||!diningCalendarDate(input.from)||input.until&&(!diningCalendarDate(input.until)||input.until<input.from)||input.note.trim().length<3||input.note.trim().length>500)throw new Error('Verify the exact learner, receiver, dates and evidence before granting purpose-specific collection authority.');
 if(input.kind==='guardian'?!data.guardian_links.some(g=>g.id===input.guardian&&g.student_id===input.student):!input.first.trim()||input.first.trim().length>150||input.last.trim().length>150||input.phone.trim().length<6||input.phone.trim().length>32)throw new Error('Choose the learner’s linked guardian or enter the verified collector’s name and phone.');
 return{student_id:input.student,guardian_relationship_id:input.kind==='guardian'?input.guardian:null,collector:input.kind==='other'?{first_name:input.first.trim(),last_name:input.last.trim(),phone:input.phone.trim()}:null,valid_from:input.from,valid_until:input.until||null,verification_method:'in_person',verification_note:input.note.trim()};
}
export function departurePickupPlanBody(data:AdminDeparture,input:{student:string;date:string;mode:string;authority:string;external:string;reason:string},today:string){
 if(!data.students.some(p=>p.id===input.student)||!diningCalendarDate(input.date)||!diningCalendarDate(today)||input.date<today||input.mode==='school_transport'||!data.policy.enabled||!data.policy.enabled_modes.includes(input.mode as DepartureMode)||input.reason.trim().length<3||input.reason.trim().length>500)throw new Error('Review the current learner, future or current date, enabled pickup arrangement and reason.');
 const adult=['guardian_pickup','authorized_collector'].includes(input.mode),authority=data.authorities.find(a=>a.id===input.authority&&a.student_id===input.student&&a.valid_from<=input.date&&(!a.valid_until||a.valid_until>=input.date));
 if(adult&&!authority||input.mode==='external_transport'&&(input.external.trim().length<3||input.external.trim().length>300))throw new Error('Select a receiver authorised for this learner and service date, or describe the external arrangement.');
 return{student_id:input.student,service_date:input.date,mode:input.mode,authority_id:adult?authority!.id:null,external_arrangement:input.mode==='external_transport'?input.external.trim():'',reason:input.reason.trim()};
}
export function departureAssistedBody(data:AdminDeparture,input:Parameters<typeof departurePickupPlanBody>[1]&{requester:string;channel:string},today:string){
 const body=departurePickupPlanBody(data,input,today);if(!data.guardian_links.some(g=>g.student_id===input.student&&g.person_id===input.requester)||!['phone','in_person','paper'].includes(input.channel))throw new Error('Choose the actual linked guardian who requested this change and how the campus received it.');
 return{...body,requester_person_id:input.requester,channel:input.channel};
}
export function departureHandoverBody(plan:AdminDeparture['plans'][number],outcome:string,note:string,now:string,today:string){
 if(plan.state!=='ready'||plan.mode==='school_transport'||plan.service_date!==today||!Number.isFinite(Date.parse(now))||!['refused','no_show','escalated',plan.mode==='independent_departure'?'departed_independently':'handed_over'].includes(outcome)||note.trim().length<3||note.trim().length>500)throw new Error('Review this exact ready plan for today and record only the outcome personally verified.');
 return{expected_revision:plan.revision,outcome,evidence_method:'in_person_verification',note:note.trim(),occurred_at:now};
}
export function departurePickupResultPath(value:unknown,action:NativePendingAction){
 const result=value as Record<string,unknown>|null;if(!result||!uuid(result.id)||result.school_id!==action.scope.schoolId||action.payload.kind!=='json')throw new Error('The exact pickup result could not be confirmed.');
 const body=JSON.parse(action.payload.body) as Record<string,unknown>,kind=action.source?.kind;
 if(kind==='pickup_authority_create'&&(result.student_id!==body.student_id||result.guardian_relationship_id!==body.guardian_relationship_id||String(result.valid_from).slice(0,10)!==body.valid_from)||kind==='pickup_authority_revoke'&&(result.id!==action.source!.sourceId||result.status!=='revoked'||result.revision!==Number(body.expected_revision)+1)||kind==='pickup_plan'&&(result.student_id!==body.student_id||String(result.service_date).slice(0,10)!==body.service_date||result.mode!==body.mode||result.authority_id!==body.authority_id)||kind==='pickup_assisted'&&(result.student_id!==body.student_id||result.requester_person_id!==body.requester_person_id||result.channel!==body.channel||result.requested_mode!==body.mode||String(result.service_date).slice(0,10)!==body.service_date)||kind==='pickup_handover'&&(result.plan_id!==action.source!.sourceId||result.outcome!==body.outcome||result.note!==body.note))throw new Error('The pickup response did not confirm this exact learner, receiver and reviewed action.');
 return action.refreshPath;
}
