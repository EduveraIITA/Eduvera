import { memo, useMemo } from "react";
import { SCENE_PLANE_TRANSFORM, SCENE_VERTICAL_SCALE, projectScenePoint, unprojectScenePoint, scenePointsAttribute, scenePresentationHeight, type SceneBounds, type SceneViewMode } from "./sceneGeometry";
import { sceneLitColor, SCENE_GROUND } from "./sceneLightingPalette";
import { DEFAULT_SCENE_SUNLIGHT, sceneShadowOffset, type SceneSunlight } from "./sceneSunlight";
import type { SceneLighting } from "./sceneLighting";
import type { CampusSceneDocument, CampusScenePoint } from "./types";

type SiteBounds = CampusSceneDocument["bounds"];
export interface SceneSurroundingsApproach { point: CampusScenePoint; width: number; kind?: "gate" | "road" | "path" }
export interface SceneSurroundingsProps {
  bounds: SiteBounds; unit: number; lighting: SceneLighting; mode: SceneViewMode; id: string;
  visibleBounds: SceneBounds; approaches?: readonly SceneSurroundingsApproach[]; sunlight?: SceneSunlight;
}
const EMPTY_APPROACHES: readonly SceneSurroundingsApproach[] = [];
const project = (points: readonly CampusScenePoint[]) => points.map(point => projectScenePoint(point));
const seedAt = (value: number) => { const raw = Math.sin(value * 127.1 + 311.7) * 43758.5453; return raw - Math.floor(raw); };

/** Whole world-space tiles buffer the view; panning inside them reuses the forest. */
export function sceneSurroundingsCoverage(bounds: SiteBounds, visible: SceneBounds): SceneBounds {
  const tile = Math.max(1, Math.max(bounds.width, bounds.height) / 4);
  const x = Math.floor(visible.x / tile) * tile, y = Math.floor(visible.y / tile) * tile;
  return { x, y, width: (Math.ceil(visible.width / tile) + 1) * tile,
    height: (Math.ceil(visible.height / tile) + 1) * tile };
}

/** Only explicit inset gates or roads whose width reaches the edge clear an exit. */
export function surroundingsApproachCorridors(bounds: SiteBounds, unit: number, approaches: readonly SceneSurroundingsApproach[]) {
  const reach = Math.max(bounds.width, bounds.height) * 8;
  return approaches.filter(({ point, width, kind }) => Math.min(point.x, point.y, bounds.width - point.x, bounds.height - point.y) <= (kind === "gate" ? Math.max(unit * 8, width / 2) : width / 2 + unit * .1)).slice(0, 32).map(({ point, width }) => {
    const distances = [point.y, bounds.width - point.x, bounds.height - point.y, point.x];
    const edge = distances.indexOf(Math.min(...distances)), half = Math.max(width * .6 + unit * 2, unit * 5);
    if (edge === 0 || edge === 2) {
      const start = edge === 0 ? 0 : bounds.height, end = edge === 0 ? -reach : bounds.height + reach;
      return [{ x: point.x - half, y: start }, { x: point.x + half, y: start }, { x: point.x + half * 1.2, y: end }, { x: point.x - half * 1.2, y: end }];
    }
    const start = edge === 3 ? 0 : bounds.width, end = edge === 3 ? -reach : bounds.width + reach;
    return [{ x: start, y: point.y - half }, { x: end, y: point.y - half * 1.2 }, { x: end, y: point.y + half * 1.2 }, { x: start, y: point.y + half }];
  });
}

function polygonContains(point: CampusScenePoint, polygon: readonly CampusScenePoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function intersects(a: readonly CampusScenePoint[], b: readonly CampusScenePoint[]) {
  if (a.some(point => polygonContains(point, b)) || b.some(point => polygonContains(point, a))) return true;
  const cross = (p: CampusScenePoint, q: CampusScenePoint, r: CampusScenePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return a.some((p, i) => b.some((r, j) => {
    const q = a[(i + 1) % a.length]!, s = b[(j + 1) % b.length]!;
    return cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0;
  }));
}
function distanceToLine(point: CampusScenePoint, a: CampusScenePoint, b: CampusScenePoint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(.001, dx * dx + dy * dy)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function treeMetrics(variant: number) {
  const radius = variant === 0 ? 7 : variant === 1 ? 3.8 : 6.7 + seedAt(variant + 7) * 3.7;
  return { radius, height: variant < 2 ? 23 : Math.max(radius * 2.15, 17 + seedAt(variant + 19) * 8) };
}

export function createSurroundingsLayout(bounds: SiteBounds, unit: number, visible: SceneBounds, approaches: readonly SceneSurroundingsApproach[] = EMPTY_APPROACHES) {
  const longest = Math.max(bounds.width, bounds.height), scale = Math.min(longest / 120, Math.max(longest / 360, unit * .85));
  const seed = Math.round(bounds.width * 13 + bounds.height * 7);
  const site = project([{ x: 0, y: 0 }, { x: bounds.width, y: 0 }, { x: bounds.width, y: bounds.height }, { x: 0, y: bounds.height }]);
  const corridors = surroundingsApproachCorridors(bounds, unit, approaches).map(project);
  const riverWidth = Math.max(scale * 12, longest * .045), riverX = -longest * (.075 + seedAt(seed) * .005);
  const riverPoints = Array.from({ length: 161 }, (_, index) => {
    const y = -longest * 4 + index / 160 * (bounds.height + longest * 8);
    return { x: riverX + Math.sin(y / (longest * .7) + seedAt(seed) * 3) * longest * .01 + Math.sin(y / (longest * .29)) * longest * .005, y };
  });
  const riverProjected = project(riverPoints);
  const riverSegments = riverProjected.slice(1).map((point, index) => [riverProjected[index]!, point] as const);
  const padded = [{ x: visible.x - scale * 20, y: visible.y - scale * 20 }, { x: visible.x + visible.width + scale * 20, y: visible.y - scale * 20 }, { x: visible.x + visible.width + scale * 20, y: visible.y + visible.height + scale * 35 }, { x: visible.x - scale * 20, y: visible.y + visible.height + scale * 35 }];
  const world = padded.map(point => unprojectScenePoint(point)), step = scale * 21;
  const minX = Math.floor(Math.min(...world.map(p => p.x)) / step), maxX = Math.ceil(Math.max(...world.map(p => p.x)) / step);
  const minY = Math.floor(Math.min(...world.map(p => p.y)) / step), maxY = Math.ceil(Math.max(...world.map(p => p.y)) / step);
  // Density depends on view span, never its position. Each world bucket chooses
  // from its whole contents before clipping, so entering offscreen trees cannot
  // displace an existing visible tree at a coverage boundary.
  const dimensions = [{ x: 0, y: 0 }, { x: visible.width + scale * 40, y: 0 }, { x: 0, y: visible.height + scale * 55 }, { x: visible.width + scale * 40, y: visible.height + scale * 55 }].map(point => unprojectScenePoint(point));
  const spanX = Math.max(...dimensions.map(point => point.x)) - Math.min(...dimensions.map(point => point.x));
  const spanY = Math.max(...dimensions.map(point => point.y)) - Math.min(...dimensions.map(point => point.y));
  const bucketCells = 8;
  let stride = 1;
  const bucketCountBound = () => (Math.ceil((spanX + step * 2) / (step * stride * bucketCells)) + 1) * (Math.ceil((spanY + step * 2) / (step * stride * bucketCells)) + 1);
  while ((Math.ceil(spanX / (step * stride)) + 2) * (Math.ceil(spanY / (step * stride)) + 2) > 8000 || bucketCountBound() > 800) stride *= 2;
  const bucketWidth = step * stride * bucketCells;
  const quota = Math.max(1, Math.min(Math.ceil(550 * bucketWidth * bucketWidth / (spanX * spanY)), Math.floor(800 / bucketCountBound())));
  type ForestPlacement = { id: string; x: number; y: number; variant: number; scale: number; footprint: CampusScenePoint[]; priority: number };
  const buckets = new Map<string, ForestPlacement[]>();
  const cellSpan = stride * bucketCells;
  const firstCol = Math.floor(minX / cellSpan) * cellSpan, lastCol = (Math.floor(maxX / cellSpan) + 1) * cellSpan;
  const firstRow = Math.floor(minY / cellSpan) * cellSpan, lastRow = (Math.floor(maxY / cellSpan) + 1) * cellSpan;
  for (let row = firstRow; row < lastRow; row += stride) for (let col = firstCol; col < lastCol; col += stride) {
    const cell = seed + col * 151.7 + row * 319.3, cluster = seedAt(seed + Math.floor(col / 4) * 19 + Math.floor(row / 4) * 41);
    if (seedAt(cell) < (cluster < .35 ? .65 : .14)) continue;
    const count = cluster > .7 && seedAt(cell + 2) > .45 ? 2 : 1;
    for (let item = 0; item < count; item++) {
      const variation = cell + item * 31, position = projectScenePoint({ x: (col + seedAt(variation + 7)) * step, y: (row + seedAt(variation + 13)) * step });
      const variant = Math.floor(seedAt(variation + 17) * 6), treeScale = scale * (.72 + seedAt(variation + 23) * .52), metrics = treeMetrics(variant);
      const radius = (metrics.radius * 1.2 + 1) * treeScale, height = (metrics.height * 1.04 + 1) * SCENE_VERTICAL_SCALE * treeScale;
      const footprint = [{ x: position.x - radius, y: position.y - height }, { x: position.x + radius, y: position.y - height }, { x: position.x + radius, y: position.y + treeScale * 5 }, { x: position.x - radius, y: position.y + treeScale * 5 }];
      if (intersects(footprint, site) || corridors.some(corridor => intersects(footprint, corridor))) continue;
      const center = { x: position.x, y: position.y - height / 2 }, clearance = Math.hypot(radius, height / 2) + riverWidth * .8;
      if (riverSegments.some(([start, end]) => distanceToLine(center, start, end) < clearance)) continue;
      const key = `${Math.floor(col / cellSpan)}:${Math.floor(row / cellSpan)}`, bucket = buckets.get(key) ?? [];
      bucket.push({ id: `${col}:${row}:${item}`, ...position, variant, scale: treeScale, footprint, priority: seedAt(variation + 43) });
      buckets.set(key, bucket);
    }
  }
  const trees = [...buckets.values()].flatMap(bucket => bucket.sort((a, b) => a.priority - b.priority).slice(0, quota)).filter(tree => intersects(tree.footprint, padded)).sort((a, b) => a.y - b.y);
  return { site, corridors, riverPoints, riverWidth, scale, trees };
}

function ForestTree({ variant, lighting, sunlight }: { variant: number; lighting: SceneLighting; sunlight: SceneSunlight }) {
  const lit = (value: string) => sceneLitColor(value, lighting), { radius, height } = treeMetrics(variant), crown = -height + radius * .98;
  const shadow = sceneShadowOffset(scenePresentationHeight(height), sunlight), castShadow = lighting === "day" && sunlight.strength > 0;
  return <g>
    <g transform={SCENE_PLANE_TRANSFORM} fill={lighting === "night" ? "#080f14" : "#40543f"}>
      <ellipse rx={radius * .76} ry={radius * .6} opacity={.16} />
      {castShadow && <g data-surroundings-cast-shadow transform={`translate(${shadow.x} ${shadow.y})`} opacity={.12 * sunlight.strength}>
        <ellipse rx={radius} ry={radius * .82} />
        <path d={`M ${-shadow.x - .7} ${-shadow.y} L -1 -2 L 1 -2 L ${-shadow.x + .7} ${-shadow.y} Z`} />
      </g>}
    </g>
    <g transform={`scale(1 ${SCENE_VERTICAL_SCALE})`}>
    <path d={`M -1 0 L -.6 ${crown} L .8 ${crown} L 1.2 0 Z`} fill={lit("#827057")} />
    {variant === 0 ? <g>
      <path d={`M 0 ${-height} Q -2 -16 -5 -12 L -3.2 -12 Q -4.5 -8 -7 -5 Q 0 -1 7 -5 Q 4.5 -8 3.2 -12 L 5 -12 Q 2 -16 0 ${-height}`} fill={lit("#456d53")} />
      <path d={`M 0 ${-height} Q -2 -16 -5 -12 L -3.2 -12 Q -4.5 -8 -7 -5 Q -2 -3 0 -3 Z`} fill={lit("#64855e")} />
    </g> : variant === 1 ? <g>
      <ellipse cx={0} cy={-height * .6} rx={radius} ry={height * .44} fill={lit("#55774e")} />
      <ellipse cx={-radius * .3} cy={-height * .66} rx={radius * .55} ry={height * .33} fill={lit("#74905b")} />
    </g> : <g>
      <ellipse cx={0} cy={crown + radius * .12} rx={radius} ry={radius * .78} fill={lit(variant % 2 ? "#537955" : "#456e50")} />
      <ellipse cx={-radius * .44} cy={crown - radius * .1} rx={radius * .67} ry={radius * .66} fill={lit("#668754")} />
      <ellipse cx={radius * .4} cy={crown - radius * .05} rx={radius * .64} ry={radius * .65} fill={lit("#537955")} />
      <ellipse cx={-radius * .06} cy={crown - radius * .43} rx={radius * .64} ry={radius * .55} fill={lit(variant % 2 ? "#78945c" : "#6c8d5b")} />
      <path d={`M ${-radius * .55} ${crown - radius * .28} q ${radius * .2} ${-radius * .25} ${radius * .5} ${-radius * .17}`} fill="none" stroke={lit("#a0ad78")} strokeWidth={radius * .1} strokeLinecap="round" opacity={.35} />
    </g>}
    </g>
  </g>;
}

/** Rendering-only landscape. Its whole canopies clear the campus, river and exits. */
export function SceneSurroundings({ bounds, unit, lighting, mode, id, visibleBounds, approaches = EMPTY_APPROACHES, sunlight = DEFAULT_SCENE_SUNLIGHT }: SceneSurroundingsProps) {
  const { x, y, width, height } = sceneSurroundingsCoverage(bounds, visibleBounds);
  const coverage = useMemo(() => ({ x, y, width, height }), [x, y, width, height]);
  return <SurroundingsDrawing bounds={bounds} unit={unit} lighting={lighting} mode={mode} id={id} visibleBounds={coverage} approaches={approaches} sunlight={sunlight} />;
}

const SurroundingsDrawing = memo(function SurroundingsDrawing({ bounds, unit, lighting, mode, id, visibleBounds, approaches = EMPTY_APPROACHES, sunlight = DEFAULT_SCENE_SUNLIGHT }: SceneSurroundingsProps) {
  const layout = useMemo(() => createSurroundingsLayout(bounds, unit, visibleBounds, approaches), [bounds, unit, visibleBounds, approaches]);
  if (mode !== "2.5d") return null;
  const prefix = `surround-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`, lit = (color: string) => sceneLitColor(color, lighting);
  const river = scenePointsAttribute(layout.riverPoints), extent = { x: visibleBounds.x - 50 * layout.scale, y: visibleBounds.y - 50 * layout.scale, width: visibleBounds.width + 100 * layout.scale, height: visibleBounds.height + 100 * layout.scale };
  return <g data-scene-surroundings="illustrative" aria-hidden="true" pointerEvents="none">
    <defs>
      <mask id={`${prefix}-outside`} maskUnits="userSpaceOnUse" {...extent}><rect {...extent} fill="white" /><polygon data-surroundings-campus-exclusion points={scenePointsAttribute(layout.site)} fill="black" /></mask>
      {Array.from({ length: 6 }, (_, index) => <g id={`${prefix}-tree-${index}`} key={index}><ForestTree variant={index} lighting={lighting} sunlight={sunlight} /></g>)}
    </defs>
    <g mask={`url(#${prefix}-outside)`}>
      <rect {...extent} fill={SCENE_GROUND[lighting]} />
      <g data-surroundings-river transform={SCENE_PLANE_TRANSFORM} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={river} stroke={lit("#8caa77")} strokeWidth={layout.riverWidth * 1.68} opacity={.8} />
        <polyline points={river} stroke={lit("#bfbc91")} strokeWidth={layout.riverWidth * 1.28} />
        <polyline points={river} stroke={lit("#60969b")} strokeWidth={layout.riverWidth} />
        <polyline points={river} stroke={lit("#7eafb0")} strokeWidth={layout.riverWidth * .68} opacity={.5} />
        <polyline points={river} stroke={lit("#bdd0bd")} strokeWidth={layout.scale * .35} strokeDasharray={`${layout.scale * 9} ${layout.scale * 18} ${layout.scale * 4} ${layout.scale * 27}`} opacity={.55} />
      </g>
      <g data-surroundings-forest>{layout.trees.map(tree => <use key={tree.id} data-surroundings-tree={tree.id} data-tree-variant={tree.variant} href={`#${prefix}-tree-${tree.variant}`} transform={`translate(${tree.x} ${tree.y}) scale(${tree.scale})`} />)}</g>
    </g>
  </g>;
});
