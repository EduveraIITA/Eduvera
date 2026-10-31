import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from '../../../../../packages/contracts/src/campus-scenes/types';
import { sceneMaterial } from '../../../../../packages/contracts/src/campus-scenes/sceneAssets';
import { sceneDrawingParts } from '../../../../../packages/contracts/src/campus-scenes/sceneDepth';
import { projectScenePoint, sceneBuildingFaces, sceneElementHeight, sceneElementWidth, scenePaintOrder, scenePointBounds, scenePresentationHeight, sceneProjectedHeight, sceneRoofFaces, sceneUnitScale, sceneVisibleElements, type SceneBounds, type SceneViewMode } from '../../../../../packages/contracts/src/campus-scenes/sceneGeometry';
import { isSceneIndoorAssetKey, sceneIndoorDimensions } from '../../../../../packages/contracts/src/campus-scenes/sceneIndoorAssets';
import { SCENE_GROUND, sceneLitColor } from '../../../../../packages/contracts/src/campus-scenes/sceneLightingPalette';
import { scenePlantSilhouette } from '../../../../../packages/contracts/src/campus-scenes/scenePlantSilhouettes';
import { DEFAULT_SCENE_SUNLIGHT, sceneShadowOffset, type SceneSunlight } from '../../../../../packages/contracts/src/campus-scenes/sceneSunlight';

type Point = CampusScenePoint;
type Lighting = 'day' | 'night';
/** An affine presentation transform. It never changes saved campus coordinates. */
export type CampusDrawingMatrix = readonly [number, number, number, number, number, number];
export type CampusDrawingFill = string | { kind: 'linear'; start: Point; end: Point; colors: string[]; positions?: number[] } | { kind: 'radial'; center: Point; radius: number; colors: string[]; positions?: number[] };
interface CommandStyle {
  fill?: CampusDrawingFill;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  dash?: number[];
  clip?: Point[];
  transform?: CampusDrawingMatrix;
  /** Diagnostic semantic only, never an operational state or identity. */
  detail?: string;
  /** Transparent decorative light/shadow cannot become an interaction target. */
  decorative?: boolean;
}
export type CampusDrawingCommand = CommandStyle & (
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'polyline'; points: Point[] }
  | { kind: 'oval'; x: number; y: number; width: number; height: number }
  | { kind: 'path'; path: string; bounds: SceneBounds; hitPolygon?: Point[] }
);
export interface CampusDrawingPart {
  key: string;
  /** The original editable element, including for display-only wall fragments. */
  elementId: string | null;
  spaceId: string | null;
  holdingId: string | null;
  role: 'surroundings' | 'ground' | 'shadow' | 'asset';
  bounds: SceneBounds;
  commands: CampusDrawingCommand[];
}
export interface CompiledCampusDrawing {
  groundColor: string;
  bounds: SceneBounds;
  parts: CampusDrawingPart[];
  /** One union per exact original identity, not a name/proximity association. */
  elementBounds: ReadonlyMap<string, SceneBounds>;
  stats: { elements: number; parts: number; commands: number; decorativeTrees: number };
}
export interface CompileCampusDrawingOptions {
  /** Callers with editor-specific visibility may supply the already-filtered set. */
  elements?: readonly CampusSceneElement[];
  floorId?: string | null;
  mode: SceneViewMode;
  lighting: Lighting;
  sunlight?: SceneSunlight;
  unavailableIds?: ReadonlySet<string> | readonly string[];
  interiorOutline?: readonly Point[];
  includeSurroundings?: boolean;
  /** A resource-state refresh can prepare only its own geometry/shadow. */
  includeBase?: boolean;
  /** Small detail is bounded per asset, independently of camera frame rate. */
  detail?: 'full' | 'balanced';
  interiorGroundColor?: string;
  statusColor?: string;
}

const TAU = Math.PI * 2;
const groundY = projectScenePoint({ x: 0, y: 1 }).y;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const rectangle = (x: number, y: number, width: number, height: number): Point[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const matrixPoint = (p: Point, m?: CampusDrawingMatrix): Point => m ? { x: p.x * m[0] + p.y * m[2] + m[4], y: p.x * m[1] + p.y * m[3] + m[5] } : p;
const expanded = (b: SceneBounds, padding: number): SceneBounds => ({ x: b.x - padding, y: b.y - padding, width: b.width + 2 * padding, height: b.height + 2 * padding });
function union(boxes: readonly SceneBounds[]): SceneBounds {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  return scenePointBounds(boxes.flatMap(b => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }]));
}
function blend(a: string, b: string, t: number) {
  return `#${[1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
}
function commandBounds(command: CampusDrawingCommand): SceneBounds {
  let points: Point[];
  if (command.kind === 'polygon' || command.kind === 'polyline') points = command.points;
  else if (command.kind === 'oval') points = rectangle(command.x, command.y, command.width, command.height);
  else points = rectangle(command.bounds.x, command.bounds.y, command.bounds.width, command.bounds.height);
  const strokeScale = command.transform ? Math.max(Math.hypot(command.transform[0], command.transform[1]), Math.hypot(command.transform[2], command.transform[3])) : 1;
  return expanded(scenePointBounds(points.map(p => matrixPoint(p, command.transform))), (command.strokeWidth ?? 0) * strokeScale / 2);
}
function makePart(key: string, source: CampusSceneElement | null, role: CampusDrawingPart['role'], commands: CampusDrawingCommand[]): CampusDrawingPart {
  return { key, elementId: source?.id ?? null, spaceId: source?.space_id ?? null, holdingId: source?.holding_id ?? null, role, commands, bounds: union(commands.map(commandBounds)) };
}

class Drawing {
  commands: CampusDrawingCommand[] = [];
  constructor(readonly mode: SceneViewMode, readonly unit: number, readonly lighting: Lighting, readonly sunlight: SceneSunlight, readonly full: boolean) {}
  lit = (color: string) => sceneLitColor(color, this.lighting);
  project = (points: readonly Point[], z = 0) => points.map(p => projectScenePoint(p, z, this.mode));
  polygon(points: Point[], fill?: CampusDrawingFill, stroke?: string, width = 0, style: CommandStyle = {}) { this.commands.push({ kind: 'polygon', points, fill, stroke, strokeWidth: width, ...style }); }
  line(points: Point[], stroke: string, width: number, style: CommandStyle = {}) { this.commands.push({ kind: 'polyline', points, stroke, strokeWidth: width, ...style }); }
  oval(cx: number, cy: number, rx: number, ry: number, fill?: CampusDrawingFill, stroke?: string, width = 0, style: CommandStyle = {}) {
    this.commands.push({ kind: 'oval', x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2, fill, stroke, strokeWidth: width, ...style });
  }
  path(path: string, bounds: SceneBounds, fill?: CampusDrawingFill, stroke?: string, width = 0, style: CommandStyle & { hitPolygon?: Point[] } = {}) { this.commands.push({ kind: 'path', path, bounds, fill, stroke, strokeWidth: width, ...style }); }
  plane(points: readonly Point[], fill?: CampusDrawingFill, stroke?: string, width = 0, z = 0, style: CommandStyle = {}) { this.polygon(this.project(points, z), fill, stroke, width, style); }
  planeLine(points: readonly Point[], stroke: string, width: number, z = 0, style: CommandStyle = {}) { this.line(this.project(points, z), stroke, width, style); }
  quad(a: Point, b: Point, bottom: number, top: number) { return [projectScenePoint(a, bottom, this.mode), projectScenePoint(b, bottom, this.mode), projectScenePoint(b, top, this.mode), projectScenePoint(a, top, this.mode)]; }
  planeOval(cx: number, cy: number, rx: number, ry: number, fill?: CampusDrawingFill, stroke?: string, width = 0, style: CommandStyle = {}) {
    const p = projectScenePoint({ x: cx, y: cy }, 0, this.mode);
    this.oval(p.x, p.y, rx, ry * (this.mode === '2.5d' ? groundY : 1), fill, stroke, width, style);
  }
}

function drawBuilding(d: Drawing, e: CampusSceneElement) {
  const { unit: u, mode, full, lighting, sunlight } = d;
  const pts = e.geometry.points, height = sceneElementHeight(e, u), b = scenePointBounds(pts);
  if (pts.length < 3) return;
  const source = sceneMaterial(e), m = { roof: d.lit(source.roof), shade: d.lit(source.shade), light: d.lit(source.light), edge: d.lit(source.edge), glass: d.lit(source.glass), mullion: d.lit(source.mullion) };
  if (mode === '2d') {
    if (e.kind === 'room') {
      d.polygon(pts, lighting === 'night' ? '#2b3741' : '#f3f1e8', undefined, 0, { detail: 'room-floor' });
      const tile = Math.max(u * 1.2, b.width / 90, b.height / 90), lines: string[] = [];
      for (let x = Math.ceil(b.x / tile) * tile; x < b.x + b.width; x += tile) lines.push(`M ${x} ${b.y} V ${b.y + b.height}`);
      for (let y = Math.ceil(b.y / tile) * tile; y < b.y + b.height; y += tile) lines.push(`M ${b.x} ${y} H ${b.x + b.width}`);
      d.path(lines.join(' '), b, undefined, lighting === 'night' ? '#52616c' : '#c6c9c3', u * .035, { opacity: .65, clip: pts, decorative: true, detail: 'floor-tiles' });
      d.polygon(pts, undefined, lighting === 'night' ? '#b2bdc5' : '#53616a', u * .25);
    } else {
      d.polygon(pts, m.roof, m.shade, u * .35);
      d.polygon(pts, undefined, m.edge, u * .6);
    }
    return;
  }
  const faces = sceneBuildingFaces(pts, height), levels = Math.max(1, e.levels ?? Math.round(height / (3.6 * u)));
  const glazed = e.asset_key === 'library' || e.asset_key === 'laboratory' || e.material === 'glass', hall = e.asset_key === 'auditorium';
  const accent = d.lit(e.asset_key === 'academic' ? '#527d7e' : e.asset_key === 'library' ? '#3e707c' : e.asset_key === 'dining' ? '#89633e' : source.shade);
  const seed = stableSeed(e.id), entryFace = faces.reduce((best, face, i) => {
    const previous = faces[best];
    return !previous || Math.hypot(face.edge[1].x - face.edge[0].x, face.edge[1].y - face.edge[0].y) > Math.hypot(previous.edge[1].x - previous.edge[0].x, previous.edge[1].y - previous.edge[0].y) ? i : best;
  }, 0);
  for (const [fi, face] of faces.entries()) {
    const [a, z] = face.edge, length = Math.hypot(z.x - a.x, z.y - a.y);
    const faceBounds = scenePointBounds(face.points);
    // One reflection shader per facade, reused by every window rather than one
    // native shader per pane. The vertical falloff also gives the glazing depth.
    const glazing: CampusDrawingFill = { kind: 'linear', start: { x: faceBounds.x, y: faceBounds.y }, end: { x: faceBounds.x, y: faceBounds.y + faceBounds.height }, colors: lighting === 'night' ? ['#f2cf85', '#dba75c', '#9f7947'] : ['#9dc6cb', m.glass, '#274a57'], positions: [0, .48, 1] };
    const direct = Math.max(0, -face.normal.x * sunlight.direction.x - face.normal.y * sunlight.direction.y) * Math.cos(sunlight.altitude) * sunlight.strength;
    d.polygon(face.points, blend(m.shade, m.light, lighting === 'night' ? .4 : .3 + .7 * direct), m.shade, u * .12, { detail: 'facade' });
    const columns = Math.max(1, Math.min(full ? 24 : 12, Math.floor(length / ((hall ? 7 : glazed ? 5.2 : e.asset_key === 'residence' ? 3.2 : 3.7) * u))));
    const rows = Math.min(full ? 12 : 8, hall ? 1 : levels), rowHeight = height / rows;
    if (e.material === 'brick' && full) {
      const courses: string[] = [];
      for (let i = 1; i <= Math.min(40, levels * 5); i++) {
        const p = projectScenePoint(a, i * height / (levels * 5)), q = projectScenePoint(z, i * height / (levels * 5));
        courses.push(`M ${p.x} ${p.y} L ${q.x} ${q.y}`);
      }
      d.path(courses.join(' '), scenePointBounds(face.points), undefined, d.lit('#ddb190'), u * .1, { opacity: .22, decorative: true, detail: 'brick-courses' });
    }
    for (let row = 0; row < rows; row++) {
      const bottom = row * rowHeight + rowHeight * (glazed ? .14 : .22), top = bottom + rowHeight * (glazed ? .72 : hall ? .63 : .55);
      d.polygon(d.quad(a, z, row * rowHeight, row * rowHeight + u * .23), accent, undefined, 0, { opacity: .78 });
      d.planeLine([a, z], m.edge, u * .16, row * rowHeight + u * .28, { opacity: .85 });
      // A bounded number of windows is recorded once; camera/people frames reuse the picture.
      for (let col = 0; col < columns; col++) {
        const inset = glazed ? .08 : e.asset_key === 'residence' ? .26 : .18;
        const first = lerp(a, z, (col + inset) / columns), last = lerp(a, z, (col + 1 - inset) / columns);
        const window = d.quad(first, last, bottom, top);
        d.polygon(d.quad(first, last, bottom - u * .12, top + u * .12), face.light ? m.shade : d.lit('#456261'));
        const darkWindow = lighting === 'night' && (seed + fi * 3 + row * 5 + col) % 7 < 2;
        d.polygon(window, darkWindow ? d.lit('#24414e') : glazing, m.mullion, u * .16, { detail: 'window' });
        if (full) {
          const mid = lerp(first, last, .5);
          d.line([projectScenePoint(mid, bottom), projectScenePoint(mid, top)], m.mullion, u * .12);
          d.planeLine([first, last], m.mullion, u * .1, bottom + (top - bottom) * .62, { opacity: .8 });
          d.planeLine([first, last], m.edge, u * .3, bottom - u * .13);
        }
      }
    }
    d.polygon(d.quad(a, z, 0, Math.min(u * .55, height * .08)), m.shade, undefined, 0, { opacity: .65 });
    d.polygon(d.quad(a, z, height - u * .65, height), accent);
    d.planeLine([a, z], m.edge, u * .25, height);
    if (fi === entryFace && length > u * 8) {
      const w = Math.min(u * (glazed ? 5 : 4), length * .26), h = Math.min(u * 2.8, height * .8);
      const first = lerp(a, z, .5 - w / length / 2), last = lerp(a, z, .5 + w / length / 2);
      const frontFirst = { x: first.x + face.normal.x * u * 1.3, y: first.y + face.normal.y * u * 1.3 }, frontLast = { x: last.x + face.normal.x * u * 1.3, y: last.y + face.normal.y * u * 1.3 };
      d.polygon(d.quad(lerp(a, z, .5 - (w + u * .9) / length / 2), lerp(a, z, .5 + (w + u * .9) / length / 2), 0, h + u * .35), m.edge);
      d.polygon(d.quad(first, last, 0, h), lighting === 'night' ? '#c09b64' : '#284d57', m.edge, u * .18, { detail: 'entrance' });
      d.polygon(d.quad(first, last, h * .7, h), lighting === 'night' ? '#d5b37e' : '#7aa9b3');
      d.line([projectScenePoint(lerp(first, last, .5)), projectScenePoint(lerp(first, last, .5), h)], m.mullion, u * .12);
      for (const p of [frontFirst, frontLast]) d.line([projectScenePoint(p), projectScenePoint(p, h + u * .18)], m.edge, u * .2);
      d.polygon(d.quad(frontFirst, frontLast, h, h + u * .18), m.shade);
      d.plane([first, last, frontLast, frontFirst], accent, m.edge, u * .16, h + u * .18, { detail: 'entrance-canopy' });
    }
  }
  const roofs = sceneRoofFaces(pts, height, e.roof, u), flat = roofs.length === 1;
  roofs.forEach((points, i) => d.polygon(points, flat ? m.roof : d.lit(['#7b8a85', '#536d6d', '#a1aaa0', '#6d8179'][i % 4]!), flat ? m.edge : d.lit('#aebeb0'), u * .23, { detail: 'roof' }));
  if (flat) {
    const roof = d.project(pts, height), lines: string[] = [];
    for (let i = 1; i <= Math.min(24, Math.ceil(b.height / (7 * u))); i++) {
      const p = projectScenePoint({ x: b.x, y: b.y + i * 7 * u }, height), q = projectScenePoint({ x: b.x + b.width, y: b.y + i * 7 * u }, height);
      lines.push(`M ${p.x} ${p.y} L ${q.x} ${q.y}`);
    }
    d.path(lines.join(' '), scenePointBounds(roof), undefined, d.lit('#6f8986'), u * .17, { clip: roof, opacity: .45, decorative: true });
    d.polygon(roof, undefined, m.edge, u * .7);
  }
}

function drawSurface(d: Drawing, e: CampusSceneElement) {
  const u = d.unit, pts = e.geometry.points, b = scenePointBounds(pts), key = e.asset_key ?? e.material, clip = d.project(pts);
  const water = key === 'water' || e.material === 'water', sports = key === 'sports', parking = key === 'parking', flowers = key === 'flower_bed';
  const paved = e.material === 'paving' || key === 'paving', grass = e.material === 'grass' || key === 'grass' || sports;
  const fill = flowers ? '#786f4d' : water ? '#548f97' : parking ? '#7e8e8b' : paved ? '#d7cdb6' : e.material === 'sand' ? '#c9ab76' : grass ? '#84a65e' : '#bec7b3';
  d.plane(pts, d.lit(fill), d.lit(water ? '#b7c69d' : paved ? '#b3b598' : '#668c54'), u * .7);
  const { x, y, width: w, height: h } = b;
  const planeRect = (rx: number, ry: number, rw: number, rh: number, color?: string, stroke?: string, width = 0, style: CommandStyle = {}) => d.plane(rectangle(rx, ry, rw, rh), color, stroke, width, 0, { clip, ...style });
  if (water) {
    d.plane(pts, undefined, d.lit('#71b2ad'), u * 3, 0, { opacity: .45, clip });
    for (let i = 0; i < 5; i++) {
      const p = projectScenePoint({ x: x + w * (.2 + (i % 3) * .11), y: y + h * (.24 + i * .12) }, 0, d.mode), length = w * (i % 2 ? .21 : .3), rise = h * .035 * (d.mode === '2.5d' ? groundY : 1);
      d.path(`M ${p.x} ${p.y} q ${length * .23} ${rise} ${length * .5} 0 t ${length * .5} 0`, scenePointBounds([{ x: p.x, y: p.y - rise }, { x: p.x + length, y: p.y + rise }]), undefined, d.lit('#b2cdc0'), u * .2, { opacity: .4, clip, decorative: true });
    }
  }
  if (flowers) {
    d.plane(pts, undefined, d.lit('#a0ad77'), u * 1.8, 0, { clip });
    const count = Math.min(48, Math.max(6, Math.floor(w * h / (u * u * 10)))), columns = Math.max(2, Math.ceil(w / (3 * u)));
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / columns), px = x + (i % columns + .5 + (row % 2) * .24) * w / columns, py = y + (row + .7) * 2.6 * u;
      d.planeOval(px, py, u * 1.15, u * .85, d.lit(i % 2 ? '#5d7949' : '#75844b'), undefined, 0, { clip, decorative: true });
      for (const [dx, dy] of [[-.42, -.18], [.28, .1], [0, -.5]]) d.planeOval(px + dx! * u, py + dy! * u, u * .23, u * .23, d.lit(['#d6b57a', '#b58691', '#d6d0aa'][i % 3]!), undefined, 0, { clip, decorative: true });
    }
  }
  if (grass) for (let i = 0; i < 10; i++) planeRect(x + (sports && h >= w ? 0 : w * i / 10), y + (sports && h >= w ? h * i / 10 : 0), sports && h >= w ? w : w / 20, sports && h >= w ? h / 20 : h, d.lit('#c5d69a'), undefined, 0, { opacity: .22, decorative: true });
  if (sports) {
    const white = d.lit('#edf0d7'), vertical = h >= w, sw = u * .35;
    planeRect(x + w * .1, y + h * .1, w * .8, h * .8, undefined, white, sw);
    d.planeLine(vertical ? [{ x: x + w * .1, y: y + h * .5 }, { x: x + w * .9, y: y + h * .5 }] : [{ x: x + w * .5, y: y + h * .1 }, { x: x + w * .5, y: y + h * .9 }], white, sw);
    d.planeOval(x + w * .5, y + h * .5, Math.min(w, h) * .13, Math.min(w, h) * .13, undefined, white, sw);
    d.planeOval(x + w * .5, y + h * .5, u * .24, u * .24, white);
    for (const end of [0, 1]) {
      planeRect(x + w * (vertical ? .3 : end ? .77 : .1), y + h * (vertical ? end ? .77 : .1 : .3), w * (vertical ? .4 : .13), h * (vertical ? .13 : .4), undefined, white, sw);
      planeRect(x + w * (vertical ? .4 : end ? .845 : .1), y + h * (vertical ? end ? .845 : .1 : .4), w * (vertical ? .2 : .055), h * (vertical ? .055 : .2), undefined, white, sw);
      const span = Math.min(7.32 * u, (vertical ? w : h) * .27), gh = Math.min(2.44 * u, span * .38), depth = Math.min(2 * u, span * .3);
      if (d.mode === '2.5d' && span >= u * 1.5) {
        const center = vertical ? { x: x + w * .5, y: y + h * (end ? .9 : .1) } : { x: x + w * (end ? .9 : .1), y: y + h * .5 };
        const a = { x: center.x - (vertical ? span / 2 : 0), y: center.y - (vertical ? 0 : span / 2) }, z = { x: center.x + (vertical ? span / 2 : 0), y: center.y + (vertical ? 0 : span / 2) };
        const offset = { x: vertical ? 0 : depth * (end ? 1 : -1), y: vertical ? depth * (end ? 1 : -1) : 0 }, c = { x: a.x + offset.x, y: a.y + offset.y }, f = { x: z.x + offset.x, y: z.y + offset.y };
        d.polygon(d.quad(c, f, 0, gh * .8), d.lit('#dce1ce'), undefined, 0, { opacity: .13, decorative: true });
        for (const t of [.2, .4, .6, .8]) d.line([projectScenePoint(lerp(c, f, t)), projectScenePoint(lerp(c, f, t), gh * .8), projectScenePoint(lerp(a, z, t), gh)], d.lit('#dce1ce'), u * .065, { decorative: true });
        d.line([projectScenePoint(a), projectScenePoint(a, gh), projectScenePoint(z, gh), projectScenePoint(z)], white, u * .25, { detail: 'goal-post' });
      }
    }
  }
  if (parking) {
    const lines: string[] = [], at = (px: number, py: number) => projectScenePoint({ x: px, y: py }, 0, d.mode);
    for (let i = 0; i <= Math.min(32, Math.floor(w / (3 * u))); i++) for (const [a, z] of [[.08, .33], [.67, .92]]) { const p = at(x + i * 3 * u, y + h * a!), q = at(x + i * 3 * u, y + h * z!); lines.push(`M ${p.x} ${p.y} L ${q.x} ${q.y}`); }
    for (const t of [.33, .67]) { const p = at(x, y + h * t), q = at(x + w, y + h * t); lines.push(`M ${p.x} ${p.y} L ${q.x} ${q.y}`); }
    d.path(lines.join(' '), scenePointBounds(clip), undefined, d.lit('#d5d6c6'), u * .25, { clip, decorative: true, detail: 'parking-markings' });
  }
  if (paved) {
    const lines: string[] = [], step = Math.max(3 * u, w / 36, h / 36);
    for (let i = step; i < w; i += step) { const [a, z] = d.project([{ x: x + i, y }, { x: x + i, y: y + h }]); lines.push(`M ${a!.x} ${a!.y} L ${z!.x} ${z!.y}`); }
    for (let i = step; i < h; i += step) { const [a, z] = d.project([{ x, y: y + i }, { x: x + w, y: y + i }]); lines.push(`M ${a!.x} ${a!.y} L ${z!.x} ${z!.y}`); }
    d.path(lines.join(' '), scenePointBounds(clip), undefined, d.lit('#b9bdad'), u * .15, { opacity: .6, clip, decorative: true });
  }
}

function drawRoad(d: Drawing, e: CampusSceneElement) {
  const pts = e.geometry.points, width = sceneElementWidth(e, d.unit), road = e.kind === 'road', u = d.unit;
  d.planeLine(pts, d.lit(road ? '#b9c2ac' : '#b1b698'), width + u * .8);
  d.planeLine(pts, d.lit(road ? '#758887' : '#ddd3b8'), width);
  if (road) {
    d.planeLine(pts, d.lit('#b4c0b5'), Math.max(u * .16, width * .018), 0, { dash: [u * 2.2, u * 3.8], opacity: .85, decorative: true, detail: 'road-markings' });
    d.planeLine(pts, d.lit('#8fa09a'), Math.max(u * .08, width * .012), 0, { opacity: .4, decorative: true });
  } else d.planeLine(pts, d.lit('#eee6d2'), u * .12, 0, { opacity: .6, decorative: true });
  if (e.review_state === 'reviewed' && e.navigation?.status === 'closed') {
    const color = d.lighting === 'night' ? '#dda398' : '#985c53';
    d.planeLine(pts, color, Math.max(u * .3, width * .11), 0, { dash: [u * 1.2, u * 1.8], opacity: .9, decorative: true, detail: 'reviewed-route-closed' });
    const middle = polylineMiddle(pts);
    if (middle) {
      const half = width * .43, normal = { x: -middle.direction.y, y: middle.direction.x };
      const bar = [{ x: middle.point.x - normal.x * half, y: middle.point.y - normal.y * half }, { x: middle.point.x + normal.x * half, y: middle.point.y + normal.y * half }];
      d.planeLine(bar, d.lighting === 'night' ? '#283239' : '#eee7d7', u * .8, 0, { decorative: true });
      d.planeLine(bar, color, u * .4, 0, { decorative: true, detail: 'reviewed-route-closed-bar' });
    }
  }
}

/** Display position only; this never adds a navigation junction or a route. */
function polylineMiddle(points: readonly Point[]): { point: Point; direction: Point } | null {
  const segments = points.slice(1).map((b, i) => ({ a: points[i]!, b, length: Math.hypot(b.x - points[i]!.x, b.y - points[i]!.y) })).filter(segment => segment.length > .00001);
  let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  for (const segment of segments) {
    if (remaining <= segment.length) return { point: lerp(segment.a, segment.b, remaining / segment.length), direction: { x: (segment.b.x - segment.a.x) / segment.length, y: (segment.b.y - segment.a.y) / segment.length } };
    remaining -= segment.length;
  }
  return null;
}

function drawClosedBadge(d: Drawing, center: Point, radius: number, detail: string) {
  const color = d.lighting === 'night' ? '#dda398' : '#985c53', background = d.lighting === 'night' ? '#252e35' : '#f2ecdf', style = { decorative: true, detail };
  d.oval(center.x, center.y, radius, radius, background, color, radius * .11, style);
  const r = radius * .4;
  d.line([{ x: center.x - r, y: center.y - r }, { x: center.x + r, y: center.y + r }], color, radius * .16, style);
  d.line([{ x: center.x + r, y: center.y - r }, { x: center.x - r, y: center.y + r }], color, radius * .16, style);
}

function drawBoundary(d: Drawing, e: CampusSceneElement) {
  const u = d.unit, width = sceneElementWidth(e, u), h = sceneElementHeight(e, u), pts = e.geometry.points;
  if (d.mode === '2d') { d.planeLine(pts, d.lit('#b4afa0'), Math.max(width, u * .55)); return; }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, z = pts[i]!, length = Math.hypot(z.x - a.x, z.y - a.y), nx = -(z.y - a.y) / Math.max(.001, length) * width / 2, ny = (z.x - a.x) / Math.max(.001, length) * width / 2;
    const body = [{ x: a.x + nx, y: a.y + ny }, { x: z.x + nx, y: z.y + ny }, { x: z.x - nx, y: z.y - ny }, { x: a.x - nx, y: a.y - ny }];
    for (const face of sceneBuildingFaces(body, h)) d.polygon(face.points, d.lit(face.light ? '#b9b5a4' : '#929c8f'), d.lit('#939e8b'), u * .06);
    d.plane(body, d.lit('#d3d0b8'), d.lit('#a5aa94'), u * .09, h, { detail: 'wall-cap' });
    const count = Math.max(1, Math.min(16, Math.ceil(length / (u * 5))));
    for (let j = 0; j <= count; j++) {
      const p = lerp(a, z, j / count), r = Math.max(width * .75, u * .32), post = rectangle(p.x - r, p.y - r, r * 2, r * 2);
      for (const face of sceneBuildingFaces(post, h + u * .28)) d.polygon(face.points, d.lit('#bdbca8'), d.lit('#a4aa94'), u * .04);
      d.plane(post, d.lit('#e0dac2'), undefined, 0, h + u * .28);
    }
  }
}

function drawTree(d: Drawing, e: CampusSceneElement) {
  const s = scenePlantSilhouette(e, d.mode, d.unit);
  if (!s) return;
  const { ground: g, crown: c, width: w, projectedHeight: h, seed } = s, lit = d.lit;
  if (e.asset_key === 'tree_palm') {
    if (d.mode === '2.5d') d.path(`M ${g.x} ${g.y} Q ${g.x - w * .07} ${g.y - h * .5} ${c.x} ${c.y}`, scenePointBounds([g, c, { x: g.x - w * .07, y: g.y - h * .5 }]), undefined, lit('#8b8461'), w * .055);
    const frondBounds = { x: c.x - w * .7, y: c.y - w * .55, width: w * 1.4, height: w * 1.1 };
    s.palmFronds.forEach((path, i) => d.path(path, frondBounds, lit(i % 2 ? '#486e48' : '#739052'), lit('#496e47'), w * .009, { detail: 'palm-frond' }));
    d.oval(c.x, c.y, w * .055, w * .055, lit('#9d9e61'));
    // Filled leaf paths have nonrectangular bounds. This invisible hit polygon follows the crown.
    d.polygon(ellipsePolygon(c.x, c.y, w * .6, w * .22), undefined, undefined, 0, { detail: 'plant-hit' });
    return;
  }
  if (e.asset_key === 'tree_conifer') {
    if (d.mode === '2d') { d.polygon(s.coniferPlan, lit('#3e6850'), lit('#5c7c55'), d.unit * .15); return; }
    d.line([g, { x: g.x, y: g.y - h * .35 }], lit('#776d52'), w * .065);
    s.coniferTiers.forEach((path, i) => d.path(path, { x: g.x - w * .52, y: g.y - h, width: w * 1.04, height: h }, lit(['#335c48', '#426b4f', '#527753'][i]!), undefined, 0, { detail: 'conifer-tier', hitPolygon: [{ x: g.x, y: g.y - h * (i === 0 ? .78 : i === 1 ? .91 : 1) }, { x: g.x - w * [.52, .37, .23][i]!, y: g.y - h * (.12 + i * .21) }, { x: g.x + w * [.52, .37, .23][i]!, y: g.y - h * (.12 + i * .21) }] }));
    return;
  }
  if (d.mode === '2.5d' && !s.shrub) {
    d.line([g, { x: s.cx, y: s.cy + h * .12 }], lit('#82745a'), w * (s.columnar ? .065 : .075));
    if (d.full) d.line([{ x: g.x - w * .16, y: g.y - h * .51 }, { x: g.x, y: g.y - h * .35 }, { x: g.x + w * .14, y: g.y - h * .53 }], lit('#82745a'), w * .025);
  }
  const leaf = ['#4c744b', '#618047', '#547b4a'][seed % 3]!, transform: CampusDrawingMatrix = [s.scaleX, 0, 0, s.scaleY, s.cx, s.cy];
  d.path(s.organicPath, { x: -.62, y: -.55, width: 1.24, height: 1.1 }, { kind: 'linear', start: { x: -.4, y: -.45 }, end: { x: .4, y: .45 }, colors: [lit(s.shrub ? '#87935e' : '#84995e'), lit(leaf), lit('#35583f')], positions: [0, .45, 1] }, undefined, 0, { transform, detail: 'organic-canopy', hitPolygon: ellipsePolygon(0, 0, .53, .46, 24) });
  if (d.full) {
    d.path('M -.43 .16 Q -.2 .35 .02 .27 Q .26 .35 .43 .13 Q .34 .43 .09 .35 Q -.2 .43 -.43 .16', { x: -.43, y: .13, width: .86, height: .3 }, lit('#35543e'), undefined, 0, { transform, opacity: .2, decorative: true });
    d.path('M -.29 -.22 Q -.1 -.4 .12 -.27 M -.37 -.01 Q -.2 -.13 -.07 -.07', { x: -.37, y: -.4, width: .5, height: .4 }, undefined, lit('#b1bc83'), .035, { transform, opacity: .2, decorative: true });
  }
}

function drawFixture(d: Drawing, e: CampusSceneElement, unavailable: boolean) {
  const p = e.geometry.points[0]; if (!p) return;
  const u = d.unit, w = sceneElementWidth(e, u), h = sceneElementHeight(e, u), g = projectScenePoint(p, 0, d.mode), t = projectScenePoint(p, h, d.mode), lit = d.lit;
  if (isSceneIndoorAssetKey(e.asset_key)) { drawIndoor(d, e, unavailable); return; }
  if (e.navigation_connector) { drawConnector(d, e); return; }
  if (e.asset_key === 'water_point' || e.asset_key === 'equipment') { drawOperational(d, e); return; }
  if (e.asset_key === 'lamp') {
    if (d.lighting === 'night' && !unavailable) {
      const glow = (cx: number, cy: number, radius: number): CampusDrawingFill => ({ kind: 'radial', center: { x: cx, y: cy }, radius, colors: ['#ffe4a5ad', '#f4c3784d', '#edb95e00'], positions: [0, .3, 1] });
      d.oval(g.x + w * .8, g.y, w * 4, w * 2, glow(g.x + w * .8, g.y, w * 4), undefined, 0, { detail: 'lamp-glow', decorative: true });
      d.oval(t.x + w * .8, t.y, w * 2.3, w * 2.3, glow(t.x + w * .8, t.y, w * 2.3), undefined, 0, { detail: 'lamp-glow', decorative: true });
    }
    d.oval(g.x, g.y, w * .27, w * .16, lit('#bbc0a8'), lit('#8b9888'), u * .1);
    d.line([g, t], lit('#526b68'), u * .26, { detail: 'lamp-pole' });
    if (d.mode === '2.5d') d.line([{ x: g.x - u * .07, y: g.y - u * .25 }, { x: t.x - u * .07, y: t.y + u * .2 }], lit('#a5b1a4'), u * .065);
    d.path(`M ${t.x} ${t.y} q ${w * .5} ${-w * .3} ${w * .8} 0`, { x: t.x, y: t.y - w * .3, width: w * .8, height: w * .3 }, undefined, lit('#7e8981'), u * .25);
    d.oval(t.x + w * .8, t.y, w * .3, w * .12, d.lighting === 'night' ? unavailable ? lit('#526365') : '#fff1ba' : '#e9e5cc', lit('#8d988b'), u * .12, { detail: 'lamp-head' });
    return;
  }
  if (e.asset_key === 'gate') {
    const angle = (e.rotation_deg ?? 0) * Math.PI / 180, a = { x: p.x - Math.cos(angle) * w / 2, y: p.y - Math.sin(angle) * w / 2 }, z = { x: p.x + Math.cos(angle) * w / 2, y: p.y + Math.sin(angle) * w / 2 };
    d.planeLine([a, z], lit('#526d64'), u * .75, h * .85);
    d.planeLine([a, z], lit('#b4b9a2'), u * .15, h * .85 + u * .25);
    d.planeLine([a, z], lit('#647b6c'), u * .18, h * .22);
    for (let i = 0; i < 10; i++) { const q = lerp(a, z, (i + .5) / 10); d.line([projectScenePoint(q, u * .3, d.mode), projectScenePoint(q, h * .7, d.mode)], lit('#778b7c'), u * .12); }
    for (const q of [a, z]) {
      const r = Math.min(w * .085, u * .8), corners = rectangle(q.x - r, q.y - r, r * 2, r * 2);
      if (d.mode === '2.5d') for (const face of sceneBuildingFaces(corners, h)) d.polygon(face.points, lit(face.light ? '#cbbd9c' : '#9b947c'), lit('#9b947c'), u * .08);
      d.plane(corners, lit('#e1d7bb'), lit('#b8ae90'), u * .15, h, { detail: 'gate-pier' });
      for (const level of [.13, .87]) d.planeLine([...corners, corners[0]!], lit('#ddd1b2'), u * .22, h * level);
    }
    if (e.review_state === 'reviewed' && e.navigation?.status === 'closed') drawClosedBadge(d, projectScenePoint(p, d.mode === '2.5d' ? h * .47 : 0, d.mode), Math.min(w * .17, u * 1.5), 'reviewed-gate-closed');
    return;
  }
  // Bench is a programmable slatted seat, with authored width/rotation retained.
  const angle = (e.rotation_deg ?? 0) * Math.PI / 180;
  const local = (x: number, y: number): Point => ({ x: p.x + x * Math.cos(angle) - y * Math.sin(angle), y: p.y + x * Math.sin(angle) + y * Math.cos(angle) });
  const [a, z, c, f] = [local(-w / 2, -w * .13), local(w / 2, -w * .13), local(w / 2, w * .13), local(-w / 2, w * .13)] as [Point, Point, Point, Point];
  if (d.mode === '2.5d') for (const q of [lerp(a, z, .16), lerp(a, z, .84)]) d.line([projectScenePoint(q), projectScenePoint(q, h * .55)], lit('#67796c'), u * .25);
  d.plane([a, z, c, f], lit('#ac8c64'), lit('#896e50'), u * .12, h * .55);
  for (const t of [.33, .66]) d.planeLine([lerp(a, f, t), lerp(z, c, t)], lit('#d4af7b'), u * .065, h * .55);
  d.planeLine([a, z], lit('#bc9b70'), u * .4, h);
}

function drawOperational(d: Drawing, e: CampusSceneElement) {
  const p = e.geometry.points[0]!, u = d.unit, w = sceneElementWidth(e, u), h = sceneElementHeight(e, u), lit = d.lit;
  const body = rectangle(p.x - w * .5, p.y - w * .28, w, w * .56), water = e.asset_key === 'water_point', bh = water ? h * .72 : h;
  d.plane(rectangle(p.x - w * .62, p.y - w * .39, w * 1.24, w * .78), lit('#b4b8a9'), lit('#84988f'), u * .07);
  if (d.mode === '2.5d') for (const [i, face] of sceneBuildingFaces(body, bh).entries()) d.polygon(face.points, lit(i % 2 ? '#849d9c' : '#b5c2bb'), lit('#6f8889'), u * .04);
  d.plane(body, lit('#dce1d5'), lit('#8c9e98'), u * .06, bh, { detail: water ? 'water-point' : 'equipment-cabinet' });
  if (water) for (const fraction of [.27, .73]) {
    const cx = p.x - w * .5 + w * fraction, cy = p.y + w * .03;
    d.plane(rectangle(cx - w * .17, cy - w * .17, w * .34, w * .29), lit('#637f85'), lit('#e1e7df'), u * .065, h * .73);
    d.plane(rectangle(cx - w * .13, cy - w * .12, w * .26, w * .19), lit('#879e9d'), undefined, 0, h * .735);
    const tap = { x: cx, y: cy - w * .13 };
    d.line([projectScenePoint(tap, h * .72, d.mode), projectScenePoint(tap, h * .89, d.mode)], lit('#d3ddd5'), u * .08);
  } else if (d.mode === '2.5d') {
    const a = { x: p.x - w * .36, y: p.y + w * .28 }, z = { x: p.x + w * .18, y: p.y + w * .28 };
    for (let i = 0; i < 5; i++) d.planeLine([a, z], lit('#4f7477'), u * .05, h * (.24 + i * .105));
    d.polygon(d.quad({ x: p.x + w * .3, y: p.y + w * .28 }, { x: p.x + w * .34, y: p.y + w * .28 }, h * .4, h * .57), lit('#d7dbc8'));
  }
}

function drawConnector(d: Drawing, e: CampusSceneElement) {
  const p = e.geometry.points[0]!, c = e.navigation_connector!, width = sceneElementWidth(e, d.unit), x = p.x - width / 2, y = p.y - width / 2, u = d.unit, lit = d.lit;
  d.plane(rectangle(x, y, width, width), lit('#e4dfcf'), lit('#718a85'), u * .1, 0, { detail: `connector-${c.kind}` });
  if (c.kind === 'stairs') for (let i = 0; i < 6; i++) d.planeLine([{ x: x + width * .16, y: y + width * (.17 + i * .125) }, { x: x + width * .84, y: y + width * (.17 + i * .125) }], lit('#6c8885'), u * .08);
  else if (c.kind === 'lift') {
    d.plane(rectangle(x + width * .2, y + width * .17, width * .6, width * .65), lit('#9bb3b0'), lit('#5a7c80'), u * .08);
    d.planeLine([{ x: p.x, y: y + width * .19 }, { x: p.x, y: y + width * .8 }], lit('#d8e0d6'), u * .08);
  }
  d.planeLine([{ x: p.x, y: y + width * .78 }, { x: p.x, y: y + width * .25 }, { x: p.x - width * .1, y: y + width * .36 }], lit('#3d636b'), u * .11);
  if (e.review_state === 'reviewed' && c.status === 'closed') drawClosedBadge(d, projectScenePoint({ x: x + width * .79, y: y + width * .2 }, 0, d.mode), width * .15, 'reviewed-connector-closed');
}

/** Authored, room-proportional floor-plan symbols remain independent from holdings. */
function drawIndoor(d: Drawing, e: CampusSceneElement, unavailable: boolean) {
  const p = e.geometry.points[0]!, { width: w, depth: h, rotation } = sceneIndoorDimensions(e, d.unit), angle = rotation * Math.PI / 180, sy = d.mode === '2.5d' ? groundY : 1;
  const matrix: CampusDrawingMatrix = [Math.cos(angle), Math.sin(angle) * sy, -Math.sin(angle), Math.cos(angle) * sy, p.x, p.y * sy];
  const night = d.lighting === 'night', ink = night ? '#c2cfd1' : '#5d6b70', soft = night ? '#33454e' : '#e8ece9', white = night ? '#697c83' : '#fcfbf7', wood = night ? '#8d806d' : '#d3b58a', blue = night ? '#6e9aa8' : '#93b8c4', sw = Math.min(w, h) * .035;
  const style = { transform: matrix }, x = -w / 2, y = -h / 2;
  const rect = (rx: number, ry: number, rw: number, rh: number, fill?: string, stroke = ink, width = sw) => d.polygon(rectangle(rx, ry, rw, rh), fill, stroke, width, style);
  const line = (pts: Point[], stroke = ink, width = sw) => d.line(pts, stroke, width, style);
  const oval = (cx: number, cy: number, rx: number, ry: number, fill: string, stroke?: string, width = 0) => d.oval(cx, cy, rx, ry, fill, stroke, width, style);
  const body = (fill: string) => rect(x, y, w, h, fill);
  switch (e.asset_key) {
    case 'desk': body(wood); line([{ x: x + w * .07, y: y + h * .12 }, { x: x + w * .93, y: y + h * .12 }], white, sw); line([{ x: x + w * .08, y: y + h * .83 }, { x: x + w * .92, y: y + h * .83 }], white, sw); break;
    case 'chair':
      line([{ x: -w * .35, y: h * .3 }, { x: w * .35, y: -h * .2 }], ink, sw * 1.7); line([{ x: w * .35, y: h * .3 }, { x: -w * .35, y: -h * .2 }], ink, sw * 1.7); rect(-w * .36, -h * .22, w * .72, h * .61, blue); rect(x, y, w, h * .24, ink); break;
    case 'computer':
      rect(-w * .1, -h * .2, w * .2, h * .65, ink); rect(-w * .23, h * .22, w * .46, h * .15, soft); rect(x, y, w, h * .55, ink); rect(x + w * .055, y + h * .06, w * .89, h * .4, unavailable ? soft : blue); line([{ x: -w * .37, y: h * .43 }, { x: w * .37, y: h * .43 }], ink, h * .1); break;
    case 'meeting_table':
      oval(0, 0, w / 2, h / 2, wood, ink, sw); oval(0, 0, w * .45, h * .38, wood, white, sw); oval(0, 0, h * .035, h * .035, ink); break;
    case 'cabinet': body(wood); line([{ x: 0, y }, { x: 0, y: -y }]); for (const t of [-.08, .08]) line([{ x: w * t, y: -h * .12 }, { x: w * t, y: h * .12 }]); break;
    case 'server_rack':
      body(night ? '#293b44' : '#536a76'); for (let i = 0; i < 6; i++) { rect(x + w * .1, y + h * (.08 + i * .14), w * .8, h * .1, ink); line([{ x: -w * .27, y: y + h * (.13 + i * .14) }, { x: w * .18, y: y + h * (.13 + i * .14) }], soft); oval(w * .29, y + h * (.13 + i * .14), sw, sw, unavailable ? soft : '#d7b85e'); } break;
    case 'printer': body(white); rect(-w * .32, -h * .25, w * .64, h * .28, blue); rect(-w * .3, h * .12, w * .6, h * .22, soft); line([{ x: -w * .24, y: h * .2 }, { x: w * .24, y: h * .2 }]); break;
    case 'fire_extinguisher': body('#b85447'); line([{ x: -w * .25, y }, { x: -w * .25, y: y - h * .2 }, { x: w * .18, y: y - h * .2 }, { x: w * .45, y: y + h * .3 }], ink, sw * 2); rect(-w * .22, -h * .15, w * .44, h * .3, '#f3e5d2', '#f3e5d2'); break;
    case 'first_aid': body(white); line([{ x: -w * .25, y: 0 }, { x: w * .25, y: 0 }], '#498b72', Math.min(w, h) * .15); line([{ x: 0, y: -h * .3 }, { x: 0, y: h * .3 }], '#498b72', Math.min(w, h) * .15); break;
    case 'toilet': rect(-w * .42, y, w * .84, h * .27, white); oval(0, h * .12, w * .4, h * .35, white, ink, sw); oval(0, h * .12, w * .23, h * .21, soft, ink, sw * .7); break;
    case 'washbasin': body(white); oval(0, 0, w * .32, h * .28, soft, ink, sw); oval(0, 0, sw, sw, ink); line([{ x: 0, y }, { x: 0, y: y + h * .23 }], ink, sw * 2); break;
    case 'door': {
      line([{ x, y }, { x: -x, y }], night ? '#2c3740' : '#fffdf7', d.unit * .5);
      const arc = Array.from({ length: 17 }, (_, i) => ({ x: x + Math.sin(i / 16 * Math.PI / 2) * w, y: y + Math.cos(i / 16 * Math.PI / 2) * w }));
      line([{ x, y }, { x, y: y + w }, ...arc]); line([{ x, y }, { x, y: y + w }], wood, sw * 3); break;
    }
    case 'window': body(blue); line([{ x: 0, y }, { x: 0, y: -y }], white, sw * 2); line([{ x, y: 0 }, { x: -x, y: 0 }], white, sw * 2); break;
    case 'projector': body(white); oval(w * .23, 0, h * .22, h * .22, blue, ink, sw); for (const t of [-.12, .12]) line([{ x: -w * .3, y: h * t }, { x: -w * .05, y: h * t }]); break;
    case 'whiteboard': body(white); line([{ x: -w * .42, y: h * .4 }, { x: w * .42, y: h * .4 }], ink, sw * 2); break;
  }
}

function drawShadow(d: Drawing, e: CampusSceneElement) {
  const p = e.geometry.points[0], h = sceneElementHeight(e, d.unit), w = sceneElementWidth(e, d.unit), night = d.sunlight.strength <= 0;
  if (!p || !h || d.mode !== '2.5d') return;
  const offset = sceneShadowOffset(scenePresentationHeight(h), d.sunlight), color = night ? '#080e12' : '#304936';
  if (e.kind === 'tree' || e.kind === 'fixture') {
    if (isSceneIndoorAssetKey(e.asset_key)) return;
    const length = Math.hypot(offset.x, offset.y), center = projectScenePoint({ x: p.x + offset.x * .72, y: p.y + offset.y * .72 }), r = w * .62 + length * .24, angle = Math.atan2(offset.y, offset.x);
    if (!night) d.planeLine([p, { x: p.x + offset.x * .72, y: p.y + offset.y * .72 }], color, w * .16, 0, { opacity: .16, decorative: true });
    d.oval(0, 0, r, w * .48, { kind: 'radial', center: { x: 0, y: 0 }, radius: r, colors: [`${color}38`, `${color}26`, `${color}00`], positions: [0, .55, 1] }, undefined, 0, { transform: [Math.cos(angle), Math.sin(angle) * groundY, -Math.sin(angle), Math.cos(angle) * groundY, center.x, center.y], opacity: night ? .8 : 1, decorative: true, detail: 'contact-shadow' });
  } else if (e.kind === 'building' || e.kind === 'room') {
    if (night) d.plane(e.geometry.points, color, color, d.unit * 1.3, 0, { opacity: .24, decorative: true });
    else {
      const pts = e.geometry.points, moved = pts.map(q => ({ x: q.x + offset.x, y: q.y + offset.y })), style = { opacity: .14 + d.sunlight.strength * .08, decorative: true, detail: 'cast-shadow' };
      d.plane(moved, color, undefined, 0, 0, style);
      pts.forEach((q, i) => d.plane([q, pts[(i + 1) % pts.length]!, moved[(i + 1) % pts.length]!, moved[i]!], color, undefined, 0, 0, style));
    }
  }
}

function stableSeed(value: string): number { return [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7); }
function random(seed: number): number { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function ellipsePolygon(cx: number, cy: number, rx: number, ry: number, count = 16): Point[] { return Array.from({ length: count }, (_, i) => ({ x: cx + Math.cos(i / count * TAU) * rx, y: cy + Math.sin(i / count * TAU) * ry })); }

/** Bounded illustrative context, deliberately without DT identities or hit targets. */
function drawSurroundings(scene: CampusSceneDocument, options: CompileCampusDrawingOptions, unit: number, sunlight: SceneSunlight): { part: CampusDrawingPart; trees: number } {
  const d = new Drawing(options.mode, unit, options.lighting, sunlight, options.detail !== 'balanced'), longest = Math.max(scene.bounds.width, scene.bounds.height), pad = longest * .6;
  const { width, height } = scene.bounds, span = longest * 2.2, seed = Math.round(width * 13 + height * 7), treeUnit = Math.min(longest / 120, Math.max(longest / 360, unit * .85));
  const riverWidth = Math.max(treeUnit * 12, longest * .045), riverX = -longest * .08;
  const river = Array.from({ length: 65 }, (_, i) => { const y = -pad + i / 64 * (height + pad * 2); return { x: riverX + Math.sin(y / (longest * .7) + random(seed) * 3) * longest * .01 + Math.sin(y / (longest * .29)) * longest * .005, y }; });
  for (const [factor, color] of [[1.68, '#8caa77'], [1.28, '#bfbc91'], [1, '#60969b'], [.68, '#7eafb0']] as const) d.planeLine(river, d.lit(color), riverWidth * factor, 0, { decorative: true });
  const approaches = scene.elements.flatMap(e => e.asset_key === 'gate' ? e.geometry.points.map(p => ({ point: p, width: sceneElementWidth(e, unit), gate: true })) : (e.kind === 'road' || e.kind === 'path') && e.asset_key !== 'boundary_wall' ? [e.geometry.points[0], e.geometry.points.at(-1)].filter((p): p is Point => !!p).map(p => ({ point: p, width: sceneElementWidth(e, unit), gate: false })) : []);
  const exits = approaches.filter(a => Math.min(a.point.x, a.point.y, width - a.point.x, height - a.point.y) <= (a.gate ? Math.max(unit * 8, a.width / 2) : a.width / 2 + unit * .1)).slice(0, 32);
  const clearApproach = (p: Point, radius: number) => exits.some(a => {
    const distances = [a.point.y, width - a.point.x, height - a.point.y, a.point.x], edge = distances.indexOf(Math.min(...distances)), half = Math.max(a.width * .6 + unit * 2, unit * 5) + radius;
    return edge === 0 || edge === 2 ? Math.abs(p.x - a.point.x) < half && (edge === 0 ? p.y < radius : p.y > height - radius) : Math.abs(p.y - a.point.y) < half && (edge === 3 ? p.x < radius : p.x > width - radius);
  });
  const placements: CampusSceneElement[] = [], columns = 34, rows = Math.max(20, Math.min(40, Math.round((height + pad * 2) / span * columns)));
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const s = seed + col * 151.7 + row * 319.3;
    if (random(s) < .35) continue;
    const p = { x: -pad + (col + random(s + 7)) / columns * (width + pad * 2), y: -pad + (row + random(s + 13)) / rows * (height + pad * 2) };
    const variant = Math.floor(random(s + 17) * 4), tw = treeUnit * (variant === 2 ? 8 : variant === 3 ? 5 : 12) * (.8 + random(s + 23) * .4), th = treeUnit * (variant === 0 ? 17 : variant === 1 ? 18 : 23);
    const r = tw * .75, clearanceY = sceneProjectedHeight(th) / groundY + r;
    if (p.x + r > 0 && p.x - r < width && p.y + r > 0 && p.y - clearanceY < height) continue;
    if (clearApproach(p, r)) continue;
    const riverAt = riverX + Math.sin(p.y / (longest * .7) + random(seed) * 3) * longest * .01 + Math.sin(p.y / (longest * .29)) * longest * .005;
    if (Math.abs(p.x - riverAt) < riverWidth * .9 + r) continue;
    placements.push({ id: `illustration:${row}:${col}`, kind: 'tree', label: '', asset_key: ['tree_broadleaf', 'tree_broadleaf', 'tree_conifer', 'tree_columnar'][variant] as CampusSceneElement['asset_key'], geometry: { type: 'point', points: [p] }, space_id: null, floor_id: null, review_state: 'reviewed', width: tw, height: th });
  }
  const limited = placements.sort((a, b) => a.geometry.points[0]!.y - b.geometry.points[0]!.y).slice(0, 600);
  for (const e of limited) { drawShadow(d, e); drawTree(d, e); }
  return { part: makePart('illustrative-surroundings', null, 'surroundings', d.commands), trees: limited.length };
}

/** Compile at scene/state/lighting boundaries, never on a camera or animation frame. */
export function compileCampusSceneDrawing(scene: CampusSceneDocument, options: CompileCampusDrawingOptions): CompiledCampusDrawing {
  const unit = sceneUnitScale(scene), sunlight = options.lighting === 'night' ? { ...(options.sunlight ?? DEFAULT_SCENE_SUNLIGHT), strength: 0 } : options.sunlight ?? DEFAULT_SCENE_SUNLIGHT;
  const elements = scenePaintOrder(options.elements ?? sceneVisibleElements(scene.elements, options.floorId));
  const unavailable = options.unavailableIds instanceof Set ? options.unavailableIds : new Set(options.unavailableIds ?? []), interior = !!options.floorId || !!options.interiorOutline;
  const full = options.detail !== 'balanced', parts: CampusDrawingPart[] = [], elementBounds = new Map<string, SceneBounds>();
  const groundColor = interior ? options.interiorGroundColor ?? (options.lighting === 'night' ? '#202a31' : '#f4f4ef') : SCENE_GROUND[options.lighting];
  let decorativeTrees = 0;
  if (options.includeBase !== false && !interior && options.mode === '2.5d' && options.includeSurroundings !== false) {
    const backdrop = drawSurroundings(scene, options, unit, sunlight); parts.push(backdrop.part); decorativeTrees = backdrop.trees;
  }
  const ground = new Drawing(options.mode, unit, options.lighting, sunlight, full);
  if (options.includeBase !== false && options.interiorOutline?.length) ground.plane(options.interiorOutline, options.lighting === 'night' ? '#2c3740' : '#fbfaf5', options.lighting === 'night' ? '#65717b' : '#d1d4cd', unit * .3);
  else if (options.includeBase !== false && !interior) {
    ground.plane(rectangle(0, 0, scene.bounds.width, scene.bounds.height), groundColor);
    const grain: string[] = [], seed = Math.round(scene.bounds.width * 13 + scene.bounds.height * 7);
    for (let i = 0; i < 180; i++) {
      const p = projectScenePoint({ x: random(seed + i * 13) * scene.bounds.width, y: random(seed + i * 19) * scene.bounds.height }, 0, options.mode);
      grain.push(`M ${p.x} ${p.y} l ${unit * .18} ${-unit * .28}`);
    }
    ground.path(grain.join(' '), scenePointBounds(ground.project(rectangle(0, 0, scene.bounds.width, scene.bounds.height))), undefined, ground.lit('#758956'), unit * .11, { opacity: options.lighting === 'night' ? .15 : .2, decorative: true, detail: 'ground-grain' });
  }
  if (ground.commands.length) parts.push(makePart('campus-ground', null, 'ground', ground.commands));
  const addAsset = (key: string, element: CampusSceneElement, source = element) => {
    const d = new Drawing(options.mode, unit, options.lighting, sunlight, full), isUnavailable = unavailable.has(source.id);
    if (element.kind === 'building' || element.kind === 'room') drawBuilding(d, element);
    else if (element.asset_key === 'boundary_wall') drawBoundary(d, element);
    else if (element.kind === 'road' || element.kind === 'path') drawRoad(d, element);
    else if (element.kind === 'surface') drawSurface(d, element);
    else if (element.kind === 'tree') drawTree(d, element);
    else drawFixture(d, element, isUnavailable);
    if (isUnavailable && element.geometry.points[0]) {
      const p = projectScenePoint(element.geometry.points[0], sceneElementHeight(element, unit), options.mode);
      d.oval(p.x, p.y, unit * 1.5, unit * 1.5, options.statusColor ?? '#bb665d', options.lighting === 'night' ? '#202a31' : '#ffffff', unit * .4, { detail: 'unavailable-status' });
    }
    const part = makePart(key, source, element.kind === 'surface' || (element.kind === 'road' || element.kind === 'path') && element.asset_key !== 'boundary_wall' ? 'ground' : 'asset', d.commands);
    parts.push(part); elementBounds.set(source.id, elementBounds.has(source.id) ? union([elementBounds.get(source.id)!, part.bounds]) : part.bounds);
  };
  const groundElements = elements.filter(e => e.asset_key !== 'boundary_wall' && ['surface', 'road', 'path'].includes(e.kind));
  groundElements.forEach(e => addAsset(e.id, e));
  if (options.mode === '2.5d') for (const e of elements) { const d = new Drawing(options.mode, unit, options.lighting, sunlight, full); drawShadow(d, e); if (d.commands.length) parts.push(makePart(`${e.id}:shadow`, e, 'shadow', d.commands)); }
  const elevated = sceneDrawingParts(elements, unit, options.mode), ordered = options.mode === '2d' ? [...elevated.filter(p => p.element.kind === 'room'), ...elevated.filter(p => p.element.kind !== 'room')] : elevated;
  ordered.forEach(p => addAsset(p.key, p.element, p.source));
  return { groundColor, bounds: union(parts.map(p => p.bounds)), parts, elementBounds, stats: { elements: elements.length, parts: parts.length, commands: parts.reduce((n, p) => n + p.commands.length, 0), decorativeTrees } };
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(.0000001, dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function polygonContains(p: Point, points: readonly Point[], tolerance: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if (tolerance > 0 && distanceToSegment(p, a, b) <= tolerance) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function inBounds(p: Point, b: SceneBounds, tolerance: number) { return p.x >= b.x - tolerance && p.x <= b.x + b.width + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.height + tolerance; }
function inversePoint(p: Point, m?: CampusDrawingMatrix): Point | null {
  if (!m) return p;
  const determinant = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(determinant) < 1e-9) return null;
  const x = p.x - m[4], y = p.y - m[5];
  return { x: (x * m[3] - y * m[2]) / determinant, y: (y * m[0] - x * m[1]) / determinant };
}
function commandHit(command: CampusDrawingCommand, point: Point, tolerance: number) {
  if (command.decorative || (command.opacity ?? 1) === 0) return false;
  if (command.clip && !polygonContains(point, command.clip, 0)) return false;
  const p = inversePoint(point, command.transform); if (!p) return false;
  const transformScale = command.transform ? Math.max(.0001, Math.min(Math.hypot(command.transform[0], command.transform[1]), Math.hypot(command.transform[2], command.transform[3]))) : 1;
  const t = tolerance / transformScale + (command.strokeWidth ?? 0) / 2;
  if (command.kind === 'polygon') return (command.fill || command.detail === 'plant-hit') ? polygonContains(p, command.points, t) : command.points.some((q, i) => distanceToSegment(p, q, command.points[(i + 1) % command.points.length]!) <= t);
  if (command.kind === 'polyline') return command.points.slice(1).some((q, i) => distanceToSegment(p, command.points[i]!, q) <= t);
  if (command.kind === 'oval') {
    const rx = command.width / 2, ry = command.height / 2;
    return ((p.x - command.x - rx) / Math.max(.0001, rx + t)) ** 2 + ((p.y - command.y - ry) / Math.max(.0001, ry + t)) ** 2 <= 1;
  }
  return command.hitPolygon ? polygonContains(p, command.hitPolygon, t) : false;
}

/** Hit the same prepared geometry in reverse paint order. Returned IDs are exact scene IDs. */
export function pickCampusDrawing(drawing: CompiledCampusDrawing, projectedPoint: Point, options: { tolerance?: number; draftPreview?: boolean } = {}): string | null {
  const tolerance = Math.max(0, options.tolerance ?? 0);
  for (let i = drawing.parts.length - 1; i >= 0; i--) {
    const p = drawing.parts[i]!;
    if (!p.elementId || p.role === 'shadow' || p.role === 'surroundings' || !options.draftPreview && !p.spaceId && !p.holdingId || !inBounds(projectedPoint, p.bounds, tolerance)) continue;
    if (p.commands.some(command => commandHit(command, projectedPoint, tolerance))) return p.elementId;
  }
  return null;
}

/** Optional JS-boundary culling retains the original global painter sequence. */
export function visibleCampusDrawingParts(drawing: CompiledCampusDrawing, viewport: SceneBounds, padding = 0): CampusDrawingPart[] {
  const b = expanded(viewport, Math.max(0, padding));
  return drawing.parts.filter(p => p.bounds.x <= b.x + b.width && p.bounds.x + p.bounds.width >= b.x && p.bounds.y <= b.y + b.height && p.bounds.y + p.bounds.height >= b.y);
}

export interface CampusPictureLayerPlan {
  key: string;
  elementId: string | null;
  /** Neutral ground/backdrop; a permitted source image may follow these layers. */
  base: boolean;
  parts: CampusDrawingPart[];
}

/** Static runs split at every mutable display fragment, including shadows. A
 * source-plan insertion boundary also splits a static run without reordering it. */
export function planCampusScenePictureLayers(drawing: CompiledCampusDrawing, mutableElementIds: ReadonlySet<string>): CampusPictureLayerPlan[] {
  const layers: CampusPictureLayerPlan[] = [];
  let staticParts: CampusDrawingPart[] = [], staticBase = false, serial = 0;
  const flush = () => {
    if (!staticParts.length) return;
    layers.push({ key: `static:${serial++}`, elementId: null, base: staticBase, parts: staticParts });
    staticParts = [];
  };
  for (const part of drawing.parts) {
    if (!part.commands.length) continue;
    const base = part.elementId === null;
    if (part.elementId && mutableElementIds.has(part.elementId)) {
      flush();
      layers.push({ key: `resource:${part.key}`, elementId: part.elementId, base: false, parts: [part] });
    } else {
      if (staticParts.length && base !== staticBase) flush();
      staticBase = base;
      staticParts.push(part);
    }
  }
  flush();
  return layers;
}
