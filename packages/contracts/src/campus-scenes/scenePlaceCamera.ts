import { projectScenePoint, sceneElementHeight, scenePointBounds, sceneRoofFaces, sceneUnitScale, type SceneViewMode } from "./sceneGeometry";
import type { CampusSceneDocument } from "./types";
import type { SceneViewportFocus } from "./sceneViewportFocus";
import { isSceneIndoorAssetKey, sceneIndoorFootprint } from "./sceneIndoorAssets";

/** Camera framing only. Several reviewed outlines may describe the same canonical place. */
export function scenePlaceFocus(scene: CampusSceneDocument, elementId: string | null, mode: SceneViewMode, floorId: string | null): SceneViewportFocus | null {
  const selected = scene.elements.find(item => item.id === elementId && item.floor_id === floorId);
  if (!selected || !["building", "room", "surface", "fixture"].includes(selected.kind)) return null;
  const unit = sceneUnitScale(scene);
  const elements = selected.space_id ? scene.elements.filter(item => item.space_id === selected.space_id && item.floor_id === floorId) : [selected];
  const points = elements.flatMap(element => {
    const height = sceneElementHeight(element, unit);
    if(element.kind === 'fixture' && isSceneIndoorAssetKey(element.asset_key)) return sceneIndoorFootprint(element,unit).map(point=>projectScenePoint(point,0,mode));
    return [...element.geometry.points.flatMap(point => [projectScenePoint(point, 0, mode), projectScenePoint(point, height, mode)]), ...(mode === "2.5d" ? sceneRoofFaces(element.geometry.points, height, element.roof, unit).flat() : [])];
  });
  if (!points.length || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const extent = scenePointBounds(points), padding = Math.max(unit * 12, Math.max(extent.width, extent.height) * .2);
  const bounds = { x: extent.x - padding, y: extent.y - padding, width: extent.width + padding * 2, height: extent.height + padding * 2 };
  return { key: JSON.stringify([selected.space_id ?? selected.id, floorId, mode, bounds]), bounds };
}
