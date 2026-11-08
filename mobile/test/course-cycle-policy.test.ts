import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssessmentWorkspace } from '../../packages/contracts/src/assessments';
import type { ActivityCatalogue, ActivityPlanInput } from '../../packages/contracts/src/wire/features/activities/api';
import { courseContextInput } from '../src/lib/learning-academic-context';
import { learningOfferingRefreshPath } from '../src/lib/learning-offering-policy';
import { assessmentPlanPayload, assessmentAuthoringRefreshPath, assessmentAuthoringAccepted, type AssessmentPlanDraft } from '../src/lib/assessment-authoring';
import { scheduleActivityInput, scheduleActivityLeadChoices } from '../src/lib/schedule-planning-policy';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const school=id(1), actor=id(2), term=id(3), subject=id(4), offering=id(5), reviewer=id(6), cycle=id(7), command=id(8), assessment=id(9);
const context = {term_id:term,subject_id:subject,course_code:'CS501',credits:4,programme_key:'MTECH-CS',term_name:'Semester I',academic_year:'2026-27',starts_on:'2026-07-01',ends_on:'2026-12-31',subject_name:'Distributed systems',color:'#123456',icon:'learning'};
const course = {id:offering,name:'Distributed systems · Group A',revision:2,learner_count:12,academic_context:context};
const scope: NativePendingScope = {schoolId:school,actorId:actor,mode:'live',namespaceId:null,origin:'https://campus.example'};
const references = {terms:[{id:term,name:context.term_name,academic_year:context.academic_year,starts_on:context.starts_on,ends_on:context.ends_on}],subjects:[{id:subject,name:context.subject_name,color:context.color,icon:context.icon}]};
test('optional course setup binds current identities, precision and reviewed programme without inventing classes', () => {
  assert.deepEqual(courseContextInput({term,subject,code:' cs501 ',credits:'4.1250',programme:' mtech-cs '},references), {term_id:term,subject_id:subject,course_code:'CS501',credits:4.125,programme_key:'MTECH-CS'});
});
test('course setup rejects stale or ambiguous catalogue identities and invalid credits', () => {
  const draft={term,subject,code:'CS501',credits:'4',programme:''};
  for (const credits of ['0','-1','1000.0001','4.00001','Infinity','4e1']) assert.throws(()=>courseContextInput({...draft,credits},references));
  assert.throws(()=>courseContextInput({...draft,term:id(22)},references));
  assert.throws(()=>courseContextInput(draft,{...references,subjects:[...references.subjects,...references.subjects]}));
});
function pending(endpoint:string, body:Record<string,unknown>, sourceId:string, revision:number, domain:NativePendingAction['domain']='learning'):NativePendingAction { return {version:1,domain,scope,clientId:command,ownerHref:'/areas/messages/assignments?scope=offering&offering_id='+offering,endpoint,refreshPath:'/api/v1/learning/offerings/'+offering+'/',method:'POST',payload:{kind:'json',body:JSON.stringify({command_id:command,...body})},source:{kind:'offering',sourceId,revision},phase:'unknown',replayPolicy:'same_request',createdAt:'2026-11-08T10:00:00Z'}; }
test('course configuration acceptance requires the exact command action and normalized academic intent', () => {
  const input={term_id:term,subject_id:subject,course_code:'CS501',credits:4,programme_key:'MTECH-CS'}, action=pending(`/api/v1/learning/offerings/${offering}/academic-context/`,{expected_revision:2,academic_context:input},offering,2);
  const receipt={id:offering,revision:3,action:'academic.configure',academic_context:context};
  assert.equal(validateNativePendingAction(action,scope,'learning'),true);
  assert.equal(learningOfferingRefreshPath(receipt,action),action.refreshPath);
  for(const patch of [{action:'enroll'},{revision:4},{academic_context:{...context,credits:3}},{id:subject}]) assert.throws(()=>learningOfferingRefreshPath({...receipt,...patch},action));
});
const workspace={mode:'admin',cycles:[{id:cycle,term_id:term,academic_year:'2026-27',starts_on:context.starts_on,ends_on:context.ends_on}],assessments:[],references:{...references,offerings:[course],classes:[],staff:[{id:actor,first_name:'Asha',last_name:'Sen'},{id:reviewer,first_name:'Ravi',last_name:'Das'}],spaces:[],grading_policies:[]}} as unknown as AssessmentWorkspace;
const draft:AssessmentPlanDraft={cycle,classId:'',subject,offering,kind:'class_test',title:'Consistency models',maximum:'40',policy:'',weight:'',scheduled:'2026-11-10T05:30:00.000Z',duration:'60',venue:'Online submission',instructions:'Explain the observed consistency guarantees.',evidence:'optional',examiner:actor,moderator:reviewer,space:'',invigilators:[]};
const assessmentBody=()=>({...assessmentPlanPayload(workspace,draft,actor,'2026-11-08T00:00:00Z','Asia/Kolkata'),idempotency_key:command});
function assessmentAction():NativePendingAction {const value=pending(`/api/v1/schools/${school}/assessments/`,assessmentBody(),school,0,'assessments'); return {...value,ownerHref:'/areas/assessments/manage?create=assessment',refreshPath:`/api/v1/schools/${school}/assessments/workspace/`,source:{kind:'assessment_creation',sourceId:school,revision:0},payload:{kind:'json',body:JSON.stringify(assessmentBody())}};}
const receipt=()=>({...assessmentBody(),id:assessment,school_id:school,command_id:command,action:'assessment.create',revision:1});
test('canonical course assessment needs no legacy class and refuses mixed or physical examination contexts', () => {
  assert.equal(assessmentBody().class_section_id,null);
  for(const patch of [{classId:id(30)},{offering:id(31)},{subject:id(32)},{kind:'exam'},{space:id(33)},{invigilators:[reviewer]},{scheduled:'2027-01-02T00:00:00Z'}]) assert.throws(()=>assessmentPlanPayload(workspace,{...draft,...patch},actor,'2026-11-08T00:00:00Z','Asia/Kolkata'));
  assert.equal(validateNativePendingAction(assessmentAction(),scope,'assessments'),true);
  for(const patch of [{command_id:id(40)},{school_id:id(41)},{offering_id:id(42)},{maximum_marks:39},{action:'schedule'}]) assert.throws(()=>assessmentAuthoringRefreshPath({...receipt(),...patch},assessmentAction()));
});
test('accepted course creation survives relaunch/read failure and never posts again after marking advances', async () => {
  let raw:string|null=null,sends=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}};
  const action=assessmentAction(), options={scope,domain:'assessments' as const,storage,randomId:()=>command,send:async()=>{sends++;return receipt();},read:async()=>{throw Error('Read interrupted');}};
  const owner={ownerHref:action.ownerHref,refreshPath:action.refreshPath,assertActive(){},resolveRefreshPath:assessmentAuthoringRefreshPath};
  const first=new NativePendingActionJournal(options);await first.hydrate();assert.equal(await first.run({endpoint:action.endpoint,body:assessmentBody(),serverKey:'idempotency_key',source:action.source},owner),false);assert.equal(JSON.parse(raw!).phase,'accepted');
  const resumed=new NativePendingActionJournal({...options,send:async()=>{sends++;throw Error('Must not repost');},read:async()=>({assessment:{...receipt(),revision:5,status:'marking'},viewer_role:'admin',results:[],publications:[]})});
  await resumed.hydrate();assert.equal(await resumed.recover({...owner,accepted:(value,guard,pending)=>{assert.equal(assessmentAuthoringAccepted(value,pending).id,assessment);guard();}}),true);assert.equal(sends,1);assert.equal(raw,null);
});
test('teaching plans use one dated course roster and reject mixed lists, foreign courses and out-of-term dates', () => {
  const catalogue={school_id:school,timezone:'Asia/Kolkata',can_manage:true,people:[{id:actor,label:'Asha',affiliations:[]}],recorders:[],reviewers:[],groups:[],spaces:[],classes:[],terms:[],subjects:[],purposes:['teaching'],offerings:[course]} as ActivityCatalogue;
  const plan:ActivityPlanInput={title:'Distributed systems',purpose:'teaching',description:'',timezone:'Asia/Kolkata',starts_on:'2026-11-10',ends_on:'2026-12-31',recurrence:'weekly',weekdays:[2],starts_at:'09:00',ends_at:'10:00',end_day_offset:0,space_id:null,person_ids:[],group_ids:[],lead_person_id:null,recorder_person_id:null,reviewer_person_id:null,attendance_mode:'none',class_section_id:null,term_id:null,subject_id:null,offering_id:offering,location_kind:'online',location_label:'Classroom link',location_url:''};
  assert.equal(scheduleActivityInput(plan,catalogue).offering_id,offering);
  for(const patch of [{person_ids:[actor]},{class_section_id:id(50)},{term_id:term},{offering_id:id(51)},{ends_on:null},{starts_on:'2026-06-30'},{ends_on:'2027-01-01'},{timezone:'UTC'}]) assert.throws(()=>scheduleActivityInput({...plan,...patch},catalogue));
  const instructor=id(52), scoped={...catalogue,offerings:[{...course,current_instructor:{person_id:instructor,name:'Current course instructor'}}]};
  assert.ok(scheduleActivityLeadChoices(scoped,offering).some(person=>person.id===instructor));
  assert.equal(scheduleActivityInput({...plan,lead_person_id:instructor},scoped).lead_person_id,instructor);
  assert.throws(()=>scheduleActivityInput({...plan,lead_person_id:instructor,recorder_person_id:instructor},scoped),'Teaching identity does not infer attendance recording authority.');
  assert.equal(scheduleActivityLeadChoices(scoped,id(53)).some(person=>person.id===instructor),false);
  const basic={...scoped,offerings:[{...course,academic_context:null,current_instructor:{person_id:instructor,name:'Learning instructor'}}]};
  assert.equal(scheduleActivityInput({...plan,ends_on:null,timezone:'UTC',lead_person_id:instructor},basic).ends_on,null);
  assert.equal(scheduleActivityInput({...plan,ends_on:null,timezone:'UTC'},basic).timezone,'UTC');
});
