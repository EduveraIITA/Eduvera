import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminDeparture, CollectorDeparture, CollectorTrip, FamilyDeparture, FamilyJourney, Rider } from '../../packages/contracts/src/wire/features/departure/api';
import { collectorCancellationAvailable, collectorCancellationBody, collectorRiderBody, departureCoordinates, familyJourneyLocation, riderStops, stopFocus } from '../src/features/DepartureJourneyPolicy';
import { departureCollectorSwap, departureFamilyFocus, departureFocusedFirst, departureManagementFocus } from '../src/features/DepartureFocusPolicy';
import { departureMapFrame, departureMapTileUrl, departurePointOnMap, fitDepartureMap, projectDeparturePoint, unprojectDeparturePoint } from '../src/features/DepartureMapPolicy';
import { departureResultReadPath } from '../src/lib/departure-operations';
import { NativePendingActionJournal, type NativePendingAction } from '../src/lib/native-pending-action';
const school='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',tripId='44444444-4444-4444-8444-444444444444',student='55555555-5555-4555-8555-555555555555',key='66666666-6666-4666-8666-666666666666';
const now=Date.parse('2026-10-29T10:00:00Z'),note='Family and school alternatives reviewed';
const rider:Rider={student_id:student,student_name:'Learner',admission_number:'A1',state:'expected',revision:2,boarded_at:null,dropped_at:null,outcome_note:'',stop_id:'a',stop_name:'First stop',stop_sequence:1,planned_time:'15:30'};
const trip={id:tripId,school_id:school,revision:4,assigned_collector_user_id:actor,collector_assignment_status:'accepted',service_date:'2026-10-29',local_date:'2026-10-29',controls_available:true,state:'planned',direction:'to_institution',roster:[rider],stops:[{id:'a',direction:'to_institution',sequence:1,name:'First stop',latitude:'0',longitude:'0',planned_time:null},{id:'b',direction:'to_institution',sequence:2,name:'Campus',latitude:'.01',longitude:'.01',planned_time:null}],latest_location:{latitude:'0',longitude:'0',accuracy_metres:'10',observed_at:new Date(now).toISOString()},location_fresh:true} as CollectorTrip;
const collector=(value=trip)=>({trips:[value],swaps:[]} as unknown as CollectorDeparture);
test('collector cancellation binds current exact assignee, service date, operating window and unoccupied roster',()=>{
  assert.equal(collectorCancellationAvailable(trip,actor,school),true);
  for(const change of [{school_id:other},{assigned_collector_user_id:other},{collector_assignment_status:'pending'},{state:'in_progress'},{controls_available:false},{local_date:'2026-10-30'},{local_date:undefined},{roster:[{...rider,state:'boarded'}]},{roster:[{...rider,state:'exception'}]}])assert.equal(collectorCancellationAvailable({...trip,...change} as CollectorTrip,actor,school),false);
  assert.deepEqual(collectorCancellationBody(trip,collector(),actor,school,` ${note} `),{expected_revision:4,note});
  for(const changed of [{...trip,revision:5},{...trip,roster:[{...rider,revision:3,state:'not_riding' as const}]},{...trip,local_date:'2026-10-30'}])assert.throws(()=>collectorCancellationBody(trip,collector(changed),actor,school,note));
  assert.throws(()=>collectorCancellationBody(trip,collector(),actor,school,'no'));assert.throws(()=>collectorCancellationBody(trip,collector(),actor,school,'x'.repeat(501)));
});
test('rider review uses exact current source, truthful transitions and reasoned exception resolution',()=>{
  const boarding={...trip,state:'boarding' as const};assert.deepEqual(collectorRiderBody(boarding,rider,collector(boarding),actor,school,'boarded',''),{expected_revision:2,state:'boarded',note:''});
  assert.throws(()=>collectorRiderBody(boarding,rider,collector({...boarding,revision:5}),actor,school,'boarded',''));
  assert.throws(()=>collectorRiderBody(boarding,rider,collector(boarding),other,school,'boarded',''));assert.throws(()=>collectorRiderBody(boarding,rider,collector(boarding),actor,school,'dropped',note));
  assert.throws(()=>collectorRiderBody(boarding,rider,collector(boarding),actor,school,'exception',''));
  const concern={...rider,state:'exception' as const,boarded_at:new Date(now).toISOString()},moving={...boarding,state:'in_progress' as const,roster:[concern]};
  assert.throws(()=>collectorRiderBody(moving,concern,collector(moving),actor,school,'not_riding',note));assert.throws(()=>collectorRiderBody(moving,concern,collector(moving),actor,school,'dropped',''));
  assert.equal(collectorRiderBody(moving,concern,collector(moving),actor,school,'dropped',note).state,'dropped');
  const outbound={...trip,direction:'from_institution' as const,state:'in_progress' as const};assert.throws(()=>collectorRiderBody(outbound,rider,collector(outbound),actor,school,'boarded',note));
});
test('location guides stop review using the explicit selected-world clock and never changes rider outcomes',()=>{
  const moving={...trip,state:'in_progress' as const},before=JSON.stringify(moving),groups=riderStops(moving);
  assert.equal(stopFocus(moving,groups,now).nearby,true);assert.equal(stopFocus(moving,groups,now+100_000).nearby,false);assert.equal(stopFocus(moving,groups,Number.NaN).nearby,false);assert.equal(JSON.stringify(moving),before);
  const boarded={...moving,roster:[{...rider,state:'boarded' as const,boarded_at:new Date(now).toISOString()}]};assert.equal(riderStops(boarded)[0]?.action,'School arrival');assert.equal(riderStops(boarded)[0]?.stop.id,'b');
  assert.deepEqual(departureCoordinates({latitude:'0',longitude:'0'}),{latitude:0,longitude:0});assert.equal(departureCoordinates({latitude:null,longitude:null}),null);
});
test('family map and external location continuation end after boarding concern, handover or trip closure, including retained coordinates',()=>{
  const family={state:'in_progress',rider_state:'boarded',latitude:'0',longitude:'0',accuracy_metres:'10',observed_at:new Date(now).toISOString()} as FamilyJourney;
  assert.deepEqual(familyJourneyLocation(family),{latitude:'0',longitude:'0',accuracy_metres:'10',observed_at:new Date(now).toISOString()});
  for(const rider_state of ['expected','exception','not_riding','dropped'])assert.equal(familyJourneyLocation({...family,rider_state}),null);
  for(const state of ['planned','boarding','completed','cancelled'])assert.equal(familyJourneyLocation({...family,state}),null);
});
test('native map projects actual coordinates, fits antimeridian stops and loads only bounded visible HTTPS tiles',()=>{
  for(const point of [{latitude:0,longitude:0},{latitude:25.4,longitude:81.8},{latitude:-50,longitude:179.9}]){const projected=projectDeparturePoint(point,12),roundTrip=unprojectDeparturePoint(projected.x,projected.y,12);assert.ok(Math.abs(point.latitude-roundTrip.latitude)<1e-8);assert.ok(Math.abs(point.longitude-roundTrip.longitude)<1e-8);}
  const template='https://tile.openstreetmap.org/{z}/{x}/{y}.png',frame=departureMapFrame({center:{latitude:0,longitude:0},zoom:15},320,300,template);
  assert.ok(frame.tiles.length>0&&frame.tiles.length<=9);assert.deepEqual(departurePointOnMap({latitude:0,longitude:0},frame),{x:160,y:150});
  assert.equal(departureMapTileUrl(template,2,-1,1),'https://tile.openstreetmap.org/2/3/1.png');assert.equal(departureMapTileUrl(template,2,1,-1),null);assert.equal(departureMapTileUrl(template,20,1,1),null);
  for(const url of ['http://tiles.example/{z}/{x}/{y}.png','file:///{z}/{x}/{y}','https://user:secret@tiles.example/{z}/{x}/{y}','https://tiles.example/tile.png'])assert.equal(departureMapTileUrl(url,2,1,1),null);
  const fit=fitDepartureMap([{latitude:1,longitude:179.9},{latitude:1,longitude:-179.9}],320,300)!;assert.ok(Math.abs(fit.center.longitude)>179);assert.ok(fit.zoom>5);
});
test('focus continuation keeps linked source first and rejects mismatched learner/date/queue or foreign duties',()=>{
  const data={school:{id:school},plans:[{id:'plan',student_id:student,service_date:'2026-10-29'}],requests:[{id:'request'}],trips:[trip],swaps:[{id:'swap',school_id:school,revision:3,requester_user_id:actor,target_user_id:other}]} as unknown as AdminDeparture;
  assert.equal(departureManagementFocus(data,`/areas/departure/manage?section=pickup&plan=plan&student=${student}&date=2026-10-29`).plan?.id,'plan');
  assert.equal(departureManagementFocus(data,`/areas/departure/manage?section=pickup&plan=plan&student=${other}&date=2026-10-29`).planUnavailable,true);
  assert.equal(departureManagementFocus(data,'/areas/departure/manage?section=trips&request=request').requestUnavailable,true);
  assert.equal(departureManagementFocus(data,'/areas/departure/manage?section=roster&swap=swap&swap_revision=2').staleSwap,true);
  assert.equal(departureManagementFocus(data,`/areas/departure/manage?section=roster&trip=${tripId}`).trip?.id,tripId);
  assert.deepEqual(departureFocusedFirst([{id:'a'},{id:'b'},{id:'c'}],'b').map(row=>row.id),['b','a','c']);
  assert.equal(departureCollectorSwap({...collector(),swaps:data.swaps},'swap','2',actor,school).changed,true);assert.equal(departureCollectorSwap({...collector(),swaps:data.swaps},'swap','3',student,school).unavailable,true);
  assert.equal(departureFamilyFocus({journeys:[{id:tripId}],requests:[],plan:null} as unknown as FamilyDeparture,`/areas/departure/plan?trip_id=${tripId}`).tripUnavailable,false);
});
function action(mode:'live'|'simulation'='simulation'):NativePendingAction{return {version:1,domain:'departure',scope:{actorId:actor,schoolId:school,mode,namespaceId:mode==='simulation'?other:null,origin:'http://localhost:3000'},clientId:key,ownerHref:`/areas/departure/operate/${tripId}`,endpoint:`/api/v1/departure/trips/${tripId}/actions/cancel/`,refreshPath:'/api/v1/departure/collector/',method:'POST',payload:{kind:'json',body:JSON.stringify({expected_revision:4,note})},source:{kind:'transport_collector_cancellation',sourceId:tripId,revision:4},phase:'unknown',replayPolicy:'inspect_only',createdAt:new Date(now).toISOString()};}
test('cancellation receipts require actual exact response; matching current GET never settles or repeats unknown intent in either world',async()=>{
  for(const mode of ['live','simulation'] as const){const original=action(mode),result={id:tripId,school_id:school,assigned_collector_user_id:actor,state:'cancelled',revision:5,cancellation_reason:note};assert.equal(departureResultReadPath(result,original),original.refreshPath);
    for(const changed of [{id:other},{school_id:other},{assigned_collector_user_id:other},{revision:6},{cancellation_reason:'another command'}])assert.throws(()=>departureResultReadPath({...result,...changed},original));
    let raw:string|null=JSON.stringify(original),sends=0,reads=0;const journal=new NativePendingActionJournal({scope:original.scope,domain:'departure',storage:{read:async()=>raw,write:async value=>{raw=value;},clear:async()=>{raw=null;}},randomId:()=>key,send:async()=>{sends++;return result;},read:async()=>{reads++;return collector({...trip,state:'cancelled',revision:5});}});await journal.hydrate();await journal.recover({ownerHref:original.ownerHref,assertActive(){},resolveRefreshPath:departureResultReadPath,accepted(){}});assert.equal(sends,0);assert.equal(reads,1);assert.ok(raw);assert.equal(journal.snapshot().action?.phase,'unknown');
  }
});
test('acknowledged cancellation refresh failure survives relaunch with reads only',async()=>{
  const original=action();let raw:string|null=null,sends=0,reads=0;const storage={read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}},context={ownerHref:original.ownerHref,refreshPath:original.refreshPath,assertActive(){},resolveRefreshPath:departureResultReadPath,accepted(){}};
  const first=new NativePendingActionJournal({scope:original.scope,domain:'departure',storage,randomId:()=>key,send:async()=>{sends++;return{id:tripId,school_id:school,assigned_collector_user_id:actor,state:'cancelled',revision:5,cancellation_reason:note};},read:async()=>{reads++;throw new Error('Read offline');}});await first.hydrate();assert.equal(await first.run({endpoint:original.endpoint,body:{expected_revision:4,note},source:original.source,replayPolicy:'inspect_only'},context),false);assert.equal(first.snapshot().action?.phase,'accepted');
  const resumed=new NativePendingActionJournal({scope:original.scope,domain:'departure',storage,randomId:()=>key,send:async()=>{sends++;throw new Error('Must not repeat');},read:async()=>{reads++;return collector();}});await resumed.hydrate();await resumed.recover(context);assert.equal(sends,1);assert.equal(reads,2);assert.equal(raw,null);
});
test('collector rider receipt binds trip, learner, author, exact revision and observation note',()=>{
  const original={...action(),endpoint:`/api/v1/departure/trips/${tripId}/riders/${student}/`,payload:{kind:'json' as const,body:JSON.stringify({expected_revision:2,state:'exception',note})},source:{kind:'transport_collector_rider',sourceId:student,revision:2}},result={trip_id:tripId,student_id:student,school_id:school,recorded_by:actor,state:'exception',revision:3,outcome_note:note};assert.equal(departureResultReadPath(result,original),original.refreshPath);
  for(const changed of [{trip_id:other},{student_id:other},{recorded_by:other},{revision:4},{outcome_note:'another note'}])assert.throws(()=>departureResultReadPath({...result,...changed},original));
});
