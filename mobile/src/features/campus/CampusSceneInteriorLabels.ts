// Native pure layout port of web SceneInteriorLabels; renderer uses screen-space SVG text.
import { scenePointBounds, scenePolygonCenter, type SceneSize, type SceneViewport } from "../../../../packages/contracts/src/campus-scenes/sceneGeometry";
import type { CampusSceneElement, CampusScenePoint } from "../../../../packages/contracts/src/campus-scenes/types";

interface InteriorLabel {
  id: string;
  name: string;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}
interface InteriorLabelsProps {
  elements: readonly CampusSceneElement[];
  viewport: SceneViewport;
  size: SceneSize;
  unit: number;
  selectedId?: string | null;
}
const FONT_SIZE = 11, LINE_HEIGHT = 13, GLYPH_WIDTH = 5.8;

function inside(point: CampusScenePoint, polygon: readonly CampusScenePoint[]) {
  let result = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const first = polygon[index]!, second = polygon[previous]!;
    if ((first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y) / (second.y - first.y) + first.x) result = !result;
  }
  return result;
}
function wrapName(name: string, length: number, lineLimit: number) {
  const words = name.trim().split(/\s+/u), lines: string[] = [];
  let remaining = words.join(" ");
  while (remaining && lines.length < lineLimit) {
    if (remaining.length <= length) { lines.push(remaining); remaining = ""; break; }
    const split = remaining.lastIndexOf(" ", length);
    const end = split > Math.floor(length / 2) ? split : length;
    lines.push(remaining.slice(0, end)); remaining = remaining.slice(end).trim();
  }
  if (remaining && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1]!.slice(0, Math.max(1, length - 1)).trimEnd()}…`;
  return lines;
}
function collides(left: InteriorLabel, right: InteriorLabel) {
  return Math.abs(left.x - right.x) < (left.width + right.width) / 2 + 6
    && Math.abs(left.y - right.y) < (left.height + right.height) / 2 + 4;
}
function crosses(a: CampusScenePoint, b: CampusScenePoint, c: CampusScenePoint, d: CampusScenePoint) {
  const orientation = (p: CampusScenePoint, q: CampusScenePoint, r: CampusScenePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
}

/** Small, screen-space room names. Tiny or crowded rooms retain their existing accessible object name. */
export function layoutSceneInteriorLabels({ elements, viewport, size, unit, selectedId }: InteriorLabelsProps): InteriorLabel[] {
  if (!Number.isFinite(viewport.scale) || viewport.scale <= 0 || !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y)
    || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return [];
  const top = (size.topInset ?? 0) + 4, bottom = size.height - (size.bottomInset ?? 0) - 4;
  const padding = Math.max(4, Math.min(8, (Number.isFinite(unit) && unit > 0 ? unit : 1) * viewport.scale * .3));
  const candidates = elements.filter(element => element.kind === "room" && element.id !== selectedId
    && element.label.trim() && element.geometry.type === "polygon" && element.geometry.points.length >= 3)
    .flatMap(element => {
      const polygon = element.geometry.points.map(point => ({ x: viewport.x + point.x * viewport.scale, y: viewport.y + point.y * viewport.scale }));
      if (polygon.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
      const bounds = scenePointBounds(polygon);
      return bounds.width > 60 && bounds.height > 24 && bounds.x + bounds.width > 4 && bounds.x < size.width - 4
        && bounds.y + bounds.height > top && bounds.y < bottom ? [{ element, polygon, bounds }] : [];
    }).sort((left, right) => right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height || left.element.id.localeCompare(right.element.id)).slice(0, 320);
  const labels: InteriorLabel[] = [], identities = new Set<string>();
  for (const { element, polygon, bounds } of candidates) {
    if (labels.length >= 80) break;
    const identity = element.space_id ? `place:${element.space_id}` : element.id;
    if (identities.has(identity)) continue;
    const lineLimit = bounds.height - padding * 2 >= LINE_HEIGHT * 2 ? 2 : 1;
    const availableWidth = Math.min(150, bounds.width - padding * 2);
    const lines = wrapName(element.label, Math.max(6, Math.floor(availableWidth / GLYPH_WIDTH)), lineLimit);
    const width = Math.max(...lines.map(line => line.length)) * GLYPH_WIDTH, height = lines.length * LINE_HEIGHT;
    const center = scenePolygonCenter(polygon);
    const positions = [center, ...[.5, .3, .7].flatMap(vertical => [.5, .3, .7].map(horizontal => ({ x: bounds.x + bounds.width * horizontal, y: bounds.y + bounds.height * vertical })))];
    for (const position of positions) {
      const label: InteriorLabel = { id: element.id, name: element.label, lines, x: position.x, y: position.y, width, height };
      const left = label.x - width / 2 - 3, right = label.x + width / 2 + 3, upper = label.y - height / 2 - 2, lower = label.y + height / 2 + 2;
      if (left < 4 || right > size.width - 4 || upper < top || lower > bottom || labels.some(previous => collides(label, previous))) continue;
      const samples = [{ x: left, y: upper }, { x: right, y: upper }, { x: right, y: lower }, { x: left, y: lower }, position,
        { x: position.x, y: upper }, { x: position.x, y: lower }, { x: left, y: position.y }, { x: right, y: position.y }];
      if (!samples.every(point => inside(point, polygon))) continue;
      const corners = samples.slice(0, 4);
      if (polygon.some((point, index) => corners.some((corner, cornerIndex) => crosses(point, polygon[(index + 1) % polygon.length]!, corner, corners[(cornerIndex + 1) % corners.length]!)))) continue;
      labels.push(label); identities.add(identity); break;
    }
  }
  return labels;
}

