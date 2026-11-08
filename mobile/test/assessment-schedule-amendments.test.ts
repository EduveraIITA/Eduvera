import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssessmentDetail,AssessmentWorkspace } from '../../packages/contracts/src/assessments';
import { assertExamScheduleAccepted,definitiveExamScheduleRefusal,examScheduleActionAllowed,examScheduleAmendmentInput,examScheduleConfirmationInput,
 examScheduleDraftChanged,examSchedulePreviewPayload,examScheduleRefreshPath,mayAmendExamSchedule,readExamSchedulePreview,type ExamSchedulePreview } from '../src/lib/assessment-schedule-amendments';
import { NativePendingActionJournal,validateNativePendingAction,type NativePendingAction,type NativePendingScope } from '../src/lib/native-pending-action';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const school=id(1),actor=id(2),assessment=id(3),sitting=id(4),room=id(5),otherRoom=id(6),staff=id(7),key=id(8),now='2026-11-08T00:00:00.000Z';
const detail={assessment:{id:assessment,revision:2,status:'scheduled',title:'Systems final',duration_minutes:60},viewer_role:'admin',exam_operation:{sitting:{id:sitting,state:'ready',revision:2,starts_at:'2026-11-10T09:00:00.000Z',ends_at:'2026-11-10T10:00:00.000Z',space_id:room},space:{id:room},candidates:[{student_id:id(9),attendance_status:'unrecorded'}],incidents:[],invigilators:[{user_id:staff,status:'accepted'}]}} as unknown as AssessmentDetail;
const workspace={mode:'admin',references:{staff:[{id:staff}],spaces:[{id:room},{id:otherRoom}]}} as unknown as AssessmentWorkspace;
const draft={scheduled:'2026-11-10T11:00:00Z',duration:'90',space:otherRoom,invigilators:[staff],reason:'Original hall closed for repair.'};
const scope:NativePendingScope={actorId:actor,schoolId:school,mode:'live',namespaceId:null,origin:'https://app2.thatcampus.com'};
const preview={can_publish:true,preview_hash:'a'.repeat(64)} as ExamSchedulePreview;
const path=`/api/v1/schools/${school}/assessments/${assessment}/`,owner=`/areas/assessments/manage?assessment=${assessment}&edit=schedule-amendment`;
const input=()=>examScheduleAmendmentInput(detail,school,examSchedulePreviewPayload(detail,workspace,draft,now),preview);
function action():NativePendingAction {const value=input();return {version:1,domain:'assessments',scope,clientId:key,ownerHref:owner,endpoint:value.endpoint,refreshPath:path,
 method:'POST',payload:{kind:'json',body:JSON.stringify({...value.body,command_id:key})},source:value.source,phase:'unknown',replayPolicy:'same_request',createdAt:now};}
const receipt=()=>({command_id:key,assessment:{id:assessment,school_id:school,status:'scheduled',revision:3,duration_minutes:90},
 sitting:{id:sitting,school_id:school,assessment_id:assessment,revision:3,state:'planning',space_id:otherRoom,starts_at:draft.scheduled},schedule_state:'awaiting_confirmation'});
const saved=()=>({...detail,assessment:{...detail.assessment,revision:3},exam_operation:{...detail.exam_operation!,sitting:{...detail.exam_operation!.sitting,revision:3,state:'planning'},schedule_state:'awaiting_confirmation',schedule_history:[{command_key:key}]}} as unknown as AssessmentDetail);
test('scheduled revision review binds exact future sitting, roster evidence, room and current administrator',()=>{
 assert.equal(mayAmendExamSchedule(detail,now),true);assert.equal(examSchedulePreviewPayload(detail,workspace,draft,now).expected_sitting_revision,2);
 for(const patch of [{scheduled:now},{duration:'0'},{duration:'1441'},{space:id(99)},{invigilators:[staff,staff]},{reason:'x'}])assert.throws(()=>examSchedulePreviewPayload(detail,workspace,{...draft,...patch},now));
 for(const changed of [{...detail,viewer_role:'examiner'},{...detail,assessment:{...detail.assessment,status:'marking'}},{...detail,exam_operation:{...detail.exam_operation!,sitting:{...detail.exam_operation!.sitting,state:'in_progress'}}},{...detail,exam_operation:{...detail.exam_operation!,candidates:[{student_id:id(9),attendance_status:'present'}]}}] as AssessmentDetail[])assert.equal(mayAmendExamSchedule(changed,now),false);
});
test('new scheduled amendment is exactly replayable while legacy authoring remains separate',()=>{
 const value=action();assert.equal(examScheduleActionAllowed(value,scope),true);assert.equal(validateNativePendingAction(value,scope,'assessments'),true);
 for(const patch of [{scope:{...scope,schoolId:id(99)}},{endpoint:path+'sitting/arrangements/'},{replayPolicy:'inspect_only' as const},{clientId:id(99)},{source:{...value.source!,fingerprint:undefined}}])assert.equal(validateNativePendingAction({...value,...patch},scope,'assessments'),false);
 assert.throws(()=>examScheduleAmendmentInput(detail,school,examSchedulePreviewPayload(detail,workspace,draft,now),{...preview,can_publish:false}));
});
test('impact review rejects a mismatched old sitting, new time, frozen cohort or affected duty',()=>{
 const payload=examSchedulePreviewPayload(detail,workspace,draft,now),value={...preview,
  previous:{scheduled_at:detail.exam_operation!.sitting.starts_at,ends_at:detail.exam_operation!.sitting.ends_at,space_id:room,invigilator_user_ids:[staff]},
  proposed:{scheduled_at:payload.scheduled_at,ends_at:'2026-11-10T12:30:00.000Z',space_id:otherRoom,space_name:'Systems hall',duration_minutes:90,invigilator_user_ids:[staff]},
  candidate_count:1,reissued_invigilator_user_ids:[staff],removed_invigilator_user_ids:[],blockers:[],reason:draft.reason,confirmation_message:'Changed duties need confirmation.'};
 assert.equal(readExamSchedulePreview(value,detail,payload),value);
 for(const changed of [{...value,previous:{...value.previous,space_id:otherRoom}},{...value,proposed:{...value.proposed,ends_at:'2026-11-10T14:00:00Z'}},
  {...value,candidate_count:2},{...value,reissued_invigilator_user_ids:[id(99)]},{...value,removed_invigilator_user_ids:[staff]},
  {...value,blockers:[{code:'room',message:'Room unavailable'}]}])assert.throws(()=>readExamSchedulePreview(changed,detail,payload));
});
test('changing only invigilators still protects unsent arrangements on leaving the editor',()=>{
 const unchanged={scheduled:detail.exam_operation!.sitting.starts_at,duration:'60',space:room,invigilators:[staff],reason:''};
 assert.equal(examScheduleDraftChanged(detail,unchanged),false);
 assert.equal(examScheduleDraftChanged(detail,{...unchanged,invigilators:[staff,id(99)]}),true);
});
test('accepted schedule receipt and later read require exact source, command identity and immutable history',()=>{
 const value=action();assert.equal(examScheduleRefreshPath(receipt(),value),path);assert.doesNotThrow(()=>assertExamScheduleAccepted(saved(),value));
 for(const changed of [{...receipt(),command_id:id(99)},{...receipt(),sitting:{...receipt().sitting,state:'ready'}},{...receipt(),sitting:{...receipt().sitting,space_id:room}},{...receipt(),assessment:{...receipt().assessment,revision:4}}])assert.throws(()=>examScheduleRefreshPath(changed,value));
 assert.throws(()=>assertExamScheduleAccepted({...saved(),exam_operation:{...saved().exam_operation!,schedule_history:[]}},value));
});
test('only an exact source-owned durable refusal releases a retained unknown command',()=>{
 const value=action(),error={status:409,details:{error:{code:'exam_schedule_command_refused',fields:{command_id:key,school_id:school,actor_user_id:actor,assessment_id:assessment,sitting_id:sitting,action:'amend',expected_assessment_revision:2,expected_sitting_revision:2}}}};
 assert.equal(definitiveExamScheduleRefusal(error,value),true);assert.equal(definitiveExamScheduleRefusal({status:409},value),false);
 assert.equal(definitiveExamScheduleRefusal({...error,details:{error:{...error.details.error,fields:{...error.details.error.fields,command_id:id(99)}}}},value),false);
});
test('lost schedule response reuses original command after relaunch and clears only on exact accepted history',async()=>{
 let raw:string|null=null,sends=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},context={ownerHref:owner,refreshPath:path,assertActive(){},resolveRefreshPath:examScheduleRefreshPath,accepted:(value:unknown,_assert:()=>void,action:NativePendingAction)=>assertExamScheduleAccepted(value as AssessmentDetail,action)};
 const first=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>key,send:async()=>{sends++;throw new Error('Response lost after server commit');},read:async()=>saved()});
 await first.hydrate();assert.equal(await first.run(input(),context),false);assert.equal(JSON.parse(raw!).phase,'unknown');
 const resumed=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>{throw new Error('Must not replace intent');},send:async original=>{assert.equal(original.clientId,key);sends++;return receipt();},read:async()=>saved()});
 await resumed.hydrate();assert.equal(await resumed.recover(context),true);assert.equal(raw,null);assert.equal(sends,2);
});
test('confirmation is a separate exact command and requires current readiness rather than an old acceptance',()=>{
 const pending={...saved(),exam_operation:{...saved().exam_operation!,readiness:{can_schedule:false}}} as AssessmentDetail;
 assert.throws(()=>examScheduleConfirmationInput(pending,school));
 const ready={...pending,exam_operation:{...pending.exam_operation!,readiness:{can_schedule:true}}} as AssessmentDetail;
 const value=examScheduleConfirmationInput(ready,school);assert.equal(value.endpoint,path+'sitting/schedule-amendments/confirm/');assert.equal(value.serverKey,'command_id');
});
test('a durable source refusal clears an unknown journal after relaunch despite the first screen having no obsolete callback',async()=>{
 let raw:string|null=null;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},context={ownerHref:owner,refreshPath:path,assertActive(){},resolveRefreshPath:examScheduleRefreshPath};
 const first=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>key,send:async()=>{throw new Error('Interrupted reply');},read:async()=>saved()});
 await first.hydrate();await first.run(input(),context);
 const error=Object.assign(new Error('This exact original command was refused.'),{status:409,details:{error:{code:'exam_schedule_command_refused',fields:{command_id:key,school_id:school,actor_user_id:actor,assessment_id:assessment,sitting_id:sitting,action:'amend',expected_assessment_revision:2,expected_sitting_revision:2}}}});
 const resumed=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>key,send:async()=>{throw error;},read:async()=>saved()});
 await resumed.hydrate();assert.equal(await resumed.recover(context),false);assert.equal(raw,null);assert.equal(resumed.snapshot().action,null);assert.equal(resumed.snapshot().obsolete,true);
});
test('foreign command, actor or source refusal never clears an unknown schedule journal',async()=>{
 for(const patch of [{command_id:id(99)},{actor_user_id:id(99)},{sitting_id:id(99)}]){
  let raw:string|null=JSON.stringify(action());const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}};
  const error=Object.assign(new Error('Foreign refusal'),{status:409,details:{error:{code:'exam_schedule_command_refused',fields:{command_id:key,school_id:school,actor_user_id:actor,assessment_id:assessment,sitting_id:sitting,action:'amend',expected_assessment_revision:2,expected_sitting_revision:2,...patch}}}});
  const journal=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>key,send:async()=>{throw error;},read:async()=>saved()});
  await journal.hydrate();assert.equal(await journal.recover({ownerHref:owner,assertActive(){},resolveRefreshPath:examScheduleRefreshPath}),false);assert.equal(journal.snapshot().action?.phase,'unknown');assert.notEqual(raw,null);
 }
});
