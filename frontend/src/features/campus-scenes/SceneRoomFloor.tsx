import { useId } from "react";
import { scenePointsAttribute } from "./sceneGeometry";
import type { SceneLighting } from "./sceneLighting";
import type { CampusSceneElement } from "./types";

/** A cutaway drawing of the authored room, not a proposed furniture or doorway arrangement. */
export function SceneRoomFloor({ element, unit, lighting }: { element: CampusSceneElement; unit: number; lighting: SceneLighting }) {
  const tileId = `room-tile-${useId().replace(/:/g, "")}`;
  if (element.kind !== "room" || element.geometry.type !== "polygon" || element.geometry.points.length < 3
    || element.geometry.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const scale = Number.isFinite(unit) && unit > 0 ? unit : 1;
  const points = scenePointsAttribute(element.geometry.points), night = lighting === "night";
  const floor = night ? "#2b3741" : "#f3f1e8", grid = night ? "#52616c" : "#c6c9c3";
  const wall = night ? "#b2bdc5" : "#53616a", tile = scale * 1.2;
  return <g data-room-floor={element.id}>
    <defs><pattern id={tileId} patternUnits="userSpaceOnUse" width={tile} height={tile}>
      <path d={`M ${tile} 0 H 0 V ${tile}`} fill="none" stroke={grid} strokeWidth={scale * .035} opacity={night ? .5 : .65} />
    </pattern></defs>
    <polygon points={points} fill={floor} />
    <polygon data-room-floor-tiles points={points} fill={`url(#${tileId})`} />
    <polygon data-room-wall points={points} fill="none" stroke={wall} strokeWidth={scale * .25} strokeLinejoin="round" />
  </g>;
}
