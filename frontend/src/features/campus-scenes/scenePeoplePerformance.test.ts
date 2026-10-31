import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleScenePeople } from "./scenePeopleTracks";
import * as motion from "./scenePeopleMotion";
import { findSceneWalkingRoute } from "./sceneWalking";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import type { ScenePeopleCompiled, ScenePeopleTrack } from "./scenePeopleTracks.types";

const scope = { worldKey: "owned-scale-world", publicationKey: "reviewed-publication", networkKey: "reviewed-network" };
const path = (floorId: string | null): CampusSceneElement => ({ id: floorId ? "upper-path" : "ground-path", kind: "path", label: "Reviewed walking path", floor_id: floorId, space_id: null, review_state: "reviewed", width: 6,
  geometry: { type: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, navigation: { walkable: true, accessible: true, status: "open", start_space_id: floorId ? "upper-start" : "ground-start", end_space_id: floorId ? "upper-end" : "ground-end" } });
const scene: CampusSceneDocument = { schema_version: 1, name: "Scale campus", bounds: { width: 300, height: 300, unit: "metres" }, source: { kind: "manual", label: "Reviewed layout" }, elements: [path(null), path("upper")] };
const ground = motion.compileScenePeopleRoute(findSceneWalkingRoute(scene, { fromSpaceId: "ground-start", toSpaceId: "ground-end" }), scope, scene)!;
const upper = motion.compileScenePeopleRoute(findSceneWalkingRoute(scene, { fromSpaceId: "upper-start", toSpaceId: "upper-end" }), scope, scene)!;
const track = (key: string, route = ground): ScenePeopleTrack => ({ key, sourceKey: `plan:${key}`, tone: "expected", targetSpaceId: route.toSpaceId, bodyRadius: .24, startsAt: 1000, endsAt: 101_000, route, routeStartsAt: 1000, routeEndsAt: 101_000 });
function largeSnapshot(active = 1024): ScenePeopleCompiled {
  const tracks = Array.from({ length: active }, (_, index) => track(`subject-${Math.floor(index / 8)}:${index % 8}`));
  const idle: CampusSceneElement = { id: "plaza", kind: "surface", label: "Plaza", space_id: "plaza", floor_id: null, review_state: "reviewed", geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] } };
  return { contextKey: scope.worldKey, scope, asOf: 50_000, tracks: [
    ...tracks,
    ...tracks.map(item => ({ ...item, route: undefined, idle: { point: { x: 50, y: 50 }, floorId: null, element: idle } })),
    ...tracks.map((item, index) => ({ ...item, key: `future-${index}`, startsAt: 200_000, endsAt: 300_000 })),
    ...tracks.map((item, index) => ({ ...item, key: `upper-${index}`, route: upper })),
    { ...track("viewer-self"), tone: "self" },
  ], points: [], unmapped: 0, unavailableRoutes: 0, conflicting: 0, sourceLimited: false };
}
afterEach(() => vi.restoreAllMocks());

describe("bounded people sampling at campus scale", () => {
  it.each([128, 256])("samples at most %s unique current-floor representatives before expensive route geometry", maximum => {
    const input = largeSnapshot(), routeSample = vi.spyOn(motion, "sampleScenePeopleRoute");
    const result = sampleScenePeople(input, 50_000, { maxPeople: maximum, floorId: null });
    expect(result.people).toHaveLength(maximum);
    expect(new Set(result.people.map(person => person.key)).size).toBe(maximum);
    expect(result.people.some(person => person.key === "viewer-self")).toBe(true);
    expect(result.people.every(person => person.floorId === null && person.moving)).toBe(true);
    expect(routeSample.mock.calls.length).toBeLessThanOrEqual(maximum * 3);
    expect(routeSample.mock.calls.every(call => call[0] === ground)).toBe(true);
    const keys = result.people.map(person => person.key);
    expect(sampleScenePeople({ ...input, tracks: [...input.tracks].reverse() }, 50_001, { maxPeople: maximum, floorId: null }).people.map(person => person.key)).toEqual(keys);
  });
  it("records warmed sampling cost without a hardware-dependent timing assertion", () => {
    const results: { inputTracks: number; maxPeople: number; sampledPeople: number; medianMs: number; p95Ms: number }[] = [];
    for (const active of [128, 1024]) for (const maximum of [128, 256]) {
      const input = largeSnapshot(active);
      for (let frame = 0; frame < 8; frame++) sampleScenePeople(input, 50_000 + frame, { maxPeople: maximum, floorId: null });
      const durations: number[] = []; let sampledPeople = 0;
      for (let frame = 0; frame < 64; frame++) {
        const start = performance.now(), result = sampleScenePeople(input, 50_000 + frame * 16, { maxPeople: maximum, floorId: null });
        durations.push(performance.now() - start); sampledPeople = result.people.length; expect(sampledPeople).toBeLessThanOrEqual(maximum);
      }
      durations.sort((a, b) => a - b);
      results.push({ inputTracks: input.tracks.length, maxPeople: maximum, sampledPeople, medianMs: durations[32]!, p95Ms: durations[60]! });
    }
    const output = process.env.CAMPUS_PEOPLE_BENCHMARK_OUTPUT;
    if (output) writeFileSync(output, `${JSON.stringify({ measuredAt: new Date().toISOString(), environment: "Vitest jsdom; sampler CPU only, not rendering or physical-device FPS", samplesPerCase: 64, results }, null, 2)}\n`);
    expect(results).toHaveLength(4);
  });
});
