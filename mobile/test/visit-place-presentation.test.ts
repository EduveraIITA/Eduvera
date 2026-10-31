import assert from 'node:assert/strict';
import test from 'node:test';
import { filterVisitPlaces, visitPlaceContexts, loadVisitPlaceCatalogue, loadVisitSchedule, placeCategory, visitPlaceFootprint, visitPlaceSchedule, visitScheduleRange, visitScheduleHighlights } from '../src/lib/visit-place-presentation';
const window={startsAt:'2026-11-01T04:30:00Z',endsAt:'2026-11-01T06:30:00Z',timezone:'Asia/Kolkata'};
const row={id:'activity-a',space_id:'room-a',starts_at:window.startsAt,ends_at:window.endsAt,state:'expected'};
test('categories search the full catalogue after paging, not only the first 25 rows',async()=>{
  const calls:number[]=[];
  const places=await loadVisitPlaceCatalogue(async page=>{calls.push(page);return {places:page===1?[{id:'building-a',label:'Computer Centre',kind:'building',campus_label:'Main'}]:[{id:'room-a',label:'Seminar room',kind:'classroom',campus_label:'Main'}],pagination:{places_has_more:page===1}} as any;});
  assert.deepEqual(calls,[1,2]);assert.equal(filterVisitPlaces(places,'rooms','seminar')[0]?.id,'room-a');assert.equal(filterVisitPlaces(places,'buildings','main').length,1);
  assert.equal(placeCategory('unrecognized'),'other');
});
test('non-advancing place pages fail rather than looping or showing partial category totals',async()=>{
  await assert.rejects(loadVisitPlaceCatalogue(async()=>({places:[{id:'a',label:'A',kind:'office'}],pagination:{places_has_more:true}} as any)),/changed while loading/);
});
test('whole-building and floor footprint include descendants and terminate on malformed cycles',()=>{
  const places=[{id:'building',parent_space_id:null},{id:'floor',parent_space_id:'building'},{id:'room',parent_space_id:'floor'},{id:'elsewhere',parent_space_id:null}];
  assert.deepEqual(visitPlaceFootprint('building',places),['building','floor','room']);assert.deepEqual(visitPlaceFootprint('floor',places),['floor','room']);
  assert.deepEqual(visitPlaceFootprint('a',[{id:'a',parent_space_id:'b'},{id:'b',parent_space_id:'a'}]),['a','b']);
});
test('schedule checks use campus dates across UTC midnight and reject invalid/oversized windows',()=>{
  assert.deepEqual(visitScheduleRange({startsAt:'2026-11-01T20:00:00Z',endsAt:'2026-11-02T02:00:00Z',timezone:'Asia/Kolkata'}),{from:'2026-11-02',until:'2026-11-02'});
  for(const value of [{...window,endsAt:window.startsAt},{...window,endsAt:'2027-11-01T06:30:00Z'},{...window,timezone:'Invalid/Zone'}])assert.equal(visitScheduleRange(value),null);
});
test('half-open intervals permit adjacent activities, ignore cancellations and keep unrelated rooms distinct',()=>{
  assert.equal(visitPlaceSchedule(['room-a'],[row],window,true).tone,'warning');
  for(const item of [{...row,ends_at:window.startsAt,starts_at:'2026-11-01T03:00:00Z'},{...row,starts_at:window.endsAt,ends_at:'2026-11-01T08:00:00Z'},{...row,state:'cancelled'},{...row,space_id:'room-b'}])assert.equal(visitPlaceSchedule(['room-a'],[item],window,true).label,'No scheduled conflict');
});
test('partial authority, errors and missing time never produce an availability guarantee',()=>{
  assert.equal(visitPlaceSchedule(['room-a'],[],window,false).label,'Availability not confirmed');
  assert.equal(visitPlaceSchedule(['room-a'],undefined,window,true).label,'Availability not confirmed');
  assert.equal(visitPlaceSchedule(['room-a'],[],undefined,true).label,'Availability not confirmed');
  assert.equal(visitPlaceSchedule(['room-a'],[],window,true).label,'No scheduled conflict');
});
test('schedule coverage requires every page and retains a partial authority result',async()=>{
  const data=await loadVisitSchedule(async page=>({items:[{...row,id:`activity-${page}`}],page,total_pages:2,can_manage:page===1}));
  assert.equal(data.items.length,2);assert.equal(data.complete,false);
});
test('duplicate, malformed or changing schedule pages cannot certify a clear schedule',async()=>{
  await assert.rejects(loadVisitSchedule(async page=>({items:[row],page,total_pages:2,can_manage:true})),/entry could not be verified/);
  await assert.rejects(loadVisitSchedule(async page=>({items:[{...row,starts_at:'invalid'}],page,total_pages:1,can_manage:true})),/entry could not be verified/);
  await assert.rejects(loadVisitSchedule(async page=>({items:[{...row,id:`item-${page}`}],page,total_pages:page===1?2:3,can_manage:true})),/schedule could not be verified/);
});

test('published geometry and parent hierarchy classify a mapped office as a building and distinguish its rooms',()=>{
 const publications=[{campus:{id:'campus-a',name:'Main campus'},scene:{document:{elements:[{id:'building-shape',space_id:'admin',kind:'building',review_state:'reviewed'},{id:'room-shape',space_id:'room',kind:'room',review_state:'reviewed'}]}},places:[{id:'admin',name:'Administration Building',kind:'office',parent_space_id:null},{id:'floor',name:'First floor',kind:'floor',parent_space_id:'admin'},{id:'room',name:'Meeting room',kind:'other',parent_space_id:'floor'}]}] as any;
 const contexts=visitPlaceContexts(publications);assert.equal(contexts.get('admin')?.category,'buildings');assert.equal(contexts.get('room')?.category,'rooms');assert.match(contexts.get('room')!.detail,/Main campus · Administration Building · First floor/);
 assert.equal(filterVisitPlaces([{id:'room',label:'Meeting room',kind:'other'}],'rooms','first floor',contexts).length,1);
});

test('map conflict overlays follow exact room/building ancestry and never claim unavailable or tint unrelated geometry',()=>{
 const publication={campus:{id:'campus'},places:[{id:'building-a',parent_space_id:null},{id:'room-a',parent_space_id:'building-a'},{id:'other',parent_space_id:null}],scene:{document:{elements:[
 {id:'building-shape',kind:'building',space_id:'building-a',review_state:'reviewed'},
 {id:'room-shape',kind:'room',space_id:'room-a',review_state:'reviewed'},
 {id:'other-shape',kind:'building',space_id:'other',review_state:'reviewed'},
 {id:'draft-shape',kind:'room',space_id:'room-a',review_state:'unreviewed'}]}}} as any;
 assert.deepEqual(visitScheduleHighlights(publication,[row],window),[{elementId:'building-shape',tone:'warning'},{elementId:'room-shape',tone:'warning'}]);
 assert.deepEqual(visitScheduleHighlights(publication,[{...row,state:'cancelled'}],window),[]);
 assert.deepEqual(visitScheduleHighlights(publication,undefined,window),[]);
 assert.deepEqual(visitScheduleHighlights(publication,[row]),[]);
});
