import type { CampusSceneElement, CampusScenePoint } from "./types";
import type { SceneEvidenceMarker } from "./sceneEvidence.types";
import { projectScenePoint, sceneElementHeight, scenePointBounds, scenePolygonCenter, type SceneSize, type SceneViewport, type SceneViewMode } from "./sceneGeometry";

export function scenePolygonContains(point:CampusScenePoint,polygon:readonly CampusScenePoint[]) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i]!,b=polygon[j]!;
    if((a.y>point.y)!==(b.y>point.y) && point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

export function scenePolygonClearance(point:CampusScenePoint,polygon:readonly CampusScenePoint[]) {
  return Math.min(...polygon.map((a,index)=>{
    const b=polygon[(index+1)%polygon.length]!,dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/Math.max(.000001,dx*dx+dy*dy)));
    return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);
  }));
}

/** A concave courtyard's centroid can be outside its footprint; use an interior span. */
export function sceneEvidenceAnchor(element:CampusSceneElement):CampusScenePoint | null {
  const points=element.geometry.points;
  if(!points.length)return null;
  if(element.geometry.type!=="polygon")return points[Math.floor(points.length/2)]!;
  const center=scenePolygonCenter(points);
  if(scenePolygonContains(center,points))return center;
  const bounds=scenePointBounds(points),y=bounds.y+bounds.height*.5;
  const xs=points.flatMap((a,index)=>{
    const b=points[(index+1)%points.length]!;
    return (a.y>y)!==(b.y>y) ? [a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y)] : [];
  }).sort((a,b)=>a-b);
  let widest=0,result:CampusScenePoint|null=null;
  for(let index=0;index+1<xs.length;index+=2)if(xs[index+1]!-xs[index]!>widest){widest=xs[index+1]!-xs[index]!;result={x:(xs[index]!+xs[index+1]!)/2,y};}
  return result;
}

export interface SceneMarkerPlacement {marker:SceneEvidenceMarker;anchor:CampusScenePoint;x:number;y:number;width:number}
export function placeSceneMarkers(markers:readonly SceneEvidenceMarker[],elements:readonly CampusSceneElement[],mode:SceneViewMode,unit:number,viewport:SceneViewport,size:SceneSize,selectedMarkerId?:string|null):SceneMarkerPlacement[] {
  const byId=new Map(elements.map(element=>[element.id,element])),placed:SceneMarkerPlacement[]=[];
  const order=[...markers].sort((a,b)=>Number(b.id===selectedMarkerId)-Number(a.id===selectedMarkerId)||a.id.localeCompare(b.id));
  for(const marker of order) {
    const element=byId.get(marker.elementId);if(!element)continue;
    const point=sceneEvidenceAnchor(element);if(!point)continue;
    const projected=projectScenePoint(point,element.kind==="building" ? sceneElementHeight(element,unit) : 0,mode);
    const anchor={x:projected.x*viewport.scale+viewport.x,y:projected.y*viewport.scale+viewport.y};
    if(anchor.x<0||anchor.x>size.width||anchor.y<0||anchor.y>size.height)continue;
    const width=marker.plannedCapacityPressure ? 70 : 54;
    let x=Math.max(width/2+4,Math.min(size.width-width/2-4,anchor.x)),y=Math.max((size.topInset??0)+24,Math.min(size.height-100,anchor.y-24));
    for(const shift of [0,-44,44,-88,88]) {
      const candidate=Math.max((size.topInset??0)+24,Math.min(size.height-100,y+shift));
      if(!placed.some(item=>Math.abs(item.x-x)<(item.width+width)/2+4 && Math.abs(item.y-candidate)<44)){y=candidate;break;}
    }
    if(!Number.isFinite(x)||!Number.isFinite(y))continue;
    x=Math.round(x*10)/10;y=Math.round(y*10)/10;
    placed.push({marker,anchor,x,y,width});
  }
  return placed;
}

