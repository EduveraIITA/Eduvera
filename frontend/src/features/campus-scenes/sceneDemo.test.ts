import { describe, expect, it } from "vitest";
import { createCampusDemoScene } from "./sceneDemo";
import type { CampusSceneElement, CampusScenePoint, CampusSceneSpace } from "./types";

const space = (id: string, name: string, kind: string): CampusSceneSpace => ({ id, name, kind, code: id, campus_id: "campus", parent_space_id: null });
const segmentDistance = (point: CampusScenePoint, a: CampusScenePoint, b: CampusScenePoint) => {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - a.x - fraction * dx, point.y - a.y - fraction * dy);
};
const edges = (element: CampusSceneElement): [CampusScenePoint, CampusScenePoint][] => {
  const points = element.geometry.points;
  return points.flatMap((point, index) => index > 0 ? [[points[index - 1]!, point] as [CampusScenePoint, CampusScenePoint]] : element.geometry.type === "polygon" ? [[points.at(-1)!, point] as [CampusScenePoint, CampusScenePoint]] : []);
};
const pointShapeDistance = (point: CampusScenePoint, element: CampusSceneElement) => {
  let inside = false;
  for (const [a, b] of edges(element)) {
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (element.geometry.type === "polygon" && inside) return 0;
  return Math.min(...element.geometry.points.map(vertex => Math.hypot(point.x - vertex.x, point.y - vertex.y)), ...edges(element).map(([a, b]) => segmentDistance(point, a, b)));
};
const shapeDistance = (first: CampusSceneElement, second: CampusSceneElement) => {
  const side = (point: CampusScenePoint, a: CampusScenePoint, b: CampusScenePoint) => (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  for (const [a, b] of edges(first)) for (const [c, d] of edges(second)) {
    if (side(c, a, b) * side(d, a, b) < 0 && side(a, c, d) * side(b, c, d) < 0) return 0;
  }
  return Math.min(...first.geometry.points.map(point => pointShapeDistance(point, second)), ...second.geometry.points.map(point => pointShapeDistance(point, first)));
};
const footprintPadding = (element: CampusSceneElement) => element.asset_key === "boundary_wall" ? element.width! * .8
  : element.kind === "tree" ? element.width! * .6
  : element.kind === "road" || element.kind === "path" || element.kind === "fixture" ? element.width! / 2 : 0;

describe("explicit illustrative campus sample", () => {
  it("is deterministic, bounded, varied and clearly awaiting review", () => {
    const scene = createCampusDemoScene([], "Cambridge");
    expect(createCampusDemoScene([], "Cambridge")).toEqual(scene);
    expect(scene.source.label).toMatch(/Synthetic/); expect(scene.name).toMatch(/illustrative sample/);
    expect(scene.elements.length).toBeGreaterThan(70);
    expect(new Set(scene.elements.map((element) => element.kind))).toEqual(new Set(["building", "road", "path", "surface", "tree", "fixture"]));
    expect(new Set(scene.elements.map((element) => element.id)).size).toBe(scene.elements.length);
    expect(scene.elements.every((element) => element.review_state === "needs_review" && element.geometry.points.every((point) => point.x >= 0 && point.x <= scene.bounds.width && point.y >= 0 && point.y <= scene.bounds.height))).toBe(true);
    expect(scene.elements.every((element) => element.space_id === null)).toBe(true);
  });
  it("links only a unique exact name with a compatible kind and never borrows a similar name", () => {
    const scene = createCampusDemoScene([space("academic", " Academic Block ", "building"), space("wrong-kind", "Main Gate", "office"), space("similar", "Academic Block Annex", "building")]);
    expect(scene.elements.find((element) => element.id === "sample_academic")!.space_id).toBe("academic");
    expect(scene.elements.find((element) => element.id === "sample_main_gate")!.space_id).toBeNull();
    expect(scene.elements.filter((element) => element.space_id !== null)).toHaveLength(1);
  });
  it("leaves ambiguous canonical names unlinked", () => {
    const scene = createCampusDemoScene([space("one", "Academic Block", "building"), space("two", "academic block", "building")]);
    expect(scene.elements.find((element) => element.id === "sample_academic")!.space_id).toBeNull();
  });
  it("keeps usable gate openings aligned with the two approach roads", () => {
    const scene = createCampusDemoScene();
    const walls = scene.elements.filter(element => element.asset_key === "boundary_wall");
    expect(walls).toHaveLength(6);
    for (const [gateId, roadId] of [["sample_main_gate", "sample_entry_road"], ["sample_service_gate", "sample_service_road"]]) {
      const gate = scene.elements.find(element => element.id === gateId)!;
      const road = scene.elements.find(element => element.id === roadId)!;
      const point = gate.geometry.points[0]!;
      expect(road.geometry.points.every(endpoint => endpoint.x === point.x)).toBe(true);
      expect(point.y).toBeGreaterThanOrEqual(Math.min(...road.geometry.points.map(endpoint => endpoint.y)));
      expect(point.y).toBeLessThanOrEqual(Math.max(...road.geometry.points.map(endpoint => endpoint.y)));
      expect(gate.width).toBeGreaterThan(road.width!);
      for (const wall of walls) {
        const [a, b] = wall.geometry.points;
        const coversGate = a!.y === point.y && b!.y === point.y
          && Math.min(a!.x, b!.x) < point.x && Math.max(a!.x, b!.x) > point.x;
        expect(coversGate).toBe(false);
      }
    }
  });
  it("keeps every conservative canopy footprint clear of buildings, vehicle roads and wall piers", () => {
    const scene = createCampusDemoScene();
    const trees = scene.elements.filter(element => element.kind === "tree");
    const obstacles = scene.elements.filter(element => element.kind === "building" || element.kind === "road" || element.asset_key === "boundary_wall");
    expect(trees).toHaveLength(58);
    // The renderer's largest crown fits within .6×width. Pedestrian walks may
    // have shade overhead; buildings, vehicle roads and perimeter piers may not.
    for (const tree of trees) for (const obstacle of obstacles) {
      const clearance = pointShapeDistance(tree.geometry.points[0]!, obstacle) - footprintPadding(tree) - footprintPadding(obstacle);
      expect(clearance, `${tree.id} canopy versus ${obstacle.id}`).toBeGreaterThanOrEqual(.5);
    }
  });
  it("uses varied editable planting and leaves the low flower beds on clear ground", () => {
    const scene = createCampusDemoScene();
    expect(new Set(scene.elements.filter(element => element.kind === "tree").map(element => element.asset_key))).toEqual(new Set(["tree_broadleaf", "tree_palm", "tree_conifer", "tree_columnar", "shrub"]));
    const beds = scene.elements.filter(element => element.asset_key === "flower_bed");
    expect(beds).toHaveLength(2);
    for (const bed of beds) {
      expect(bed.kind).toBe("surface");
      expect(bed.geometry.type).toBe("polygon");
      expect(bed.height).toBeLessThanOrEqual(.5);
      for (const other of scene.elements.filter(element => element.id !== bed.id)) {
        expect(shapeDistance(bed, other) - footprintPadding(other), `${bed.id} versus ${other.id}`).toBeGreaterThanOrEqual(.5);
      }
    }
  });
});
