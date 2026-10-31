import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from '../../../packages/contracts/src/campus-scenes/types';
import { clampSceneViewport, fitSceneViewport, projectScenePoint, sceneElementHeight, scenePointBounds, sceneRenderBounds, sceneRoofFaces, sceneUnitScale, sceneViewportInsets, zoomSceneViewport, type SceneBounds, type SceneSize, type SceneViewport, type SceneViewMode } from '../../../packages/contracts/src/campus-scenes/sceneGeometry';
import { fitFocusedSceneViewport, resizeSceneViewport, type SceneViewportFocus } from '../../../packages/contracts/src/campus-scenes/sceneViewportFocus';
import { scenePlaceFocus } from '../../../packages/contracts/src/campus-scenes/scenePlaceCamera';
import { isSceneIndoorAssetKey, sceneIndoorFootprint } from '../../../packages/contracts/src/campus-scenes/sceneIndoorAssets';
export interface CampusCamera {zoom:number;x:number;y:number;initialized:boolean}
export const initialCampusCamera:CampusCamera={zoom:1,x:0,y:0,initialized:false};
export const validCampusCameraBounds=(value:SceneBounds|null|undefined):value is SceneBounds=>!!value&&[value.x,value.y,value.width,value.height].every(Number.isFinite)&&value.width>0&&value.height>0;
/** A published floor keeps authored global coordinates, but its padding scales
 * with that floor instead of the outdoor campus's decorative unit estimate. */
export function nativeCampusFramingBounds(scene:CampusSceneDocument,elements:readonly CampusSceneElement[],mode:SceneViewMode,options:{publishedInterior:boolean;outline?:readonly CampusScenePoint[]|null;viewBounds?:SceneBounds|null}):SceneBounds{
  if(options.publishedInterior){const points=[...options.outline??[],...elements.flatMap(row=>row.geometry.points)].map(point=>projectScenePoint(point,0,mode));if(points.length&&points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))){const extent=scenePointBounds(points);if(validCampusCameraBounds(extent)){const padding=Math.max(extent.width,extent.height)*.06;return{x:extent.x-padding,y:extent.y-padding,width:extent.width+padding*2,height:extent.height+padding*2};}}}
  return validCampusCameraBounds(options.viewBounds)?options.viewBounds:sceneRenderBounds({...scene,elements:[...elements]},mode);
}
/** Interior focus uses the floor's scale for breathing room, never the outdoor
 * decorative unit. Geometry and exact canonical place/resource links stay intact. */
export function nativeCampusPlaceFocus(scene:CampusSceneDocument,elementId:string|null,mode:SceneViewMode,floorId:string|null):SceneViewportFocus|null{
  if(!floorId)return scenePlaceFocus(scene,elementId,mode,null);
  const floor=scene.elements.filter(element=>element.floor_id===floorId),selected=floor.find(element=>element.id===elementId);
  if(!selected||!['building','room','surface','fixture'].includes(selected.kind))return null;
  const unit=sceneUnitScale(scene),elements=selected.space_id?floor.filter(element=>element.space_id===selected.space_id):[selected];
  const points=elements.flatMap(element=>{
    if(element.kind==='fixture'&&isSceneIndoorAssetKey(element.asset_key))return sceneIndoorFootprint(element,unit).map(point=>projectScenePoint(point,0,mode));
    const height=sceneElementHeight(element,unit);
    return [...element.geometry.points.flatMap(point=>[projectScenePoint(point,0,mode),projectScenePoint(point,height,mode)]),...(mode==='2.5d'?sceneRoofFaces(element.geometry.points,height,element.roof,unit).flat():[])];
  });
  if(!points.length||points.some(point=>!Number.isFinite(point.x)||!Number.isFinite(point.y)))return null;
  const extent=scenePointBounds(points),floorBounds=scenePointBounds(floor.flatMap(element=>element.geometry.points).map(point=>projectScenePoint(point,0,mode)));
  const padding=Math.max(.01,Math.max(floorBounds.width,floorBounds.height)*.02,Math.max(extent.width,extent.height)*.2);
  const bounds={x:extent.x-padding,y:extent.y-padding,width:extent.width+padding*2,height:extent.height+padding*2};
  return validCampusCameraBounds(bounds)?{key:JSON.stringify([selected.space_id??selected.id,floorId,mode,bounds]),bounds}:null;
}
const close=(a:number,b:number)=>Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
export const sameCampusCamera=(a:CampusCamera,b:CampusCamera)=>a.initialized===b.initialized&&close(a.zoom,b.zoom)&&close(a.x,b.x)&&close(a.y,b.y);
const fittedCamera=(camera:CampusCamera)=>camera.initialized&&close(camera.zoom,1)&&close(camera.x,0)&&close(camera.y,0);
export function nativeCampusCameraFromViewport(viewport:SceneViewport,size:SceneSize,bounds:SceneBounds):CampusCamera{const fit=fitSceneViewport(size,bounds);return{zoom:viewport.scale/fit.scale,x:(size.width/2-viewport.x)/viewport.scale-(bounds.x+bounds.width/2),y:(size.height/2-viewport.y)/viewport.scale-(bounds.y+bounds.height/2),initialized:true};}
export function nativeCampusCameraViewport(camera:CampusCamera,size:SceneSize,bounds:SceneBounds):SceneViewport{const fit=fitSceneViewport(size,bounds),scale=fit.scale*Math.max(1,Math.min(8,Number.isFinite(camera.zoom)?camera.zoom:1)),x=Number.isFinite(camera.x)?camera.x:0,y=Number.isFinite(camera.y)?camera.y:0;return clampSceneViewport({scale,x:size.width/2-(bounds.x+bounds.width/2+x)*scale,y:size.height/2-(bounds.y+bounds.height/2+y)*scale},size,bounds);}
export function nativeCampusConstrainCamera(camera:CampusCamera,size:SceneSize,bounds:SceneBounds):CampusCamera{return nativeCampusCameraFromViewport(nativeCampusCameraViewport(camera,size,bounds),size,bounds);}
type Intent='focus'|'fit'|'overview'|'manual';
export interface NativeCampusCameraFrame {key:string;size:SceneSize;bounds:SceneBounds;intent:Intent;viewport:SceneViewport;emitted:CampusCamera}
export interface NativeCampusCameraInput {key:string;size:SceneSize;bounds:SceneBounds;camera:CampusCamera;focus?:SceneBounds|null;overview:boolean}
const sameSize=(a:SceneSize,b:SceneSize)=>a.width===b.width&&a.height===b.height&&a.topInset===b.topInset&&a.bottomInset===b.bottomInset;
const automatic=(intent:Intent,input:NativeCampusCameraInput)=>{const fit=fitSceneViewport(input.size,input.bounds);if(intent==='focus'&&validCampusCameraBounds(input.focus))return fitFocusedSceneViewport(input.size,input.focus,input.bounds);if(intent==='overview'&&input.size.width<600&&input.size.height>input.size.width){const inset=sceneViewportInsets(input.size);return zoomSceneViewport(fit,{x:input.size.width/2,y:inset.top+inset.height/2},2.85,input.size,input.bounds);}return fit;};
/** One presentation frame, driven by actual numeric host dimensions. A false
 * initialized acknowledgement is a fresh reset even after a child framed its
 * new selection in the same React effect batch. No scene object identity or
 * second navigation/camera history is retained. */
export function resolveNativeCampusCamera(previous:NativeCampusCameraFrame|null,input:NativeCampusCameraInput):{frame:NativeCampusCameraFrame;camera:CampusCamera;changed:boolean}{
  const defaultIntent:Intent=validCampusCameraBounds(input.focus)?'focus':input.overview?'overview':'fit';
  const targetChanged=!!previous&&previous.key!==input.key,reset=!input.camera.initialized;
  const external=!!previous&&input.camera.initialized&&!sameCampusCamera(input.camera,previous.emitted);
  let intent:Intent,viewport:SceneViewport;
  if(targetChanged||reset){intent=defaultIntent;viewport=automatic(intent,input);}
  else if(!previous||external){intent=fittedCamera(input.camera)?'fit':'manual';viewport=intent==='fit'?automatic(intent,input):nativeCampusCameraViewport(input.camera,input.size,input.bounds);}
  else if(!sameSize(previous.size,input.size)){intent=previous.intent;viewport=intent==='manual'?resizeSceneViewport(previous.viewport,previous.size,input.size,input.bounds):automatic(intent,input);}
  else{intent=previous.intent;viewport=nativeCampusCameraViewport(input.camera,input.size,input.bounds);}
  const camera=nativeCampusCameraFromViewport(viewport,input.size,input.bounds);
  return{frame:{key:input.key,size:{...input.size},bounds:{...input.bounds},intent,viewport,emitted:camera},camera,changed:!sameCampusCamera(camera,input.camera)};
}
