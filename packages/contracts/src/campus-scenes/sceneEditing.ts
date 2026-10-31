import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";

export function elementBounds(element: CampusSceneElement) {
  const xs = element.geometry.points.map(point => point.x);
  const ys = element.geometry.points.map(point => point.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, depth: Math.max(...ys) - y };
}

export function moveElement(element: CampusSceneElement, dx: number, dy: number, bounds: CampusSceneDocument["bounds"]): CampusSceneElement {
  const box = elementBounds(element);
  const safeX = Math.max(-box.x, Math.min(bounds.width - box.x - box.width, dx));
  const safeY = Math.max(-box.y, Math.min(bounds.height - box.y - box.depth, dy));
  return { ...element, review_state: "needs_review", geometry: { ...element.geometry,
    points: element.geometry.points.map(point => ({ x: round(point.x + safeX), y: round(point.y + safeY) })) } };
}

export function resizeElement(element: CampusSceneElement, dimension: "width" | "depth", value: number, bounds: CampusSceneDocument["bounds"]): CampusSceneElement {
  const box = elementBounds(element);
  const original = box[dimension];
  if (original <= 0 || value <= 0) return element;
  const axis = dimension === "width" ? "x" : "y";
  const maximum = dimension === "width" ? bounds.width - box.x : bounds.height - box.y;
  const ratio = Math.min(value, maximum) / original;
  return { ...element, review_state: "needs_review", geometry: { ...element.geometry,
    points: element.geometry.points.map(point => ({ ...point, [axis]: round(box[axis] + (point[axis] - box[axis]) * ratio) })) } };
}

export function clampPoint(point: CampusScenePoint, bounds: CampusSceneDocument["bounds"]): CampusScenePoint {
  return { x: round(Math.max(0, Math.min(bounds.width, point.x))), y: round(Math.max(0, Math.min(bounds.height, point.y))) };
}

export function defaultPoints(kind: CampusSceneElement["kind"], bounds: CampusSceneDocument["bounds"], offset = 0): CampusScenePoint[] {
  const x = bounds.width * (.36 + (offset % 5) * .035); const y = bounds.height * (.36 + (offset % 5) * .035);
  const width = bounds.width * .15; const depth = bounds.height * .12;
  if (kind === "tree" || kind === "fixture") return [{ x: round(x), y: round(y) }];
  if (kind === "road" || kind === "path") return [{ x: round(x), y: round(y) }, { x: round(x + width * 2), y: round(y + depth) }];
  return [{ x: round(x), y: round(y) }, { x: round(x + width), y: round(y) }, { x: round(x + width), y: round(y + depth) }, { x: round(x), y: round(y + depth) }];
}

export function geometryType(kind: CampusSceneElement["kind"]): CampusSceneElement["geometry"]["type"] {
  return kind === "tree" || kind === "fixture" ? "point" : kind === "road" || kind === "path" ? "polyline" : "polygon";
}

export function draftIssues(scene: CampusSceneDocument): string[] {
  const issues: string[] = [];
  if (!scene.name.trim()) issues.push("Give this campus view a name.");
  if (!scene.elements.length) issues.push("Add at least one building, path or landscape feature.");
  const unnamed = scene.elements.filter(element => !element.label.trim()).length;
  if (unnamed) issues.push(`Name ${unnamed} ${unnamed === 1 ? "item" : "items"} before publishing.`);
  const pending = scene.elements.filter(element => element.review_state !== "reviewed").length;
  if (pending) issues.push(`Review ${pending} ${pending === 1 ? "item" : "items"} before publishing.`);
  return issues;
}

function round(value: number) { return Math.round(value * 100) / 100; }
