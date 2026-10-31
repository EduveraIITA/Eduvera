import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";

export interface SceneWalkingSegment { elementId: string; floorId: string | null; points: CampusScenePoint[] }
export type SceneWalkingLeg = (SceneWalkingSegment & { kind: "walk" }) | {
  kind: "entrance" | "stairs" | "lift"; elementId: string; label: string;
  fromFloorId: string | null; toFloorId: string | null; point: CampusScenePoint;
};
export type SceneWalkingRoute = {
  status: "available";
  fromSpaceId: string;
  toSpaceId: string;
  unit: CampusSceneDocument["bounds"]["unit"];
  /** Drawing length only; relative units never imply metres or a walking time. */
  length: number;
  points: CampusScenePoint[];
  segments: SceneWalkingSegment[];
  legs?: SceneWalkingLeg[];
  transitionCount?: number;
} | {
  status: "unavailable";
  reason: "network_unavailable" | "origin_unmapped" | "destination_unmapped" | "no_path" | "same_place";
  fromSpaceId: string;
  toSpaceId: string;
};
export interface SceneWalkingRequest { fromSpaceId: string; toSpaceId: string; accessibleOnly?: boolean; excludedConnectorIds?: readonly string[] }

function reviewedPaths(scene: CampusSceneDocument) {
  return scene.elements.filter(element => element.kind === "path" && element.asset_key !== "boundary_wall"
    && element.geometry.type === "polyline" && element.geometry.points.length >= 2
    && element.review_state === "reviewed" && element.navigation?.walkable === true);
}
/** Only explicitly authored canonical endpoint links can be chosen as route places. */
export function sceneWalkingPlaceIds(scene: CampusSceneDocument): string[] {
  return [...new Set(reviewedPaths(scene).flatMap(element => [element.navigation!.start_space_id, element.navigation!.end_space_id]).filter((id): id is string => Boolean(id)))];
}

interface Cost { transitions: number; length: number }
interface Edge { to: string; length: number; element: CampusSceneElement; connector?: { fromFloorId: string | null; toFloorId: string | null } }
interface Node { point: CampusScenePoint; edges: Edge[] }
const nodeKey = (point: CampusScenePoint, floor: string | null) => `${floor ?? "outdoors"}:${point.x}:${point.y}`;
const compare = (left: Cost, right: Cost) => left.transitions - right.transitions || left.length - right.length;

/** Lexicographic routing avoids inventing a stair/lift distance or travel time. */
class MinQueue {
  private entries: { key: string; cost: Cost }[] = [];
  push(key: string, cost: Cost) {
    const entry = { key, cost }; let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compare(this.entries[parent]!.cost, cost) <= 0) break;
      this.entries[index] = this.entries[parent]!; index = parent;
    }
    this.entries[index] = entry;
  }
  pop() {
    const first = this.entries[0], last = this.entries.pop();
    if (this.entries.length && last) {
      let index = 0;
      while (index * 2 + 1 < this.entries.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.entries.length && compare(this.entries[child + 1]!.cost, this.entries[child]!.cost) < 0) child++;
        if (compare(this.entries[child]!.cost, last.cost) >= 0) break;
        this.entries[index] = this.entries[child]!; index = child;
      }
      this.entries[index] = last;
    }
    return first;
  }
}

/** Exact reviewed vertices and explicit connectors only; no inferred entrances or floor transfers. */
export function findSceneWalkingRoute(scene: CampusSceneDocument, request: SceneWalkingRequest): SceneWalkingRoute {
  const { fromSpaceId, toSpaceId, accessibleOnly = false } = request;
  const unavailable = (reason: Extract<SceneWalkingRoute, { status: "unavailable" }>["reason"]): SceneWalkingRoute => ({ status: "unavailable", reason, fromSpaceId, toSpaceId });
  const paths = reviewedPaths(scene);
  if (!paths.length) return unavailable("network_unavailable");
  const placeIds = sceneWalkingPlaceIds(scene);
  if (!placeIds.includes(fromSpaceId)) return unavailable("origin_unmapped");
  if (!placeIds.includes(toSpaceId)) return unavailable("destination_unmapped");
  if (fromSpaceId === toSpaceId) return unavailable("same_place");
  const nodes = new Map<string, Node>(), places = new Map<string, Set<string>>();
  const addNode = (point: CampusScenePoint, floorId: string | null) => {
    const key = nodeKey(point, floorId);
    if (!nodes.has(key)) nodes.set(key, { point, edges: [] });
    return key;
  };
  for (const element of paths) {
    if (element.navigation!.status !== "open" || (accessibleOnly && !element.navigation!.accessible)) continue;
    const keys = element.geometry.points.map(point => addNode(point, element.floor_id));
    for (let index = 1; index < keys.length; index++) {
      const previous = nodes.get(keys[index - 1]!)!, current = nodes.get(keys[index]!)!;
      const length = Math.hypot(current.point.x - previous.point.x, current.point.y - previous.point.y);
      if (!Number.isFinite(length) || length <= 0) continue;
      previous.edges.push({ to: keys[index]!, length, element });
      current.edges.push({ to: keys[index - 1]!, length, element });
    }
    for (const [id, key] of [[element.navigation!.start_space_id, keys[0]!], [element.navigation!.end_space_id, keys.at(-1)!]] as const) {
      if (!id) continue;
      if (!places.has(id)) places.set(id, new Set());
      places.get(id)!.add(key);
    }
  }
  const excluded = new Set(request.excludedConnectorIds ?? []);
  for (const element of scene.elements) {
    const connector = element.navigation_connector, point = element.geometry.points[0];
    if (!connector || !point || element.kind !== "fixture" || element.review_state !== "reviewed" || connector.status !== "open" || excluded.has(element.id)
      || (accessibleOnly && (!connector.accessible || connector.kind === "stairs"))) continue;
    const from = addNode(point, connector.from_floor_id), to = addNode(point, connector.to_floor_id);
    nodes.get(from)!.edges.push({ to, length: 0, element, connector: { fromFloorId: connector.from_floor_id, toFloorId: connector.to_floor_id } });
    nodes.get(to)!.edges.push({ to: from, length: 0, element, connector: { fromFloorId: connector.to_floor_id, toFloorId: connector.from_floor_id } });
  }
  const origins = places.get(fromSpaceId), destinations = places.get(toSpaceId);
  if (!origins?.size || !destinations?.size) return unavailable("no_path");
  const queue = new MinQueue(), distances = new Map<string, Cost>(), previous = new Map<string, { from: string; edge: Edge }>();
  for (const key of origins) { const cost = { transitions: 0, length: 0 }; distances.set(key, cost); queue.push(key, cost); }
  let destination: string | null = null;
  for (let current = queue.pop(); current; current = queue.pop()) {
    if (compare(current.cost, distances.get(current.key)!) !== 0) continue;
    if (destinations.has(current.key)) { destination = current.key; break; }
    for (const edge of nodes.get(current.key)!.edges) {
      const cost = { transitions: current.cost.transitions + (edge.connector ? 1 : 0), length: current.cost.length + edge.length };
      const retained = distances.get(edge.to);
      if (retained && compare(cost, retained) >= 0) continue;
      distances.set(edge.to, cost); previous.set(edge.to, { from: current.key, edge }); queue.push(edge.to, cost);
    }
  }
  if (!destination) return unavailable("no_path");
  const steps: { from: string; to: string; edge: Edge }[] = [];
  let key = destination;
  for (let step = previous.get(key); step; step = previous.get(key)) { steps.push({ from: step.from, to: key, edge: step.edge }); key = step.from; }
  if (!steps.length) return unavailable("same_place");
  steps.reverse();
  const legs: SceneWalkingLeg[] = [];
  for (const step of steps) {
    const element = step.edge.element, point = nodes.get(step.to)!.point;
    if (step.edge.connector) {
      legs.push({ kind: element.navigation_connector!.kind, elementId: element.id, label: element.label, ...step.edge.connector, point });
    } else {
      const last = legs.at(-1);
      if (last?.kind === "walk" && last.elementId === element.id) last.points.push(point);
      else legs.push({ kind: "walk", elementId: element.id, floorId: element.floor_id, points: [nodes.get(step.from)!.point, point] });
    }
  }
  const segments = legs.filter((leg): leg is SceneWalkingSegment & { kind: "walk" } => leg.kind === "walk");
  return { status: "available", fromSpaceId, toSpaceId, unit: scene.bounds.unit, length: distances.get(destination)!.length,
    transitionCount: distances.get(destination)!.transitions, legs, segments,
    points: [nodes.get(steps[0]!.from)!.point, ...steps.map(step => nodes.get(step.to)!.point)] };
}
