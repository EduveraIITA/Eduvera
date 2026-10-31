import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';
import { studentIntakeAcceptedPerson, studentIntakeEnrollmentMatches, studentIntakeInput, studentIntakeRefreshPath, validRetainedStudentIntake, validStudentIntakeReview, type RetainedStudentIntake, type StudentIntakeReview } from '../src/lib/people-academic-enrollment';

const school='20000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000002',person='20000000-0000-4000-8000-000000000003',student='20000000-0000-4000-8000-000000000004',id='20000000-0000-4000-8000-000000000005',key='20000000-0000-4000-8000-000000000006';
const option={class_section_id:person,term_id:student,class_name:'Class 7A',term_name:'Term 1',starts_on:'2026-04-01',ends_on:'2027-03-31',today:'2026-10-29',next_roll:7};
const fields={schoolId:school,first:' Mira ',last:' Shah ',admission:' tc-17 ',birth:'',date:'2026-10-29',roll:'7',option,guardian:null,relationship:'guardian' as const,leave:false};
const input=studentIntakeInput(fields),review:StudentIntakeReview={id,expires_at:'2026-10-29T08:00:00Z',input,class_name:option.class_name,term_name:option.term_name,guardian:null,warnings:[]},retained:RetainedStudentIntake={version:1,scopeKey:'[actor,campus,world,origin]',fingerprint:'a'.repeat(64),review};
const scope:NativePendingScope={actorId:actor,schoolId:school,mode:'live',namespaceId:null,origin:'https://campus.example'},owner='/areas/people/records?create=student',root=`/api/v1/schools/${school}/people/participants`;
const record:NativePendingAction={version:1,domain:'people',scope,clientId:key,ownerHref:owner,endpoint:`/api/v1/people/enrollment-reviews/${id}/commit`,refreshPath:root+'?page=1',method:'POST',payload:{kind:'json',body:'{}'},source:{kind:'enrollment_review',sourceId:id,revision:0,fingerprint:retained.fingerprint},replayPolicy:'same_request',phase:'prepared',createdAt:'2026-10-29T06:00:00Z'};
const result={student_id:student,person_id:person},profile={id:person,revision:1,first_name:'Mira',last_name:'Shah',source_profiles:[{kind:'learning',id:student}]};

test('new learner intake preserves explicit guardian and signing choices without an account',()=>{
 assert.equal(input.first_name,'Mira');assert.equal(input.admission_number,'TC-17');assert.equal(input.date_of_birth,null);assert.equal('person' in input,false);assert.equal('email' in input,false);
 const body=studentIntakeInput({...fields,guardian:{mode:'new',first_name:' Riya ',last_name:' Shah ',phone:'+91 9876543210',email:'riya@example.com'},leave:true});assert.equal(body.guardian?.mode,'new');assert.equal(body.can_authorize_leave,true);
 for(const patch of [{first:''},{birth:'2026-02-30'},{birth:'2026-10-29'},{date:'2026-03-31'},{roll:'0'},{roll:'32768'},{leave:true},{guardian:{mode:'existing' as const,id:'missing'}},{guardian:{mode:'new' as const,first_name:'Riya',last_name:'',phone:'short',email:''}}])assert.throws(()=>studentIntakeInput({...fields,...patch}));
});
test('server preview must match every submitted identity, placement and authority field',()=>{
 assert.equal(validStudentIntakeReview(review,school,input),true);
 for(const changed of [{...review,input:{...input,school_id:actor}},{...review,input:{...input,person:{id:person,expected_revision:1}}},{...review,input:{...input,can_authorize_leave:true}},{...review,input:{...input,roll_number:8}},{...review,input:{...input,first_name:'Another'}},{...review,guardian:{id:actor,name:'Unexpected',phone:''}},{...review,warnings:[4]}])assert.equal(validStudentIntakeReview(changed,school,input),false);
 const existing={...input,guardian:{mode:'existing' as const,id:actor}},value={...review,input:existing,guardian:{id:actor,name:'Riya',phone:'9876543210'}};assert.equal(validStudentIntakeReview(value,school,existing),true);assert.equal(validStudentIntakeReview({...value,guardian:{...value.guardian,id:student}},school),false);
});
test('retained review is bound to exact campus and native session scope',()=>{
 assert.equal(validRetainedStudentIntake(retained,retained.scopeKey,school),true);assert.equal(validRetainedStudentIntake(retained,'different-origin-or-world',school),false);assert.equal(validRetainedStudentIntake(retained,retained.scopeKey,actor),false);assert.equal(validRetainedStudentIntake({...retained,fingerprint:'wrong'},retained.scopeKey,school),false);
});
test('real shared commit gate permits only empty exact review commands in their retained scope',()=>{
 assert.equal(validateNativePendingAction(record,scope,'people'),true);
 for(const changed of [{...record,payload:{kind:'json' as const,body:JSON.stringify({command_id:key})}},{...record,source:{...record.source!,sourceId:actor}},{...record,source:{...record.source!,fingerprint:'bad'}},{...record,refreshPath:root.replace(school,actor)+'?page=1'}])assert.equal(validateNativePendingAction(changed,scope,'people'),false);
 assert.equal(validateNativePendingAction(record,{...scope,mode:'simulation',namespaceId:id},'people'),false);
});
test('accepted intake binds receipt IDs to retained review and canonical learner source',()=>{
 const path=studentIntakeRefreshPath(result,record,retained),accepted={...record,phase:'accepted' as const,refreshPath:path};assert.deepEqual(studentIntakeAcceptedPerson(profile,accepted,retained),{studentId:student,personId:person});
 for(const invalid of [{...result,person_id:'bad'},{...result,student_id:'bad'}])assert.throws(()=>studentIntakeRefreshPath(invalid,record,retained));
 assert.throws(()=>studentIntakeRefreshPath(result,record,{...retained,fingerprint:'b'.repeat(64)}));
 for(const changed of [{...profile,id:actor},{...profile,source_profiles:[{kind:'learning',id:actor}]},{...profile,first_name:'Someone else'},{...profile,revision:0}])assert.throws(()=>studentIntakeAcceptedPerson(changed,accepted,retained));
 assert.throws(()=>studentIntakeAcceptedPerson(profile,{...accepted,refreshPath:path+'&student_id='+student},retained));
});
test('fresh enrollment proof requires the exact reviewed placement even after a later move',()=>{
 const history=[{id:key,class_section_id:input.class_section_id,term_id:input.term_id,roll_number:input.roll_number,enrolled_on:input.enrolled_on}];assert.equal(studentIntakeEnrollmentMatches({history},retained),true);
 assert.equal(studentIntakeEnrollmentMatches({current:{...history[0]},history:[]},retained),false);
 for(const patch of [{class_section_id:actor},{term_id:actor},{roll_number:8},{enrolled_on:'2026-10-28'}])assert.equal(studentIntakeEnrollmentMatches({history:[{...history[0],...patch}]},retained),false);
});
test('lost intake receipt recovers the identical stored review and accepted read failure never sends again',async()=>{
 let raw:string|null=null,sends=0,reads=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},sent:NativePendingAction[]=[];
 const first=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>key,send:async action=>{sends++;sent.push(action);throw new Error('Response lost');},read:async()=>profile});await first.hydrate();await first.run({endpoint:record.endpoint,body:{},serverKey:'review_id',source:record.source},{ownerHref:owner,refreshPath:record.refreshPath,assertActive(){},resolveRefreshPath:(value,action)=>studentIntakeRefreshPath(value,action,retained)});assert.equal(JSON.parse(raw!).phase,'unknown');
 const second=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>actor,send:async action=>{sends++;sent.push(action);return result;},read:async()=>{reads++;throw new Error('Fresh profile unavailable');}});await second.hydrate();assert.equal(await second.recover({ownerHref:owner,assertActive(){},resolveRefreshPath:(value,action)=>studentIntakeRefreshPath(value,action,retained)}),false);assert.equal(JSON.parse(raw!).phase,'accepted');assert.equal(sent[0]!.clientId,sent[1]!.clientId);assert.equal(sent[0]!.payload.kind==='json'&&sent[0]!.payload.body,'{}');
 const third=new NativePendingActionJournal({scope,domain:'people',storage,randomId:()=>actor,send:async()=>{throw new Error('Must not resend');},read:async()=>{reads++;return profile;}});await third.hydrate();assert.equal(await third.recover({ownerHref:owner,assertActive(){},accepted:(value,_assert,action)=>{studentIntakeAcceptedPerson(value,action,retained);}}),true);assert.equal(sends,2);assert.equal(reads,2);assert.equal(raw,null);
});
