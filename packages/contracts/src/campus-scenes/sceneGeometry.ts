import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";

export type SceneViewMode = "2d" | "2.5d";
export interface SceneBounds { x: number; y: number; width: number; height: number }
export interface SceneViewport { x: number; y: number; scale: number }
export interface SceneSize { width: number; height: number; topInset?: number; bottomInset?: number }
export interface SceneFace { points: CampusScenePoint[]; edge: [CampusScenePoint, CampusScenePoint]; normal: CampusScenePoint; light: boolean }
const CAMERA_YAW = 0;
const CAMERA_ELEVATION = 52 * Math.PI / 180;
const COS_YAW = Math.cos(CAMERA_YAW), SIN_YAW = Math.sin(CAMERA_YAW);
const GROUND_DEPTH = Math.sin(CAMERA_ELEVATION);
/** A shared illustration scale makes small-campus architecture readable on a phone. */
export const SCENE_HEIGHT_EXAGGERATION = 1.6;
export const SCENE_VERTICAL_SCALE = Math.cos(CAMERA_ELEVATION) * SCENE_HEIGHT_EXAGGERATION;
export const SCENE_PLANE_TRANSFORM = `matrix(${COS_YAW} ${GROUND_DEPTH * SIN_YAW} ${-SIN_YAW} ${GROUND_DEPTH * COS_YAW} 0 0)`;

/** Presentation height never changes the saved physical dimension or footprint. */
export function scenePresentationHeight(height: number) { return height * SCENE_HEIGHT_EXAGGERATION; }
/** An elevated, straight-front camera keeps the plan square and every asset in one scale. */
export function sceneProjectedHeight(height: number) { return height * SCENE_VERTICAL_SCALE; }
export function scenePointDepth(point: CampusScenePoint) { return point.x * SIN_YAW + point.y * COS_YAW; }

export function projectScenePoint(point: CampusScenePoint, elevation = 0, mode: SceneViewMode = "2.5d"): CampusScenePoint {
  return mode === "2d" ? { x: point.x, y: point.y } : { x: point.x * COS_YAW - point.y * SIN_YAW, y: scenePointDepth(point) * GROUND_DEPTH - sceneProjectedHeight(elevation) };
}

export function unprojectScenePoint(point: CampusScenePoint, mode: SceneViewMode = "2.5d"): CampusScenePoint {
  return mode === "2d" ? { ...point } : { x: point.x * COS_YAW + point.y / GROUND_DEPTH * SIN_YAW, y: -point.x * SIN_YAW + point.y / GROUND_DEPTH * COS_YAW };
}

export function scenePointsAttribute(points: readonly CampusScenePoint[]): string {
  return points.map(({ x, y }) => `${Number(x.toFixed(3))},${Number(y.toFixed(3))}`).join(" ");
}

export function scenePointBounds(points: readonly CampusScenePoint[]): SceneBounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function sceneUnitScale(scene: Pick<CampusSceneDocument, "bounds">): number {
  return scene.bounds.unit === "metres" ? 1 : Math.max(scene.bounds.width, scene.bounds.height) / 250;
}

export function sceneElementHeight(element: CampusSceneElement, unitScale = 1): number {
  if (element.height !== undefined) return Math.max(0, element.height);
  if (element.asset_key === "boundary_wall") return 3 * unitScale;
  if (element.kind === "building") return (element.levels ?? 2) * 3.6 * unitScale;
  if (element.kind === "room") return .3 * unitScale;
  if (element.kind === "tree") return (element.asset_key === "shrub" ? 1.4 : element.asset_key === "tree_palm" ? 15 : element.asset_key === "tree_columnar" ? 14 : element.asset_key === "tree_conifer" ? 15 : 10) * unitScale;
  if (element.kind === "fixture") return (element.asset_key === "lamp" ? 8 : element.asset_key === "gate" ? 6 : 1.6) * unitScale;
  return 0;
}

export function sceneElementWidth(element: CampusSceneElement, unitScale = 1): number {
  if (element.width !== undefined) return Math.max(.1, element.width);
  if (element.asset_key === "boundary_wall") return .8 * unitScale;
  if (element.kind === "tree") return (element.asset_key === "shrub" ? 3.2 : element.asset_key === "tree_columnar" ? 5 : element.asset_key === "tree_conifer" ? 8 : 9) * unitScale;
  if (element.kind === "road") return 8 * unitScale;
  if (element.kind === "path") return 3 * unitScale;
  return 4 * unitScale;
}

export function signedSceneArea(points: readonly CampusScenePoint[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

/** Winding-normalised visible walls work for concave and rotated building footprints. */
export function sceneBuildingFaces(points: readonly CampusScenePoint[], height: number): SceneFace[] {
  const winding = signedSceneArea(points) >= 0 ? 1 : -1;
  const faces: SceneFace[] = [];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const dx = next.x - point.x, dy = next.y - point.y, length = Math.hypot(dx,dy);
    if (length < .0001) return;
    const normal = {x:dy / length * winding,y:-dx / length * winding};
    if (normal.x * SIN_YAW + normal.y * COS_YAW <= .0001) return;
    faces.push({
      points: [projectScenePoint(point), projectScenePoint(next), projectScenePoint(next, height), projectScenePoint(point, height)],
      edge: [point, next],
      normal,
      light: Math.abs(next.x - point.x) > Math.abs(next.y - point.y),
    });
  });
  return faces.sort((a, b) => scenePointDepth(a.edge[0]) + scenePointDepth(a.edge[1]) - scenePointDepth(b.edge[0]) - scenePointDepth(b.edge[1]));
}

export function scenePolygonCenter(points: readonly CampusScenePoint[]): CampusScenePoint {
  const area = signedSceneArea(points);
  if (Math.abs(area) < .0001) {
    const bounds = scenePointBounds(points);
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }
  const sum = points.reduce((result, point, index) => {
    const next = points[(index + 1) % points.length]!, cross = point.x * next.y - next.x * point.y;
    return { x: result.x + (point.x + next.x) * cross, y: result.y + (point.y + next.y) * cross };
  }, { x: 0, y: 0 });
  return { x: sum.x / (6 * area), y: sum.y / (6 * area) };
}

export function scenePolygonIsConvex(points: readonly CampusScenePoint[]): boolean {
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!, b = points[(index + 1) % points.length]!, c = points[(index + 2) % points.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < .00001) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return sign !== 0;
}

export function sceneRoofFaces(points: readonly CampusScenePoint[], height: number, roof: string | undefined, unitScale = 1): CampusScenePoint[][] {
  if (roof === "flat" || !roof || points.length !== 4 || !scenePolygonIsConvex(points)) return [points.map((point) => projectScenePoint(point, height))];
  const a = points[0]!, b = points[1]!, c = points[2]!, d = points[3]!;
  const firstLength = Math.hypot(b.x - a.x, b.y - a.y), secondLength = Math.hypot(c.x - b.x, c.y - b.y);
  const ridgeHeight = height + Math.min(firstLength, secondLength) * .19;
  const corners = [a, b, c, d].map((point) => projectScenePoint(point, height));
  const [p, q, r, s] = corners as [CampusScenePoint, CampusScenePoint, CampusScenePoint, CampusScenePoint];
  if (roof === "hip") {
    const center = scenePolygonCenter(points), rise = Math.min(Math.min(firstLength, secondLength) * .22, 6 * unitScale);
    const peak = projectScenePoint(center, height + rise);
    return [[p, q, peak], [q, r, peak], [r, s, peak], [s, p, peak]];
  }
  // A long ridge follows the longer pair of sides, including rotated footprints.
  if (firstLength >= secondLength) {
    const left = projectScenePoint({ x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 }, ridgeHeight);
    const right = projectScenePoint({ x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, ridgeHeight);
    return [[p, q, right, left], [q, r, right], [r, s, left, right], [s, p, left]];
  }
  const top = projectScenePoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ridgeHeight);
  const bottom = projectScenePoint({ x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 }, ridgeHeight);
  return [[p, q, top], [q, r, bottom, top], [r, s, bottom], [s, p, top, bottom]];
}

export function sceneRenderBounds(scene: CampusSceneDocument, mode: SceneViewMode): SceneBounds {
  const { width, height } = scene.bounds, unit = sceneUnitScale(scene);
  const points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }].map((point) => projectScenePoint(point, 0, mode));
  for (const element of scene.elements) {
    const elevation = sceneElementHeight(element, unit), radius = sceneElementWidth(element, unit) / 2;
    for (const point of element.geometry.points) {
      points.push(projectScenePoint(point, elevation + radius * .4, mode));
      if (element.geometry.type === "point") {
        points.push(projectScenePoint({ x: point.x - radius, y: point.y - radius }, elevation, mode));
        points.push(projectScenePoint({ x: point.x + radius, y: point.y + radius }, 0, mode));
      }
    }
  }
  const bounds = scenePointBounds(points), padding = Math.max(width, height) * .045;
  return { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + padding * 2, height: bounds.height + padding * 2 };
}

/** Toolbars reserve presentation space; old/editor callers retain their zero bottom inset. */
export function sceneViewportInsets(size: SceneSize) {
  const top = Math.max(0, Math.min(size.height / 3, size.topInset ?? 0));
  const bottom = Math.max(0, Math.min(Math.max(0, size.height - top - 1), size.bottomInset ?? 0));
  return { top, bottom, height: Math.max(1, size.height - top - bottom) };
}

export function fitSceneViewport(size: SceneSize, bounds: SceneBounds): SceneViewport {
  const { top, height } = sceneViewportInsets(size);
  const scale = Math.max(.0001, Math.min(size.width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)) * .94);
  return { scale, x: (size.width - bounds.width * scale) / 2 - bounds.x * scale, y: top + (height - bounds.height * scale) / 2 - bounds.y * scale };
}

export function clampSceneViewport(viewport: SceneViewport, size: SceneSize, bounds: SceneBounds): SceneViewport {
  const fit = fitSceneViewport(size, bounds), scale = Math.max(fit.scale, Math.min(fit.scale * 8, viewport.scale));
  const clampAxis = (value: number, length: number, origin: number, extent: number) => {
    const rendered = extent * scale, margin = 24;
    if (rendered <= length - margin * 2) return (length - rendered) / 2 - origin * scale;
    return Math.max(length - (origin + extent) * scale - margin, Math.min(margin - origin * scale, value));
  };
  const { top, height } = sceneViewportInsets(size);
  return { scale, x: clampAxis(viewport.x, size.width, bounds.x, bounds.width), y: top + clampAxis(viewport.y - top, height, bounds.y, bounds.height) };
}

export function zoomSceneViewport(viewport: SceneViewport, point: CampusScenePoint, multiplier: number, size: SceneSize, bounds: SceneBounds): SceneViewport {
  const fit = fitSceneViewport(size, bounds), scale = Math.max(fit.scale, Math.min(fit.scale * 8, viewport.scale * multiplier));
  return clampSceneViewport({ scale, x: point.x - (point.x - viewport.x) * scale / viewport.scale, y: point.y - (point.y - viewport.y) * scale / viewport.scale }, size, bounds);
}

export function constrainSceneTranslation(element: CampusSceneElement, delta: CampusScenePoint, bounds: CampusSceneDocument["bounds"]): CampusScenePoint {
  const box = scenePointBounds(element.geometry.points);
  return { x: Math.max(-box.x, Math.min(bounds.width - box.x - box.width, delta.x)), y: Math.max(-box.y, Math.min(bounds.height - box.y - box.height, delta.y)) };
}

export function sceneVisibleElements(elements: readonly CampusSceneElement[], floorId?: string | null, showRooms = false): CampusSceneElement[] {
  return elements.filter((element) => !floorId ? showRooms || (element.kind !== "room" && !element.floor_id) : element.floor_id === floorId);
}

/** Ground layers precede elevated geometry; stable IDs break ties without random visual changes. */
export function scenePaintOrder(elements: readonly CampusSceneElement[]): CampusSceneElement[] {
  const layer = (element: CampusSceneElement) => element.kind === "surface" ? 0 : element.asset_key !== "boundary_wall" && (element.kind === "road" || element.kind === "path") ? 1 : 2;
  return [...elements].sort((a, b) => {
    const difference = layer(a) - layer(b);
    if (difference) return difference;
    // Large landscape polygons form the base; a smaller pond or courtyard remains visible.
    if (a.kind === "surface" && b.kind === "surface") {
      const areaDifference = Math.abs(signedSceneArea(b.geometry.points)) - Math.abs(signedSceneArea(a.geometry.points));
      if (Math.abs(areaDifference) > .00001) return areaDifference;
    }
    const depth = (element: CampusSceneElement) => {
      const bounds = scenePointBounds(element.geometry.points);
      return scenePointDepth({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    };
    return depth(a) - depth(b) || a.id.localeCompare(b.id);
  });
}
