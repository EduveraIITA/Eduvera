import type { CampusSceneDocument, CampusScenePoint } from "./types";
import { sceneDrawingParts } from "./sceneDepth";
import { scenePlantSilhouette } from "./scenePlantSilhouettes";
import { projectScenePoint, sceneBuildingFaces, sceneElementHeight, sceneElementWidth, scenePointBounds, scenePointDepth, sceneRoofFaces, sceneVisibleElements, type SceneBounds, type SceneViewMode } from "./sceneGeometry";

export interface ScenePeopleMask {
  path: string; fill: boolean; strokeWidth?: number;
  transform?: { x: number; y: number; scaleX: number; scaleY: number };
}
export interface ScenePeopleOccluder { key: string; depth: number; bounds: SceneBounds; masks: readonly ScenePeopleMask[] }
const polygon = (points: readonly CampusScenePoint[]) => points.length ? `M ${points.map(point => `${point.x} ${point.y}`).join(" L ")} Z` : "";

/** Shared source geometry compiles once; mask fragments never become editable objects. */
export function scenePeopleOccluders(scene: CampusSceneDocument, floorId: string | null, mode: SceneViewMode, unit: number): ScenePeopleOccluder[] {
  if (mode === "2d") return [];
  const result: ScenePeopleOccluder[] = [];
  for (const part of sceneDrawingParts(sceneVisibleElements(scene.elements, floorId), unit, mode)) {
    const element = part.element, points = element.geometry.points;
    if (!points.length) continue;
    const masks: ScenePeopleMask[] = [], height = sceneElementHeight(element, unit), width = sceneElementWidth(element, unit);
    let bounds: SceneBounds;
    if ((element.kind === "building" || element.kind === "room") && element.geometry.type === "polygon") {
      for (const face of sceneBuildingFaces(points, height)) masks.push({ path: polygon(face.points), fill: true });
      for (const roof of sceneRoofFaces(points, height, element.roof, unit)) masks.push({ path: polygon(roof), fill: true });
      bounds = scenePointBounds(points.flatMap(point => [projectScenePoint(point), projectScenePoint(point, height + Math.min(width, 6 * unit))]));
    } else if (element.asset_key === "boundary_wall") {
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!, b = points[index]!, length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < .001) continue;
        const offset = { x: (b.y - a.y) / length * width / 2, y: -(b.x - a.x) / length * width / 2 };
        const footprint = [{ x: a.x + offset.x, y: a.y + offset.y }, { x: b.x + offset.x, y: b.y + offset.y }, { x: b.x - offset.x, y: b.y - offset.y }, { x: a.x - offset.x, y: a.y - offset.y }];
        for (const face of sceneBuildingFaces(footprint, height)) masks.push({ path: polygon(face.points), fill: true });
        masks.push({ path: polygon(footprint.map(point => projectScenePoint(point, height))), fill: true });
        const posts = Math.min(32, Math.max(1, Math.ceil(length / (24 * unit))));
        for (let post = 0; post <= posts; post++) {
          const point = { x: a.x + (b.x - a.x) * post / posts, y: a.y + (b.y - a.y) * post / posts }, radius = width * .7;
          const corners = [{ x: point.x - radius, y: point.y - radius }, { x: point.x + radius, y: point.y - radius }, { x: point.x + radius, y: point.y + radius }, { x: point.x - radius, y: point.y + radius }];
          for (const face of sceneBuildingFaces(corners, height + unit * .25)) masks.push({ path: polygon(face.points), fill: true });
          masks.push({ path: polygon(corners.map(corner => projectScenePoint(corner, height + unit * .25))), fill: true });
        }
      }
      bounds = scenePointBounds(points.flatMap(point => [{ x: point.x - width, y: projectScenePoint(point, height + unit * .5).y }, { x: point.x + width, y: projectScenePoint(point).y + width }]));
    } else if (element.kind === "tree") {
      const plant = scenePlantSilhouette(element, mode, unit);
      if (!plant) continue;
      const { ground, crown, projectedHeight } = plant;
      if (element.asset_key === "tree_palm") {
        masks.push({ path: `M ${ground.x} ${ground.y} Q ${ground.x - width * .07} ${ground.y - projectedHeight * .5} ${crown.x} ${crown.y}`, fill: false, strokeWidth: width * .055 });
        for (const path of plant.palmFronds) masks.push({ path, fill: true });
      } else if (element.asset_key === "tree_conifer") {
        masks.push({ path: `M ${ground.x} ${ground.y} v ${-projectedHeight * .35}`, fill: false, strokeWidth: width * .065 });
        for (const path of plant.coniferTiers) masks.push({ path, fill: true });
      } else {
        if (!plant.shrub) masks.push({ path: `M ${ground.x} ${ground.y} L ${plant.cx} ${plant.cy + projectedHeight * .12}`, fill: false, strokeWidth: width * (plant.columnar ? .065 : .075) });
        masks.push({ path: plant.organicPath, fill: true, transform: { x: plant.cx, y: plant.cy, scaleX: plant.scaleX, scaleY: plant.scaleY } });
      }
      bounds = { x: ground.x - width * .65, y: ground.y - projectedHeight - width * .15, width: width * 1.3, height: projectedHeight + width * .3 };
    } else continue;
    if (masks.length) {
      // The front edge can cover a walker even after it passes a large footprint's centre.
      const depth = Math.max(...points.map(scenePointDepth)) + (element.asset_key === "boundary_wall" ? width * .7 : 0);
      result.push({ key: part.key, depth, bounds, masks });
    }
  }
  return result.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
}

