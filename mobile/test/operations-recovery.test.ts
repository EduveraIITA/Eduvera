import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiningIssue, DiningIssueDetail, DiningRecovery } from '../../packages/contracts/src/wire/features/dining/diningApi';
import type { AccommodationRoom, StayRecord, StayRecovery } from '../../packages/contracts/src/wire/features/accommodation/accommodationApi';
import { diningObservedCount, diningOpeningOutsideHours, diningRecoveryBody, reviewedDiningSource } from '../src/lib/dining-session-operations';
import { accommodationInitialInterval, accommodationObservedTime, accommodationPlannedInterval, reviewedAccommodationRoom, reviewedAccommodationStay } from '../src/lib/accommodation-stay-operations';
import { readOperationNow } from '../src/lib/operation-clock';
const id='11111111-1111-4111-8111-111111111111',person='22222222-2222-4222-8222-222222222222',receipt='33333333-3333-4333-8333-333333333333';
const recovery:DiningRecovery={id,revision:7,state:'draft',recovery_only:true,allowed_actions:['reassign']},operator={id:person,label:'Next operator'},coordinator={id:receipt,label:'Next coordinator'};
test('minimal Dining recovery supports explicit coordinator/operator or handler changes without private fields',()=>{
  assert.deepEqual(diningRecoveryBody(recovery,'session',{note:' Restore route ',coordinator}),{expected_revision:7,action:'reassign',note:'Restore route',coordinator_person_id:receipt});
  assert.deepEqual(diningRecoveryBody(recovery,'session',{note:'Change dated team',operator,coordinator}),{expected_revision:7,action:'reassign',note:'Change dated team',operator_person_id:person,coordinator_person_id:receipt});
  assert.deepEqual(diningRecoveryBody(recovery,'issue',{note:'Restore handler',operator}),{expected_revision:7,action:'reassign',note:'Restore handler',handler_person_id:person});
  for(const input of [{note:'Restore route'},{note:'x',operator},{note:'Restore route',operator:{id:'wrong',label:'Wrong'}}])assert.throws(()=>diningRecoveryBody(recovery,'session',input));
  assert.throws(()=>diningRecoveryBody(recovery,'issue',{note:'Restore route',coordinator}));assert.throws(()=>diningRecoveryBody({...recovery,allowed_actions:[]},'session',{note:'Restore route',operator}));
});
test('fresh Dining source must preserve exact ID/revision, recovery projection and current capability',()=>{
  assert.equal(reviewedDiningSource(recovery,recovery,'reassign').revision,7);
  for(const current of [{...recovery,id:person},{...recovery,revision:8},{...recovery,allowed_actions:[]},{...recovery,recovery_only:false}])assert.throws(()=>reviewedDiningSource(recovery,current as DiningRecovery,'reassign'));
  const full={id,revision:7,allowed_actions:['resolve']} as DiningIssue;assert.equal(reviewedDiningSource(full,full,'resolve').id,id);
  assert.throws(()=>reviewedDiningSource<DiningIssueDetail>(full,recovery,'resolve'));
});
test('cumulative Dining count uses actual confirmed time and retains the exact corrected receipt',()=>{
  const source={count_total:12,count_receipt_id:receipt},now='2026-10-29T12:00:00Z';
  assert.deepEqual(diningObservedCount(source,'15','2026-10-29T11:59:00Z',now,false),{count_total:15,observed_at:'2026-10-29T11:59:00Z'});
  assert.deepEqual(diningObservedCount(source,'0','2026-10-29T11:59:00Z',now,true),{count_total:0,observed_at:'2026-10-29T11:59:00Z',supersedes_receipt_id:receipt});
  for(const [total,observed,clock] of [['11',now,now],['1.5',now,now],['10000001',now,now],['15','2026-10-29T12:01:00Z',now],['15',now,''],['15','invalid',now]])assert.throws(()=>diningObservedCount(source,total!,observed!,clock!,false));
});
test('opening reasons are checked against fresh hours and never a missing host-clock substitute',()=>{
  const starts='2026-10-29T12:00:00Z',ends='2026-10-29T13:00:00Z';assert.equal(diningOpeningOutsideHours(starts,ends,starts,''),false);assert.equal(diningOpeningOutsideHours(starts,ends,ends,'Serving late'),true);
  assert.throws(()=>diningOpeningOutsideHours(starts,ends,ends,''));assert.throws(()=>diningOpeningOutsideHours(starts,ends,'','Serving late'));
});
test('Accommodation date defaults require a valid confirmed instant and never construct an invalid end',()=>{
  assert.equal(accommodationInitialInterval(''),null);assert.equal(accommodationInitialInterval('invalid'),null);assert.equal(accommodationInitialInterval('+275760-09-13T00:00:00.000Z'),null);
  assert.deepEqual(accommodationInitialInterval('2026-10-29T12:00:00Z'),{starts:'2026-10-29T12:00:00Z',ends:'2026-10-30T12:00:00.000Z'});
});
test('Accommodation observations and changed ends fail closed on missing/future/invalid times',()=>{
  const now='2026-10-29T12:00:00Z';assert.equal(accommodationObservedTime(now,now),now);
  for(const [observed,clock] of [['2026-10-29T12:01:00Z',now],[now,''],['invalid',now]])assert.throws(()=>accommodationObservedTime(observed!,clock!));
  assert.deepEqual(accommodationPlannedInterval(now,'2026-10-30T12:00:00Z'),{starts_at:now,ends_at:'2026-10-30T12:00:00Z'});
  assert.throws(()=>accommodationPlannedInterval(now,'invalid'));assert.throws(()=>accommodationPlannedInterval(now,now));
});
test('Accommodation source and room preflight reject revision/identity/authority drift without replacing typed entries',()=>{
  const source={id,revision:7,recovery_only:false,allowed_actions:{move_in:true}} as StayRecord;assert.equal(reviewedAccommodationStay(source,source,'move_in').id,id);
  for(const changed of [{...source,id:person},{...source,revision:8},{...source,allowed_actions:{move_in:false}},{id,revision:7,recovery_only:true,allowed_actions:{reassign:true}}])assert.throws(()=>reviewedAccommodationStay(source,changed as StayRecord|StayRecovery,'move_in'));
  const room={id,revision:4,active:true} as AccommodationRoom;assert.equal(reviewedAccommodationRoom(room,room,true).id,id);for(const changed of [undefined,{...room,revision:5},{...room,active:false},{...room,id:person}])assert.throws(()=>reviewedAccommodationRoom(room,changed,true));assert.throws(()=>reviewedAccommodationRoom(room,room,false));
});
test('missing selected-world clock never invokes the Live/device clock supplier',async()=>{
  let hostCalls=0;const context={actorId:person,schoolId:id,mode:'simulation' as const,namespaceId:receipt};
  await assert.rejects(readOperationNow(context,async()=>({}),()=>{hostCalls++;return '2026-10-29T12:00:00Z';}));assert.equal(hostCalls,0);
  await assert.rejects(readOperationNow({...context,namespaceId:null},async()=>{throw new Error('Must not fetch');},()=>{hostCalls++;return '2026-10-29T12:00:00Z';}));assert.equal(hostCalls,0);
});
