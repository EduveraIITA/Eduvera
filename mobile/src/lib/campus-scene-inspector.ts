import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from '../../../packages/contracts/src/campus-scenes/types';
import { clampPoint } from '../../../packages/contracts/src/campus-scenes/sceneEditing';
import type { NativePendingFile } from './native-pending-action';

export interface NativeFloorPlanIntakeRequest {file:NativePendingFile;buildingId:string;floorId:string|null;newFloor?:{name:string;code:string};instructions:string;rightsConfirmed:true;traceOnly?:boolean}
export function campusSceneFloorBelongsToBuilding(floor:CampusSceneSpace,buildingId:string,spaces:readonly CampusSceneSpace[]){
 if(floor.kind!=='floor')return false;const seen=new Set([floor.id]);let parent=floor.parent_space_id;
 while(parent&&!seen.has(parent)){if(parent===buildingId)return true;seen.add(parent);parent=spaces.find(space=>space.id===parent)?.parent_space_id??null;}return false;
}
export function campusSceneFloorOf(place:CampusSceneSpace,spaces:readonly CampusSceneSpace[]){
 const seen=new Set<string>();let current:CampusSceneSpace|undefined=place;
 while(current&&!seen.has(current.id)){if(current.kind==='floor')return current.id;seen.add(current.id);current=spaces.find(space=>space.id===current?.parent_space_id);}return null;
}
export function campusSceneConnectorReady(element:CampusSceneElement,document:CampusSceneDocument,spaces:readonly CampusSceneSpace[]){
 const link=element.navigation_connector;if(!link)return true;
 const building=document.elements.find(item=>item.id===element.parent_element_id&&item.kind==='building'&&item.space_id),place=spaces.find(item=>item.id===building?.space_id&&item.status!=='inactive');
 const floor=(id:string|null)=>spaces.some(item=>item.id===id&&item.status!=='inactive'&&item.campus_id===place?.campus_id&&!!place&&campusSceneFloorBelongsToBuilding(item,place.id,spaces));
 return element.kind==='fixture'&&!!place&&floor(link.to_floor_id)&&['open','closed'].includes(link.status)&&(link.kind==='entrance'?link.from_floor_id===null&&element.floor_id===null:(link.kind==='stairs'||link.kind==='lift')&&floor(link.from_floor_id)&&link.from_floor_id!==link.to_floor_id&&element.floor_id===link.from_floor_id&&(link.kind!=='stairs'||!link.accessible));
}
export function campusSceneChangeCorner(element:CampusSceneElement,index:number,axis:'x'|'y',value:number,document:CampusSceneDocument){
 if(!Number.isFinite(value)||!Number.isInteger(index)||index<0||index>=element.geometry.points.length)throw new Error('Choose an existing corner and a finite coordinate.');
 return {...element,review_state:'needs_review' as const,geometry:{...element.geometry,points:element.geometry.points.map((point,position)=>position===index?clampPoint({...point,[axis]:value},document.bounds):point)}};
}
export function campusSceneRemoveCorner(element:CampusSceneElement,index:number){
 const minimum=element.geometry.type==='polygon'?3:element.geometry.type==='polyline'?2:1;
 if(element.geometry.points.length<=minimum||!Number.isInteger(index)||index<0||index>=element.geometry.points.length)throw new Error('Keep the minimum number of corners for this shape.');
 return {...element,review_state:'needs_review' as const,geometry:{...element.geometry,points:element.geometry.points.filter((_,position)=>position!==index)}};
}
export function campusSceneAddCorner(element:CampusSceneElement,document:CampusSceneDocument){
 const points=element.geometry.points,last=points.at(-1),other=element.geometry.type==='polygon'?points[0]:points.at(-2);
 if(element.geometry.type==='point'||points.length>=500||!last||!other)throw new Error('This shape cannot have another corner.');
 return {...element,review_state:'needs_review' as const,geometry:{...element.geometry,points:[...points,clampPoint({x:(last.x+other.x)/2,y:(last.y+other.y)/2},document.bounds)]}};
}
export function campusSceneFloorIntake(document:CampusSceneDocument,spaces:readonly CampusSceneSpace[],values:{file:NativePendingFile|null;buildingId:string;floorId:string;floorName:string;floorCode:string;instructions:string;rights:boolean;traceOnly:boolean},maxBytes:number):NativeFloorPlanIntakeRequest{
 const {file}=values,building=spaces.find(space=>space.id===values.buildingId&&space.status!=='inactive'&&document.elements.some(element=>element.kind==='building'&&element.space_id===space.id)),floor=values.floorId?spaces.find(space=>space.id===values.floorId):null,name=values.floorName.trim(),code=values.floorCode.trim().toUpperCase(),instructions=values.instructions.trim();
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!file||!file.uri||!file.name||!['image/png','image/jpeg','image/webp'].includes(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>maxBytes||!/^[a-f0-9]{64}$/.test(file.hash)||!values.rights||!building||values.floorId&&(!floor||floor.status==='inactive'||floor.campus_id!==building.campus_id||!campusSceneFloorBelongsToBuilding(floor,building.id,spaces))||!values.floorId&&(name.length<2||name.length>160||code&&!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(code))||instructions.length>1000)throw new Error('Choose a mapped building, its current floor or a new floor name, and an authorized PNG, JPEG or WebP inside the image limit.');
 return {file:{...file},buildingId:building.id,floorId:floor?.id??null,...(!floor?{newFloor:{name,code}}:{}),instructions,rightsConfirmed:true,...(values.traceOnly?{traceOnly:true}:{})};
}
export function campusSceneDefinitiveImportFailure(error:unknown){
 const value=error as {details?:{code?:unknown;retry_requires_new_key?:unknown;error?:{code?:unknown}}}|null;
 return value?.details?.code==='campus_import_failed'&&value.details.retry_requires_new_key===true||value?.details?.error?.code==='campus_import_failed';
}
