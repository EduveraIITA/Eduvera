import assert from 'node:assert/strict';
import test from 'node:test';
import { learningResourceEnvelope, learningSessionMaterials, learningWorkRefreshPath } from '../src/lib/learning-session-policy';
import type { TeachingMaterial, TeachingSessionDetail } from '../../packages/contracts/src/wire/features/teaching-sessions/api';
import type { NativePendingAction } from '../src/lib/native-pending-action';

const material = (id: string, patch: Partial<TeachingMaterial> = {}) => ({ id, title: 'Reading', kind: 'link', url: 'https://example.test', body: null, shared: true, replaces_material_id: null, ...patch }) as TeachingMaterial;
const old = material('old'), current = material('current',{replaces_material_id:'old'}), privateMaterial = material('private',{shared:false});
const source = { session:{id:'session',date:'2026-10-29',state:'expected',source_fingerprint:'fingerprint'},lesson:{revision:3},capabilities:{can_manage:true,can_read_preparation:true},materials:[old,current,privateMaterial] } as TeachingSessionDetail;
test('current and earlier resource versions retain instructor privacy and immutable originals', () => {
  const instructor = learningSessionMaterials(source);
  assert.deepEqual(instructor.current.map(item => item.id),['current','private']); assert.deepEqual(instructor.earlier.map(item => item.id),['old']);
  const learner = learningSessionMaterials({...source,capabilities:{can_manage:false,can_read_preparation:false}});
  assert.deepEqual(learner.current.map(item => item.id),['current']); assert.deepEqual(learner.earlier.map(item => item.id),['old']);
  assert.equal(source.materials.length,3); assert.equal(old.id,'old');
});
test('new resource versions bind current source revision and exact replaced resource', () => {
  const envelope = learningResourceEnvelope(source,{materialId:'new',title:' Updated reading ',shared:true,replaces:current});
  assert.deepEqual(envelope,{expected_revision:3,source_fingerprint:'fingerprint',material_id:'new',title:'Updated reading',shared:true,replaces_material_id:'current'});
  for(const changed of [{...source,capabilities:{can_manage:false,can_read_preparation:true}},{...source,session:{...source.session,state:'cancelled' as const}},{...source,materials:Array.from({length:50},(_,index)=>material(String(index)))}]) assert.throws(() => learningResourceEnvelope(changed,{materialId:'new',title:'Reading',shared:true}));
  for(const replaces of [old,material('foreign')]) assert.throws(() => learningResourceEnvelope(source,{materialId:'new',title:'Reading',shared:true,replaces}));
});
function action(endpoint: string, body: object, kind: 'session'|'assignment' = 'session'): NativePendingAction { return {clientId:'command',endpoint,refreshPath: kind === 'session' ? '/api/v1/learning/sessions/session?date=2026-10-29' : '/api/v1/learning/assignments/assignment/work/learner/',payload:{kind:'json',body:JSON.stringify(body)},source:{kind,sourceId:kind,revision:3,fingerprint:'fingerprint'},method:'POST'} as NativePendingAction; }
test('lesson receipt is bound to exact session, date, reviewed source and saved state', () => {
  const value=action('/api/v1/learning/sessions/session/lesson?date=2026-10-29',{expected_revision:3,source_fingerprint:'fingerprint',state:'reported'}), receipt={id:'session',date:'2026-10-29',revision:4,state:'reported'};
  assert.equal(learningWorkRefreshPath(receipt,value),value.refreshPath);
  assert.throws(()=>learningWorkRefreshPath(receipt,{...value,refreshPath:'/api/v1/learning/sessions/session?date=2026-10-30'}));
  for(const patch of [{id:'other'},{date:'2026-10-30'},{revision:3},{state:'prepared'}])assert.throws(()=>learningWorkRefreshPath({...receipt,...patch},value));
});
test('JSON and private file resource receipts match the retained material identity and visibility', () => {
  const value=action('/api/v1/learning/sessions/session/materials?date=2026-10-29',{expected_revision:3,source_fingerprint:'fingerprint',material_id:'material',shared:false}), receipt={id:'session',date:'2026-10-29',revision:4,material_id:'material',shared:false};
  assert.equal(learningWorkRefreshPath(receipt,value),value.refreshPath);
  assert.throws(()=>learningWorkRefreshPath({...receipt,material_id:'other'},value)); assert.throws(()=>learningWorkRefreshPath({...receipt,shared:true},value));
  const upload={...value,endpoint:value.endpoint.replace('/materials?','/materials/files?'),payload:{kind:'multipart' as const,fields:{expected_revision:'3',source_fingerprint:'fingerprint',material_id:'material',shared:'false'},file:{} as never}};
  assert.equal(learningWorkRefreshPath(receipt,upload),value.refreshPath);
});
test('private draft and upload receipts cannot switch student or canonical person identities', () => {
  for(const [owner,key] of [['work','student_id'],['people','person_id']] as const){
    const base=action(`/api/v1/learning/assignments/assignment/${owner}/learner/`,{expected_revision:3,body:'response'},'assignment'), value={...base,refreshPath:`/api/v1/learning/assignments/assignment/${owner}/learner/`}, receipt={id:'assignment',[key]:'learner',revision:4};
    assert.equal(learningWorkRefreshPath(receipt,value),value.refreshPath); assert.throws(()=>learningWorkRefreshPath({...receipt,[key]:'sibling'},value));
    assert.throws(()=>learningWorkRefreshPath(receipt,{...value,refreshPath:`/api/v1/learning/assignments/assignment/${owner}/sibling/`}));
    const upload={...value,endpoint:value.endpoint+'files/',payload:{kind:'multipart' as const,fields:{expected_revision:'3',file_id:'file'},file:{} as never}};
    assert.equal(learningWorkRefreshPath({...receipt,file_id:'file'},upload),value.refreshPath); assert.throws(()=>learningWorkRefreshPath({...receipt,file_id:'other'},upload));
  }
});
test('submission and review receipts must match original attempt and decision', () => {
  const value=action('/api/v1/learning/assignments/assignment/work/learner/submit/',{expected_revision:3,attempt_id:'attempt'},'assignment'), receipt={id:'assignment',student_id:'learner',revision:4,attempt_id:'attempt',attempt_number:2,manifest_hash:'a'.repeat(64)};
  assert.equal(learningWorkRefreshPath(receipt,value),value.refreshPath); assert.throws(()=>learningWorkRefreshPath({...receipt,attempt_id:'other'},value)); assert.throws(()=>learningWorkRefreshPath({...receipt,manifest_hash:'bad'},value));
  const review={...value,endpoint:value.endpoint.replace('/submit/','/review/'),payload:{kind:'json' as const,body:JSON.stringify({expected_revision:3,attempt_id:'attempt',decision:'request_changes'})}};
  const reviewed={id:'assignment',student_id:'learner',attempt_id:'attempt',decision:'request_changes'};
  assert.equal(learningWorkRefreshPath(reviewed,review),value.refreshPath); assert.throws(()=>learningWorkRefreshPath({...reviewed,decision:'reviewed'},review));
});
