import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AARANYA, PREFIX, area, clippedRegions, createInteriorPlan, inside, materializeInteriorPlan } from './aaranya-interior-layout.mjs';
import { mergeInteriorScene, teachingFloorCodeUpgrade } from './seed-aaranya-building-interiors.mjs';

const source=JSON.parse(await readFile(new URL('../test/fixtures/aaranya-interior-buildings.json',import.meta.url),'utf8'));
const plan=createInteriorPlan(source),mapped=materializeInteriorPlan(plan);

await test('concave clipping produces separate regions rather than a fake room across a courtyard',()=>{
 const u=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:7,y:10},{x:7,y:3},{x:3,y:3},{x:3,y:10},{x:0,y:10}];
 const regions=clippedRegions(u,[{a:0,b:-1,c:-5},{a:0,b:1,c:9}]);
 assert.equal(regions.length,2);assert.equal(regions.reduce((sum,p)=>sum+area(p),0),24);
 assert.ok(regions.every(poly=>poly.every(p=>inside(p,u))));
});

await test('the two retained irregular footprints are fully partitioned into rooms and circulation on every floor',()=>{
 assert.deepEqual(plan.buildings.map(b=>b.floors.length),[2,3]);
 assert.equal(plan.buildings.flatMap(b=>b.floors.flatMap(f=>f.rooms)).length,61);
 for(const b of plan.buildings)for(const f of b.floors){
  const covered=f.rooms.reduce((sum,r)=>sum+area(r.local),0)+f.halls.reduce((sum,p)=>sum+area(p),0);
  assert.ok(Math.abs(covered-area(b.outline))<.002,`${f.key} has unassigned or double-assigned floor area`);
  for(const r of f.rooms){assert.ok(inside(r.door,r.local));assert.ok(r.local.every(p=>inside(p,b.outline)));}
 }
});

await test('all indoor paths and furniture anchors stay within their exact retained building',()=>{
 for(const b of plan.buildings)for(const f of b.floors){
  for(const e of mapped.elements.filter(e=>e.floor_id===f.key&&e.parent_element_id===b.element.id)){
   assert.ok(e.geometry.points.every(p=>inside(p,b.element.geometry.points)),`${e.id} anchor outside building`);
   if(e.kind==='path')for(let i=1;i<e.geometry.points.length;i++)for(let sample=0;sample<=20;sample++){
    const a=e.geometry.points[i-1],c=e.geometry.points[i],t=sample/20;
    assert.notDeepEqual(a,c,`${e.id} repeats a consecutive walking vertex`);
    assert.ok(inside({x:a.x+(c.x-a.x)*t,y:a.y+(c.y-a.y)*t},b.element.geometry.points),`${e.id} crosses outside footprint`);
   }
  }
 }
});

await test('desk, chair, computer and storage footprints fit their canonical room',()=>{
 const keys=new Set(['desk','chair','computer','cabinet','meeting_table','server_rack','printer','projector','toilet','washbasin','whiteboard']);
 for(const b of plan.buildings)for(const f of b.floors)for(const r of f.rooms){
  assert.ok(mapped.elements.some(e=>e.kind==='fixture'&&e.space_id===r.key&&!['door','window'].includes(e.asset_key)),`${r.key} has no functional furnishings`);
  for(const e of mapped.elements.filter(e=>e.space_id===r.key&&keys.has(e.asset_key))){
   const angle=e.rotation_deg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),p=e.geometry.points[0],width=Number(e.width),depth=Number(e.depth);
   for(const [x,y]of[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]])assert.ok(inside({x:p.x+x*c-y*s,y:p.y+x*s+y*c},r.polygon),`${e.id} protrudes outside room`);
  }
 }
});

await test('each floor has one connected walking graph with a branch into every room',()=>{
 const key=p=>`${p.x.toFixed(6)},${p.y.toFixed(6)}`;
 for(const b of plan.buildings)for(const f of b.floors){
  const graph=new Map(),endpoints=new Map();
  for(const e of mapped.elements.filter(e=>e.floor_id===f.key&&e.navigation)){
   const keys=e.geometry.points.map(key);for(const k of keys)if(!graph.has(k))graph.set(k,new Set());
   for(let i=1;i<keys.length;i++){graph.get(keys[i-1]).add(keys[i]);graph.get(keys[i]).add(keys[i-1]);}
   if(e.navigation.end_space_id)endpoints.set(e.navigation.end_space_id,keys.at(-1));
  }
  const reached=new Set(),queue=[graph.keys().next().value];
  while(queue.length){const k=queue.shift();if(reached.has(k))continue;reached.add(k);queue.push(...graph.get(k));}
  for(const r of f.rooms)assert.ok(reached.has(endpoints.get(r.key)),`${r.key} is disconnected`);
  for(const p of[...f.connectors.stairs,f.connectors.lift])assert.ok(reached.has(key(b.basis.world(p))),`${f.key} connector is disconnected`);
 }
});

await test('existing academic identities survive and asset links resolve to exact rooms with truthful pooled counts',()=>{
 const existing=mapped.spaces.filter(s=>s.id).map(s=>s.id);
 assert.deepEqual(existing,[AARANYA.teaching,...AARANYA.existingRooms]);
 const ids=Object.fromEntries(mapped.spaces.map((s,i)=>[s.key,s.id??`space-${i}`]));
 for(const r of mapped.resources)ids[`holding:${r.key}`]=`holding-${r.key}`;
 const resolved=materializeInteriorPlan(plan,ids),tags=resolved.resources.filter(r=>r.asset_tag).map(r=>r.asset_tag);
 assert.equal(tags.length,new Set(tags).size);
 for(const r of resolved.resources){
  if(r.asset_tag){const fixture=resolved.elements.find(e=>e.holding_id===ids[`holding:${r.key}`]);assert.ok(fixture);assert.equal(fixture.space_id,ids[r.space]);assert.equal(r.quantity,1);}
  else{const symbols=resolved.elements.filter(e=>e.space_id===ids[r.space]&&e.asset_key===r.type);assert.equal(symbols.length,r.quantity);}
 }
 const lifts=resolved.elements.filter(e=>e.navigation_connector?.kind==='lift');assert.equal(lifts.length,2);
 assert.ok(lifts.every(e=>e.holding_id&&e.navigation_connector.from_floor_id===ids[e.id.includes('ADM')?'ADM_F0':'CC2_F0']&&e.navigation_connector.to_floor_id===ids[e.id.includes('ADM')?'ADM_F1':'CC2_F1']));
 assert.ok(resolved.elements.some(e=>e.id===PREFIX+'CC2_F2_LIFT_SHAFT'&&!e.navigation_connector&&!e.holding_id));
});

await test('merge is repeat-safe and preserves every unrelated scene element and source field',()=>{
 const unrelated={id:'other-room',kind:'room',label:'Unrelated published room',extra:'retained'},old={id:`journey_room_${AARANYA.existingRooms[0]}`,geometry:{old:true}};
 const before={...source,source:{...source.source,notes:'Keep private acquisition provenance'},elements:[...source.elements,unrelated,old]};
 const first=mergeInteriorScene(before,mapped.elements),second=mergeInteriorScene(first,mapped.elements);
 assert.deepEqual(second,first);assert.deepEqual(first.source,before.source);
 assert.equal(first.elements.find(e=>e.id==='other-room'),unrelated);
 assert.deepEqual(first.elements.filter(e=>source.elements.some(b=>b.id===e.id)),source.elements);
 assert.equal(first.elements.filter(e=>e.id===old.id).length,1);
});

await test('the retained Teaching-floor upgrade changes only its exact legacy code and respects custom metadata',()=>{
 const before={id:AARANYA.teaching,school_id:AARANYA.school,campus_id:AARANYA.campus,parent_space_id:AARANYA.computing,name:'Teaching floor',code:'IIITA-CURR-CC2-DEMO-FLOOR',kind:'floor',capacity:null,is_accessible:false,is_bookable:false,status:'active',revision:2,attributes:{retained:true}};
 const request=teachingFloorCodeUpgrade(before);
 assert.equal(request.code,plan.buildings[1].floors[1].code);assert.equal(request.expected_revision,before.revision);
 for(const field of ['campus_id','parent_space_id','name','kind','capacity','is_accessible','is_bookable','status'])assert.equal(request[field],before[field]);
 assert.equal(teachingFloorCodeUpgrade({...before,code:request.code,revision:3}),null);
 for(const change of[{id:'different-identity'},{campus_id:'other-campus'},{school_id:'other-school'},{parent_space_id:AARANYA.admin},{name:'First floor'},{kind:'office'},{code:'CUSTOM-FLOOR'},{status:'inactive'}])assert.throws(()=>teachingFloorCodeUpgrade({...before,...change}));
 assert.deepEqual(before.attributes,{retained:true});
});
