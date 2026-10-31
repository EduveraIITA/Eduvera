import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/api-client';
import { describeGateCommand, nativeGateAcceptedResult, nativeGateConfirmationDisposition, nativeGateFailureDisposition, validateNativeGateCommand } from '../src/lib/gate-command';
import { assertVisitSharingSource, readVisitSharing, visitShareAction, visitShareCommand } from '../src/lib/visit-sharing';
import type { ArrangedVisit, VisitOptions } from '../../packages/contracts/src/wire/features/gate/visitApi';
import type { VisitSharing } from '../../packages/contracts/src/wire/features/gate/visitSharingApi';
const visitId='7098597b-84b0-4665-a91e-17375936fe68',personId='300739ff-2580-4d91-b69e-31b25e4883d3',key='a72526eb-1428-45ec-86c2-7baf0bfdb024',shareId='07e0c620-48e5-4bb6-aaae-d2c4b09b1a33',rootId='fa0fb0c0-317d-414d-8d61-059d655b053e';
const root='/api/v1/gate/schools/school-a/visit-arrangements',person={id:personId,label:'Organiser',revision:2,has_app_access:false},visit={id:visitId,revision:4} as ArrangedVisit,options={people:[person]} as VisitOptions;
const source:VisitSharing={visit_revision:4,share_revision:3,can_share:true,can_open_shared:true,current:{id:shareId,root_id:rootId,revision:3,organiser:person,starts_at:'2026-10-29T00:00:00Z',ends_at:'2026-10-29T18:00:00Z',directions:'North gate',state:'active',owner:{id:visitId,label:'Campus owner',available:true},can_renew:true,can_revoke:true,can_takeover:false,invitation:null}};
const build=(current=source)=>visitShareCommand(root,visit,current,person,options,'2026-10-29T19:00:00Z','North gate',key,'2026-10-29T10:00:00Z');
test('renewal keeps exact organiser thread while changed party begins a separate private root',()=>{
 const renewal=build();assert.equal(renewal.shareMutation?.action,'renewed');assert.equal(renewal.shareMutation?.shareRootId,rootId);assert.equal(JSON.parse(renewal.body).expected_visit_revision,4);
 const changed=build({...source,current:{...source.current!,state:'party_changed'}});assert.equal(changed.shareMutation?.action,'shared');assert.equal(changed.shareMutation?.shareRootId,key);
 const fresh=build({...source,current:null,share_revision:0,can_open_shared:false});assert.equal(fresh.shareMutation?.previousShareId,null);assert.equal(fresh.shareMutation?.shareRootId,key);
 assert.throws(()=>visitShareCommand(root,visit,source,{...person,revision:1},options,'2026-10-29T19:00:00Z','',key,'2026-10-29T10:00:00Z'),/current campus identity/);
 assert.throws(()=>visitShareCommand(root,visit,source,person,options,'2026-10-29T09:00:00Z','',key,'2026-10-29T10:00:00Z'),/future end/);
});
test('sharing binds current visit, source revision and exact sharing stream before another explicit decision',()=>{
 assert.doesNotThrow(()=>assertVisitSharingSource(source,source,visit));
 for(const current of [{...source,visit_revision:5},{...source,share_revision:4},{...source,can_share:false},{...source,current:{...source.current!,id:key}},{...source,current:{...source.current!,root_id:key}}])assert.throws(()=>assertVisitSharingSource(source,current,visit),/changed/);
 assert.throws(()=>visitShareAction(root,visitId,source,'takeover',key),/no longer available/);
 const takeover=visitShareAction(root,visitId,{...source,current:{...source.current!,can_takeover:true,owner:{...source.current!.owner,available:false}}},'takeover',key);assert.equal(takeover.shareMutation?.action,'taken_over');assert.equal(takeover.shareMutation?.shareRootId,rootId);
});
test('sharing journal requires correlated share ID/root/action/revision and retains uncertain HTTP refusals',()=>{
 const input=build(),command=describeGateCommand(input,'exact-actor:school:world','school-a',key)!;assert.ok(command);assert.equal(command.kind,'visit-sharing');assert.equal(command.confirmationPath,`${root}/${visitId}/shared/commands/${key}/`);assert.equal(command.reviewPath,`${root}/${visitId}/sharing/`);assert.equal(validateNativeGateCommand(command,'exact-actor:school:world','school-a'),true);
 const receipt={visit_id:visitId,share_id:key,share_root_id:rootId,action:'renewed',revision:4};assert.equal(nativeGateAcceptedResult(command,receipt,true),true);
 for(const change of [{visit_id:key},{share_id:shareId},{share_root_id:key},{action:'shared'},{revision:5}])assert.equal(nativeGateAcceptedResult(command,{...receipt,...change},true),false);
 assert.equal(nativeGateAcceptedResult(command,{current:{id:key,root_id:rootId,revision:4},share_revision:4}),true);assert.equal(nativeGateAcceptedResult(command,{current:{id:key,root_id:rootId,revision:5},share_revision:5}),false);
 assert.equal(nativeGateConfirmationDisposition(command,{state:'accepted',result:receipt}),'accepted');assert.equal(nativeGateConfirmationDisposition(command,{state:'not_found'}),'retry-identical');
 for(const status of [400,401,403,404,409,422,500])assert.equal(nativeGateFailureDisposition(command,new ApiError('lost access',status),true),'unknown');
 assert.equal(describeGateCommand({...input,shareMutation:{...input.shareMutation!,action:'shared'}},'exact-actor:school:world','school-a',key),null);
 const revoke=visitShareAction(root,visitId,source,'revoke',key);assert.ok(describeGateCommand(revoke,'exact','school-a',key));assert.equal(describeGateCommand({...revoke,path:`${root}/${visitId}/shares/${key}/revoke/`},'exact','school-a',key),null);
});
test('malformed sharing metadata fails closed before private controls render',()=>{
 assert.equal(readVisitSharing(source),source);for(const change of [{visit_revision:NaN},{share_revision:2},{can_share:1},{current:{...source.current!,organiser:{...person,revision:Infinity}}},{current:{...source.current!,ends_at:'bad'}},{current:{...source.current!,owner:{label:'name'}}},{current:null}])assert.throws(()=>readVisitSharing({...source,...change}));
 assert.doesNotThrow(()=>readVisitSharing({...source,current:null,share_revision:0,can_open_shared:false}));
});
