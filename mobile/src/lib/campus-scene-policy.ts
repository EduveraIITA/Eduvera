import type { CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';
const uuid = (v:unknown):v is string => typeof v==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const elementId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v);
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
/** Structural byte boundary; the owning campus service still validates all geometry and authority. */
export function nativeSceneDocument(v:unknown):v is CampusSceneDocument {
 const d=object(v),bounds=object(d?.bounds),source=object(d?.source);
 return !!d&&d.schema_version===1&&text(d.name,160)&&!!bounds&&['width','height'].every(k=>typeof bounds[k]==='number'&&Number.isFinite(bounds[k])&&Number(bounds[k])>0)&&['relative','metres'].includes(String(bounds.unit))&&!!source&&['manual','aerial_image','site_plan','name_search','open_map'].includes(String(source.kind))&&text(source.label,200)&&Array.isArray(d.elements)&&d.elements.length<=2000&&new Set(d.elements.map((e:unknown)=>object(e)?.id)).size===d.elements.length&&d.elements.every((v:unknown)=>{const e=object(v),g=object(e?.geometry);return !!e&&elementId(e.id)&&typeof e.label==='string'&&e.label.length<=160&&['building','room','road','path','tree','fixture','surface'].includes(String(e.kind))&&['reviewed','needs_review'].includes(String(e.review_state))&&!!g&&['polygon','polyline','point'].includes(String(g.type))&&Array.isArray(g.points)&&g.points.length>0&&g.points.length<=500&&g.points.every((v:unknown)=>{const p=object(v);return p&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y);})&&[e.space_id,e.floor_id,e.holding_id].every(id=>id==null||uuid(id))&&(e.parent_element_id==null||elementId(e.parent_element_id));});
}
/** A last-known query can lag an exact accepted receipt. It never downgrades it. */
export function campusSceneSourceState(localRevision:number,queriedRevision:number,sourceFailed:boolean):'current'|'failed'|'changed' {
 if(sourceFailed||!integer(localRevision)||!integer(queriedRevision))return 'failed';
 return queriedRevision>localRevision?'changed':'current';
}
export function campusSceneEditorFocus(document:CampusSceneDocument,elementId:string|null):{selected:string|null;floor:string|null;mode:'2d'|'2.5d'} {
 const element=document.elements.find(row=>row.id===elementId);
 return {selected:element?.id??null,floor:element?.floor_id??null,mode:element?.floor_id?'2d':'2.5d'};
}
export function campusSceneActionAllowed(record:NativePendingAction,scope:NativePendingScope):boolean {
 try {
 const match=new RegExp(`^/api/v1/schools/${encodeURIComponent(scope.schoolId)}/campus-scenes/([^/]+)/(draft|publish|reopen|reviewed-places|imports|imports/lookup|images)/$`).exec(record.endpoint);
 if(!match||!uuid(match[1])||!record.source||record.source.sourceId!==match[1]||record.source.kind!=='campus_scene'||!integer(record.source.revision)||record.replayPolicy!=='same_request'||record.refreshPath!==`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/campus-scenes/${match[1]}/workspace/`)return false;
 if(record.continuation!==undefined){const c=object(record.continuation),f=object(c?.newFloor),body=record.payload.kind==='json'?object(JSON.parse(record.payload.body)):null,t=object(body?.target);if(match[2]!=='imports'||!c||c.kind!=='floor_plan'||!uuid(c.buildingId)||(c.floorId!==null&&!uuid(c.floorId))||!nativeSceneDocument(c.baseDocument)||c.newFloor!==undefined&&(!f||!text(f.name,160)||typeof f.code!=='string'||f.code.length>40)||body?.kind!=='image'||body.purpose!=='floor_plan'||t?.building_id!==c.buildingId||(t?.floor_id??null)!==c.floorId)return false;}
 const action=match[2];if(record.method!==(action==='draft'?'PUT':'POST'))return false;
 if(action==='images') {
   if(record.payload.kind!=='multipart'||!keys(record.payload.fields,['idempotency_key','rights_confirmed'])||record.payload.fields.idempotency_key!==record.clientId||record.payload.fields.rights_confirmed!=='true'||!['image/png','image/jpeg','image/webp'].includes(record.payload.file.type)||record.payload.file.size>4*1024*1024)return false;
 }else{
 if(record.payload.kind!=='json')return false; const body=object(JSON.parse(record.payload.body));if(!body||body.idempotency_key!==record.clientId)return false;
 if(['draft','reviewed-places'].includes(action)){if(body.expected_revision!==record.source.revision||!nativeSceneDocument(body.document)||!keys(body,action==='draft'?['idempotency_key','expected_revision','document']:['idempotency_key','expected_revision','document','rows']))return false;if(action==='reviewed-places'&&(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>2000))return false;}
 else if(['publish','reopen'].includes(action)){if(!keys(body,['idempotency_key','expected_revision'])||body.expected_revision!==record.source.revision)return false;}
 else if(action==='imports/lookup'){if(!keys(body,['idempotency_key','query'])||!text(body.query,120)||body.query.trim().length<4)return false;}
 else if(action==='imports'){
 if(body.kind==='geojson'){if(!keys(body,['idempotency_key','kind','text','label','attribution','rights_confirmed'])||!text(body.text,2*1024*1024)||!text(body.label,160)||!text(body.attribution,500)||body.rights_confirmed!==true)return false;JSON.parse(body.text);}
 else if(body.kind==='location'){const l=object(body.location);if(!keys(body,['idempotency_key','kind','location','radius_metres'])||!l||!text(l.id,100)||!text(l.name,200)||typeof l.latitude!=='number'||typeof l.longitude!=='number'||!Number.isFinite(l.latitude)||!Number.isFinite(l.longitude)||l.source!=='OpenStreetMap'||!integer(body.radius_metres,100)||body.radius_metres>1200)return false;}
 else if(body.kind==='image'){if(!keys(body,['idempotency_key','kind','image_asset_id','label','source_kind','instructions','purpose','target'])||!uuid(body.image_asset_id)||!text(body.label,160)||!['aerial_image','site_plan'].includes(String(body.source_kind))||typeof body.instructions!=='string'||body.instructions.length>1000)return false;const t=object(body.target);if(body.purpose!==undefined&&(body.purpose!=='floor_plan'||body.source_kind!=='site_plan'||!t||!uuid(t.building_id)||!integer(t.expected_building_revision,1)||!!t.floor_id!==!!t.expected_floor_revision||t.floor_id&&(!uuid(t.floor_id)||!integer(t.expected_floor_revision,1))))return false;if(body.purpose===undefined&&body.target!==undefined)return false;}
 else return false;
 }
 }
 if(record.receipt!==undefined){const r=object(record.receipt);if(record.phase!=='accepted'||!r)return false;
 if(['draft','publish','reopen','reviewed-places'].includes(action)){if(r.id!==match[1]||r.revision!==record.source.revision+1||!nativeSceneDocument(r.document))return false;}
 else if(action==='imports'&&!nativeSceneDocument(r.document))return false;
 else if(action==='imports/lookup'&&(!Array.isArray(r.locations)||r.locations.length>100))return false;
 else if(action==='images'){const i=object(r.image);if(!i||i.id!==record.clientId||record.payload.kind!=='multipart'||!integer(i.width,1)||!integer(i.height,1)||i.byte_size!==record.payload.file.size||!text(i.mime_type,80)||i.sha256!==record.payload.file.hash)return false;}
 }
 return true;
 }catch{return false;}
}
export function definitiveCampusImportFailure(error:unknown,action:Pick<NativePendingAction,'domain'|'endpoint'>){const e=object(error),details=object(e?.details),inner=object(details?.error);return action.domain==='campus'&&/\/imports\/(?:lookup\/)?$/.test(action.endpoint)&&(details?.code==='campus_import_failed'&&details.retry_requires_new_key===true||inner?.code==='campus_import_failed');}

/** Exact current whole-campus setup intents; these select presentation only. */
export function campusSceneGuideIntent(href:string){
 const url=new URL(href,'https://thatcampus.invalid'),q=url.searchParams,step=q.get('setup_step');
 if(['setup','setup_step','setup_element'].some(key=>q.getAll(key).length>1)||q.get('setup')!=='whole-campus'||!['find','layout','connect','share'].includes(step??''))return null;
 const raw=q.get('setup_element'),element=raw&&raw.length<=120?raw:null;
 return{step:step!,element,panel:element?null:step==='find'||step==='layout'?'source' as const:step==='connect'?'places' as const:'review' as const,href:'/more/setup/whole-campus?'+new URLSearchParams({...(q.get('campus_id')?{campus_id:q.get('campus_id')!}:{}),step:step!})};
}
