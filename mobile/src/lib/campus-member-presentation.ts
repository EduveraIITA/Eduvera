import type { SceneResourceOptions, CampusScenePublished } from '../../../packages/contracts/src/campus-scenes/contracts';
import type { CampusSceneDocument } from '../../../packages/contracts/src/campus-scenes/types';
import type { CampusOperationalProjection } from '../../../packages/contracts/src/campus-operation';
import { campusSceneRecords } from '../../../packages/contracts/src/campus-scene-records';
import { boundCampusAssets, campusActivityRecords, campusAssetLabel } from '../../../packages/contracts/src/campus-operation-presentation';
import { projectSceneEvidence } from '../../../packages/contracts/src/campus-scenes/sceneEvidence';
import { sceneVisibleElements } from '../../../packages/contracts/src/campus-scenes/sceneGeometry';
import type { SceneEvidenceGroup, SceneEvidenceMarker } from '../../../packages/contracts/src/campus-scenes/sceneEvidence.types';

/** The response has no scope field: its exact school/campus/room request owns scope. */
export function campusPooledRoomResources(value:unknown,spaceId:string,page:number):SceneResourceOptions|null{
  if(!value||typeof value!=='object'||!spaceId||!Number.isSafeInteger(page)||page<1)return null;
  const row=value as SceneResourceOptions;
  if(row.page!==page||row.page_size!==20||!Number.isSafeInteger(row.total)||row.total<0||!Array.isArray(row.items)||row.items.length>20||row.items.length>row.total||new Set(row.items.map(item=>item?.id)).size!==row.items.length)return null;
  if(row.items.some(item=>!item||typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.name.trim()||item.space_id!==spaceId||item.tracking_mode!=='pooled'||!Number.isSafeInteger(item.quantity)||(item.quantity??0)<=0||typeof item.unit_label!=='string'||!item.unit_label.trim()||!['available','unavailable'].includes(item.state)))return null;
  return row;
}
/** Record counts remain record counts; only known canonical ancestry places them. */
export function campusMemberMarkers(scene:CampusSceneDocument,places:CampusScenePublished['places'],campusId:string,layer:'none'|'classes'|'events'|'maintenance',data:CampusOperationalProjection|undefined,floorId:string|null):{markers:SceneEvidenceMarker[];groups:SceneEvidenceGroup[]}{
  if(!data||layer==='none')return{markers:[],groups:[]};
  const reviewed={...scene,elements:scene.elements.filter(row=>row.review_state==='reviewed')},records=campusActivityRecords(data.activities.filter(row=>row.layer===layer)),spaces=places.map(place=>({...place,campus_id:campusId}));
  const projections=(['expected','accepted']as const).map(dimension=>projectSceneEvidence({scene:reviewed,spaces,records,campusId,floorId,layer:dimension}));
  const markers=projections.flatMap(value=>value.markers.map(marker=>({...marker,id:`campus-layer:${layer}:${marker.id}`}))),groups=projections.flatMap(value=>value.groups.map(group=>({...group,id:`campus-layer:${layer}:${group.id}`})));
  if(layer==='maintenance'){const visible=new Set(sceneVisibleElements(reviewed.elements,floorId).map(row=>row.id));for(const asset of boundCampusAssets(reviewed,data.assets)){if(!visible.has(asset.element_id)||!['reported_fault','awaiting_verification'].includes(asset.signal.state))continue;markers.push({id:`campus-layer:asset:${asset.element_id}`,elementId:asset.element_id,dimension:'accepted',count:1,label:`${campusAssetLabel(asset)} · ${asset.name}`,summary:'One shared asset status, not a physical measurement.',tone:asset.signal.impact==='not_working'?'fault':'attention'});}}
  return{markers,groups};
}

/** Private administrator evidence is never reconstructed from member layers. */
export function campusAdministratorMarkers(scene:CampusSceneDocument,data:import('../../../packages/contracts/src/campus-view').CampusViewResponse|undefined,campusId:string,layer:import('../../../packages/contracts/src/campus-scenes/sceneEvidence.types').SceneEvidenceLayer,floorId:string|null){
  if(!data||layer==='none')return{markers:[]as SceneEvidenceMarker[],groups:[]as SceneEvidenceGroup[],unlocated:[]as import('../../../packages/contracts/src/campus-scenes/sceneEvidence.types').SceneEvidenceRecord[]};
  const result=projectSceneEvidence({scene:{...scene,elements:scene.elements.filter(row=>row.review_state==='reviewed')},records:campusSceneRecords(data,campusId),spaces:data.spaces,campusId,layer,floorId});
  return{...result,markers:result.markers.map(marker=>({...marker,id:`campus-evidence:${marker.id}`})),groups:result.groups.map(group=>({...group,id:`campus-evidence:${group.id}`}))};
}
