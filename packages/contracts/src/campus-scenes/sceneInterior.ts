import { scenePointBounds, sceneUnitScale } from "./sceneGeometry";
import type { CampusSceneDocument, CampusSceneElement } from "./types";

/** Keep the authored global coordinates; a camera frame, not a geometry translation, isolates a floor. */
export function sceneInteriorView(scene: CampusSceneDocument, building: CampusSceneElement, floorId: string) {
  const elements = scene.elements.filter(element => element.id !== building.id && (element.floor_id === floorId
    || element.parent_element_id === building.id && (element.navigation_connector?.from_floor_id === floorId || element.navigation_connector?.to_floor_id === floorId)))
    .map(element => element.navigation_connector ? { ...element, floor_id: floorId } : element);
  const bounds = scenePointBounds([...building.geometry.points, ...elements.flatMap(element => element.geometry.points)]);
  const padding = Math.max(sceneUnitScale(scene) * 4, Math.max(bounds.width, bounds.height) * .08);
  return { document: { ...scene, elements }, outline: building.geometry.points,
    viewBounds: { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 } };
}
export function sceneBuildingFloorIds(scene: CampusSceneDocument, building: CampusSceneElement) {
  return [...new Set(scene.elements.filter(element => element.parent_element_id === building.id).flatMap(element =>
    [element.floor_id, element.navigation_connector?.from_floor_id, element.navigation_connector?.to_floor_id]).filter((id): id is string => Boolean(id)))];
}
export function sceneFloorBuilding(scene: CampusSceneDocument, places: Array<{ id: string; parent_space_id: string | null }>, floorId: string) {
  const seen = new Set<string>(); let place = places.find(item => item.id === floorId);
  while (place && !seen.has(place.id)) {
    const building = scene.elements.find(element => element.kind === "building" && element.space_id === place?.id);
    if (building) return building;
    seen.add(place.id);
    const parentBuilding = scene.elements.find(element => element.kind === "building" && element.space_id === place?.parent_space_id);
    if (parentBuilding) return parentBuilding;
    place = places.find(item => item.id === place?.parent_space_id);
  }
  return undefined;
}

export function sceneElementBuilding(scene: CampusSceneDocument, places: Array<{id:string;parent_space_id:string|null}>, element?: CampusSceneElement) {
  const seen = new Set<string>();
  let current = element;
  while(current && !seen.has(current.id)) {
    if(current.kind === 'building') return current;
    seen.add(current.id);
    current = scene.elements.find(item => item.id === current?.parent_element_id);
  }
  return element?.floor_id ? sceneFloorBuilding(scene,places,element.floor_id) : element?.space_id ? sceneFloorBuilding(scene,places,element.space_id) : undefined;
}
