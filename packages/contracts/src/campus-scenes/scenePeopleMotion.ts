import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";
import { findSceneWalkingRoute, type SceneWalkingRequest, type SceneWalkingRoute } from "./sceneWalking";
import { sceneElementWidth, scenePointBounds } from "./sceneGeometry";
import { scenePolygonClearance, scenePolygonContains } from "./sceneEvidencePlacement";

/** Presentation identity only. Its caller still owns authorization and source validity. */
export interface ScenePeopleMotionScope { worldKey: string; publicationKey: string; networkKey: string }
export interface ScenePeopleMotionEdge {
  elementId: string; floorId: string | null; from: CampusScenePoint; to: CampusScenePoint;
  startDistance: number; endDistance: number; length: number; legIndex: number;
  corridor: { from: CampusScenePoint; to: CampusScenePoint; width: number } | null;
}
export interface ScenePeopleRoutePlan {
  provenance: "illustrative";
  scope: ScenePeopleMotionScope; fromSpaceId: string | null; toSpaceId: string;
  unit: CampusSceneDocument["bounds"]["unit"]; length: number;
  edges: readonly ScenePeopleMotionEdge[];
  transitions: readonly { distance: number; elementId: string; kind: "entrance" | "stairs" | "lift"; fromFloorId: string | null; toFloorId: string | null }[];
}
export interface ScenePeopleRouteSample {
  provenance: "illustrative";
  /** Both coordinates are illustrations, never tracked positions. */
  point: CampusScenePoint; centerlinePoint: CampusScenePoint; floorId: string | null;
  heading: number; distance: number; edgeIndex: number; elementId: string;
  complete: boolean; fitsCorridor: boolean;
}
export interface ScenePeopleLaneOptions { laneFraction?: number; bodyRadius?: number }
export type ScenePeopleRoutingOptions = Pick<SceneWalkingRequest, "accessibleOnly" | "excludedConnectorIds">;
export type ScenePeopleRouteResult = { status: "available"; plan: ScenePeopleRoutePlan } | {
  status: "unavailable";
  reason: Extract<SceneWalkingRoute, { status: "unavailable" }>["reason"] | "invalid_route" | "context_changed" | "current_edge_unavailable";
};
export interface ScenePeopleMotionWindow { startsAtMs: number; endsAtMs: number }
export interface ScenePeopleClockSample { scope: ScenePeopleMotionScope; epoch: string; instantMs: number | null }

const EPSILON = 1e-7;
const finitePoint = (point: CampusScenePoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (a: CampusScenePoint, b: CampusScenePoint) => Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;
const sameScope = (a: ScenePeopleMotionScope, b: ScenePeopleMotionScope) => a.worldKey === b.worldKey && a.publicationKey === b.publicationKey && a.networkKey === b.networkKey;
const validScope = (scope: ScenePeopleMotionScope) => Boolean(scope.worldKey && scope.publicationKey && scope.networkKey);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const interpolate = (a: CampusScenePoint, b: CampusScenePoint, progress: number) => ({ x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress });
const seed = (key: string) => {
  let value = 2166136261;
  for (let index = 0; index < key.length; index++) value = Math.imul(value ^ key.charCodeAt(index), 16777619);
  return (value >>> 0) / 4294967296;
};

function pointOnSegment(point: CampusScenePoint, a: CampusScenePoint, b: CampusScenePoint) {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  if (squared <= EPSILON * EPSILON) return samePoint(point, a);
  const fraction = ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared;
  return fraction >= -EPSILON && fraction <= 1 + EPSILON && samePoint(point, interpolate(a, b, clamp(fraction, 0, 1)));
}

function reviewedCorridor(scene: CampusSceneDocument, edge: Pick<ScenePeopleMotionEdge, "elementId" | "floorId" | "from" | "to">) {
  const element = scene.elements.find(item => item.id === edge.elementId);
  if (!element || element.kind !== "path" || element.asset_key === "boundary_wall" || element.geometry.type !== "polyline"
    || element.floor_id !== edge.floorId || element.review_state !== "reviewed" || !element.navigation?.walkable || element.navigation.status !== "open") return null;
  const index = element.geometry.points.findIndex((a, index, points) => {
    const b = points[index + 1];
    return b && !samePoint(a, b) && pointOnSegment(edge.from, a, b) && pointOnSegment(edge.to, a, b);
  });
  return index < 0 ? null : { element, index, from: element.geometry.points[index]!, to: element.geometry.points[index + 1]! };
}

/** Cumulative drawing distance, with explicit floor transfers and no invented connector duration or ETA. */
export function compileScenePeopleRoute(route: SceneWalkingRoute, scope: ScenePeopleMotionScope, scene?: CampusSceneDocument): ScenePeopleRoutePlan | null {
  if (route.status !== "available" || !validScope(scope)) return null;
  const legs = route.legs?.length ? route.legs : route.segments.map(segment => ({ ...segment, kind: "walk" as const }));
  const edges: ScenePeopleMotionEdge[] = [], transitions: ScenePeopleRoutePlan["transitions"][number][] = [];
  let length = 0, previous: { point: CampusScenePoint; floorId: string | null } | null = null;
  for (const [legIndex, leg] of legs.entries()) {
    if (leg.kind !== "walk") {
      if (!previous || !finitePoint(leg.point) || !samePoint(previous.point, leg.point) || previous.floorId !== leg.fromFloorId) return null;
      if (scene) {
        const element = scene.elements.find(item => item.id === leg.elementId), connector = element?.navigation_connector;
        if (!element || element.kind !== "fixture" || element.review_state !== "reviewed" || !connector || connector.status !== "open"
          || connector.kind !== leg.kind || !element.geometry.points[0] || !samePoint(element.geometry.points[0], leg.point)
          || !(connector.from_floor_id === leg.fromFloorId && connector.to_floor_id === leg.toFloorId || connector.from_floor_id === leg.toFloorId && connector.to_floor_id === leg.fromFloorId)) return null;
      }
      transitions.push({ distance: length, elementId: leg.elementId, kind: leg.kind, fromFloorId: leg.fromFloorId, toFloorId: leg.toFloorId });
      previous = { point: leg.point, floorId: leg.toFloorId };
      continue;
    }
    if (leg.points.length < 2 || leg.points.some(point => !finitePoint(point))) return null;
    if (previous && (!samePoint(previous.point, leg.points[0]!) || previous.floorId !== leg.floorId)) return null;
    for (let index = 1; index < leg.points.length; index++) {
      const from = leg.points[index - 1]!, to = leg.points[index]!, distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (!Number.isFinite(distance)) return null;
      if (distance <= EPSILON) continue;
      const edge = { elementId: leg.elementId, floorId: leg.floorId, from: { ...from }, to: { ...to }, startDistance: length, endDistance: length + distance, length: distance, legIndex };
      const corridor = scene ? reviewedCorridor(scene, edge) : null;
      if (scene && !corridor) return null;
      edges.push({ ...edge, corridor: corridor ? { from: { ...corridor.from }, to: { ...corridor.to }, width: sceneElementWidth(corridor.element, scene!.bounds.unit === "metres" ? 1 : Math.max(scene!.bounds.width, scene!.bounds.height) / 250) } : null });
      length += distance;
    }
    previous = { point: leg.points.at(-1)!, floorId: leg.floorId };
  }
  return edges.length ? { provenance: "illustrative", scope: { ...scope }, fromSpaceId: route.fromSpaceId, toSpaceId: route.toSpaceId, unit: route.unit, length, edges, transitions } : null;
}

/** Sample world coordinates directly; frame rate and wall time cannot change travelled distance. */
export function sampleScenePeopleRoute(plan: ScenePeopleRoutePlan, distance: number, options: ScenePeopleLaneOptions = {}): ScenePeopleRouteSample | null {
  if (!Number.isFinite(distance) || !plan.edges.length || !Number.isFinite(plan.length) || plan.length <= 0) return null;
  const travelled = clamp(distance, 0, plan.length);
  let low = 0, high = plan.edges.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (plan.edges[middle]!.endDistance <= travelled) low = middle + 1; else high = middle;
  }
  const edge = plan.edges[low]!, progress = clamp((travelled - edge.startDistance) / edge.length, 0, 1);
  const centerlinePoint = interpolate(edge.from, edge.to, progress), point = { ...centerlinePoint };
  const radius = Number.isFinite(options.bodyRadius) ? Math.max(0, options.bodyRadius!) : 0;
  const fraction = Number.isFinite(options.laneFraction) ? clamp(options.laneFraction!, -1, 1) : 0;
  const fitsCorridor = Boolean(edge.corridor && radius <= edge.corridor.width / 2);
  if (edge.corridor && fitsCorridor && fraction) {
    const { from, to, width } = edge.corridor, dx = to.x - from.x, dy = to.y - from.y, span = Math.hypot(dx, dy);
    const along = Math.hypot(centerlinePoint.x - from.x, centerlinePoint.y - from.y);
    const taper = Math.min(1, along / Math.max(width, EPSILON), (span - along) / Math.max(width, EPSILON));
    const offset = fraction * Math.max(0, width / 2 - radius) * Math.max(0, taper);
    point.x -= dy / span * offset; point.y += dx / span * offset;
  }
  return { provenance: "illustrative", point, centerlinePoint, floorId: edge.floorId, heading: Math.atan2(edge.to.y - edge.from.y, edge.to.x - edge.from.x), distance: travelled,
    edgeIndex: low, elementId: edge.elementId, complete: travelled === plan.length, fitsCorridor };
}

/** Re-route only from the exact current reviewed edge; this local split is never persisted or exposed as a place. */
export function retargetScenePeopleRoute(scene: CampusSceneDocument, plan: ScenePeopleRoutePlan, distance: number, toSpaceId: string,
  scope: ScenePeopleMotionScope, options: ScenePeopleRoutingOptions = {}): ScenePeopleRouteResult {
  if (!sameScope(plan.scope, scope) || !validScope(scope)) return { status: "unavailable", reason: "context_changed" };
  const sample = sampleScenePeopleRoute(plan, distance);
  if (!sample) return { status: "unavailable", reason: "invalid_route" };
  const edge = plan.edges[sample.edgeIndex]!, source = reviewedCorridor(scene, edge);
  if (!source || !edge.corridor || !samePoint(source.from, edge.corridor.from) || !samePoint(source.to, edge.corridor.to)
    || Math.abs(sceneElementWidth(source.element, scene.bounds.unit === "metres" ? 1 : Math.max(scene.bounds.width, scene.bounds.height) / 250) - edge.corridor.width) > EPSILON)
    return { status: "unavailable", reason: "current_edge_unavailable" };
  const point = sample.centerlinePoint, path = source.element, navigation = path.navigation!;
  let origin = samePoint(point, path.geometry.points[0]!) ? navigation.start_space_id : samePoint(point, path.geometry.points.at(-1)!) ? navigation.end_space_id : null;
  let routingScene = scene;
  const fragments = new Set<string>();
  if (!origin) {
    const used = new Set(scene.elements.flatMap(element => [element.id, element.space_id ?? "", element.navigation?.start_space_id ?? "", element.navigation?.end_space_id ?? ""]));
    origin = "__scene_people_edge_origin";
    while (used.has(origin)) origin += "_";
    const prefix = path.geometry.points.slice(0, source.index + 1), suffix = path.geometry.points.slice(source.index + 1);
    if (!samePoint(prefix.at(-1)!, point)) prefix.push(point);
    if (!samePoint(suffix[0]!, point)) suffix.unshift(point);
    const pieces = [
      { points: prefix, start_space_id: navigation.start_space_id, end_space_id: origin },
      { points: suffix, start_space_id: origin, end_space_id: navigation.end_space_id },
    ].filter(piece => piece.points.length >= 2);
    const split = pieces.map((piece, index) => {
      let id = `${origin}_path_${index}`;
      while (used.has(id)) id += "_";
      used.add(id); fragments.add(id);
      return { ...path, id, geometry: { ...path.geometry, points: piece.points }, navigation: { ...navigation, start_space_id: piece.start_space_id, end_space_id: piece.end_space_id } };
    });
    routingScene = { ...scene, elements: scene.elements.flatMap(element => element.id === path.id ? split : [element]) };
  }
  const route = findSceneWalkingRoute(routingScene, { ...options, fromSpaceId: origin, toSpaceId });
  if (route.status !== "available") return route;
  const restored = { ...route, segments: route.segments.map(segment => fragments.has(segment.elementId) ? { ...segment, elementId: path.id } : segment),
    legs: route.legs?.map(leg => fragments.has(leg.elementId) ? { ...leg, elementId: path.id } : leg) };
  const next = compileScenePeopleRoute(restored, scope, scene);
  return next ? { status: "available", plan: { ...next, fromSpaceId: null } } : { status: "unavailable", reason: "invalid_route" };
}

/** Confirmed-clock sampling only. Staggering is visual, bounded and never an attendance or travel-time claim. */
export function scenePeopleMotionProgress(instantMs: number | null, window: ScenePeopleMotionWindow, illustrationKey: string, staggerFraction = .12): number | null {
  const duration = window.endsAtMs - window.startsAtMs;
  if (instantMs === null || !Number.isFinite(instantMs) || !Number.isFinite(window.startsAtMs) || !Number.isFinite(window.endsAtMs)
    || !Number.isFinite(duration) || duration <= 0 || instantMs < window.startsAtMs || instantMs >= window.endsAtMs) return null;
  const stagger = Number.isFinite(staggerFraction) ? clamp(staggerFraction, 0, .25) : 0;
  const delay = duration * stagger * seed(illustrationKey);
  return clamp((instantMs - window.startsAtMs - delay) / (duration - delay), 0, 1);
}

/** Rebase from source intent on seeks/context changes; never animate an old world into a new one. */
export function canRetargetScenePeopleMotion(previous: ScenePeopleClockSample, next: ScenePeopleClockSample): boolean {
  return sameScope(previous.scope, next.scope) && validScope(next.scope) && Boolean(next.epoch) && previous.epoch === next.epoch
    && previous.instantMs !== null && next.instantMs !== null && Number.isFinite(previous.instantMs) && Number.isFinite(next.instantMs) && next.instantMs >= previous.instantMs;
}

/** Stable anonymous slots only in linked, reviewed room/surface polygons. */
export function scenePeopleIdleSlots(element: CampusSceneElement, count: number, unit: number, groupKey: string, bodyRadius = unit * .65): CampusScenePoint[] {
  if (!element.space_id || element.review_state !== "reviewed" || !["room", "surface"].includes(element.kind) || element.geometry.type !== "polygon"
    || !Number.isFinite(count) || count < 1 || !Number.isFinite(unit) || unit <= 0 || !Number.isFinite(bodyRadius) || bodyRadius < 0) return [];
  const bounds = scenePointBounds(element.geometry.points), candidates: { point: CampusScenePoint; rank: number }[] = [];
  for (let row = 0; row < 9; row++) for (let column = 0; column < 9; column++) {
    const point = { x: bounds.x + bounds.width * (column + .5) / 9, y: bounds.y + bounds.height * (row + .5) / 9 };
    if (scenePolygonContains(point, element.geometry.points) && scenePolygonClearance(point, element.geometry.points) >= bodyRadius)
      candidates.push({ point, rank: seed(`${element.id}:${groupKey}:${row}:${column}`) });
  }
  const chosen: CampusScenePoint[] = [];
  for (const { point } of candidates.sort((a, b) => a.rank - b.rank)) {
    if (chosen.every(other => Math.hypot(point.x - other.x, point.y - other.y) >= bodyRadius * 2)) chosen.push(point);
    if (chosen.length >= Math.min(8, Math.floor(count))) break;
  }
  return chosen;
}

/** A caller-owned bounded cache; creating another scope cannot read or fall back to this snapshot. */
export function createScenePeopleRouteResolver(scene: CampusSceneDocument, scope: ScenePeopleMotionScope, capacity = 128) {
  const limit = Number.isFinite(capacity) ? clamp(Math.floor(capacity), 1, 512) : 128;
  const snapshot = structuredClone(scene), context = { ...scope }, cache = new Map<string, ScenePeopleRouteResult>();
  return {
    resolve(fromSpaceId: string, toSpaceId: string, options: ScenePeopleRoutingOptions = {}): ScenePeopleRouteResult {
      const key = JSON.stringify([context.worldKey, context.publicationKey, context.networkKey, fromSpaceId, toSpaceId, Boolean(options.accessibleOnly), [...(options.excludedConnectorIds ?? [])].sort()]);
      const retained = cache.get(key);
      if (retained) { cache.delete(key); cache.set(key, retained); return retained; }
      const route = findSceneWalkingRoute(snapshot, { ...options, fromSpaceId, toSpaceId });
      const plan = compileScenePeopleRoute(route, context, snapshot);
      const result: ScenePeopleRouteResult = plan ? { status: "available", plan } : { status: "unavailable", reason: route.status === "unavailable" ? route.reason : "invalid_route" };
      cache.set(key, result);
      if (cache.size > limit) cache.delete(cache.keys().next().value!);
      return result;
    },
    retarget(plan: ScenePeopleRoutePlan, distance: number, toSpaceId: string, options: ScenePeopleRoutingOptions = {}) {
      return retargetScenePeopleRoute(snapshot, plan, distance, toSpaceId, context, options);
    },
    size: () => cache.size,
    clear: () => cache.clear(),
  };
}
