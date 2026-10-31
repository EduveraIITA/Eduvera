#!/usr/bin/env node
/**
 * Repeat-safe, owner-authorized fixture authoring through ordinary domain APIs.
 * Default: read-only plan. --apply explicitly persists the reviewed Aaranya plan.
 * Run from repository root with AARANYA_API_URL pointing to the reviewed runtime.
 * Credentials are read locally and are never written to a receipt or stdout.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AARANYA, PREFIX, createInteriorPlan, materializeInteriorPlan, resourceTypes, inside } from './aaranya-interior-layout.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const expectedBuildings={
 [AARANYA.admin]:{name:'Administration Building',code:'AIT-B-082',levels:2},
 [AARANYA.computing]:{name:'Computing Centre II',code:'AIT-B-067',levels:3},
};
/** One explicit legacy fixture identity; never infer a floor from its name. */
export function teachingFloorCodeUpgrade(space){
 if(!space||space.id!==AARANYA.teaching||space.school_id!==AARANYA.school||space.campus_id!==AARANYA.campus||space.parent_space_id!==AARANYA.computing||space.name!=='Teaching floor'||space.kind!=='floor'||space.status!=='active'||!Number.isSafeInteger(space.revision)||space.revision<1)throw new Error('The exact retained Aaranya Teaching-floor identity changed.');
 if(space.code==='AIT-INT-CC2-F1')return null;
 if(space.code!=='IIITA-CURR-CC2-DEMO-FLOOR')throw new Error('The retained Teaching-floor code was customized; review it without overwriting.');
 const fields=['campus_id','parent_space_id','name','kind','capacity','is_accessible','is_bookable','status'];
 return {...Object.fromEntries(fields.map(key=>[key,space[key]])),code:'AIT-INT-CC2-F1',expected_revision:space.revision};
}
export function mergeInteriorScene(document,elements){
 const replaced=new Set(AARANYA.existingRooms.map(id=>`journey_room_${id}`));
 return {...document,elements:[...document.elements.filter(e=>!e.id.startsWith(PREFIX)&&!replaced.has(e.id)),...elements]};
}
function validatePlan(document,plan,materialized){
 if(mergeInteriorScene(document,materialized.elements).elements.length>2000)throw new Error('The authored plan exceeds the scene element budget.');
 for(const building of plan.buildings)for(const floor of building.floors){
  for(const element of materialized.elements.filter(e=>e.floor_id===floor.key&&e.parent_element_id===building.element.id)){
   for(const p of element.geometry.points)if(!inside(p,building.element.geometry.points))throw new Error(`Outside footprint: ${element.id}`);
   if(element.kind==='path')for(let i=1;i<element.geometry.points.length;i++)for(let t=1;t<20;t++){
    const a=element.geometry.points[i-1],b=element.geometry.points[i],p={x:a.x+(b.x-a.x)*t/20,y:a.y+(b.y-a.y)*t/20};
    if(!inside(p,building.element.geometry.points))throw new Error(`Corridor leaves footprint: ${element.id}`);
   }
  }
 }
 const tags=materialized.resources.filter(r=>r.asset_tag).map(r=>r.asset_tag);
 if(new Set(tags).size!==tags.length)throw new Error('Duplicate resource fixture identity.');
}

class Client {
 constructor(base,origin){this.base=base;this.origin=origin;this.cookies=new Map();}
 async request(path,method='GET',body,key){
  const headers=new Headers({Cookie:[...this.cookies].map(([name,value])=>`${name}=${value}`).join('; '),Origin:this.origin});
  if(method!=='GET'){
   headers.set('X-CSRFToken',this.cookies.get('csrftoken')??'');headers.set('Idempotency-Key',key??randomUUID());
   if(body!==undefined)headers.set('Content-Type','application/json');
  }
  const response=await fetch(this.base+path,{method,headers,...body===undefined?{}:{body:JSON.stringify(body)},signal:AbortSignal.timeout(60000)});
  for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');if(at>0)this.cookies.set(pair.slice(0,at),pair.slice(at+1));}
  const raw=await response.text();let value;try{value=raw?JSON.parse(raw):null;}catch{throw new Error(`${method} ${path}: non-JSON response (${response.status}).`);}
  if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(value).slice(0,1200)}`);
  return value;
 }
 async login(credential){
  await this.request('/api/v1/auth/csrf/');
  const result=await this.request('/api/v1/auth/login/','POST',{identifier:credential.accounts.director.email,password:credential.password});
  if(result.mfa_required)throw new Error('The fixture owner must complete MFA; no bypass is supported.');
  await this.request('/api/v1/auth/active-school/','POST',{school_id:AARANYA.school});
  const context=await this.request('/api/v1/auth/execution-environment/','POST',{mode:'live'});
  if(context?.mode&&context.mode!=='live')throw new Error('Explicit Live fixture scope was not selected.');
 }
 async logout(){await this.request('/api/v1/auth/logout/','POST',{});this.cookies.clear();}
}

export async function run({apply=false,api=process.env.AARANYA_API_URL??'http://127.0.0.1:8000',origin=process.env.AARANYA_API_ORIGIN??'http://127.0.0.1:5173',runtime=resolve(process.env.AARANYA_AUTHORING_STATE??'.runtime/aaranya-building-interiors-20261027'),credentials=resolve(process.env.AARANYA_CREDENTIALS??'.runtime/iiita-campus/credentials.json')}={}){
 const url=new URL(api);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:')throw new Error('This fixture writer is restricted to an explicitly reviewed local runtime.');
 await mkdir(runtime,{recursive:true,mode:0o700});
 const statePath=resolve(runtime,'state.json'),receiptPath=resolve(runtime,'receipt.json'),planPath=resolve(runtime,'plan.json');
 let state;try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={version:1,fixture:'aaranya-building-interiors-20261027',school:AARANYA.school,campus:AARANYA.campus,api,ids:{},keys:{},created:[]};}
 if(state.school!==AARANYA.school||state.campus!==AARANYA.campus||state.api!==api)throw new Error('The retained receipt belongs to a different fixture/runtime. Choose its exact state directory.');
 const save=async()=>{const temp=statePath+'.tmp';await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(temp,statePath);};
 const client=new Client(api.replace(/\/$/,''),origin),base=`/api/v1/schools/${AARANYA.school}`,sceneRoute=`${base}/campus-scenes/${AARANYA.campus}`;
 await client.login(JSON.parse(await readFile(credentials,'utf8')));
 try{
  let setup=await client.request(base+'/institution-setup/'),workspace=await client.request(sceneRoute+'/workspace/');
  if(setup.school.id!==AARANYA.school||setup.school.name!=='Aaranya Institute of Technology'||!setup.campuses.some(c=>c.id===AARANYA.campus&&c.code==='AIT-MAIN'&&c.name==='Aaranya Campus'))throw new Error('Exact owner-authorized fictional Aaranya institution required.');
  for(const [id,expected]of Object.entries(expectedBuildings)){
   const space=setup.spaces.find(p=>p.id===id),element=(workspace.scene?.draft??workspace.scene?.published?.document)?.elements.find(e=>e.space_id===id&&e.kind==='building');
   if(space?.campus_id!==AARANYA.campus||space.parent_space_id!==null||space.name!==expected.name||space.code!==expected.code||element?.levels!==expected.levels)throw new Error('An exact reviewed source building has changed; review before seeding.');
  }
  const document=workspace.scene?.draft??workspace.scene?.published?.document;if(!document)throw new Error('An existing campus scene is required.');
  // Never silently publish another person's unsaved layout edits.
  if(workspace.scene.draft&&hash(workspace.scene.draft)!==hash(workspace.scene.published?.document)&&!state.saved_revision&&(!state.scene_save_request||hash(workspace.scene.draft)!==hash(state.scene_save_request.document)))throw new Error('A different editable campus draft is present. Review it before applying interiors.');
  const plan=createInteriorPlan(document),materialized=materializeInteriorPlan(plan);validatePlan(document,plan,materialized);
  const sourceHash=hash(document.source),outsideHash=hash(mergeInteriorScene(document,[]).elements),footprintsHash=hash(plan.buildings.map(b=>b.element));
  const summary={fixture:plan.fixture,mode:apply?'apply':'read_only_plan',school:AARANYA.school,campus:AARANYA.campus,scene_revision:workspace.scene.revision,buildings:plan.buildings.map(b=>({name:b.element.label,floors:b.floors.map(f=>({name:f.name,rooms:f.rooms.map(r=>({name:r.name,kind:r.kind,existing_id:r.id??null}))}))})),canonical_spaces:materialized.spaces.length,individual_resources:materialized.resources.filter(r=>r.asset_tag).length,pooled_resources:materialized.resources.filter(r=>!r.asset_tag).length,interior_elements:materialized.elements.length,final_scene_elements:mergeInteriorScene(document,materialized.elements).elements.length,source_hash:sourceHash,outside_hash:outsideHash,footprints_hash:footprintsHash,limits:plan.limits};
  await writeFile(planPath,JSON.stringify({...summary,proposal:materialized},null,2)+'\n',{mode:0o600});
  if(!apply){console.log(JSON.stringify(summary,null,2));return summary;}
  if(process.env.AARANYA_INDOOR_SCHEMA_REVIEWED!=='276')throw new Error('The coordinating release owner must confirm native schema276 before applying this fixture (AARANYA_INDOOR_SCHEMA_REVIEWED=276).');
  const readiness=await client.request('/readyz');if(readiness.status!=='ready')throw new Error('The reviewed runtime is not ready.');
  // Strict184 rejects these newly reviewed read-only fields;185 accepts them.
  await client.request(`${sceneRoute}/resources/?space_id=${AARANYA.admin}&tracking_mode=pooled`);
  const teaching=setup.spaces.find(p=>p.id===AARANYA.teaching),teachingUpgrade=teachingFloorCodeUpgrade(teaching);
  if(teachingUpgrade){
   const assignmentsBefore=hash({classes:setup.classes,staff:setup.staff});
   if(state.teaching_floor_upgrade&&hash(state.teaching_floor_upgrade.request)!==hash(teachingUpgrade))throw new Error('The retained floor changed while its exact code upgrade was pending.');
   state.teaching_floor_upgrade??={key:randomUUID(),request:teachingUpgrade,before:{id:teaching.id,name:teaching.name,code:teaching.code,revision:teaching.revision},assignments_hash_before:assignmentsBefore};await save();
   const updated=await client.request(`${base}/institution-setup/spaces/${AARANYA.teaching}/`,'PATCH',state.teaching_floor_upgrade.request,state.teaching_floor_upgrade.key);
   if(teachingFloorCodeUpgrade(updated)!==null||updated.id!==teaching.id||updated.name!==teaching.name)throw new Error('The exact Teaching-floor upgrade was not confirmed.');
   for(const key of ['campus_id','parent_space_id','name','kind','capacity','is_accessible','is_bookable','status'])if(updated[key]!==teaching[key])throw new Error('The floor code upgrade changed unrelated metadata.');
   setup=await client.request(base+'/institution-setup/');
   if(hash({classes:setup.classes,staff:setup.staff})!==assignmentsBefore)throw new Error('Placements changed during the bounded floor-code upgrade.');
   state.teaching_floor_upgrade.after={id:updated.id,name:updated.name,code:updated.code,revision:updated.revision};state.teaching_floor_upgrade.assignments_unchanged=true;await save();
  }
  if(state.published_version&&!state.published_hash&&workspace.scene.published?.version===state.published_version&&hash(workspace.scene.published.document)===state.saved_hash){state.published_hash=hash(workspace.scene.published.document);await save();}
  if(state.published_version){
   const current=workspace.scene.published?.document;
   if(!current||hash(current)!==state.published_hash)throw new Error('The published scene changed after this fixture. It will not be overwritten.');
   const verified=verify(setup,current,state,materialized,sourceHash,outsideHash);
   console.log(JSON.stringify({status:'already_applied',...verified}));return verified;
  }
  if(state.initial_source_hash&&state.initial_source_hash!==sourceHash||state.initial_outside_hash&&state.initial_outside_hash!==outsideHash||state.footprints_hash&&state.footprints_hash!==footprintsHash)throw new Error('Campus source, footprint or unrelated geometry changed during authoring.');
  state.initial_source_hash??=sourceHash;state.initial_outside_hash??=outsideHash;state.footprints_hash??=footprintsHash;state.started_at??=new Date().toISOString();await save();
  for(const spec of materialized.spaces){
   const parent=state.ids[spec.parent]??spec.parent;
   let existing=spec.id?setup.spaces.find(p=>p.id===spec.id):state.ids[spec.key]?setup.spaces.find(p=>p.id===state.ids[spec.key]):setup.spaces.find(p=>p.campus_id===AARANYA.campus&&p.code===spec.code);
   if(existing){
    if(existing.campus_id!==AARANYA.campus||existing.parent_space_id!==parent||existing.kind!==spec.kind||existing.name!==spec.name||existing.status!=='active')throw new Error(`Exact fixture space identity changed: ${spec.key}`);
   }else{
    if(spec.id||state.ids[spec.key])throw new Error(`A retained canonical place is missing: ${spec.key}`);
    state.keys[spec.key]??=randomUUID();await save();
    existing=await client.request(base+'/institution-setup/spaces/','POST',{campus_id:AARANYA.campus,parent_space_id:parent,name:spec.name,code:spec.code,kind:spec.kind,capacity:spec.capacity??null,is_accessible:true,is_bookable:['classroom','laboratory','workshop'].includes(spec.kind)||spec.style==='meeting'},state.keys[spec.key]);
    setup.spaces.push(existing);state.created.push({kind:'space',key:spec.key,id:existing.id});
   }
   state.ids[spec.key]=existing.id;await save();
  }
  for(const [key,spec]of Object.entries(resourceTypes)){
   let existing=setup.resource_types.find(t=>t.code===spec.code);
   if(existing){if(existing.name!==spec.name||existing.category!==spec.category||existing.tracking_mode!==spec.tracking_mode||!existing.is_active)throw new Error(`Exact fixture resource type changed: ${spec.code}`);}
   else{state.keys[`type:${key}`]??=randomUUID();await save();existing=await client.request(base+'/institution-setup/resource-types/','POST',spec,state.keys[`type:${key}`]);setup.resource_types.push(existing);state.created.push({kind:'resource_type',key,id:existing.id});}
   state.ids[`type:${key}`]=existing.id;await save();
  }
  for(const spec of materialized.resources){
   const space=state.ids[spec.space],type=state.ids[`type:${spec.type}`],notes=`Author-designed fictional Aaranya inventory. Fixture ${plan.fixture}; identity ${spec.key}.`;
   let existing=state.ids[`holding:${spec.key}`]?setup.holdings.find(h=>h.id===state.ids[`holding:${spec.key}`]):spec.asset_tag?setup.holdings.find(h=>h.asset_tag===spec.asset_tag):setup.holdings.find(h=>h.notes===notes);
   if(existing){
    if(existing.campus_id!==AARANYA.campus||existing.space_id!==space||existing.resource_type_id!==type||existing.name!==spec.name||existing.quantity!==spec.quantity||existing.asset_tag!==spec.asset_tag||existing.notes!==notes||existing.state!=='available')throw new Error(`An exact fixture holding was changed; review it without overwriting: ${spec.key}`);
   }else{
    if(state.ids[`holding:${spec.key}`])throw new Error(`A retained resource identity is missing: ${spec.key}`);
    state.keys[`holding:${spec.key}`]??=randomUUID();await save();
    existing=await client.request(base+'/institution-setup/assets/','POST',{campus_id:AARANYA.campus,space_id:space,resource_type_id:type,name:spec.name,quantity:spec.quantity,asset_tag:spec.asset_tag,state:'available',notes},state.keys[`holding:${spec.key}`]);setup.holdings.push(existing);state.created.push({kind:'holding',key:spec.key,id:existing.id});
   }
   state.ids[`holding:${spec.key}`]=existing.id;await save();
  }
  workspace=await client.request(sceneRoute+'/workspace/');
  if(state.scene_publish_request&&workspace.scene.published?.version===state.scene_publish_request.expected_revision+1&&hash(workspace.scene.published.document)===state.saved_hash){state.published_version=workspace.scene.published.version;state.published_hash=hash(workspace.scene.published.document);await save();}
  if(state.published_version){const verified=verify(setup,workspace.scene.published.document,state,materialized,sourceHash,outsideHash);console.log(JSON.stringify({status:'recovered_published_receipt',...verified}));return verified;}
  if(hash(mergeInteriorScene(workspace.scene.draft??workspace.scene.published.document,[]).elements)!==outsideHash)throw new Error('Unrelated campus geometry changed before scene save.');
  if(!workspace.scene.draft){state.keys.reopen??=randomUUID();await save();await client.request(sceneRoute+'/reopen/','POST',{expected_revision:workspace.scene.revision,idempotency_key:state.keys.reopen});workspace=await client.request(sceneRoute+'/workspace/');}
  const resolved=materializeInteriorPlan(plan,state.ids),candidate=mergeInteriorScene(workspace.scene.draft,resolved.elements);
  if(hash(candidate.source)!==sourceHash||hash(mergeInteriorScene(candidate,[]).elements)!==outsideHash)throw new Error('Source/unrelated scene preservation failed.');
  if(state.saved_hash&&state.saved_hash!==hash(candidate))throw new Error('The retained save belongs to a different reviewed plan.');
  state.keys.save??=randomUUID();state.keys.publish??=randomUUID();state.saved_hash=hash(candidate);
  state.scene_save_request??={expected_revision:workspace.scene.revision,idempotency_key:state.keys.save,document:candidate};await save();
  if(!state.saved_revision){const saved=await client.request(sceneRoute+'/draft/','PUT',state.scene_save_request);state.saved_revision=saved.revision;await save();}
  state.scene_publish_request??={expected_revision:state.saved_revision,idempotency_key:state.keys.publish};await save();
  if(!state.published_version){const published=await client.request(sceneRoute+'/publish/','POST',state.scene_publish_request);state.published_version=published.version??published.revision;await save();}
  const after=await client.request(sceneRoute+'/published/');setup=await client.request(base+'/institution-setup/');state.published_hash=hash(after.scene.document);state.finished_at=new Date().toISOString();await save();
  const verified=verify(setup,after.scene.document,state,materialized,sourceHash,outsideHash);
  const receipt={...summary,status:'published',published_version:state.published_version,published_hash:state.published_hash,started_at:state.started_at,finished_at:state.finished_at,verified,created:state.created};await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({status:'published',version:state.published_version,...verified}));return receipt;
 }finally{await client.logout();}
}
function verify(setup,document,state,materialized,sourceHash,outsideHash){
 if(hash(document.source)!==sourceHash||hash(mergeInteriorScene(document,[]).elements)!==outsideHash)throw new Error('Published source/outside geometry changed.');
 for(const spec of materialized.spaces)if(!setup.spaces.some(p=>p.id===state.ids[spec.key]&&p.campus_id===AARANYA.campus))throw new Error('A canonical place is missing after publication.');
 for(const spec of materialized.resources)if(!setup.holdings.some(h=>h.id===state.ids[`holding:${spec.key}`]&&h.space_id===state.ids[spec.space]&&h.campus_id===AARANYA.campus))throw new Error('A resource lost its exact room relationship.');
 const fixtures=document.elements.filter(e=>e.id.startsWith(PREFIX)&&e.holding_id);
 for(const e of fixtures)if(!setup.holdings.some(h=>h.id===e.holding_id&&h.space_id===e.space_id))throw new Error('A mapped asset differs from its canonical room.');
 if(teachingFloorCodeUpgrade(setup.spaces.find(p=>p.id===AARANYA.teaching))!==null)throw new Error('The retained Teaching-floor code still needs its bounded upgrade.');
 return {canonical_spaces:materialized.spaces.length,resources:materialized.resources.length,individual_mapped_resources:fixtures.length,scene_elements:document.elements.length,preserved_source:true,preserved_outside_elements:true,existing_room_ids:AARANYA.existingRooms,teaching_floor_code:'AIT-INT-CC2-F1'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw new Error('Only --apply is supported; the default is a read-only plan.');
 await run({apply:process.argv.includes('--apply')});
}
