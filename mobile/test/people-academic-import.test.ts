import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportDetail, ImportValues } from '../../packages/contracts/src/wire/features/people/import-api';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingInput, type NativePendingScope } from '../src/lib/native-pending-action';
import { nativePeopleAcademicImportAllowed, peopleAcademicImportAccepted, peopleAcademicImportCancel, peopleAcademicImportColumns, peopleAcademicImportCommit, peopleAcademicImportPath, peopleAcademicImportRefreshPath, peopleAcademicImportRow, peopleAcademicImportUpload, validPeopleAcademicImport } from '../src/lib/people-academic-import';

const school='10000000-0000-4000-8000-000000000001',term='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000003',student='10000000-0000-4000-8000-000000000004',key='10000000-0000-4000-8000-000000000005',actor='10000000-0000-4000-8000-000000000006';
const scope:NativePendingScope={schoolId:school,actorId:actor,mode:'live',namespaceId:null,origin:'https://campus.example'};
const values={...Object.fromEntries(peopleAcademicImportColumns.map(key=>[key,''])),admission_number:'TC-17',first_name:'Mira',last_name:'Shah',class:'7A',roll_number:'3',enrolled_on:'2026-10-29',relationship:'guardian'} as ImportValues;
const job:ImportDetail={id,filename:'intake.csv',state:'draft',revision:3,row_count:1,created_at:'2026-10-29T04:00:00Z',expires_at:'2026-10-30T04:00:00Z',receipt:null,review:{term:{id:term,name:'Term 1',today:'2026-10-29',starts_on:'2026-04-01',ends_on:'2027-03-31'},classes:[{id:student,label:'7A',room:'204'}],validation_token:'a'.repeat(64),rows:[{row_number:2,values,decision:'include',guardian_choice:{mode:'none'},errors:[],warnings:[],guardian_name:'',class_name:'7A'}],summary:{total:1,included:1,skipped:0,errors:0,warnings:0,new_guardians:0,existing_guardians:0,registers_reopened:2}}};
const receipt={import_id:id,students:1,guardians_created:0,guardians_reused:0,skipped:0,registers_reopened:2,enrolled:[{row_number:2,student_id:student,admission_number:'TC-17'}]};
const committed={...job,state:'committed' as const,revision:4,review:null,receipt};
function action(input:NativePendingInput,read=peopleAcademicImportPath(school,id)):NativePendingAction{return {version:1,domain:'people',scope,clientId:key,ownerHref:`/areas/people/import?school=${school}&import=${id}`,endpoint:input.endpoint,refreshPath:read,method:input.method??'POST',payload:{kind:'json',body:JSON.stringify({...input.body,...(input.serverKey==='idempotency_key'?{idempotency_key:key}:{})})},source:input.source,replayPolicy:input.replayPolicy??(input.serverKey?'same_request':'inspect_only'),phase:'prepared',createdAt:'2026-10-29T04:00:00Z'};}

test('real shared stage gate accepts UTF-8 CSV over generic body limit but never over 512 KiB',()=>{
 const csv='x'.repeat(150000),record=action(peopleAcademicImportUpload(school,term,'intake.csv',csv),peopleAcademicImportPath(school));
 assert.equal(validateNativePendingAction(record,scope,'people'),true);
 assert.equal(validateNativePendingAction(action(peopleAcademicImportUpload(school,term,'intake.csv','é'.repeat(262144)),peopleAcademicImportPath(school)),scope,'people'),true);
 assert.throws(()=>peopleAcademicImportUpload(school,term,'intake.csv','é'.repeat(262145)));
 for(const filename of ['../intake.csv','bad\n.csv','', 'x'.repeat(151)])assert.throws(()=>peopleAcademicImportUpload(school,term,filename,csv));
 assert.throws(()=>peopleAcademicImportUpload(school,term,'intake.csv','x\0y'));
});
test('shared import gate rejects wrong scope, endpoints, sources and refresh queries',()=>{
 const record=action(peopleAcademicImportCommit(school,job));assert.equal(validateNativePendingAction(record,scope,'people'),true);
 for(const changed of [{...record,endpoint:record.endpoint+'/anything'},{...record,method:'PATCH' as const},{...record,source:{...record.source!,sourceId:student}},{...record,source:{...record.source!,revision:2}},{...record,refreshPath:peopleAcademicImportPath(actor,id)},{...record,refreshPath:record.refreshPath+'&school_id='+school},{...record,refreshPath:record.refreshPath+'&unrelated=1'},{...record,refreshPath:peopleAcademicImportPath(school,student)},{...record,payload:{kind:'json' as const,body:JSON.stringify({...JSON.parse(record.payload.kind==='json'?record.payload.body:''),expected_revision:4})}}])assert.equal(validateNativePendingAction(changed,scope,'people'),false);
 for(const patch of [{actorId:student},{schoolId:student},{origin:'https://other.example'},{mode:'simulation' as const,namespaceId:'run:other'}])assert.equal(validateNativePendingAction(record,{...scope,...patch},'people'),false);
 assert.equal(nativePeopleAcademicImportAllowed({...record,domain:'learning'},scope),false);
});
test('commit binds exact reviewed rows and token; malformed receipts cannot resolve',()=>{
 const record=action(peopleAcademicImportCommit(school,job));assert.equal(peopleAcademicImportRefreshPath(receipt,record),peopleAcademicImportPath(school,id));
 for(const bad of [{...receipt,import_id:student},{...receipt,students:2},{...receipt,guardians_created:1},{...receipt,guardians_reused:1},{...receipt,skipped:1},{...receipt,registers_reopened:1},{...receipt,enrolled:[{...receipt.enrolled[0],row_number:3}]},{...receipt,enrolled:[{...receipt.enrolled[0],admission_number:'OTHER'}]},{...receipt,enrolled:[{...receipt.enrolled[0],student_id:'invalid'}]}])assert.throws(()=>peopleAcademicImportRefreshPath(bad,record));
 const accepted={...record,phase:'accepted' as const};assert.equal(peopleAcademicImportAccepted(committed,accepted).state,'committed');
 for(const bad of [{...committed,id:student},{...committed,revision:5},{...committed,state:'draft'},{...committed,receipt:{...receipt,students:0}}])assert.throws(()=>peopleAcademicImportAccepted(bad,accepted));
 assert.throws(()=>peopleAcademicImportCommit(school,{...job,review:{...job.review!,summary:{...job.review!.summary,errors:1}}}));
 assert.throws(()=>peopleAcademicImportCommit(school,{...job,review:{...job.review!,validation_token:'invalid'}}));
});
test('canonical guardian profile attachment uses the receipt-bound preview range without inventing counts',()=>{
 const source={...job,review:{...job.review!,rows:[{...job.review!.rows[0]!,values:{...values,person_id:actor,person_revision:'2'},guardian_choice:{mode:'person' as const,person_id:term,expected_revision:2}}]}},record=action(peopleAcademicImportCommit(school,source));
 assert.equal(validateNativePendingAction(record,scope,'people'),true);
 assert.doesNotThrow(()=>peopleAcademicImportRefreshPath({...receipt,guardians_created:1},record));
 assert.doesNotThrow(()=>peopleAcademicImportRefreshPath({...receipt,guardians_reused:1},record));
 assert.throws(()=>peopleAcademicImportRefreshPath({...receipt,guardians_created:1,guardians_reused:1},record));
 assert.throws(()=>peopleAcademicImportRefreshPath({...receipt,guardians_created:-1},record));
});
test('row correction keeps original revision, trims raw cells and removes overriding CSV guardian references',()=>{
 const changed={...values,guardian_person_id:actor,guardian_person_revision:'5',first_name:' Mira '},input=peopleAcademicImportRow(school,job,job.review!.rows[0]!,changed,'include',{mode:'none'}),record=action(input),body=input.body as {values:ImportValues};
 assert.equal(body.values.first_name,'Mira');assert.equal(body.values.guardian_person_id,undefined);assert.equal(body.values.guardian_person_revision,undefined);assert.equal(validateNativePendingAction(record,scope,'people'),true);
 assert.equal(validateNativePendingAction({...record,replayPolicy:'same_request'},scope,'people'),false);
 assert.equal(validateNativePendingAction({...record,endpoint:record.endpoint.replace('/2','/1'),source:{...record.source!,fingerprint:'1'}},scope,'people'),false);
 assert.throws(()=>peopleAcademicImportRefreshPath({revision:5},record));
 const accepted={...record,phase:'accepted' as const},saved={...job,revision:4,review:{...job.review!,rows:[{...job.review!.rows[0]!,values:body.values}]}};
 assert.equal(peopleAcademicImportAccepted(saved,accepted).revision,4);
 assert.throws(()=>peopleAcademicImportAccepted({...saved,review:{...saved.review,rows:[{...saved.review.rows[0]!,decision:'skip'}]}},accepted));
});
test('unknown receipt-backed import replays the identical revision/token after relaunch',async()=>{
 let raw:string|null=null,sends=0;const bodies:string[]=[],input=peopleAcademicImportCommit(school,job),storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}};
 const first=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>key,send:async record=>{sends++;bodies.push(JSON.stringify(record));throw new Error('Response lost');},read:async()=>committed});await first.hydrate();assert.equal(await first.run(input,{ownerHref:'/areas/people/import?import='+id,refreshPath:peopleAcademicImportPath(school,id),assertActive(){},resolveRefreshPath:peopleAcademicImportRefreshPath}),false);
 assert.equal(JSON.parse(raw!).phase,'unknown');
 const resumed=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>actor,send:async record=>{sends++;bodies.push(JSON.stringify(record));return receipt;},read:async()=>committed});await resumed.hydrate();assert.equal(await resumed.recover({ownerHref:'/areas/people/import?import='+id,assertActive(){},resolveRefreshPath:peopleAcademicImportRefreshPath,accepted:(value,_assert,record)=>{peopleAcademicImportAccepted(value,record);}}),true);
 assert.equal(JSON.parse(bodies[0]!).clientId,JSON.parse(bodies[1]!).clientId);assert.equal(JSON.parse(bodies[0]!).payload.body,JSON.parse(bodies[1]!).payload.body);assert.equal(sends,2);assert.equal(raw,null);
});
test('known accepted upload retains its returned ID and recovers by read only',async()=>{
 let raw:string|null=null,sends=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},input=peopleAcademicImportUpload(school,term,'intake.csv','header\nrow');
 const first=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>key,send:async()=>{sends++;return {id};},read:async()=>{throw new Error('Follow-up failed');}});await first.hydrate();await first.run(input,{ownerHref:'/areas/people/import?create=import',refreshPath:peopleAcademicImportPath(school),assertActive(){},resolveRefreshPath:peopleAcademicImportRefreshPath});
 assert.equal(JSON.parse(raw!).phase,'accepted');assert.equal(JSON.parse(raw!).refreshPath,peopleAcademicImportPath(school,id));
 const resumed=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>actor,send:async()=>{sends++;throw new Error('Must not resend');},read:async()=>job});await resumed.hydrate();assert.equal(await resumed.recover({ownerHref:'/areas/people/import?create=import',assertActive(){},resolveRefreshPath:peopleAcademicImportRefreshPath,accepted:(value,_assert,record)=>{peopleAcademicImportAccepted(value,record);}}),true);assert.equal(sends,1);assert.equal(raw,null);
});
test('legacy row uncertainty never replays or infers success from current matching values',async()=>{
 let raw:string|null=null,sends=0,reads=0,accepted=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},input=peopleAcademicImportRow(school,job,job.review!.rows[0]!,values,'include',{mode:'none'});
 const first=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>key,send:async()=>{sends++;throw new Error('Lost response');},read:async()=>{reads++;return {...job,revision:4};}});await first.hydrate();await first.run(input,{ownerHref:'/areas/people/import?import='+id,refreshPath:peopleAcademicImportPath(school,id),assertActive(){}});
 const resumed=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>actor,send:async()=>{sends++;},read:async()=>{reads++;return {...job,revision:4};}});await resumed.hydrate();assert.equal(await resumed.recover({ownerHref:'/areas/people/import?import='+id,assertActive(){},accepted:()=>{accepted++;}}),false);assert.equal(sends,1);assert.equal(reads,1);assert.equal(accepted,0);assert.equal(JSON.parse(raw!).phase,'unknown');
});
test('discard validates exact source and outcome; malformed draft views are refused',()=>{
 const record=action(peopleAcademicImportCancel(school,job));assert.equal(validateNativePendingAction(record,scope,'people'),true);assert.equal(peopleAcademicImportRefreshPath({state:'cancelled'},record),peopleAcademicImportPath(school,id));assert.throws(()=>peopleAcademicImportRefreshPath({state:'committed'},record));
 assert.equal(peopleAcademicImportAccepted({...job,state:'cancelled',review:null,revision:4},{...record,phase:'accepted'}).state,'cancelled');
 assert.equal(validPeopleAcademicImport(job,id),true);for(const bad of [{...job,review:null},{...job,row_count:501},{...job,review:{...job.review,rows:null}},{...job,review:{...job.review,summary:{...job.review!.summary,total:2}}}])assert.equal(validPeopleAcademicImport(bad,id),false);
});
