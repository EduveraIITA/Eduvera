import assert from 'node:assert/strict';
import test from 'node:test';
import { assessmentArrangementsPayload, assessmentAuthoringAccepted, assessmentAuthoringActionAllowed, assessmentAuthoringChoices, assessmentAuthoringRefreshPath, assessmentAuthoringRoot, assessmentCyclePayload, assessmentPlanPayload, type AssessmentPlanDraft } from '../src/lib/assessment-authoring';
import type { AssessmentDetail, AssessmentWorkspace } from '../../packages/contracts/src/assessments';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [school,actor,moderator,term,cycle,classId,subject,space,invigilator,assessment,sitting,command,otherClass,otherSubject] = Array.from({length:14},(_,n)=>id(n+1)) as string[];
const scope: NativePendingScope = {actorId:actor!,schoolId:school!,mode:'live',namespaceId:null,origin:'https://campus.example'}, root = assessmentAuthoringRoot(school!);
const workspace = {mode:'admin',cycles:[{id:cycle,term_id:term,academic_year:'2026',starts_on:'2026-01-01',ends_on:'2026-12-31'}],assessments:[],references:{terms:[{id:term,name:'Term',academic_year:'2026',starts_on:'2026-01-01',ends_on:'2026-12-31'}],classes:[{id:classId,name:'Class',academic_year:'2026'},{id:otherClass,name:'Other year',academic_year:'2025'}],subjects:[{id:subject,name:'Science'},{id:otherSubject,name:'Math'}],staff:[{id:actor,first_name:'Examiner',last_name:'One'},{id:moderator,first_name:'Reviewer',last_name:'Two'},{id:invigilator,first_name:'Invigilator',last_name:'Three'}],spaces:[{id:space,name:'Hall',capacity:40}],grading_policies:[]}} as unknown as AssessmentWorkspace;
const plan: AssessmentPlanDraft = {cycle:cycle!,classId:classId!,subject:subject!,kind:'exam',title:' Science paper ',maximum:'100.25',policy:'',weight:'',scheduled:'2026-10-30T04:00:00.000Z',duration:'90',venue:'',instructions:' Bring writing materials. ',evidence:'optional',examiner:actor!,moderator:moderator!,space:space!,invigilators:[invigilator!]};
const now = '2026-10-29T00:00:00.000Z';
const details = {assessment:{id:assessment,revision:3,status:'draft',title:'Science paper',scheduled_at:plan.scheduled,duration_minutes:90},viewer_role:'admin',exam_operation:{sitting:{id:sitting,revision:4,state:'planning',space_id:space,starts_at:plan.scheduled},space:{id:space},invigilators:[{user_id:invigilator,status:'accepted'}]}} as unknown as AssessmentDetail;
const body = () => assessmentPlanPayload(workspace,plan,actor!,now,'Asia/Kolkata');
function action(kind: string, endpoint: string, values: object, revision = 0, sourceId = school!): NativePendingAction {return {version:1,domain:'assessments',scope,clientId:command!,ownerHref:'/areas/assessments/manage?create=assessment',endpoint,refreshPath:`${root}/workspace/`,method:'POST',payload:{kind:'json',body:JSON.stringify(values)},source:{kind,sourceId,revision,...(kind === 'assessment_arrangements' ? {fingerprint:sitting} : {})},phase:'unknown',replayPolicy:'inspect_only',createdAt:now};}
const creationReceipt = () => ({id:assessment,school_id:school,revision:1,status:'draft',...body(),maximum_marks:'100.25',sitting:{id:sitting,school_id:school,assessment_id:assessment,revision:1,space_id:space}});

test('assessment planning binds class year, independent reviewers and exact physical arrangements',()=>{
  const value=body(); assert.equal(value.class_section_id,classId); assert.equal(value.title,'Science paper'); assert.equal(value.maximum_marks,100.25); assert.equal(value.venue,'Hall'); assert.equal(value.weight_percent,null); assert.deepEqual(value.invigilator_user_ids,[invigilator]); assert.deepEqual(assessmentAuthoringChoices(workspace,cycle!,classId!).classes.map(value=>value.id),[classId]);
  for(const patch of [{classId:otherClass},{moderator:actor},{space:'foreign'},{invigilators:[invigilator!,invigilator!]},{scheduled:now},{maximum:'100.123'},{weight:'101'},{policy:'foreign'}])assert.throws(()=>assessmentPlanPayload(workspace,{...plan,...patch},actor!,now,'Asia/Kolkata'));
});
test('staff class tests keep the owning teacher and only their actual class subjects',()=>{
  const staff={...workspace,mode:'staff',can_plan_class_test:true,planner_user_id:actor,references:{...workspace.references!,staff:workspace.references!.staff.filter(value=>value.id===moderator),subjects:[{id:subject,name:'Science',class_section_ids:[classId]},{id:otherSubject,name:'Math',class_section_ids:[otherClass]}]}} as unknown as AssessmentWorkspace;
  const value=assessmentPlanPayload(staff,{...plan,kind:'class_test',space:'',invigilators:[]},actor!,now,'Asia/Kolkata'); assert.equal(value.examiner_user_id,actor); assert.equal(value.space_id,null); assert.deepEqual(value.invigilator_user_ids,[]);
  for(const patch of [{kind:'exam'},{examiner:moderator},{subject:otherSubject},{scheduled:'2027-01-01T04:00:00Z'}])assert.throws(()=>assessmentPlanPayload(staff,{...plan,kind:'class_test',...patch},actor!,now,'Asia/Kolkata'));
  assert.throws(()=>assessmentPlanPayload({...staff,can_plan_class_test:false} as AssessmentWorkspace,{...plan,kind:'class_test'},actor!,now,'Asia/Kolkata'));
});
test('class test cycle date uses campus civil time across the UTC date boundary',()=>{
  const staff={...workspace,mode:'staff',can_plan_class_test:true,planner_user_id:actor,cycles:[{...workspace.cycles[0],starts_on:'2026-10-30',ends_on:'2026-10-30'}],references:{...workspace.references!,subjects:[{id:subject,name:'Science',class_section_ids:[classId]}]}} as unknown as AssessmentWorkspace;
  assert.doesNotThrow(()=>assessmentPlanPayload(staff,{...plan,kind:'class_test',scheduled:'2026-10-29T20:00:00Z'},actor!,now,'Asia/Kolkata'));
  assert.throws(()=>assessmentPlanPayload(staff,{...plan,kind:'class_test',scheduled:'2026-10-29T17:00:00Z'},actor!,now,'Asia/Kolkata'));
});
const cycleInput={term:term!,name:' Autumn exams ',code:' au-26 ',label:' Result ',start:'2026-10-01',end:'2026-10-31'};
test('cycle setup stays inside the actual term and preserves its explicit result label',()=>{
  assert.deepEqual(assessmentCyclePayload(workspace,cycleInput),{term_id:term,name:'Autumn exams',code:'AU-26',result_label:'Result',starts_on:'2026-10-01',ends_on:'2026-10-31'});
  for(const patch of [{term:'foreign'},{start:'2025-12-31'},{end:'2027-01-01'},{start:'2026-02-30'},{end:'2026-09-30'},{code:'x'}])assert.throws(()=>assessmentCyclePayload(workspace,{...cycleInput,...patch}));
});
test('arrangement edits carry both exact revisions and stop when current authority or state ends',()=>{
  const value=assessmentArrangementsPayload(workspace,details,plan,now); assert.equal(value.expected_assessment_revision,3); assert.equal(value.expected_sitting_revision,4);
  for(const changed of [{...details,viewer_role:'examiner'},{...details,assessment:{...details.assessment,status:'scheduled'}},{...details,exam_operation:{...details.exam_operation!,sitting:{...details.exam_operation!.sitting,state:'ready'}}}] as AssessmentDetail[])assert.throws(()=>assessmentArrangementsPayload(workspace,changed,plan,now));
});
test('creation success verifies direct school/source receipt before binding the exact new detail',()=>{
  const value=action('assessment_creation',`${root}/`,body()), receipt=creationReceipt(); assert.equal(assessmentAuthoringRefreshPath(receipt,value),`${root}/${assessment}/`);
  for(const patch of [{school_id:id(99)},{class_section_id:otherClass},{revision:2},{maximum_marks:'99'},{sitting:{...receipt.sitting,space_id:id(98)}}])assert.throws(()=>assessmentAuthoringRefreshPath({...receipt,...patch},value));
  assert.throws(()=>assessmentAuthoringRefreshPath(receipt,{...value,replayPolicy:'same_request'}));
});
test('cycle success retains its server ID in the owning workspace read',()=>{
  const values=assessmentCyclePayload(workspace,cycleInput), value=action('assessment_cycle',`${root}/cycles/`,values), receipt={id:cycle,school_id:school,revision:1,...values};
  assert.equal(assessmentAuthoringRefreshPath(receipt,value),`${root}/workspace/?cycle_id=${cycle}`);
  assert.deepEqual(assessmentAuthoringAccepted({...workspace,cycles:[receipt]},{...value,phase:'accepted',refreshPath:assessmentAuthoringRefreshPath(receipt,value)}),{kind:'cycle',id:cycle,title:'Autumn exams'});
  assert.throws(()=>assessmentAuthoringAccepted({...workspace,cycles:[{...receipt,term_id:id(99)}]},{...value,refreshPath:`${root}/workspace/?cycle_id=${cycle}`}));
});
test('arrangement success verifies both next revisions and exact physical time and place',()=>{
  const values=assessmentArrangementsPayload(workspace,details,plan,now), value=action('assessment_arrangements',`${root}/${assessment}/sitting/arrangements/`,values,3,assessment), receipt={assessment:{id:assessment,school_id:school,revision:4,duration_minutes:90},sitting:{id:sitting,school_id:school,assessment_id:assessment,revision:5,space_id:space,starts_at:plan.scheduled}};
  assert.equal(assessmentAuthoringRefreshPath(receipt,value),`${root}/${assessment}/`);
  assert.throws(()=>assessmentAuthoringRefreshPath({...receipt,sitting:{...receipt.sitting,revision:4}},value)); assert.throws(()=>assessmentAuthoringRefreshPath({...receipt,assessment:{...receipt.assessment,revision:5}},value));
  assert.throws(()=>assessmentAuthoringRefreshPath({...receipt,sitting:{...receipt.sitting,id:id(99)}},value));
  const retained={...value,refreshPath:`${root}/${assessment}/`};assert.equal(assessmentAuthoringActionAllowed(retained,scope),true);assert.equal(assessmentAuthoringActionAllowed({...retained,source:{...retained.source!,fingerprint:undefined}},scope),false);
});
test('accepted read checks the actual selected assessment and independent staff authority',()=>{
  const value={...action('assessment_creation',`${root}/`,body()),phase:'accepted' as const,refreshPath:`${root}/${assessment}/`}, read={assessment:{...creationReceipt(),examiner_user_id:actor,moderator_user_id:moderator},viewer_role:'admin',results:[],publications:[]};
  assert.deepEqual(assessmentAuthoringAccepted(read,value),{kind:'assessment',id:assessment,title:'Science paper'});
  assert.throws(()=>assessmentAuthoringAccepted({...read,assessment:{...read.assessment,id:id(99)}},value)); assert.throws(()=>assessmentAuthoringAccepted({...read,viewer_role:'viewer'},value)); assert.throws(()=>assessmentAuthoringAccepted({...read,assessment:{...read.assessment,moderator_user_id:actor}},value));
  assert.throws(()=>assessmentAuthoringAccepted({...read,results:undefined},value));
});
test('authoring journal accepts exact legacy owners and refuses operational or cross-campus paths',()=>{
  const value=action('assessment_creation',`${root}/`,body()); assert.equal(assessmentAuthoringActionAllowed(value,scope),true); assert.equal(validateNativePendingAction(value,scope,'assessments'),true);
  for(const patch of [{endpoint:`${root}/${assessment}/results/`},{endpoint:assessmentAuthoringRoot(id(99))+'/'},{method:'PUT' as const},{replayPolicy:'same_request' as const},{source:{kind:'assessment',sourceId:school!,revision:0}},{refreshPath:'/api/v1/chat/messages/'}])assert.equal(assessmentAuthoringActionAllowed({...value,...patch},scope),false);
  const accepted={...value,phase:'accepted' as const,refreshPath:`${root}/${assessment}/`}; assert.equal(assessmentAuthoringActionAllowed(accepted,scope),true); assert.equal(assessmentAuthoringActionAllowed({...value,phase:'accepted'},scope),false);
  assert.equal(assessmentAuthoringActionAllowed({...value,payload:{kind:'json',body:JSON.stringify({...body(),idempotency_key:command})}},scope),false);
});
test('lost legacy creation response is inspected after relaunch without a duplicate assessment',async()=>{
  let raw:string|null=null,sends=0,reads=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}}, context={ownerHref:'/areas/assessments/manage?create=assessment',refreshPath:`${root}/workspace/`,assertActive(){},resolveRefreshPath:assessmentAuthoringRefreshPath};
  const first=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>command!,send:async()=>{sends++;throw new Error('Response lost');},read:async()=>{reads++;return workspace;}});
  await first.hydrate();assert.equal(await first.run({endpoint:`${root}/`,body:body(),serverKey:null,replayPolicy:'inspect_only',source:{kind:'assessment_creation',sourceId:school!,revision:0}},context),false);
  const second=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>{throw new Error('No replacement intent');},send:async()=>{throw new Error('Never repeat legacy creation');},read:async()=>{reads++;return workspace;}});
  await second.hydrate();assert.equal(await second.recover(context),false);assert.equal(sends,1);assert.equal(reads,1);assert.equal(JSON.parse(raw!).phase,'unknown');
});
test('accepted creation whose source read failed resumes reads only with the original returned ID',async()=>{
  let raw:string|null=null,sends=0,reads=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}}, context={ownerHref:'/areas/assessments/manage?create=assessment',refreshPath:`${root}/workspace/`,assertActive(){},resolveRefreshPath:assessmentAuthoringRefreshPath};
  const first=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>command!,send:async()=>{sends++;return creationReceipt();},read:async()=>{reads++;throw new Error('Detail read unavailable');}});
  await first.hydrate();assert.equal(await first.run({endpoint:`${root}/`,body:body(),serverKey:null,replayPolicy:'inspect_only',source:{kind:'assessment_creation',sourceId:school!,revision:0}},context),false);assert.equal(JSON.parse(raw!).phase,'accepted');assert.equal(JSON.parse(raw!).refreshPath,`${root}/${assessment}/`);
  const second=new NativePendingActionJournal({scope,domain:'assessments',storage,randomId:()=>command!,send:async()=>{throw new Error('Accepted means read only');},read:async()=>{reads++;return {assessment:{...creationReceipt(),examiner_user_id:actor,moderator_user_id:moderator},viewer_role:'admin',results:[],publications:[]};}});
  await second.hydrate();assert.equal(await second.recover({...context,accepted:(value,_assert,action)=>{assessmentAuthoringAccepted(value,action);}}),true);assert.equal(sends,1);assert.equal(reads,2);assert.equal(raw,null);
});
