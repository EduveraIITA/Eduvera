import { projectScenePoint, sceneElementHeight, scenePointBounds, sceneRoofFaces, sceneUnitScale, type SceneViewMode } from "./sceneGeometry";
import type { SceneWalkingRoute } from "./sceneWalking";
import type { CampusSceneDocument } from "./types";
import type { SceneViewportFocus } from "./sceneViewportFocus";

/** Camera-only context: route geometry and the exact linked arrival building, never inferred spatial links. */
export function sceneWalkingRouteFocus(scene: CampusSceneDocument, route: SceneWalkingRoute | null | undefined, mode: SceneViewMode, floorId: string | null = null): SceneViewportFocus | null {
  if (route?.status !== "available") return null;
  const unit = sceneUnitScale(scene);
  const points = route.segments.filter(segment => segment.floorId === floorId).flatMap(segment => segment.points.map(point => projectScenePoint(point, 0, mode)));
  if (!points.length) return null;
  const entranceBuildingIds = new Set((route.legs ?? []).filter(leg => leg.kind !== "walk" && leg.kind === "entrance").map(leg => scene.elements.find(element => element.id === leg.elementId)?.parent_element_id));
  const arrival = scene.elements.filter(element => element.floor_id === floorId && (element.space_id === route.toSpaceId && ["building", "room"].includes(element.kind) || floorId === null && entranceBuildingIds.has(element.id)));
  for (const element of arrival) {
    const height = sceneElementHeight(element, unit);
    for (const point of element.geometry.points) points.push(projectScenePoint(point, 0, mode), projectScenePoint(point, height, mode));
    if (mode === "2.5d") points.push(...sceneRoofFaces(element.geometry.points, height, element.roof, unit).flat());
  }
  if (!points.length || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const extent = scenePointBounds(points), padding = Math.max(unit * 12, Math.max(extent.width, extent.height) * .16);
  const bounds = { x: extent.x - padding, y: extent.y - padding, width: extent.width + padding * 2, height: extent.height + padding * 2 };
  return { bounds, key: JSON.stringify([route.fromSpaceId, route.toSpaceId, scene.bounds.unit, mode, floorId, route.segments, route.legs, bounds]) };
}
