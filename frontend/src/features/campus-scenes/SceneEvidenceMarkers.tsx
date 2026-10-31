import type { CampusSceneElement } from "./types";
import type { SceneEvidenceMarker } from "./sceneOperations.types";
import type { SceneSize, SceneViewport, SceneViewMode } from "./sceneGeometry";
import { placeSceneMarkers } from "./sceneEvidencePlacement";

function EvidenceSymbol({dimension}:Pick<SceneEvidenceMarker,"dimension">) {
  if(dimension==="expected")return <><circle r="6"/><path d="M 0 -3.5 V 0 L 2.5 1.5"/></>;
  if(dimension==="observed")return <><path d="M -7 0 Q 0 -9 7 0 Q 0 9 -7 0 Z"/><circle r="2"/></>;
  if(dimension==="accepted")return <><rect x="-6" y="-6" width="12" height="12" rx="2"/><path d="m -3 0 2 2 4 -4"/></>;
  return <><circle r="6"/><path d="M -2 -2 C -2 -5 3 -5 3 -2 Q 3 -1 0 0 V 1 M 0 3.5 v .1"/></>;
}

export function SceneEvidenceMarkers({markers,elements,mode,unit,viewport,size,selectedMarkerId,onSelectMarker}:{markers:readonly SceneEvidenceMarker[];elements:readonly CampusSceneElement[];mode:SceneViewMode;unit:number;viewport:SceneViewport;size:SceneSize;selectedMarkerId?:string|null;onSelectMarker?:(id:string)=>void}) {
  const placements=placeSceneMarkers(markers,elements,mode,unit,viewport,size,selectedMarkerId);
  return <g className="scene-evidence-markers">{placements.map(({marker,anchor,x,y,width})=><g key={marker.id} data-evidence-marker={marker.id} data-dimension={marker.dimension} data-tone={marker.tone} data-selected={selectedMarkerId===marker.id||undefined} className="scene-evidence-marker" role="button" tabIndex={0} aria-label={`${marker.label}. ${marker.summary}`} aria-pressed={selectedMarkerId===marker.id}
    onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()}
    onClick={event=>{event.stopPropagation();onSelectMarker?.(marker.id);}}
    onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();event.stopPropagation();onSelectMarker?.(marker.id);}}}>
    <title>{marker.label}. {marker.summary}</title>
    <path className="scene-evidence-marker__leader" d={`M ${anchor.x} ${anchor.y} L ${x} ${y+12}`} pointerEvents="none"/>
    <g transform={`translate(${x} ${y})`}>
      <rect x={-width/2} y={-22} width={width} height={44} fill="transparent"/>
      <rect className="scene-evidence-marker__background" x={-width/2} y={-15} width={width} height={30} rx={15}/>
      <g className="scene-evidence-marker__symbol" transform={`translate(${-width/2+15} 0)`} fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{marker.tone ? <><path d="M 0 -6 L 7 6 H -7 Z"/><path d="M 0 -2 V 1 M 0 3.5 v .1"/></> : <EvidenceSymbol dimension={marker.dimension}/>}</g>
      <text className="scene-evidence-marker__count" x={marker.plannedCapacityPressure ? 1 : 10} y="4" textAnchor="middle">{marker.count>99 ? "99+" : marker.count}</text>
      {marker.plannedCapacityPressure && <text className="scene-evidence-marker__pressure" x={width/2-13} y="4" textAnchor="middle">!</text>}
    </g>
  </g>)}</g>;
}

