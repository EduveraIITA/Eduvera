import { describe, expect, it } from "vitest";
import type { CampusMotionClaim, CampusMotionProjection } from "../campus-view/campusMotion.types";
import { sceneEvidenceAnchor, scenePolygonContains } from "./sceneEvidencePlacement";
import { scenePolygonCenter } from "./sceneGeometry";
import { compileScenePeopleTracks, reconcileScenePeopleTracks, sampleScenePeople } from "./scenePeopleTracks";
import type { CampusSceneDocument, CampusSceneElement, CampusScenePoint } from "./types";

const at = Date.parse("2026-10-27T10:00:00Z");
const iso = (seconds: number) => new Date(at + seconds * 1000).toISOString();
const point = (x: number, y: number) => ({ x, y });
const claim = (id: string, space: string, from: number, until: number): CampusMotionClaim => ({
  id, space_id: space, starts_at: iso(from), ends_at: iso(until), expected_count: 1,
  spatial_claim: "expected_context_only", source: { domain: "activities", record_id: id, revision: 1 },
});
const projection = (claims: CampusMotionClaim[]): CampusMotionProjection => ({
  schema_version: 1, school_id: "school", campus_id: "campus", as_of: iso(0),
  environment: { kind: "live", namespace_id: null },
  subjects: [{ subject_key: "opaque", kind: "person", claims }], points: [],
  limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: [],
});
const surface = (id: string, x: number): CampusSceneElement => ({
  id, kind: "surface", label: id, space_id: id, floor_id: null, review_state: "reviewed",
  geometry: { type: "polygon", points: [point(x - 5, 5), point(x + 5, 5), point(x + 5, 15), point(x - 5, 15)] },
});

// The same exact entrance/corridor/stairs/lift topology exercised by sceneIndoor.test.tsx.
function multiFloorScene(): CampusSceneDocument {
  const building: CampusSceneElement = {
    id: "building", kind: "building", label: "Learning block", space_id: "building-place", floor_id: null,
    review_state: "reviewed", geometry: { type: "polygon", points: [point(20, 20), point(80, 20), point(80, 80), point(20, 80)] },
  };
  const walk = (id: string, points: CampusScenePoint[], floor: string | null, start: string | null, end: string | null): CampusSceneElement => ({
    id, kind: "path", label: id, space_id: null, floor_id: floor, parent_element_id: floor ? building.id : null,
    width: 3, review_state: "reviewed", geometry: { type: "polyline", points },
    navigation: { walkable: true, accessible: true, status: "open", start_space_id: start, end_space_id: end },
  });
  const connector = (kind: "entrance" | "stairs" | "lift", position: CampusScenePoint, from: string | null): CampusSceneElement => ({
    id: kind, kind: "fixture", label: kind, asset_key: "equipment", parent_element_id: building.id,
    floor_id: from, space_id: null, review_state: "reviewed", geometry: { type: "point", points: [position] },
    navigation_connector: { kind, from_floor_id: from, to_floor_id: from ? "first" : "ground", accessible: kind !== "stairs", status: "open" },
  });
  return {
    schema_version: 1, name: "Learning campus", bounds: { width: 100, height: 100, unit: "metres" },
    source: { kind: "manual", label: "Reviewed floor plan" }, elements: [
      building,
      { ...building, id: "room", kind: "room", label: "Room 201", space_id: "room-place", parent_element_id: building.id,
        floor_id: "first", geometry: { type: "polygon", points: [point(25, 20), point(35, 20), point(35, 30), point(25, 30)] } },
      walk("outdoor", [point(10, 90), point(50, 80)], null, "gate", "building-place"),
      walk("ground-corridor", [point(50, 80), point(40, 50), point(60, 50)], "ground", null, null),
      walk("first-corridor", [point(60, 50), point(40, 50), point(30, 30)], "first", null, "room-place"),
      connector("entrance", point(50, 80), null), connector("stairs", point(40, 50), "ground"), connector("lift", point(60, 50), "ground"),
    ],
  };
}
const multiFloorPlaces = [
  { id: "gate", parent_space_id: null, kind: "gate" },
  { id: "building-place", parent_space_id: null, kind: "building" },
  { id: "ground", parent_space_id: "building-place", kind: "floor" },
  { id: "first", parent_space_id: "building-place", kind: "floor" },
  { id: "room-place", parent_space_id: "first", kind: "classroom" },
];

describe("people projection source safety", () => {
  it("does not depart early when a shorter same-place claim is nested inside an ongoing context", () => {
    const scene: CampusSceneDocument = {
      schema_version: 1, name: "Long campus", bounds: { width: 1200, height: 100, unit: "metres" },
      source: { kind: "manual", label: "Reviewed" }, elements: [surface("a", 10), surface("b", 1010), {
        id: "long-walk", kind: "path", label: "Long walk", space_id: null, floor_id: null, width: 3,
        review_state: "reviewed", geometry: { type: "polyline", points: [point(10, 10), point(1010, 10)] },
        navigation: { walkable: true, accessible: true, status: "open", start_space_id: "a", end_space_id: "b" },
      }],
    };
    const places = [{ id: "a", parent_space_id: null, kind: "outdoor" }, { id: "b", parent_space_id: null, kind: "outdoor" }];
    const source = projection([claim("long-context", "a", 0, 600), claim("nested-context", "a", 100, 200), claim("destination", "b", 700, 3000)]);
    const original = structuredClone(source);
    const data = compileScenePeopleTracks(scene, places, source, "publication-1");
    const transfer = data.tracks.find(track => track.route)!;

    // The route takes longer than the gap: the nested claim must not end the outer context.
    expect(transfer.route).toMatchObject({ length: 1000, fromSpaceId: "a", toSpaceId: "b" });
    expect(transfer.startsAt).toBeGreaterThanOrEqual(at + 600_000);
    expect(transfer.startsAt).toBeLessThan(at + 607_001);
    expect(sampleScenePeople(data, at + 550_000).people).toEqual([
      expect.objectContaining({ key: "opaque:0", moving: false, floorId: null }),
    ]);
    expect(source).toEqual(original);
  });

  it("removes faulted floor connections and invalidates in-flight routes while retaining the known room context", () => {
    const scene = multiFloorScene(), original = structuredClone(scene);
    const source = projection([claim("previous", "gate", -600, 0), claim("class", "room-place", 600, 1800)]);
    const normal = compileScenePeopleTracks(scene, multiFloorPlaces, source, "publication-1");
    const liftOnly = compileScenePeopleTracks(scene, multiFloorPlaces, source, "publication-1", { excludedConnectorIds: ["stairs"] });
    expect(normal.tracks.find(track => track.route)?.route?.transitions.map(transition => transition.kind)).toEqual(["entrance", "stairs"]);
    expect(liftOnly.tracks.find(track => track.route)?.route?.transitions.map(transition => transition.kind)).toEqual(["entrance", "lift"]);

    const blocked = compileScenePeopleTracks(scene, multiFloorPlaces, source, "publication-1", { excludedConnectorIds: ["stairs", "lift"] });
    expect(blocked.unavailableRoutes).toBe(1);
    expect(blocked.tracks.every(track => !track.route)).toBe(true);
    expect(blocked.scope.networkKey).not.toBe(normal.scope.networkKey);
    const transfer = normal.tracks.find(track => track.route)!;
    const instant = (transfer.startsAt + transfer.endsAt) / 2;
    expect(reconcileScenePeopleTracks(normal, blocked, scene, instant)).toBe(blocked);
    expect(sampleScenePeople(blocked, at + 1000_000, { floorId: "first" }).people).toEqual([
      expect.objectContaining({ key: "opaque:0", floorId: "first", moving: false }),
    ]);
    expect(scene).toEqual(original);
  });

  it("withholds transfers when operational layout routing is unavailable without erasing authorized expectations", () => {
    const scene = multiFloorScene();
    const source = projection([claim("previous", "gate", -600, 0), claim("class", "room-place", 600, 1800)]);
    const normal = compileScenePeopleTracks(scene, multiFloorPlaces, source, "publication-1");
    const unavailable = compileScenePeopleTracks(scene, multiFloorPlaces, source, "publication-1", { routingAvailable: false });
    expect(unavailable.unavailableRoutes).toBe(1);
    expect(unavailable.tracks.every(track => !track.route)).toBe(true);
    expect(unavailable.scope.networkKey).not.toBe(normal.scope.networkKey);
    expect(sampleScenePeople(unavailable, at + 1000_000).people).toEqual([
      expect.objectContaining({ moving: false, floorId: "first" }),
    ]);
  });

  it("anchors a scan inside a concave mapped footprint without turning its point evidence into a person", () => {
    const courtyard: CampusSceneElement = {
      id: "courtyard", kind: "surface", label: "Courtyard", space_id: "courtyard-place", floor_id: null, review_state: "reviewed",
      geometry: { type: "polygon", points: [point(0, 0), point(70, 0), point(70, 60), point(50, 60), point(50, 20), point(20, 20), point(20, 60), point(0, 60)] },
    };
    const scene: CampusSceneDocument = { schema_version: 1, name: "Courtyard campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [courtyard] };
    const source = projection([]);
    source.points = [{ id: "scan", space_id: "courtyard-place", observed_at: iso(0), dimension: "accepted", spatial_claim: "point_observation_only", source: { domain: "gate.movement", record_id: "scan", revision: null } }];
    const data = compileScenePeopleTracks(scene, [{ id: "courtyard-place", parent_space_id: null, kind: "outdoor" }], source, "publication-1");
    expect(scenePolygonContains(scenePolygonCenter(courtyard.geometry.points), courtyard.geometry.points)).toBe(false);
    expect(data.points).toHaveLength(1);
    expect(data.points[0]!.point).toEqual(sceneEvidenceAnchor(courtyard));
    expect(scenePolygonContains(data.points[0]!.point, courtyard.geometry.points)).toBe(true);
    expect(sampleScenePeople(data, at + 1000)).toMatchObject({ people: [], pulses: [{ key: "scan", dimension: "accepted", ageMs: 1000 }] });
    expect(sampleScenePeople(data, at + 120_000)).toEqual({ people: [], pulses: [] });
  });
});
