import { describe, expect, it, vi } from "vitest";
import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";
import { findSceneWalkingRoute, type SceneWalkingRoute } from "./sceneWalking";
import { canRetargetScenePeopleMotion, compileScenePeopleRoute, createScenePeopleRouteResolver, retargetScenePeopleRoute, sampleScenePeopleRoute, scenePeopleIdleSlots, scenePeopleMotionProgress, type ScenePeopleMotionScope } from "./scenePeopleMotion";
import { scenePolygonClearance, scenePolygonContains } from "./sceneEvidencePlacement";

const scope: ScenePeopleMotionScope = { worldKey: "scenario:one", publicationKey: "publication:3", networkKey: "all-open" };
const point = (x: number, y: number): CampusScenePoint => ({ x, y });
const path = (id: string, points: CampusScenePoint[], start: string | null, end: string | null, floorId: string | null = null): CampusSceneElement => ({
  id, label: id, kind: "path", geometry: { type: "polyline", points }, space_id: null, floor_id: floorId, width: 6, review_state: "reviewed",
  navigation: { walkable: true, accessible: true, status: "open", start_space_id: start, end_space_id: end },
});
const campus = (): CampusSceneDocument => ({ schema_version: 1, name: "Fixture campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed plan" }, elements: [
  path("arrival", [point(10, 20), point(30, 20), point(30, 50)], "A", "B"),
  path("garden", [point(30, 50), point(70, 50)], "B", "C"),
  path("branch", [point(30, 20), point(70, 20)], null, "D"),
] });
const planned = (scene = campus(), from = "A", to = "C") => compileScenePeopleRoute(findSceneWalkingRoute(scene, { fromSpaceId: from, toSpaceId: to }), scope, scene)!;

describe("illustrative people route geometry", () => {
  it("uses cumulative distance through bends and different path elements at a constant drawing speed", () => {
    const scene = campus(), original = structuredClone(scene), plan = planned(scene);
    expect(plan.length).toBe(90);
    expect(sampleScenePeopleRoute(plan, 10)).toMatchObject({ point: point(20, 20), floorId: null, heading: 0, complete: false });
    expect(sampleScenePeopleRoute(plan, 20)).toMatchObject({ point: point(30, 20), heading: Math.PI / 2 });
    expect(sampleScenePeopleRoute(plan, 35)).toMatchObject({ point: point(30, 35), heading: Math.PI / 2 });
    expect(sampleScenePeopleRoute(plan, 50)).toMatchObject({ point: point(30, 50), elementId: "garden" });
    expect(sampleScenePeopleRoute(plan, 65)).toMatchObject({ point: point(45, 50), heading: 0 });
    expect(sampleScenePeopleRoute(plan, 1000)).toMatchObject({ point: point(70, 50), distance: 90, complete: true });
    expect(sampleScenePeopleRoute(plan, -100)).toMatchObject({ point: point(10, 20), distance: 0 });
    expect(sampleScenePeopleRoute(plan, Number.NaN)).toBeNull();
    expect(scene).toEqual(original);
    const before = sampleScenePeopleRoute(plan, 20 - 1e-5)!.point, after = sampleScenePeopleRoute(plan, 20 + 1e-5)!.point;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(3e-5);
  });

  it("changes floors only at explicit reviewed connectors without assigning a connector distance", () => {
    const scene = campus();
    scene.elements = [path("outside", [point(0, 0), point(20, 0)], "gate", "arrival"), path("inside", [point(20, 0), point(40, 0)], null, "room", "ground"), {
      id: "entrance", kind: "fixture", label: "Entrance", space_id: null, floor_id: null, review_state: "reviewed", geometry: { type: "point", points: [point(20, 0)] },
      navigation_connector: { kind: "entrance", status: "open", accessible: true, from_floor_id: null, to_floor_id: "ground" },
    }];
    const plan = planned(scene, "gate", "room");
    expect(plan.length).toBe(40);
    expect(plan.transitions).toEqual([{ distance: 20, elementId: "entrance", kind: "entrance", fromFloorId: null, toFloorId: "ground" }]);
    expect(sampleScenePeopleRoute(plan, 19.99)?.floorId).toBeNull();
    expect(sampleScenePeopleRoute(plan, 20)).toMatchObject({ point: point(20, 0), floorId: "ground" });
    const retained = findSceneWalkingRoute(scene, { fromSpaceId: "gate", toSpaceId: "room" });
    scene.elements[2]!.navigation_connector!.status = "closed";
    expect(compileScenePeopleRoute(retained, scope, scene)).toBeNull();
  });

  it("rejects disconnected geometry, implicit floor changes and unavailable routes", () => {
    const scene = campus(), route = findSceneWalkingRoute(scene, { fromSpaceId: "A", toSpaceId: "C" }) as Extract<SceneWalkingRoute, { status: "available" }>;
    const disconnected = structuredClone(route); disconnected.legs![1] = { kind: "walk", elementId: "garden", floorId: null, points: [point(99, 99), point(70, 50)] };
    expect(compileScenePeopleRoute(disconnected, scope)).toBeNull();
    const wrongFloor = structuredClone(route); (wrongFloor.legs![1] as { floorId: string | null }).floorId = "first";
    expect(compileScenePeopleRoute(wrongFloor, scope)).toBeNull();
    expect(compileScenePeopleRoute({ status: "unavailable", reason: "no_path", fromSpaceId: "A", toSpaceId: "C" }, scope)).toBeNull();
    expect(compileScenePeopleRoute(route, { ...scope, worldKey: "" })).toBeNull();
  });

  it("keeps the full figure radius inside the known path corridor and centers it at junctions", () => {
    const plan = planned();
    const sample = sampleScenePeopleRoute(plan, 10, { laneFraction: 100, bodyRadius: 1 })!;
    expect(sample.point).toEqual(point(20, 22));
    expect(Math.abs(sample.point.y - sample.centerlinePoint.y) + 1).toBeLessThanOrEqual(3);
    expect(sample.fitsCorridor).toBe(true);
    const junction = sampleScenePeopleRoute(plan, 20, { laneFraction: 1, bodyRadius: 1 })!;
    expect(junction.point).toEqual(junction.centerlinePoint);
    expect(sampleScenePeopleRoute(plan, 10, { laneFraction: 1, bodyRadius: 4 })).toMatchObject({ point: point(20, 20), fitsCorridor: false });
  });

  it("retargets from the exact middle of its current edge through an existing junction without snapping", () => {
    const scene = campus(), original = structuredClone(scene), plan = planned(scene);
    const next = retargetScenePeopleRoute(scene, plan, 10, "D", scope);
    expect(next.status).toBe("available");
    if (next.status !== "available") throw Error("Expected reviewed branch route");
    expect(next.plan.length).toBe(50);
    expect(next.plan.fromSpaceId).toBeNull();
    expect(sampleScenePeopleRoute(next.plan, 0)?.point).toEqual(sampleScenePeopleRoute(plan, 10)?.point);
    expect(sampleScenePeopleRoute(next.plan, 10)?.point).toEqual(point(30, 20));
    expect(sampleScenePeopleRoute(next.plan, 50)?.point).toEqual(point(70, 20));
    expect(next.plan.edges.map(edge => edge.elementId)).toEqual(["arrival", "branch"]);
    expect(JSON.stringify(next.plan)).not.toContain("__scene_people_edge_origin");
    expect(scene).toEqual(original);
  });

  it("can reverse on its current edge while retaining the exact lateral position", () => {
    const scene = campus(), plan = planned(scene), lane = { laneFraction: .5, bodyRadius: 1 };
    const previous = sampleScenePeopleRoute(plan, 35, lane)!;
    const next = retargetScenePeopleRoute(scene, plan, 35, "D", scope);
    if (next.status !== "available") throw Error("Expected reverse route");
    expect(sampleScenePeopleRoute(next.plan, 0, lane)?.point).toEqual(previous.point);
    expect(sampleScenePeopleRoute(next.plan, 0, lane)?.heading).toBe(-Math.PI / 2);
    expect(sampleScenePeopleRoute(next.plan, 15)?.point).toEqual(point(30, 20));
  });

  it("retargets at authored vertices and canonical endpoints without zero length invented links", () => {
    const scene = campus(), plan = planned(scene);
    for (const distance of [0, 20, 50, 90]) {
      const next = retargetScenePeopleRoute(scene, plan, distance, "D", scope);
      if (next.status !== "available") throw Error(`Expected endpoint route at ${distance}`);
      expect(sampleScenePeopleRoute(next.plan, 0)?.point).toEqual(sampleScenePeopleRoute(plan, distance)?.point);
      expect(next.plan.edges.every(edge => edge.length > 0)).toBe(true);
    }
  });

  it("fails closed for changed worlds, publications, closures or the current authored edge", () => {
    const scene = campus(), plan = planned(scene);
    for (const changed of [{ ...scope, worldKey: "live" }, { ...scope, publicationKey: "publication:4" }, { ...scope, networkKey: "closed" }])
      expect(retargetScenePeopleRoute(scene, plan, 10, "D", changed)).toEqual({ status: "unavailable", reason: "context_changed" });
    const closed = structuredClone(scene); closed.elements[0]!.navigation!.status = "closed";
    expect(retargetScenePeopleRoute(closed, plan, 10, "D", scope)).toEqual({ status: "unavailable", reason: "current_edge_unavailable" });
    const changed = structuredClone(scene); changed.elements[0]!.geometry.points[1]!.x = 31;
    expect(retargetScenePeopleRoute(changed, plan, 10, "D", scope)).toEqual({ status: "unavailable", reason: "current_edge_unavailable" });
    scene.elements[0]!.geometry.points[1]!.x = 31;
    expect(sampleScenePeopleRoute(plan, 20)?.point).toEqual(point(30, 20));
    expect(retargetScenePeopleRoute(scene, plan, 10, "D", scope)).toEqual({ status: "unavailable", reason: "current_edge_unavailable" });
  });

  it("returns unavailable instead of crossing an unmapped or closed route", () => {
    const scene = campus(), plan = planned(scene);
    expect(retargetScenePeopleRoute(scene, plan, 10, "unknown", scope)).toMatchObject({ status: "unavailable", reason: "destination_unmapped" });
    scene.elements[2]!.navigation!.status = "closed";
    expect(retargetScenePeopleRoute(scene, plan, 10, "D", scope)).toMatchObject({ status: "unavailable", reason: "no_path" });
  });
});

describe("people illustration clock and place validity", () => {
  it("samples only the caller's finite confirmed clock window and never reads wall time", () => {
    const wallClock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("No wall-clock extrapolation"); });
    const window = { startsAtMs: 1000, endsAtMs: 11000 };
    expect(scenePeopleMotionProgress(null, window, "figure")).toBeNull();
    expect(scenePeopleMotionProgress(999, window, "figure")).toBeNull();
    expect(scenePeopleMotionProgress(11000, window, "figure")).toBeNull();
    expect(scenePeopleMotionProgress(6000, window, "figure", 0)).toBe(.5);
    const staggered = scenePeopleMotionProgress(6000, window, "figure")!;
    expect(staggered).toBeGreaterThanOrEqual(.3); expect(staggered).toBeLessThanOrEqual(.5);
    expect(scenePeopleMotionProgress(6000, window, "figure")).toBe(staggered);
    expect(scenePeopleMotionProgress(6000, window, "another")).not.toBe(staggered);
    expect(scenePeopleMotionProgress(2000, window, "figure", 0)).toBe(.1);
    expect(scenePeopleMotionProgress(6000, { startsAtMs: 11000, endsAtMs: 1000 }, "figure")).toBeNull();
    expect(wallClock).not.toHaveBeenCalled();
  });

  it("reuses motion only for forward or paused confirmed time in exactly the same context", () => {
    const previous = { scope, epoch: "clock:1", instantMs: 5000 };
    expect(canRetargetScenePeopleMotion(previous, { ...previous, instantMs: 6000 })).toBe(true);
    expect(canRetargetScenePeopleMotion(previous, previous)).toBe(true);
    for (const next of [{ ...previous, instantMs: 4000 }, { ...previous, instantMs: null }, { ...previous, instantMs: Number.NaN }, { ...previous, epoch: "clock:2" }, { ...previous, scope: { ...scope, worldKey: "scenario:two" } }])
      expect(canRetargetScenePeopleMotion(previous, next)).toBe(false);
  });

  it("keeps bounded idle slots stable inside a concave linked place without changing geometry", () => {
    const element: CampusSceneElement = { id: "court", label: "Court", kind: "surface", space_id: "place", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [point(0, 0), point(70, 0), point(70, 60), point(50, 60), point(50, 20), point(20, 20), point(20, 60), point(0, 60)] } };
    const original = structuredClone(element), slots = scenePeopleIdleSlots(element, 1000, 1, "group", 2);
    expect(slots).toHaveLength(8);
    expect(scenePeopleIdleSlots(element, 3, 1, "group", 2)).toEqual(slots.slice(0, 3));
    for (const [index, slot] of slots.entries()) {
      expect(scenePolygonContains(slot, element.geometry.points)).toBe(true);
      expect(scenePolygonClearance(slot, element.geometry.points)).toBeGreaterThanOrEqual(2);
      for (const other of slots.slice(index + 1)) expect(Math.hypot(slot.x - other.x, slot.y - other.y)).toBeGreaterThanOrEqual(4);
    }
    expect(element).toEqual(original);
    for (const invalid of [{ ...element, kind: "building" as const }, { ...element, space_id: null }, { ...element, review_state: "needs_review" as const }])
      expect(scenePeopleIdleSlots(invalid, 8, 1, "group")).toEqual([]);
    expect(scenePeopleIdleSlots(element, .1, 1, "group")).toEqual([]);
  });
});

describe("scoped people route cache", () => {
  it("reuses bounded routes per exact scope and options without borrowing a changed source snapshot", () => {
    const scene = campus(), resolver = createScenePeopleRouteResolver(scene, scope, 2);
    const first = resolver.resolve("A", "C");
    expect(resolver.resolve("A", "C")).toBe(first);
    expect(resolver.resolve("A", "C", { accessibleOnly: true })).not.toBe(first);
    resolver.resolve("A", "D"); expect(resolver.size()).toBe(2);
    expect(resolver.resolve("A", "C")).not.toBe(first);
    scene.elements[0]!.navigation!.status = "closed";
    expect(resolver.resolve("A", "D").status).toBe("available");
    const changed = createScenePeopleRouteResolver(scene, { ...scope, networkKey: "arrival-closed" });
    expect(changed.resolve("A", "C")).toMatchObject({ status: "unavailable", reason: "no_path" });
    resolver.clear(); expect(resolver.size()).toBe(0);
  });
});
