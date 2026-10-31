import assert from 'node:assert/strict';
import test from 'node:test';
import { effectivePeriodsForDate, findDraftPeriod, type PlannerPeriod } from '../../packages/contracts/src/academic-planner';
import type { TeacherDay } from '../../packages/contracts/src/wire/features/day-plans/api';
import type { ScheduleScreen, ScheduleVersion } from '../../packages/contracts/src/wire/features/schedule-planning/api';
import { responseSchema } from '../../backend/src/day-plans/contracts';
import { academicCoverageActionAllowed, academicCoverageAvailable, academicCoverageBody, academicCoverageReceipt, academicSummaryRange, academicTeacherDay, academicTeacherRead, academicTeachingHref, type AcademicTeacherPeriod } from '../src/lib/academic-schedule-policy';
import { academicLessonDraftBody, academicLessonEditBody, academicPlannerReturn } from '../src/lib/academic-planner-policy';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction } from '../src/lib/native-pending-action';
import { nativeScheduleAuthoringAllowed } from '../src/lib/schedule-planning-policy';
const school='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',classId='33333333-3333-4333-8333-333333333333',periodId='44444444-4444-4444-8444-444444444444',planId='55555555-5555-4555-8555-555555555555',key='66666666-6666-4666-8666-666666666666',other='77777777-7777-4777-8777-777777777777',termId='88888888-8888-4888-8888-888888888888';
const date='2026-10-29',period={id:periodId,class_section_id:classId,class_name:'Class A',period_number:1,title:'Mathematics',starts_at:'09:00:00',ends_at:'09:45:00',teacher_user_id:actor,teacher_name:'Teacher',day_plan_id:planId,plan_version:2,response_revision:0,response_note:'',response_source:null,responded_at:null,coverage_status:'pending',cancelled:false,materials:[],slot_type:'class',subject_id:other,room:'101',notice:'',owner_name:'Campus coordinator'} as AcademicTeacherPeriod;
const day={date,context:{today:date,local_time:'08:00',timezone:'Asia/Kolkata',is_instructional:true,label:null},periods:[period],schedule_sources:[]} as TeacherDay;
function action(mode:'live'|'simulation'='simulation'):NativePendingAction {return {version:1,domain:'schedule',scope:{actorId:actor,schoolId:school,mode,namespaceId:mode==='simulation'?other:null,origin:'http://localhost:3000'},clientId:key,ownerHref:`/areas/timetable/schedule?source=academic&date=${date}&coverage=${periodId}`,endpoint:`/api/v1/day-plans/periods/${periodId}/respond`,refreshPath:academicTeacherRead(school,date),method:'POST',payload:{kind:'json',body:JSON.stringify({school_id:school,idempotency_key:key,expected_revision:0,status:'accepted',note:'',source:'app'})},source:{kind:'academic_coverage_response',sourceId:periodId,revision:0},phase:'unknown',replayPolicy:'same_request',createdAt:'2026-10-29T02:30:00Z'};}
test('teacher day is exact date/teacher and response uses server local clock, published version and current source',()=>{
  assert.equal(academicTeacherDay(day,date,actor),day);assert.throws(()=>academicTeacherDay({...day,date:'2026-10-30'},date,actor));assert.throws(()=>academicTeacherDay({...day,periods:[{...period,teacher_user_id:other}]},date,actor));
  assert.equal(academicCoverageAvailable(day,period,actor),true);
  for(const changed of [{cancelled:true},{teacher_user_id:other},{coverage_status:'not_required'},{day_plan_id:null},{response_revision:-1}])assert.equal(academicCoverageAvailable(day,{...period,...changed} as AcademicTeacherPeriod,actor),false);
  assert.equal(academicCoverageAvailable({...day,context:{...day.context,local_time:'09:45'}},period,actor),false);assert.equal(academicCoverageAvailable({...day,date:'2026-10-28'},period,actor),false);assert.equal(academicCoverageAvailable({...day,date:'2026-10-30'},period,actor),true);
  const body=academicCoverageBody(period,day,actor,school,'accepted','');assert.doesNotThrow(()=>responseSchema.parse({...body,idempotency_key:key}));assert.equal(body.source,'app');
  assert.throws(()=>academicCoverageBody(period,day,actor,school,'declined',' '));assert.equal(academicCoverageBody(period,day,actor,school,'declined','Unavailable for appointment').status,'declined');
  for(const changed of [{response_revision:1},{plan_version:3},{teacher_user_id:other},{ends_at:'10:00:00'}])assert.throws(()=>academicCoverageBody(period,{...day,periods:[{...period,...changed}]},actor,school,'accepted',''));
});
test('coverage gate is narrow: exact app response, key, revision, teacher read/date/owner, scope and no assisted evidence',()=>{
  const original=action();assert.equal(academicCoverageActionAllowed(original,original.scope),true);assert.equal(nativeScheduleAuthoringAllowed(original,original.scope),true);assert.equal(validateNativePendingAction(original,original.scope,'schedule'),true);
  const body=JSON.parse((original.payload as {body:string}).body);
  for(const patch of [{source:'phone',received_at:'2026-10-29T08:00:00Z'},{school_id:other},{idempotency_key:other},{expected_revision:1},{status:'pending'},{note:'x'.repeat(501)},{status:'declined',note:''},{extra:true}])assert.equal(academicCoverageActionAllowed({...original,payload:{kind:'json',body:JSON.stringify({...body,...patch})}},original.scope),false);
  for(const patch of [{method:'PUT'},{replayPolicy:'inspect_only'},{endpoint:`/api/v1/day-plans/periods/${other}/respond`},{refreshPath:academicTeacherRead(other,date)},{refreshPath:academicTeacherRead(school,'2026-10-30')},{ownerHref:`/areas/timetable/schedule?source=academic&date=${date}&coverage=${other}`},{source:{...original.source!,revision:1}},{ownerHref:original.ownerHref+'&coverage='+periodId}])assert.equal(academicCoverageActionAllowed({...original,...patch} as NativePendingAction,original.scope),false);
  for(const scope of [{...original.scope,actorId:other},{...original.scope,schoolId:other},{...original.scope,namespaceId:school},{...original.scope,origin:'https://other.example'}])assert.equal(academicCoverageActionAllowed(original,scope),false);
});
test('coverage response receipt binds exact period/status/next response revision',()=>{
  const original=action(),receipt={id:periodId,status:'accepted',response_revision:1};assert.equal(academicCoverageReceipt(receipt,original),original.refreshPath);
  for(const patch of [{id:other},{status:'declined'},{response_revision:2}])assert.throws(()=>academicCoverageReceipt({...receipt,...patch},original));
});
test('lost coverage response replays only original key/bytes and acknowledged refresh recovers through reads in Live and Simulation',async()=>{
  for(const mode of ['live','simulation'] as const){const original=action(mode);let raw:string|null=null,sends=0,reads=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},bodies:string[]=[];
    const context={ownerHref:original.ownerHref,refreshPath:original.refreshPath,assertActive(){},resolveRefreshPath:academicCoverageReceipt,accepted(){}};
    const first=new NativePendingActionJournal({scope:original.scope,domain:'schedule',storage,randomId:()=>key,send:async retained=>{sends++;bodies.push((retained.payload as {body:string}).body);throw new Error('Lost response');},read:async()=>day});await first.hydrate();assert.equal(await first.run({endpoint:original.endpoint,body:JSON.parse((original.payload as {body:string}).body),source:original.source,serverKey:'idempotency_key'},context),false);
    const second=new NativePendingActionJournal({scope:original.scope,domain:'schedule',storage,randomId:()=>other,send:async retained=>{sends++;bodies.push((retained.payload as {body:string}).body);return{id:periodId,status:'accepted',response_revision:1};},read:async()=>{reads++;throw new Error('Read offline');}});await second.hydrate();await second.recover(context);assert.equal(second.snapshot().action?.phase,'accepted');assert.equal(bodies[0],bodies[1]);
    const third=new NativePendingActionJournal({scope:original.scope,domain:'schedule',storage,randomId:()=>other,send:async()=>{sends++;throw new Error('Do not repeat');},read:async()=>{reads++;return day;}});await third.hydrate();await third.recover(context);assert.equal(sends,2);assert.equal(reads,2);assert.equal(raw,null);
  }
});
test('coverage source lease drift during secure preparation stops dispatch and keeps original intent',async()=>{
  const original=action();let raw:string|null=null,active=true,sends=0;const journal=new NativePendingActionJournal({scope:original.scope,domain:'schedule',randomId:()=>key,storage:{read:async()=>raw,write:async value=>{raw=value;if(JSON.parse(value).phase==='unknown')active=false;},clear:async()=>{raw=null;}},send:async()=>{sends++;return{};},read:async()=>day});await journal.hydrate();await journal.run({endpoint:original.endpoint,body:JSON.parse((original.payload as {body:string}).body),source:original.source,serverKey:'idempotency_key'},{ownerHref:original.ownerHref,refreshPath:original.refreshPath,assertActive(){if(!active)throw new Error('Source left');},resolveRefreshPath:academicCoverageReceipt});assert.equal(sends,0);assert.ok(raw);assert.equal(journal.snapshot().action?.phase,'unknown');
});
test('summary range is explicit date only, and teaching continuation must match dated class/period',()=>{
  assert.deepEqual(academicSummaryRange('2026-10-02','day'),{start:'2026-09-25',end:'2026-10-31'});assert.deepEqual(academicSummaryRange(date,'year'),{start:'2026-01-01',end:'2026-12-31'});
  const href=`/areas/timetable/session?date=${date}&class_section_id=${classId}&period_number=1`;assert.equal(academicTeachingHref({...period,teaching_session_href:href},date),href);assert.equal(academicTeachingHref({...period,teaching_session_href:href.replace(classId,other)},date),null);assert.equal(academicTeachingHref({...period,teaching_session_href:'https://other.example'+href},date),null);
});
const schedulePeriod={id:periodId,weekday:4,period_number:1,subject_id:other,teacher_user_id:actor,title:'Math',slot_type:'class' as const,room:'101',starts_at:'09:00',ends_at:'09:45'};
const draft={id:planId,class_section_id:classId,term_id:termId,state:'draft' as const,starts_on:date,ends_on:'2027-03-31',revision:4,baseline:false,periods:[{...schedulePeriod,id:other}]};
const schedule={school_id:school,school_date:'2026-10-28',selected_term_id:termId,terms:[{id:termId,starts_on:'2026-04-01',ends_on:'2027-03-31'}],classes:[{id:classId,name:'Class A'}],teachers:[{id:actor,name:'Teacher'}],subjects:[{id:other,name:'Mathematics'}],versions:[],slots:[{...schedulePeriod,title:undefined,display_title:'Math',class_section_id:classId,class_name:'Class A',teacher_name:'Teacher'}],calendar_exceptions:[]} as unknown as ScheduleScreen;
test('dated planner resolves actual weekday, closure, active override/draft and exact class rather than any historical matching ID',()=>{
  assert.equal(effectivePeriodsForDate(schedule,date,classId)[0]?.id,periodId);assert.equal(effectivePeriodsForDate(schedule,'2026-10-30',classId).length,0);assert.equal(effectivePeriodsForDate(schedule,date,other).length,0);
  assert.equal(effectivePeriodsForDate({...schedule,calendar_exceptions:[{date,is_instructional:false}] as ScheduleScreen['calendar_exceptions']},date).length,0);
  const active={...draft,state:'published' as const},data={...schedule,versions:[{...active,id:termId,baseline:true,periods:[schedulePeriod]},active]};assert.equal(effectivePeriodsForDate(data,date,classId)[0]?.version_id,planId);
  assert.equal(effectivePeriodsForDate({...data,versions:[...data.versions,{...draft,id:school,periods:[{...schedulePeriod,id:key}]}]},date,classId)[0]?.id,key);
  assert.equal(findDraftPeriod(draft,schedulePeriod)?.id,other);assert.equal(findDraftPeriod({...draft,periods:[{...schedulePeriod,id:other,period_number:2}]},schedulePeriod),undefined);
});
test('recurring edit uses exact copied period/revision and preserves other lessons; draft preparation stays future in current term',()=>{
  const original=effectivePeriodsForDate(schedule,date,classId)[0]!,data={...schedule,versions:[{...draft,periods:[draft.periods[0]!,{...schedulePeriod,id:key,period_number:2,starts_at:'10:00',ends_at:'10:45'}]}]},proposal={subject:other,teacher:actor,title:'Ignored subject title',room:'202',start:'09:00',end:'09:50'};
  const body=academicLessonEditBody(data,original,draft,proposal);assert.equal(body.expected_revision,4);assert.equal(body.periods[0]?.id,other);assert.equal(body.periods[0]?.room,'202');assert.equal(body.periods[0]?.title,'Mathematics');assert.equal(body.periods[1]?.id,key);assert.equal(body.periods[1]?.room,'101');assert.equal('class_name' in body.periods[0]!,false);
  assert.throws(()=>academicLessonEditBody({...data,versions:[{...data.versions[0]!,revision:5}]},original,draft,proposal));assert.throws(()=>academicLessonEditBody(data,original,draft,{...proposal,teacher:school}));assert.throws(()=>academicLessonEditBody(data,original,draft,{...proposal,end:'08:00'}));
  assert.equal(academicLessonDraftBody(schedule,classId,'2026-10-20').starts_on,date);assert.throws(()=>academicLessonDraftBody(data,classId,date));assert.throws(()=>academicLessonDraftBody(schedule,other,date));
});
test('one-date change returns only to exact internal class/date planner and retains lesson inspection identity',()=>{
  const href=`/areas/timetable/planning?source=academic&date=${date}&class=${classId}&period=${periodId}`;assert.equal(academicPlannerReturn(href,classId,date,school),href);
  for(const value of ['https://evil.example'+href,href.replace(classId,other),href.replace(date,'2026-10-30'),href+'&return_to=%2Faccount',href+'&class='+classId,href+'#other',href+'&school='+other])assert.equal(academicPlannerReturn(value,classId,date,school),null);
});
