import type { CampusSceneElement, CampusScenePoint } from "./types";
import { projectScenePoint, sceneElementHeight, sceneElementWidth, scenePaintOrder, scenePointBounds, scenePointDepth, type SceneBounds, type SceneViewMode } from "./sceneGeometry";

export interface SceneDrawingPart {
  key: string;
  source: CampusSceneElement;
  element: CampusSceneElement;
  primary: boolean;
}

function overlaps(a: SceneBounds, b: SceneBounds) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function footprint(element: CampusSceneElement, unit: number): SceneBounds {
  const bounds = scenePointBounds(element.geometry.points);
  const radius = element.geometry.type === "point" ? sceneElementWidth(element, unit) * .55 : element.asset_key === "boundary_wall" ? sceneElementWidth(element, unit) * .8 : 0;
  return { x: bounds.x - radius, y: bounds.y - radius, width: bounds.width + radius * 2, height: bounds.height + radius * 2 };
}

function projectedBounds(element: CampusSceneElement, ground: SceneBounds, unit: number): SceneBounds {
  const corners = [{ x: ground.x, y: ground.y }, { x: ground.x + ground.width, y: ground.y }, { x: ground.x + ground.width, y: ground.y + ground.height }, { x: ground.x, y: ground.y + ground.height }];
  const height = sceneElementHeight(element, unit) + sceneElementWidth(element, unit) * .3;
  return scenePointBounds(corners.flatMap(point => [projectScenePoint(point), projectScenePoint(point, height)]));
}

/** SVG paints later siblings on top. A desktop and its computer share an anchor,
 * so their random identities must not decide which one covers the other. Keep
 * unrelated depth positions unchanged while ordering each exact stack's slots. */
function orderCoincidentWorkstations(parts: SceneDrawingPart[]): SceneDrawingPart[] {
  const groups = new Map<string, number[]>();
  parts.forEach((part, index) => {
    const element = part.element, point = element.geometry.points[0];
    if (element.kind !== "fixture" || element.geometry.type !== "point" || !point || !["desk", "computer"].includes(element.asset_key ?? "")) return;
    const key = JSON.stringify([element.floor_id, element.parent_element_id ?? null, point.x, point.y]);
    const indexes = groups.get(key) ?? []; indexes.push(index); groups.set(key, indexes);
  });
  const ordered = [...parts];
  for (const indexes of groups.values()) {
    if (!indexes.some(index => parts[index]!.element.asset_key === "desk") || !indexes.some(index => parts[index]!.element.asset_key === "computer")) continue;
    const stack = indexes.map(index => parts[index]!).sort((a, b) => Number(a.element.asset_key === "computer") - Number(b.element.asset_key === "computer") || a.key.localeCompare(b.key));
    indexes.forEach((index, position) => { ordered[index] = stack[position]!; });
  }
  return ordered;
}

/** Display fragments never enter the saved document or acquire a new editable identity. */
export function sceneDrawingParts(elements: readonly CampusSceneElement[], unit: number, mode: SceneViewMode): SceneDrawingPart[] {
  const elevated = scenePaintOrder(elements).filter(element => element.asset_key === "boundary_wall" || !["surface", "road", "path"].includes(element.kind));
  const wallEdges = elevated.filter(element => element.asset_key === "boundary_wall").reduce((sum, element) => sum + element.geometry.points.length - 1, 0);
  const wallLength = elevated.filter(element => element.asset_key === "boundary_wall").reduce((sum, element) => sum + element.geometry.points.slice(1).reduce((length, b, index) => { const a = element.geometry.points[index]!; return length + Math.hypot(b.x - a.x, b.y - a.y); }, 0), 0);
  // Keep decorative fragments bounded even for very large imported plans.
  const fragmentLength = Math.max(unit * 18, wallLength / Math.max(1, 240 - wallEdges));
  const parts: SceneDrawingPart[] = [];
  for (const source of elevated) {
    if (mode === "2d" || source.asset_key !== "boundary_wall" || wallEdges > 240) {
      parts.push({ key: source.id, source, element: source, primary: true });
      continue;
    }
    let fragment = 0;
    source.geometry.points.slice(1).forEach((b, index) => {
      const a = source.geometry.points[index]!, length = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.ceil(length / fragmentLength));
      const at = (fraction: number): CampusScenePoint => ({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
      for (let position = 0; position < count; position += 1) {
        const id = fragment++;
        parts.push({ key: `${source.id}:wall:${id}`, source, element: { ...source, geometry: { type: "polyline", points: [at(position / count), at((position + 1) / count)] } }, primary: id === 0 });
      }
    });
  }
  if (mode === "2d") return orderCoincidentWorkstations(parts);
  const boxes = parts.map(part => footprint(part.element, unit));
  const projections = parts.map((part, index) => projectedBounds(part.element, boxes[index]!, unit));
  const edges = parts.map(() => new Set<number>()), incoming = parts.map(() => 0);
  const scan = parts.map((_, index) => index).sort((a, b) => projections[a]!.x - projections[b]!.x || parts[a]!.key.localeCompare(parts[b]!.key));
  for (let position = 0; position < scan.length; position += 1) {
    const aIndex = scan[position]!, a = boxes[aIndex]!, projection = projections[aIndex]!;
    for (let next = position + 1; next < scan.length; next += 1) {
      const bIndex = scan[next]!, b = boxes[bIndex]!, otherProjection = projections[bIndex]!;
      if (otherProjection.x > projection.x + projection.width) break;
      if (!overlaps(projection, otherProjection)) continue;
      // Billboard plants/fixtures already have a reliable point depth; reserve
      // dependencies for extended footprints that make the simple order fail.
      if (parts[aIndex]!.element.geometry.type === "point" && parts[bIndex]!.element.geometry.type === "point") continue;
      const aBehind = a.x + a.width <= b.x + .001 || a.y + a.height <= b.y + .001;
      const bBehind = b.x + b.width <= a.x + .001 || b.y + b.height <= a.y + .001;
      if (aBehind === bBehind) continue;
      const before = aBehind ? aIndex : bIndex, after = aBehind ? bIndex : aIndex;
      if (!edges[before]!.has(after)) { edges[before]!.add(after); incoming[after]! += 1; }
    }
  }
  const depth = (index: number) => { const box = boxes[index]!; return scenePointDepth({ x: box.x + box.width / 2, y: box.y + box.height / 2 }); };
  const baseOrder = parts.map((_, index) => index).sort((a, b) => depth(a) - depth(b) || parts[a]!.key.localeCompare(parts[b]!.key));
  const rank = parts.map(() => 0);
  baseOrder.forEach((index, position) => { rank[index] = position; });
  const ready: number[] = [];
  const push = (index: number) => {
    ready.push(index);
    let position = ready.length - 1;
    while (position > 0) {
      const parent = Math.floor((position - 1) / 2);
      if (rank[ready[parent]!]! <= rank[index]!) break;
      ready[position] = ready[parent]!; position = parent;
    }
    ready[position] = index;
  };
  const pop = () => {
    const first = ready[0]!, last = ready.pop()!;
    if (ready.length) {
      let position = 0;
      while (position * 2 + 1 < ready.length) {
        const left = position * 2 + 1, right = left + 1;
        const child = right < ready.length && rank[ready[right]!]! < rank[ready[left]!]! ? right : left;
        if (rank[last]! <= rank[ready[child]!]!) break;
        ready[position] = ready[child]!; position = child;
      }
      ready[position] = last;
    }
    return first;
  };
  incoming.forEach((count, index) => { if (!count) push(index); });
  const remaining = new Set(parts.map((_, index) => index)), ordered: SceneDrawingPart[] = [];
  let fallback = 0;
  while (remaining.size) {
    // Intersecting/cyclic shapes retain a deterministic bounded fallback.
    while (!remaining.has(baseOrder[fallback]!)) fallback += 1;
    const index = ready.length ? pop() : baseOrder[fallback]!;
    if (!remaining.has(index)) continue;
    remaining.delete(index); ordered.push(parts[index]!);
    for (const after of edges[index]!) { incoming[after]! -= 1; if (incoming[after] === 0 && remaining.has(after)) push(after); }
  }
  return orderCoincidentWorkstations(ordered);
}
