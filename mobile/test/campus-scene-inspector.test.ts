import assert from 'node:assert/strict';
import test from 'node:test';
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from '../../packages/contracts/src/campus-scenes/types';
import { campusSceneAddCorner, campusSceneChangeCorner, campusSceneConnectorReady, campusSceneDefinitiveImportFailure, campusSceneFloorBelongsToBuilding, campusSceneFloorIntake, campusSceneFloorOf, campusSceneRemoveCorner } from '../src/lib/campus-scene-inspector';

const place=(id:string,kind:string,parent:string|null=null,campus='campus'):CampusSceneSpace=>({id,name:id,kind,campus_id:campus,parent_space_id:parent,code:id,status:'active',revision:2});
const spaces=[place('building','building'),place('wing','wing','building'),place('floor-1','floor','wing'),place('floor-2','floor','building'),place('room','classroom','floor-1'),place('other-building','building'),place('other-floor','floor','other-building')];
const building:CampusSceneElement={id:'drawing-building',kind:'building',label:'Learning building',geometry:{type:'polygon',points:[{x:5,y:5},{x:45,y:5},{x:45,y:45},{x:5,y:45}]},space_id:'building',floor_id:null,review_state:'reviewed'};
const room:CampusSceneElement={id:'room',kind:'room',label:'Office',geometry:{type:'polygon',points:[{x:10,y:10},{x:25,y:10},{x:25,y:25},{x:10,y:25}]},space_id:null,parent_element_id:building.id,floor_id:'floor-1',review_state:'reviewed'};
const document:CampusSceneDocument={schema_version:1,name:'Campus',bounds:{width:100,height:100,unit:'relative'},source:{kind:'manual',label:'Reviewed drawing'},elements:[building,room]};
const connector:CampusSceneElement={id:'entrance',kind:'fixture',label:'Entrance',geometry:{type:'point',points:[{x:12,y:12}]},space_id:null,parent_element_id:building.id,floor_id:null,review_state:'needs_review',navigation_connector:{kind:'entrance',from_floor_id:null,to_floor_id:'floor-1',status:'open',accessible:true}};
const file={uri:'file:///private/plan.png',name:'plan.png',type:'image/png',size:2048,hash:'a'.repeat(64)},intake={file,buildingId:'building',floorId:'floor-1',floorName:'Ground floor',floorCode:'',instructions:'  Reception at the bottom.  ',rights:true,traceOnly:false};

test('floor ancestry follows exact parent IDs through wings and refuses cycles or matching names',()=>{
 assert.equal(campusSceneFloorBelongsToBuilding(spaces[2]!,'building',spaces),true);assert.equal(campusSceneFloorBelongsToBuilding(spaces[6]!,'building',spaces),false);assert.equal(campusSceneFloorOf(spaces[4]!,spaces),'floor-1');
 const cyclic=[place('cycle','wing','loop'),place('loop','wing','cycle'),place('floor','floor','cycle')];assert.equal(campusSceneFloorBelongsToBuilding(cyclic[2]!,'building',cyclic),false);assert.equal(campusSceneFloorOf(cyclic[0]!,cyclic),null);
 assert.equal(campusSceneFloorBelongsToBuilding({...spaces[2]!,name:'building',parent_space_id:'missing'},'building',spaces),false);
});
test('entrance review requires the actual mapped building, current floor and outdoor landing',()=>{
 assert.equal(campusSceneConnectorReady(connector,document,spaces),true);
 for(const change of [{parent_element_id:null},{floor_id:'floor-1'},{navigation_connector:{...connector.navigation_connector!,to_floor_id:'other-floor'}},{navigation_connector:{...connector.navigation_connector!,from_floor_id:'floor-2'}}])assert.equal(campusSceneConnectorReady({...connector,...change},document,spaces),false);
 assert.equal(campusSceneConnectorReady(connector,document,spaces.map(space=>space.id==='floor-1'?{...space,status:'inactive'}:space)),false);
 assert.equal(campusSceneConnectorReady(connector,document,spaces.map(space=>space.id==='floor-1'?{...space,campus_id:'foreign'}:space)),false);
});
test('stairs and lifts require distinct exact floors; stairs can never be marked step-free',()=>{
 const stairs={...connector,floor_id:'floor-1',navigation_connector:{kind:'stairs' as const,from_floor_id:'floor-1',to_floor_id:'floor-2',status:'open' as const,accessible:false}};assert.equal(campusSceneConnectorReady(stairs,document,spaces),true);
 assert.equal(campusSceneConnectorReady({...stairs,navigation_connector:{...stairs.navigation_connector,accessible:true}},document,spaces),false);
 assert.equal(campusSceneConnectorReady({...stairs,navigation_connector:{...stairs.navigation_connector,to_floor_id:'floor-1'}},document,spaces),false);
 assert.equal(campusSceneConnectorReady({...stairs,navigation_connector:{...stairs.navigation_connector,kind:'lift',accessible:true}},document,spaces),true);
});
test('corner edits remain bounded, reset review and preserve the original drawing',()=>{
 const changed=campusSceneChangeCorner(room,0,'x',-500,document);assert.equal(changed.geometry.points[0]!.x,0);assert.equal(changed.review_state,'needs_review');assert.equal(room.geometry.points[0]!.x,10);
 assert.throws(()=>campusSceneChangeCorner(room,0,'x',Infinity,document));assert.throws(()=>campusSceneChangeCorner(room,7,'x',1,document));
 const triangle=campusSceneRemoveCorner(room,1);assert.equal(triangle.geometry.points.length,3);assert.throws(()=>campusSceneRemoveCorner(triangle,0));assert.equal(campusSceneAddCorner(room,document).geometry.points.length,5);assert.throws(()=>campusSceneAddCorner(connector,document));
});
test('floor-plan handoff binds only a mapped building and one of its current floors',()=>{
 const request=campusSceneFloorIntake(document,spaces,intake,4096);assert.equal(request.buildingId,'building');assert.equal(request.floorId,'floor-1');assert.equal(request.instructions,'Reception at the bottom.');assert.equal('newFloor' in request,false);assert.notEqual(request.file,file);assert.equal(document.elements.length,2);
 for(const change of [{buildingId:'other-building'},{floorId:'other-floor'},{rights:false},{floorId:'missing'}])assert.throws(()=>campusSceneFloorIntake(document,spaces,{...intake,...change},4096));
 assert.throws(()=>campusSceneFloorIntake(document,spaces.map(space=>space.id==='floor-1'?{...space,status:'inactive'}:space),intake,4096));
});
test('new floor and tracing are explicit proposal inputs without creating a place',()=>{
 const request=campusSceneFloorIntake(document,spaces,{...intake,floorId:'',floorName:'  First floor ',floorCode:' fl-1 ',traceOnly:true},4096);assert.deepEqual(request.newFloor,{name:'First floor',code:'FL-1'});assert.equal(request.floorId,null);assert.equal(request.traceOnly,true);assert.equal(spaces.length,7);
 for(const change of [{floorName:'x'},{floorCode:'bad space'},{floorCode:'x'.repeat(41)}])assert.throws(()=>campusSceneFloorIntake(document,spaces,{...intake,floorId:'',...change},4096));
});
test('private image handoff requires bounded bytes, supported MIME and an integrity digest',()=>{
 for(const patch of [{file:null},{file:{...file,size:0}},{file:{...file,size:4097}},{file:{...file,hash:'bad'}},{file:{...file,type:'image/heic'}},{instructions:'x'.repeat(1001)}])assert.throws(()=>campusSceneFloorIntake(document,spaces,{...intake,...patch},4096));
 assert.throws(()=>campusSceneFloorIntake(document,spaces,intake,NaN));
});
test('only the owning durable import-failed receipt permits a new attempt message',()=>{
 assert.equal(campusSceneDefinitiveImportFailure({status:500}),false);assert.equal(campusSceneDefinitiveImportFailure({details:{code:'campus_import_failed'}}),false);
 assert.equal(campusSceneDefinitiveImportFailure({details:{code:'campus_import_failed',retry_requires_new_key:true}}),true);assert.equal(campusSceneDefinitiveImportFailure({details:{error:{code:'campus_import_failed'}}}),true);
 assert.equal(campusSceneDefinitiveImportFailure({details:{error:{code:'scene_command_pending'}}}),false);
});
