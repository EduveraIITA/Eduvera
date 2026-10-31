import { describe, expect, it } from "vitest";
import { findSceneWalkingRoute, sceneWalkingPlaceIds } from "./sceneWalking";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneNavigation, CampusScenePoint } from "./types";
const p = (x: number, y: number): CampusScenePoint => ({ x, y });
function path(id: string, points: CampusScenePoint[], start: string | null = null, end: string | null = null, metadata: Partial<CampusSceneNavigation> = {}, floor: string | null = null): CampusSceneElement {
  return { id, kind: "path", label: id, space_id: null, floor_id: floor, geometry: { type: "polyline", points }, review_state: "reviewed", navigation: { walkable: true, accessible: true, status: "open", start_space_id: start, end_space_id: end, ...metadata } };
}
const scene = (...elements: CampusSceneElement[]): CampusSceneDocument => ({ schema_version: 1, name: "Reviewed campus", bounds: { width: 1000, height: 1000, unit: "metres" }, source: { kind: "manual", label: "Reviewed plan" }, elements });
const route = (document: CampusSceneDocument, accessibleOnly = false) => findSceneWalkingRoute(document, { fromSpaceId: "gate", toSpaceId: "learning", accessibleOnly });

describe("reviewed campus walking routes", () => {
  it("does not turn roads, walls, unreviewed paths or ordinary visual paths into routes", () => {
    const walk = path("walk", [p(0, 0), p(10, 0)], "gate", "learning");
    for (const element of [{ ...walk, kind: "road" as const }, { ...walk, asset_key: "boundary_wall" as const }, { ...walk, review_state: "needs_review" as const }, { ...walk, navigation: undefined }]) {
      expect(route(scene(element))).toMatchObject({ status: "unavailable", reason: "network_unavailable" });
    }
  });
  it("uses exact authored endpoints and the shortest reviewed path in both directions", () => {
    const document = scene(path("long", [p(0, 0), p(0, 30), p(30, 30)], "gate", "learning"), path("short-a", [p(0, 0), p(15, 0)], "gate"), path("short-b", [p(15, 0), p(30, 30)], null, "learning"));
    const result = route(document);
    expect(result).toMatchObject({ status: "available", unit: "metres", length: 15 + Math.hypot(15, 30), segments: [{ elementId: "short-a" }, { elementId: "short-b" }] });
    expect(findSceneWalkingRoute(document, { fromSpaceId: "learning", toSpaceId: "gate" })).toMatchObject({ status: "available", points: [p(30, 30), p(15, 0), p(0, 0)] });
  });
  it("never joins crossing lines without an explicit shared vertex in both paths", () => {
    expect(route(scene(path("east", [p(0, 10), p(20, 10)], "gate"), path("south", [p(10, 0), p(10, 20)], null, "learning")))).toMatchObject({ status: "unavailable", reason: "no_path" });
    expect(route(scene(path("east", [p(0, 10), p(10, 10), p(20, 10)], "gate"), path("south", [p(10, 0), p(10, 20)], null, "learning")))).toMatchObject({ status: "unavailable", reason: "no_path" });
    expect(route(scene(path("east", [p(0, 10), p(10, 10), p(20, 10)], "gate"), path("south", [p(10, 0), p(10, 10), p(10, 20)], null, "learning")))).toMatchObject({ status: "available", length: 20 });
  });
  it("does not snap nearby endpoints together", () => {
    expect(route(scene(path("a", [p(0, 0), p(10, 0)], "gate"), path("b", [p(10.001, 0), p(20, 0)], null, "learning")))).toMatchObject({ status: "unavailable", reason: "no_path" });
  });
  it("excludes closed links and can choose an explicitly reviewed step-free detour", () => {
    const direct = path("steps", [p(0, 0), p(20, 0)], "gate", "learning", { accessible: false });
    const detour = path("ramp", [p(0, 0), p(10, 10), p(20, 0)], "gate", "learning");
    expect(route(scene(direct, detour))).toMatchObject({ status: "available", length: 20 });
    expect(route(scene(direct, detour), true)).toMatchObject({ status: "available", segments: [{ elementId: "ramp" }] });
    expect(route(scene(direct, { ...detour, navigation: { ...detour.navigation!, status: "closed" } }), true)).toMatchObject({ status: "unavailable", reason: "no_path" });
    expect(sceneWalkingPlaceIds(scene({ ...direct, navigation: { ...direct.navigation!, status: "closed" } }))).toEqual(["gate", "learning"]);
  });
  it("does not connect identical coordinates on different floors or invent a transfer", () => {
    expect(route(scene(path("outside", [p(0, 0), p(10, 0)], "gate"), path("upstairs", [p(10, 0), p(20, 0)], null, "learning", {}, "floor-one")))).toMatchObject({ status: "unavailable", reason: "no_path" });
    expect(route(scene(path("inside-a", [p(0, 0), p(10, 0)], "gate", null, {}, "floor-one"), path("inside-b", [p(10, 0), p(20, 0)], null, "learning", {}, "floor-one")))).toMatchObject({ status: "available", segments: [{ floorId: "floor-one" }, { floorId: "floor-one" }] });
  });
  it("returns a relative drawing length without inventing distance or time", () => {
    const result = route({ ...scene(path("walk", [p(0, 0), p(30, 40)], "gate", "learning")), bounds: { width: 100, height: 100, unit: "relative" } });
    expect(result).toMatchObject({ status: "available", length: 50, unit: "relative" });
    expect(result).not.toHaveProperty("eta"); expect(result).not.toHaveProperty("metres");
  });
  it("explains unmapped places and a chosen start already at the destination", () => {
    const document = scene(path("walk", [p(0, 0), p(10, 0)], "gate", "learning"));
    expect(findSceneWalkingRoute(document, { fromSpaceId: "unknown", toSpaceId: "learning" })).toMatchObject({ reason: "origin_unmapped" });
    expect(findSceneWalkingRoute(document, { fromSpaceId: "gate", toSpaceId: "unknown" })).toMatchObject({ reason: "destination_unmapped" });
    expect(findSceneWalkingRoute(document, { fromSpaceId: "gate", toSpaceId: "gate" })).toMatchObject({ reason: "same_place" });
  });
  it("keeps two isolated scene copies independent after a route closure", () => {
    const live = scene(path("walk", [p(0, 0), p(10, 0)], "gate", "learning"));
    const branch = structuredClone(live); branch.elements[0]!.navigation!.status = "closed";
    expect(route(branch)).toMatchObject({ reason: "no_path" });
    expect(route(live)).toMatchObject({ status: "available", length: 10 });
  });
  it("handles the bounded 20,000-point scene without a quadratic graph scan", () => {
    const points = Array.from({ length: 20000 }, (_, index) => p(index % 500, Math.floor(index / 500)));
    const document = scene(...Array.from({ length: 40 }, (_, index) => path(`p${index}`, points.slice(index * 499, index * 499 + 500), index === 0 ? "gate" : null, index === 39 ? "learning" : null)));
    const result = route(document);
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.points.length).toBe(19961);
  });
});
