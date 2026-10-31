import assert from 'node:assert/strict';
import test from 'node:test';
import type { RepairDetail } from '../../packages/contracts/src/wire/features/facilities/facilitiesApi';
import { facilitiesReport, facilitiesExternalGrant, facilitiesAction, facilitiesExternalEnd } from '../../backend/src/facilities/facilities.contracts';
import { facilitiesPeople, facilitiesReportBody, facilitiesAssignmentBody, facilitiesExternalBody, facilitiesEndBody, facilitiesOrdinaryReceipt, facilitiesContinueJob } from '../src/lib/facilities-operations';
import type { RecordedCommand } from '../src/lib/recorded-command';
const school='11111111-1111-4111-8111-111111111111', repairId='22222222-2222-4222-8222-222222222222', personId='33333333-3333-4333-8333-333333333333', handlerId='44444444-4444-4444-8444-444444444444', key='55555555-5555-4555-8555-555555555555', accessId='66666666-6666-4666-8666-666666666666', photoId='77777777-7777-4777-8777-777777777777';
const root=`/api/v1/schools/${school}/facilities`, now='2026-10-29T10:00:00.000Z';
const options={people:[{id:personId,label:'Technician',revision:4,has_app_access:true}],pagination:{page:1,page_size:25,people_has_more:false}};
const repair={id:repairId,revision:8,handler:{id:handlerId,label:'Handler'},verifier:{id:handlerId,label:'Verifier'},coordinator:{id:handlerId,label:'Coordinator'},allowed_actions:{assign:true,assign_verifier:true,assign_coordinator:true,accept:false},can_invite_external:true,photos:[{id:photoId}],external_access:null} as unknown as RepairDetail;
const command=(path:string,body:unknown,phase:'accepted'|'unknown'='accepted'):RecordedCommand=>({version:1,domain:'facilities',root,scopeKey:'same-actor-campus-world',key,sourceId:repairId,method:'POST',path,confirmationPath:null,body:JSON.stringify({command_id:key,expected_revision:8,...body as object}),phase});
test('assisted reporting preserves reporter versus recorder and only explicit mapped impact',()=>{
 const settings={configured:true,can_manage:true} as Parameters<typeof facilitiesReportBody>[0];
 const input={problem:'  Leaking pipe  ',location:'Room 2',urgent:false,selected:null,reporter:{id:personId,label:'Resident'},impact:null} as const;
 const body=facilitiesReportBody(settings,input); assert.equal(body.reporter_person_id,personId);assert.equal(facilitiesReport.safeParse({...body,command_id:key}).success,true);
 assert.throws(()=>facilitiesReportBody({...settings,can_manage:false},input));assert.throws(()=>facilitiesReportBody(settings,{...input,impact:'not_working'}));
 const mapped=facilitiesReportBody(settings,{...input,selected:{kind:'holdings',id:photoId,label:'Pump',mapStatus:true},impact:'degraded'});assert.equal(mapped.holding_id,photoId);
});
test('restricted orphan reassignment uses actual server action and current app-enabled canonical choice',()=>{
 const limited={...repair,recovery_only:true};
 for(const target of ['handler','verifier','coordinator'] as const){const body=facilitiesAssignmentBody(limited,target,{id:personId,label:'Next'},'Restore missing endpoint',8,options);assert.equal(facilitiesAction.safeParse({...body,command_id:key}).success,true);assert.equal(Object.keys(body).filter(k=>k.endsWith('_person_id')).length,1);}
 assert.throws(()=>facilitiesAssignmentBody(limited,'handler',{id:personId,label:'Next'},'Reason',7,options));assert.throws(()=>facilitiesAssignmentBody(limited,'handler',{id:personId,label:'Next'},'Reason',8,{...options,people:[{...options.people[0],has_app_access:false}]}));
 for(const changed of [{...options,pagination:{...options.pagination,page_size:10}},{...options,people:[...options.people,...options.people]},{...options,people:[{...options.people[0],revision:NaN}]}])assert.throws(()=>facilitiesPeople(changed));
});
test('external grant is exact revision/person/window and explicitly selected current photos',()=>{
 const person={id:personId,label:'Technician',revision:4},input={revision:8,endsAt:'2026-10-30T10:00:00.000Z',instructions:'Inspect shared pipe only',sharedPhotoIds:[photoId]};
 const body=facilitiesExternalBody(repair,person,input,now,options);assert.equal(facilitiesExternalGrant.safeParse({...body,command_id:key}).success,true);
 for(const changed of [{...input,revision:7},{...input,endsAt:now},{...input,endsAt:'2028-10-29T10:00:00.000Z'},{...input,sharedPhotoIds:[photoId,photoId]},{...input,sharedPhotoIds:[accessId]}])assert.throws(()=>facilitiesExternalBody(repair,person,changed,now,options));
 assert.throws(()=>facilitiesExternalBody(repair,{...person,revision:3},input,now,options));assert.throws(()=>facilitiesExternalBody({...repair,recovery_only:true},person,input,now,options));
});
test('end targets original assignment; accepted receipt remains valid after private access transfer',()=>{
 const source={...repair,external_access:{id:accessId,can_manage:true,state:'expired'}} as RepairDetail;
 const body=facilitiesEndBody(source,accessId,8,'Assignment ended');assert.equal(facilitiesExternalEnd.safeParse({...body,command_id:key}).success,true);assert.throws(()=>facilitiesEndBody(source,photoId,8,'Reason'));
 const cmd=command(`${root}/repairs/${repairId}/external-access/${accessId}/end`,body),receipt={state:'accepted',result:{id:repairId,revision:9,action:'external_ended',external_access_id:key,access_transferred:true}};
 assert.equal(facilitiesOrdinaryReceipt(receipt,cmd).transferred,true);assert.throws(()=>facilitiesOrdinaryReceipt({...receipt,result:{...receipt.result,external_access_id:accessId}},cmd));assert.throws(()=>facilitiesOrdinaryReceipt({...receipt,result:{...receipt.result,revision:10}},cmd));
});
test('job responsibility never advances from matching state or an unknown/unrelated activation',()=>{
 const intent={repairId,accessId,revision:8},activate=command(`${root}/repairs/${repairId}/external-access/${accessId}/activate`,{});
 const current={...repair,revision:9,external_view:true,external_access:{id:accessId,can_activate:false},allowed_actions:{...repair.allowed_actions,accept:true}} as RepairDetail;
 assert.deepEqual(facilitiesContinueJob(intent,activate,current),{expected_revision:9,action:'accept',note:''});
 for(const prior of [null,{...activate,phase:'unknown' as const},{...activate,path:activate.path.replace(accessId,photoId)},{...activate,body:JSON.stringify({command_id:accessId,expected_revision:8})}])assert.equal(facilitiesContinueJob(intent,prior,current),null);
 assert.equal(facilitiesContinueJob(intent,activate,{...current,revision:10}),null);assert.equal(facilitiesContinueJob(intent,activate,{...current,allowed_actions:{...current.allowed_actions,accept:false}}),null);
 const receipt={state:'accepted',result:{id:repairId,revision:9,action:'external_ready',external_access_id:accessId}};assert.equal(facilitiesOrdinaryReceipt(receipt,activate).action,'external_ready');
});
