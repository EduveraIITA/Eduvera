import { describe, expect, it } from "vitest";
import { sceneOnboardingReadiness } from "./sceneSetupReadiness";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";
const space = (id: string, kind: string, parent: string | null = null): CampusSceneSpace => ({ id, kind, parent_space_id: parent, campus_id: "campus", name: id, code: id });
const feature = (id: string, kind: CampusSceneElement["kind"], place: string | null = null): CampusSceneElement => ({ id, kind, label: id, review_state: "reviewed", space_id: place, floor_id: null, geometry: { type: "point", points: [{ x: 0, y: 0 }] } });
const path = (id: string, start: string | null, end: string | null, from = 0, to = 10, floor: string | null = null): CampusSceneElement => ({ ...feature(id, "path"), floor_id: floor, geometry: { type: "polyline", points: [{ x: from, y: 0 }, { x: to, y: 0 }] }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: start, end_space_id: end } });
const scene = (...elements: CampusSceneElement[]): CampusSceneDocument => ({ schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "relative" }, source: { kind: "manual", label: "Drawing" }, elements });
const gate = { ...feature("gate-feature", "fixture", "gate"), asset_key: "gate" as const, holding_id: "gate-holding" };
const places = [space("gate", "gate"), space("building", "building"), space("ground", "floor", "building"), space("upper", "floor", "building"), space("room", "classroom", "upper")];

describe("progressive scene setup checks", () => {
  it("permits a reviewed visual campus with decorative trees and scenery without compulsory place records", () => {
    const result = sceneOnboardingReadiness(scene(feature("tree", "tree"), { ...feature("water", "surface"), asset_key: "water" }), []);
    expect(result.blockers).toEqual([]); expect(result.advisories).toEqual([]);
    expect(result.counts).toMatchObject({ features: 2, visualOnly: 2, routeChecks: 0 });
  });
  it("keeps existing publication review blockers distinct from optional operational links", () => {
    const result = sceneOnboardingReadiness(scene({ ...feature("lamp", "fixture"), asset_key: "lamp", review_state: "needs_review" }), []);
    expect(result.blockers[0]?.code).toBe("review"); expect(result.advisories[0]?.code).toBe("asset_link");
    expect(result.advisories[0]?.detail).toContain("Decorative lights");
  });
  it("checks declared reviewed journeys with the existing solver, without snapping near corners", () => {
    const healthy = sceneOnboardingReadiness(scene(gate, feature("building-feature", "building", "building"), path("walk", "gate", "building")), places);
    expect(healthy.advisories).toEqual([]); expect(healthy.counts.routeChecks).toBe(1);
    const disconnected = sceneOnboardingReadiness(scene(gate, path("a", "gate", null), path("b", null, "building", 10.001, 20)), places);
    expect(disconnected.advisories).toEqual([expect.objectContaining({ code: "disconnected_route" })]);
  });
  it("does not infer a floor transfer and distinguishes stairs from reviewed step-free travel", () => {
    const base = [gate, feature("building-feature", "building", "building"), path("outdoor", "gate", "building", 0, 10), path("upstairs", null, "room", 10, 20, "upper")];
    expect(sceneOnboardingReadiness(scene(...base), places).advisories.some(issue => issue.code === "disconnected_route")).toBe(true);
    const entrance: CampusSceneElement = { ...feature("entrance", "fixture"), parent_element_id: "building-feature", geometry: { type: "point", points: [{ x: 10, y: 0 }] }, navigation_connector: { kind: "entrance", status: "open", accessible: false, from_floor_id: null, to_floor_id: "upper" } };
    const result = sceneOnboardingReadiness(scene(...base, entrance), places);
    expect(result.advisories.some(issue => issue.code === "disconnected_route")).toBe(false);
    expect(result.advisories.some(issue => issue.code === "step_free")).toBe(true);
  });
  it("checks explicit connector floors against the linked building, never by floor names", () => {
    const connector: CampusSceneElement = { ...feature("stairs", "fixture"), floor_id: "ground", parent_element_id: "building-feature", navigation_connector: { kind: "stairs", from_floor_id: "ground", to_floor_id: "foreign", status: "open", accessible: true } };
    const result = sceneOnboardingReadiness(scene(feature("building-feature", "building", "building"), connector), [...places, space("foreign", "floor", "other-building")]);
    expect(result.advisories).toContainEqual(expect.objectContaining({ code: "floor_connection", elementId: "stairs" }));
  });
  it("reports missing canonical links and route origins without blocking a visual publication", () => {
    const result = sceneOnboardingReadiness(scene(feature("stale", "room", "missing"), path("walk", "gate", "building")), places);
    expect(result.blockers).toEqual([]);
    expect(result.advisories.map(issue => issue.code)).toEqual(["place_link", "route_origin"]);
  });
  it("does not turn a hundred linked visual structures or multipart outlines into required route tasks", () => {
    const elements = Array.from({ length: 100 }, (_, index) => feature(`part${index}`, "building", index % 2 ? "building" : `place${index}`));
    const result = sceneOnboardingReadiness(scene(...elements, gate), [...places, ...Array.from({ length: 100 }, (_, index) => space(`place${index}`, "building"))]);
    expect(result.blockers).toEqual([]); expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]).toMatchObject({ id: "optional-directions", code: "route_endpoint" });
    expect(result.counts.routeChecks).toBe(0);
  });
  it("counts only current canonical places and deduplicates declared multipart destination journeys", () => {
    const result = sceneOnboardingReadiness(scene(gate, feature("part1", "building", "building"), feature("part2", "building", "building"), feature("stale", "building", "removed"), path("walk", "gate", "building")), places);
    expect(result.counts).toMatchObject({ linkedPlaces: 2, declaredEndpoints: 2, routeChecks: 1 });
    expect(result.advisories.filter(issue => issue.code === "place_link")).toHaveLength(1);
    expect(result.advisories.filter(issue => issue.code === "disconnected_route")).toHaveLength(0);
  });
  it("bounds expensive journey checks and reports the remaining scope honestly", () => {
    const elements = [gate, ...Array.from({ length: 162 }, (_, index) => path(`path${index}`, "gate", `room${index}`))];
    const result = sceneOnboardingReadiness(scene(...elements), [...places, ...Array.from({ length: 162 }, (_, index) => space(`room${index}`, "classroom"))]);
    expect(result.counts).toMatchObject({ routeChecks: 160, uncheckedRoutes: 2 });
    expect(result.limitations.join(" ")).toContain("first 160");
  });
});
