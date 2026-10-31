import { describe, expect, it } from "vitest";
import { compileScenePeopleTracks, reconcileScenePeopleTracks, sampleScenePeople } from "./scenePeopleTracks";
import type { CampusMotionClaim, CampusMotionProjection } from "../campus-view/campusMotion.types";
import type { CampusSceneDocument } from "./types";

const at = Date.parse("2026-10-27T10:00:00Z"), iso = (seconds: number) => new Date(at + seconds * 1000).toISOString();
const point = (x: number, y: number) => ({ x, y });
const scene: CampusSceneDocument = { schema_version: 1, name: "Any campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [
  { id: "gate", kind: "fixture", asset_key: "gate", label: "Entry", space_id: "a", floor_id: null, review_state: "reviewed", geometry: { type: "point", points: [point(10, 10)] } },
  { id: "plaza", kind: "surface", label: "Plaza", space_id: "b", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [point(40, 0), point(60, 0), point(60, 20), point(40, 20)] } },
  { id: "hall", kind: "building", label: "Hall", space_id: "c", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [point(40, 45), point(60, 45), point(60, 60), point(40, 60)] } },
  { id: "walk-a", kind: "path", label: "East walk", space_id: null, floor_id: null, width: 3, review_state: "reviewed", geometry: { type: "polyline", points: [point(10, 10), point(50, 10)] }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: "a", end_space_id: "b" } },
  { id: "walk-b", kind: "path", label: "South walk", space_id: null, floor_id: null, width: 3, review_state: "reviewed", geometry: { type: "polyline", points: [point(50, 10), point(50, 50)] }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: "b", end_space_id: "c" } },
] };
const places = [{ id: "a", parent_space_id: null, kind: "gate" }, { id: "b", parent_space_id: null, kind: "outdoor" }, { id: "c", parent_space_id: null, kind: "building" }, { id: "room", parent_space_id: "c", kind: "classroom" }];
const claim = (id: string, space: string, from: number, until: number): CampusMotionClaim => ({ id, space_id: space, starts_at: iso(from), ends_at: iso(until), expected_count: 1, spatial_claim: "expected_context_only", source: { domain: "activities", record_id: id, revision: 1 } });
const projection = (claims: CampusMotionClaim[]): CampusMotionProjection => ({ schema_version: 1, school_id: "school", campus_id: "campus", as_of: iso(0), environment: { kind: "live", namespace_id: null }, subjects: [{ subject_key: "opaque", kind: "person", claims }], points: [], limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: [] });

describe("generic DT people tracks", () => {
  it("walks a connected planned transfer at steady pace and keeps the same key across snapshots", () => {
    const input = projection([claim("previous", "a", -600, 0), claim("next", "b", 120, 600)]);
    const data = compileScenePeopleTracks(scene, places, input, "v1");
    const first = sampleScenePeople(data, at + 100_000).people[0]!, second = sampleScenePeople(data, at + 101_000).people[0]!;
    expect(first.point.y).toBe(10); expect(second.point.x - first.point.x).toBeGreaterThanOrEqual(1.1); expect(second.point.x - first.point.x).toBeLessThanOrEqual(1.42); expect(first.moving).toBe(true);
    const refreshed = compileScenePeopleTracks(structuredClone(scene), places, { ...input, as_of: iso(101) }, "v1");
    expect(sampleScenePeople(refreshed, at + 101_000).people).toEqual(sampleScenePeople(data, at + 101_000).people);
    expect(sampleScenePeople(data, at + 600_000).people).toEqual([]);
  });
  it("follows bends continuously and targets an exact canonical ancestor entrance without placing room occupants on roofs", () => {
    const data = compileScenePeopleTracks(scene, places, projection([claim("prior", "a", -600, 0), claim("room-plan", "room", 120, 600)]), "v1");
    const track = data.tracks.find(track => track.route)!;
    const corner = track.startsAt + (track.endsAt - track.startsAt) * .5;
    const before = sampleScenePeople(data, corner - 1).people[0]!, after = sampleScenePeople(data, corner + 1).people[0]!;
    expect(Math.hypot(before.point.x - after.point.x, before.point.y - after.point.y)).toBeLessThan(.01);
    expect(sampleScenePeople(data, at + 200_000).people).toEqual([]);
  });
  it("never invents a walk for closed, disconnected, missing or unlinked paths", () => {
    const document = structuredClone(scene); document.elements[3]!.navigation!.status = "closed";
    const data = compileScenePeopleTracks(document, places, projection([claim("prior", "a", -600, 0), claim("next", "b", 120, 600)]), "v1");
    expect(data.unavailableRoutes).toBe(1); expect(sampleScenePeople(data, at + 100_000).people).toEqual([]);
    const unknown = compileScenePeopleTracks(scene, places, projection([claim("unknown", "unmapped", 0, 600)]), "v1");
    expect(unknown.unmapped).toBe(1); expect(unknown.tracks).toEqual([]);
  });
  it("bounds anonymous representative figures and keeps exact rooms on their floor", () => {
    const document = structuredClone(scene); document.elements.push({ ...scene.elements[1]!, id: "room-shape", kind: "room", space_id: "room", floor_id: "first" });
    const input = projection([{ ...claim("class", "room", 0, 600), expected_count: 400 }]); input.subjects[0]!.kind = "group";
    const data = compileScenePeopleTracks(document, places, input, "v1"), poses = sampleScenePeople(data, at + 1000).people;
    expect(poses).toHaveLength(8); expect(poses.every(pose => pose.floorId === "first" && !pose.moving)).toBe(true);
  });
  it("leaves conflicting expectations unknown and does not bridge through their ambiguous period", () => {
    const data = compileScenePeopleTracks(scene, places, projection([claim("prior", "a", -600, -100), claim("one", "b", 0, 100), claim("two", "c", 50, 200), claim("after", "b", 250, 600)]), "v1");
    expect(data.conflicting).toBe(1); expect(data.tracks.every(track => !track.route)).toBe(true);
  });
  it("retargets a revised destination from the current reviewed edge without a jump and invalidates changed networks/worlds", () => {
    const previous = compileScenePeopleTracks(scene, places, projection([claim("prior", "a", -600, 0), claim("next", "b", 120, 600)]), "v1");
    const next = compileScenePeopleTracks(scene, places, projection([claim("prior", "a", -600, 0), { ...claim("next", "c", 120, 600), source: { domain: "activities", record_id: "next", revision: 2 } }]), "v1");
    const instant = at + 100_000, old = sampleScenePeople(previous, instant).people[0]!;
    const reconciled = reconcileScenePeopleTracks(previous, next, scene, instant);
    expect(sampleScenePeople(reconciled, instant).people[0]!.point).toEqual(old.point);
    expect(sampleScenePeople(reconciled, instant).people[0]!.opacity).toBe(old.opacity);
    const closed = structuredClone(scene); closed.elements[3]!.navigation!.status = "closed";
    const changed = compileScenePeopleTracks(closed, places, projection([claim("next", "c", 120, 600)]), "v1");
    expect(reconcileScenePeopleTracks(previous, changed, closed, instant)).toBe(changed);
    expect(reconcileScenePeopleTracks(previous, { ...next, contextKey: "other-world" }, scene, instant).tracks).toEqual(next.tracks);
  });
  it("shows timestamped scan pulses separately, never turning them into people", () => {
    const input = projection([]); input.points = [{ id: "scan", space_id: "a", observed_at: iso(0), dimension: "accepted", spatial_claim: "point_observation_only", source: { domain: "gate.movement", record_id: "scan", revision: null } }];
    const data = compileScenePeopleTracks(scene, places, input, "v1");
    expect(sampleScenePeople(data, at + 1000)).toMatchObject({ people: [], pulses: [{ key: "scan", ageMs: 1000 }] });
    expect(sampleScenePeople(data, at + 120_000).pulses).toEqual([]); expect(sampleScenePeople(data, null)).toEqual({ people: [], pulses: [] });
  });
  it("keeps distinct people in one plan naturally separated with stable pacing across refreshes", () => {
    const input = projection([claim("prior", "a", -600, 0), claim("next", "b", 120, 600)]);
    input.subjects = Array.from({ length: 8 }, (_, index) => ({ ...input.subjects[0]!, subject_key: `person-${index}` }));
    const first = sampleScenePeople(compileScenePeopleTracks(scene, places, input, "v1"), at + 105_000).people;
    expect(first).toHaveLength(8);
    expect(new Set(first.map(pose => pose.point.x.toFixed(3))).size).toBe(8);
    const second = sampleScenePeople(compileScenePeopleTracks(scene, places, { ...input, as_of: iso(105) }, "v1"), at + 105_000).people;
    expect(second).toEqual(first);
  });
});
