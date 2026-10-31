import assert from 'node:assert/strict';
import test from 'node:test';
import { gateSharedVisitTime, readGateSharedChanges } from '../src/features/GateSharedVisitPolicy';
const change={revision:4,recorded_at:'2026-10-29T09:00:00Z',title:'Campus visit',starts_at:'2026-10-30T09:00:00Z',ends_at:'2026-10-30T10:00:00Z',state:'confirmed',party_size:3,place_label:'Reception',contact_label:'Campus host'};
test('shared changes preserve full current safe projection and discard all manager/private fields',()=>{
  const result=readGateSharedChanges({changes:[{...change,action:'changed',actor:{id:'private',label:'Internal employee'},guest_name:'Private old guest',person_id:'private',last_movement:{observed_count:3},metadata:{pre_share:'private'}}],changes_has_more:false});
  assert.deepEqual(result,{changes:[change],hasMore:false});assert.equal(JSON.stringify(result).includes('private'),false);
});
test('history is bounded to actual latest25 descending revisions; incomplete or manager history does not become shared history',()=>{
  const changes=Array.from({length:25},(_,i)=>({...change,revision:30-i}));assert.equal(readGateSharedChanges({changes,changes_has_more:true}).changes.length,25);
  for(const data of [{history:changes,history_has_more:true},{changes:[...changes,{...change,revision:1}],changes_has_more:true},{changes:[change,change],changes_has_more:false},{changes:[{...change,revision:2},{...change,revision:3}],changes_has_more:false},{changes:[{...change,ends_at:change.starts_at}],changes_has_more:false},{changes:[{...change,state:'movement_recorded'}],changes_has_more:false}])assert.throws(()=>readGateSharedChanges(data));
  assert.deepEqual(readGateSharedChanges({changes:[],changes_has_more:false}),{changes:[],hasMore:false});
});
test('shared history uses the owning campus timezone rather than the phone timezone',()=>{
  const india=gateSharedVisitTime('2026-10-29T09:00:00Z','Asia/Kolkata'),utc=gateSharedVisitTime('2026-10-29T09:00:00Z','UTC');assert.notEqual(india,utc);assert.equal(gateSharedVisitTime('2026-10-29T09:00:00Z','Invalid/Zone'),'2026-10-29T09:00:00.000Z');
});
