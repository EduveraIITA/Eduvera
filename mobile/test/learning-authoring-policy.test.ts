import assert from 'node:assert/strict';
import test from 'node:test';
import { learningAssignmentPayload, learningAuthoringObsolete, learningAuthoringRefreshPath, learningPracticePayload, learningReviewerOptions } from '../src/lib/learning-authoring-policy';
import type { AssignmentItem, AssignmentList } from '../../packages/contracts/src/wire/features/learning/assignmentApi';
import type { NativePendingAction } from '../src/lib/native-pending-action';
import type { ClassPracticeList } from '../../packages/contracts/src/wire/features/notices/classPracticeApi';

const list: AssignmentList = { context: 'class', can_create: true, can_general: true, timezone: 'Asia/Kolkata', class_section: { id:'class',label:'Year 7' }, terms:[{id:'term',name:'Autumn'}], subjects:[{id:'science',name:'Science'}], reviewers:[{id:'general',name:'General reviewer',subject_id:null},{id:'science-reviewer',name:'Science reviewer',subject_id:'science'},{id:'other',name:'Other subject',subject_id:'math'}],items:[],page:1,has_more:false };
const item = { id:'assignment',revision:2,title:' Investigation ',instructions:' Review the observations. ',reviewer_id:'science-reviewer',term_id:'term',subject_id:'science',due_at:null,cutoff_at:null,submission_mode:'either',max_attempts:null } satisfies Pick<AssignmentItem,'id'|'revision'|'title'|'instructions'|'reviewer_id'|'term_id'|'subject_id'|'due_at'|'cutoff_at'|'submission_mode'|'max_attempts'>;
test('assignment authoring binds current class, term, subject and eligible named reviewer', () => { const payload=learningAssignmentPayload(list,item); assert.equal(payload.class_section_id,'class'); assert.equal(payload.expected_revision,2); assert.equal(payload.title,'Investigation'); assert.equal(payload.reviewer_id,'science-reviewer'); assert.equal(payload.due_at,null); assert.equal(payload.cutoff_at,null); assert.equal(payload.resubmission_mode,'on_request'); assert.deepEqual(learningReviewerOptions(list,'science').map(value=>value.value),['general','science-reviewer']); });
test('offering authoring uses its native context without inventing a class or term', () => { const payload=learningAssignmentPayload({...list,context:'offering',offering:{id:'group',name:'Robotics',revision:3},class_section:undefined,terms:undefined},{...item,term_id:null,subject_id:null,reviewer_id:'general'}); assert.equal(payload.context_kind,'learning_offering'); assert.equal(payload.offering_id,'group'); assert.equal('class_section_id'in payload,false); assert.equal('term_id'in payload,false); });
test('unavailable capability, foreign reviewer/context and invalid policy values fail before command preparation', () => { for(const [source,changed] of [[{...list,can_create:false},item],[list,{...item,reviewer_id:'other'}],[list,{...item,term_id:'other'}],[{...list,can_general:false},{...item,subject_id:null}],[list,{...item,max_attempts:0}],[list,{...item,max_attempts:101}],[list,{...item,due_at:'2026-10-29T12:00:00Z',cutoff_at:'2026-10-29T11:00:00Z'}]] as const) assert.throws(()=>learningAssignmentPayload(source,changed)); });
const action={clientId:'command',source:{kind:'offering',sourceId:'group',revision:3},payload:{kind:'json',body:JSON.stringify({participants:[{id:'person',expected_revision:2}],instructor:{id:'instructor',expected_revision:4}})}} as NativePendingAction;
const proof={confirmation:'permanently_inapplicable',receipt_state:'absent',handler:'learning.offerings',command_id:'command',source_id:'group',expected_revision:3,current_revision:4,code:'learning.offering_revision_obsolete'};
const error=(value:object)=>({status:409,details:{error:{fields:{offering_obsolete:value}}}});
test('only source-bound receipt-absent monotonic proof releases an offering command',()=>{assert.equal(learningAuthoringObsolete(error(proof),action),true);for(const patch of [{receipt_state:'accepted'},{command_id:'other'},{source_id:'other'},{expected_revision:2},{current_revision:3},{handler:'learning.assignments'}])assert.equal(learningAuthoringObsolete(error({...proof,...patch}),action),false);});
test('selected-person stale proof must match a revision actually committed to the original group command',()=>{const selected={...proof,current_revision:3,code:'learning.offering_selection_obsolete',person_id:'person',selected_revision:2,current_person_revision:3};assert.equal(learningAuthoringObsolete(error(selected),action),true);for(const patch of [{person_id:'unselected'},{selected_revision:1},{current_person_revision:2}])assert.equal(learningAuthoringObsolete(error({...selected,...patch}),action),false);});
test('assignment receipt must identify the original source and next revision before accepted recovery',()=>{
  const value={...action,endpoint:'/api/v1/learning/assignments/',refreshPath:'/api/v1/learning/assignments/source/',source:{kind:'assignment',sourceId:'source',revision:2},payload:{kind:'json',body:JSON.stringify({assignment_id:'source',expected_revision:2})}} as NativePendingAction;
  assert.equal(learningAuthoringRefreshPath({id:'source',revision:3},value),value.refreshPath);
  assert.throws(()=>learningAuthoringRefreshPath({id:'source',revision:3},{...value,refreshPath:'/api/v1/learning/assignments/other/'}));
  for(const receipt of [{id:'other',revision:3},{id:'source',revision:2},{id:'source',revision:4},{}])assert.throws(()=>learningAuthoringRefreshPath(receipt,value));
  const publication={...value,endpoint:'/api/v1/learning/assignments/source/publish/',payload:{kind:'json' as const,body:JSON.stringify({expected_revision:2,audience_hash:'reviewed'})}};
  assert.equal(learningAuthoringRefreshPath({id:'source',revision:3,audience_count:5},publication),value.refreshPath);
  assert.throws(()=>learningAuthoringRefreshPath({id:'source',revision:3},publication));
});
test('private practice reply acceptance matches the stable original note ID',()=>{
  const value={...action,endpoint:'/api/v1/learning/practice/source/notes/',refreshPath:'/api/v1/learning/practice/source/?student_id=learner',source:{kind:'practice',sourceId:'source',revision:1},payload:{kind:'json',body:JSON.stringify({note_id:'note',student_id:'learner',body:'Question'})}} as NativePendingAction;
  assert.equal(learningAuthoringRefreshPath({id:'note',replayed:true},value),value.refreshPath);
  assert.throws(()=>learningAuthoringRefreshPath({id:'different-note'},value));
  assert.throws(()=>learningAuthoringRefreshPath({id:'note'}, {...value,refreshPath:'/api/v1/learning/practice/source/?student_id=sibling'}));
});
test('teaching work receipt matches exact session date, source revision, chosen work and command link ID',()=>{
  const value={...action,endpoint:'/api/v1/learning/sessions/source/work?date=2026-10-29',refreshPath:'/api/v1/learning/sessions/source?date=2026-10-29',source:{kind:'session',sourceId:'source',revision:2,fingerprint:'reviewed'},payload:{kind:'json',body:JSON.stringify({expected_revision:2,source_fingerprint:'reviewed',work_kind:'assignment',work_id:'work'})}} as NativePendingAction;
  const receipt={id:'source',date:'2026-10-29',link_id:'command',work_kind:'assignment',work_id:'work',revision:3};
  assert.equal(learningAuthoringRefreshPath(receipt,value),value.refreshPath);
  assert.throws(()=>learningAuthoringRefreshPath(receipt,{...value,refreshPath:'/api/v1/learning/sessions/source?date=2026-10-30'}));
  for(const patch of [{id:'other'},{date:'2026-10-30'},{link_id:'other'},{work_id:'other'},{revision:2}])assert.throws(()=>learningAuthoringRefreshPath({...receipt,...patch},value));
});
const practiceList = {school_id:'school',class_section:{id:'class',label:'Class'},can_publish:true,can_publish_general:true,terms:[{id:'term',name:'Term'}],subjects:[{id:'science',name:'Science'}]} as ClassPracticeList;
const practiceInput = {practiceId:'practice',term:'term',subject:'science',date:'2026-10-29',title:' Observe ',body:' Record your observations. ',due:''};
test('practice publication preserves exact class, term, subject and intentional optional due date',()=>{
  assert.deepEqual(learningPracticePayload(practiceList,practiceInput),{practice_id:'practice',class_section_id:'class',term_id:'term',subject_id:'science',date:'2026-10-29',title:'Observe',body:'Record your observations.',due_at:null});
  assert.equal(learningPracticePayload(practiceList,{...practiceInput,subject:''}).subject_id,null);
});
test('practice cannot publish for unavailable capability, foreign context or an overflowing calendar date',()=>{
  assert.throws(()=>learningPracticePayload({...practiceList,can_publish:false},practiceInput));
  assert.throws(()=>learningPracticePayload({...practiceList,can_publish_general:false},{...practiceInput,subject:''}));
  for(const patch of [{term:'foreign'},{subject:'foreign'},{date:'2026-02-30'},{due:'invalid'},{body:' '},{title:'x'.repeat(181)}])assert.throws(()=>learningPracticePayload(practiceList,{...practiceInput,...patch}));
});
