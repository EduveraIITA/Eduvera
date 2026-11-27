import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePendingActionJournal, validateNativePendingAction, type NativePendingAction, type NativePendingScope } from '../src/lib/native-pending-action';
import { campusSceneActionAllowed, definitiveCampusImportFailure, nativeSceneDocument, campusSceneSourceState, campusSceneEditorFocus, retainedCampusMapBoundary } from '../src/lib/campus-scene-policy';
import { campusInteriorBuildings, campusInteriorSetupStage, findCampusInteriorBuilding } from '../src/features/campus/campus-copilot-targets';
import type { CampusSceneDocument, CampusSceneSpace } from '../../packages/contracts/src/campus-scenes/types';
const campus='10000000-0000-4000-8000-000000000001',sceneId='10000000-0000-4000-8000-000000000002',key='10000000-0000-4000-8000-000000000003';
const scope:NativePendingScope={actorId:'actor',schoolId:'school',mode:'simulation',namespaceId:'world',origin:'https://campus.test'},root=`/api/v1/schools/school/campus-scenes/${campus}/`;
const document:CampusSceneDocument={schema_version:1,name:'Current campus',bounds:{width:1000,height:800,unit:'relative'},source:{kind:'manual',label:'Reviewed source'},elements:[{id:'osm_way_42',kind:'building',label:'Library',geometry:{type:'polygon',points:[{x:10,y:10},{x:200,y:10},{x:200,y:100},{x:10,y:100}]},space_id:null,floor_id:null,review_state:'reviewed'}]};
function action():NativePendingAction{return{version:1,domain:'campus',scope,clientId:key,ownerHref:`/more/virtual-campus?campus_id=${campus}&edit=1`,endpoint:root+'draft/',refreshPath:root+'workspace/',method:'PUT',payload:{kind:'json',body:JSON.stringify({idempotency_key:key,expected_revision:7,document})},source:{kind:'campus_scene',sourceId:campus,revision:7},phase:'prepared',replayPolicy:'same_request',createdAt:'2026-10-29T06:00:00Z'};}
test('current source feature identifiers are preserved without inventing canonical place identities',()=>{assert.ok(nativeSceneDocument(document));assert.ok(validateNativePendingAction(action(),scope,'campus'));assert.equal(nativeSceneDocument({...document,elements:[{...document.elements[0],parent_element_id:'bad/id'}]}),false);});
test('campus writes require exact school, campus, source revision, method, key and refresh owner',()=>{for(const patch of [{endpoint:root.replace('/school/','/foreign/')+'draft/'},{refreshPath:root.replace(campus,key)+'workspace/'},{method:'POST'},{source:{kind:'campus_scene',sourceId:campus,revision:8}},{source:{kind:'campus_scene',sourceId:key,revision:7}},{payload:{kind:'json',body:JSON.stringify({idempotency_key:sceneId,expected_revision:7,document})}},{payload:{kind:'json',body:JSON.stringify({idempotency_key:key,expected_revision:7,document,command_id:key})}}])assert.equal(validateNativePendingAction({...action(),...patch},scope,'campus'),false,JSON.stringify(patch));assert.equal(validateNativePendingAction(action(),{...scope,namespaceId:'other-world'},'campus'),false);});
test('accepted campus receipts are bounded to their actual operation; other domains cannot carry them',()=>{const a={...action(),phase:'accepted' as const,receipt:{id:campus,revision:8,document}};assert.ok(campusSceneActionAllowed(a,scope));assert.equal(campusSceneActionAllowed({...a,receipt:{id:'bad',revision:8,document}},scope),false);assert.equal(validateNativePendingAction({...a,domain:'learning'},scope,'learning'),false);});
test('an acknowledged draft retains its exact server document across relaunch and only refreshes',async()=>{let raw:string|null=null,sends=0,reads=0;const storage={read:async()=>raw,write:async(v:string)=>{raw=v;},clear:async()=>{raw=null;}},make=(fail:boolean)=>new NativePendingActionJournal({scope,domain:'campus',storage,randomId:()=>key,send:async()=>{sends++;return{id:campus,revision:8,document};},read:async()=>{reads++;if(fail)throw new Error('lost refresh');return{campus:{id:campus}};}}),a=action(),context={ownerHref:a.ownerHref,refreshPath:a.refreshPath,assertActive(){}};const first=make(true);await first.hydrate();assert.equal(await first.run({endpoint:a.endpoint,method:'PUT',serverKey:'idempotency_key',source:a.source,body:{expected_revision:7,document}},context),false);assert.deepEqual(JSON.parse(raw!).receipt.document,document);const next=make(false);await next.hydrate();let restored:unknown;assert.equal(await next.recover({...context,accepted:(_v,_assert,saved)=>{restored=saved.receipt;}}),true);assert.deepEqual(restored,{id:campus,revision:8,document});assert.equal(sends,1);assert.equal(reads,2);assert.equal(raw,null);});
test('interrupted import retains the original source and floor context, never rebuilds it from current choices',async()=>{let raw:string|null=null,dispatches:NativePendingAction[]=[];const storage={read:async()=>raw,write:async(v:string)=>{raw=v;},clear:async()=>{raw=null;}},make=(fail:boolean)=>new NativePendingActionJournal({scope,domain:'campus',storage,randomId:()=>key,send:async a=>{dispatches.push(a);if(fail)throw new Error('lost');return{document};},read:async()=>({})}),a=action(),context={ownerHref:a.ownerHref,refreshPath:a.refreshPath,assertActive(){}};const input={endpoint:root+'imports/',serverKey:'idempotency_key' as const,source:a.source,body:{kind:'image',image_asset_id:sceneId,label:'Owned plan',source_kind:'site_plan',instructions:'',purpose:'floor_plan',target:{building_id:sceneId,expected_building_revision:3}},continuation:{kind:'floor_plan',buildingId:sceneId,floorId:null,newFloor:{name:'Ground floor',code:'G'},baseDocument:document}};const first=make(true);await first.hydrate();await first.run(input,context);const second=make(false);await second.hydrate();assert.equal(await second.recover(context),true);assert.equal(dispatches.length,2);assert.deepEqual(dispatches[1]?.payload,dispatches[0]?.payload);assert.deepEqual(dispatches[1]?.continuation,input.continuation);assert.equal(dispatches[1]?.clientId,key);});
test('only an owning durable failed import permits a fresh attempt; ordinary rate-limit/network errors retain intent',()=>{const a={domain:'campus' as const,endpoint:root+'imports/'};assert.ok(definitiveCampusImportFailure({details:{error:{code:'campus_import_failed'}}},a));for(const e of [{status:429},{status:500},{details:{error:{code:'generic'}}}])assert.equal(definitiveCampusImportFailure(e,a),false);assert.equal(definitiveCampusImportFailure({details:{error:{code:'campus_import_failed'}}},{...a,endpoint:root+'draft/'}),false);});
test('boundary generation restores the exact outline and releases a failed attempt before generating with a fresh key', async () => {
 const boundary = [
  { latitude: 19, longitude: 73 },
  { latitude: 19, longitude: 73.001 },
  { latitude: 19.001, longitude: 73.001 },
 ];
 const endpoint = root+'imports/';
 const senderInputs: NativePendingAction[] = [];
 let raw: string|null = null;
 const storage = {read:async()=>raw,write:async(value:string)=>{raw=value;},clear:async()=>{raw=null;}};
 const context = {ownerHref:action().ownerHref,refreshPath:root+'workspace/',assertActive(){}};
 const serviceFailure = Object.assign(new Error('The map source could not finish the layout.'), {
  status: 503, details: { error: { code: 'campus_import_failed' } },
 });
 const make = (keyForNewAttempt: string, send: () => unknown) => new NativePendingActionJournal({
  scope, domain:'campus', storage, randomId:()=>keyForNewAttempt,
  send:async command=>{senderInputs.push(command);return send();},read:async()=>({}),
 });
 const first = make(key,()=>{throw new Error('The connection was interrupted.');});
 const body={kind:'map_area',label:'A mapped campus',boundary};
 const input={endpoint, serverKey:'idempotency_key' as const, source:action().source, body};
 await first.hydrate();
 assert.equal(await first.run(input,context),false);
 const next = make(sceneId,()=>{if(senderInputs.length===2)throw serviceFailure;return {document};});
 await next.hydrate();
 const restored = retainedCampusMapBoundary(next.snapshot().action,endpoint);
 assert.deepEqual(restored,boundary);
 assert.equal(retainedCampusMapBoundary(next.snapshot().action,endpoint.replace(campus,sceneId)),null);
 assert.equal(await next.recover(context),false);
 assert.deepEqual(senderInputs[1]?.payload,senderInputs[0]?.payload);
 assert.equal(next.snapshot().action,null);
 assert.equal(next.snapshot().error,serviceFailure.message);
 assert.equal(await next.run({...input,body:{...body,boundary:restored}},context),true);
 assert.equal(senderInputs[2]?.clientId,sceneId);
 assert.deepEqual(retainedCampusMapBoundary(senderInputs[2]!,endpoint),boundary);
});
test('source failure and newer revision lock edits while an older query never downgrades an accepted receipt',()=>{
 assert.equal(campusSceneSourceState(7,7,false),'current');assert.equal(campusSceneSourceState(8,7,false),'current');
 assert.equal(campusSceneSourceState(7,8,false),'changed');assert.equal(campusSceneSourceState(7,7,true),'failed');
 assert.equal(campusSceneSourceState(7,Number.NaN,false),'failed');
});
test('scene receipts bind exact campus and one revision advancement, not merely an arbitrary valid scene UUID',()=>{
 const accepted={...action(),phase:'accepted' as const,receipt:{id:campus,revision:8,document}};
 assert.ok(campusSceneActionAllowed(accepted,scope));
 for(const receipt of [{id:sceneId,revision:8,document},{id:campus,revision:7,document},{id:campus,revision:9,document}])assert.equal(campusSceneActionAllowed({...accepted,receipt},scope),false);
});
test('current 200-character source labels remain retainable and blank optional new-floor codes stay valid',()=>{
 assert.ok(nativeSceneDocument({...document,source:{...document.source,label:'x'.repeat(200)}}));
 assert.equal(nativeSceneDocument({...document,source:{...document.source,label:'x'.repeat(201)}}),false);
 const continuation={kind:'floor_plan',buildingId:sceneId,floorId:null,newFloor:{name:'First floor',code:''},baseDocument:document};
 const record={...action(),endpoint:root+'imports/',method:'POST' as const,payload:{kind:'json' as const,body:JSON.stringify({idempotency_key:key,kind:'image',image_asset_id:sceneId,label:'Plan',source_kind:'site_plan',instructions:'',purpose:'floor_plan',target:{building_id:sceneId,expected_building_revision:3}})},continuation};
 assert.ok(validateNativePendingAction(record,scope,'campus'));
 assert.equal(validateNativePendingAction({...record,continuation:{...continuation,buildingId:campus}},scope,'campus'),false);
 assert.equal(validateNativePendingAction({...action(),continuation},scope,'campus'),false);
});
test('image acknowledgement uses its command id and exact original content before journal recovery can release bytes',()=>{
 const file={uri:'file:///private/fixture.png',name:'fixture.png',type:'image/png',size:100,hash:'a'.repeat(64)};
 const record={...action(),endpoint:root+'images/',method:'POST' as const,phase:'accepted' as const,payload:{kind:'multipart' as const,fields:{idempotency_key:key,rights_confirmed:'true'},file},receipt:{image:{id:key,mime_type:'image/png',width:5,height:5,byte_size:100,sha256:file.hash}}};
 assert.ok(validateNativePendingAction(record,scope,'campus'));
 for(const image of [{...record.receipt.image,id:sceneId},{...record.receipt.image,byte_size:101},{...record.receipt.image,sha256:'b'.repeat(64)}])assert.equal(validateNativePendingAction({...record,receipt:{image}},scope,'campus'),false);
});
test('opening an exact indoor element selects its recorded floor and plan mode',()=>{
 const indoor={...document,elements:[...document.elements,{...document.elements[0]!,id:'room_1',kind:'room' as const,floor_id:sceneId}]};
 assert.deepEqual(campusSceneEditorFocus(indoor,'room_1'),{selected:'room_1',floor:sceneId,mode:'2d'});
 assert.deepEqual(campusSceneEditorFocus(indoor,'osm_way_42'),{selected:'osm_way_42',floor:null,mode:'2.5d'});
 assert.deepEqual(campusSceneEditorFocus(indoor,'missing'),{selected:null,floor:null,mode:'2.5d'});
});
test('Assistant opens the next available interior setup step for the selected campus',()=>{
 const building={...document.elements[0]!,space_id:sceneId};
 const linked={...document,elements:[building]};
 const active=[{id:sceneId,status:'active' as const}];
 assert.equal(campusInteriorSetupStage(linked,active,false),'reopen');
 assert.equal(campusInteriorSetupStage(linked,active,true),'indoor');
 assert.equal(campusInteriorSetupStage(linked,[{id:sceneId,status:'inactive'}],true),'preview');
 assert.equal(campusInteriorSetupStage(linked,[{id:key,status:'active'}],true),'preview');
 assert.equal(campusInteriorSetupStage(document,[],true),'assisted');
 assert.equal(campusInteriorSetupStage({...document,elements:[]},[],true),'map');
 assert.equal(campusInteriorSetupStage({...document,source:{...document.source,image_asset_id:key},elements:[]},[],true),'preview');
});
test('the indoor plan source requires one exact authorized linked building',()=>{
 const library:CampusSceneSpace={id:sceneId,campus_id:campus,parent_space_id:null,name:'Main Library',code:'LIBRARY',kind:'library',status:'active'};
 const alternate:CampusSceneSpace={...library,id:key,name:'West Library',code:'LIB-WEST'};
 const draft={...document,elements:[{...document.elements[0]!,space_id:sceneId},{...document.elements[0]!,id:'west',space_id:key}]};
 const spaces=[library,alternate],buildings=campusInteriorBuildings(draft,spaces);
 assert.equal(findCampusInteriorBuilding(buildings,spaces,' main library ')?.space_id,sceneId);
 assert.equal(findCampusInteriorBuilding(buildings,spaces,'lib-west')?.space_id,key);
 assert.equal(findCampusInteriorBuilding(buildings,spaces,'Library'),undefined);
 assert.equal(findCampusInteriorBuilding(buildings,spaces,'Old Library'),undefined);
 assert.equal(findCampusInteriorBuilding(campusInteriorBuildings(draft,[library]),[library],'West Library'),undefined);
});
test('the retained public download binds consent and the exact campus, building and floor',()=>{
 const live={...scope,mode:'live' as const,namespaceId:null};
 const payload={idempotency_key:key,source_id:'lulu-lucknow-first',rights_confirmed:true,
  target:{building_id:sceneId,expected_building_revision:4,floor_id:campus,expected_floor_revision:6}};
 const download:NativePendingAction={...action(),scope:live,method:'POST',endpoint:root+'imports/floor-plan-download/',
  payload:{kind:'json',body:JSON.stringify(payload)},continuation:{kind:'public_floor_plan',buildingId:sceneId,floorId:campus,floorLabel:'First Floor'}};
 assert.ok(validateNativePendingAction(download,live,'campus'));
 assert.equal(campusSceneActionAllowed(download,scope),false);
 for(const patch of [{rights_confirmed:false},{source_id:'https://plan.test/a.jpg'},{target:{...payload.target,floor_id:undefined}}])
  assert.equal(campusSceneActionAllowed({...download,payload:{kind:'json',body:JSON.stringify({...payload,...patch})}},live),false);
 const receipt={image:{id:sceneId,mime_type:'image/jpeg',width:20,height:20,sha256:'a'.repeat(64),byte_size:1300},
  label:'LuLu Mall Lucknow · First Floor',source_url:'https://plan.test/1.jpg',replayed:true};
 const accepted={...download,phase:'accepted' as const,receipt};
 assert.ok(validateNativePendingAction(accepted,live,'campus'));
 assert.equal(campusSceneActionAllowed({...accepted,receipt:{...receipt,source_url:'https://user:pass@plan.test/1.jpg'}},live),false);
});
