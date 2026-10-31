import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import type { CampusMotionClaim, CampusMotionProjection } from "../campus-view/campusMotion.types";
import type { CampusSceneDocument } from "./types";
import { useScenePeople } from "./useScenePeople";
import { sampleScenePeople } from "./scenePeopleTracks";
const context = vi.hoisted(() => ({ environment: { mode: "live" } }));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({ useOptionalExecutionEnvironment: () => context.environment }));
const at = Date.parse("2026-10-27T10:00:00Z"), iso = (s: number) => new Date(at + s * 1000).toISOString();
const claim = (id: string, space: string, from: number, to: number): CampusMotionClaim => ({ id, space_id: space, starts_at: iso(from), ends_at: iso(to), expected_count: 1, spatial_claim: "expected_context_only", source: { domain: "activities", record_id: id, revision: 1 } });
const scene: CampusSceneDocument = { schema_version: 1, name: "Campus", bounds: { width: 100, height: 100, unit: "metres" }, source: { kind: "manual", label: "Reviewed" }, elements: [
  ...["a", "b", "c"].map((id, index) => ({ id, kind: "surface" as const, label: id, space_id: id, floor_id: null, review_state: "reviewed" as const, geometry: { type: "polygon" as const, points: [{ x: index * 40, y: 0 }, { x: index * 40 + 20, y: 0 }, { x: index * 40 + 20, y: 20 }, { x: index * 40, y: 20 }] } })),
  ...[0, 1].map(index => ({ id: `path${index}`, kind: "path" as const, label: "Walk", space_id: null, floor_id: null, review_state: "reviewed" as const, width: 3, geometry: { type: "polyline" as const, points: [{ x: 10 + index * 40, y: 10 }, { x: 50 + index * 40, y: 10 }] }, navigation: { walkable: true, accessible: true, status: "open" as const, start_space_id: ["a", "b"][index]!, end_space_id: ["b", "c"][index]! } })),
] };
const places = ["a", "b", "c"].map(id => ({ id, name: id, code: id, kind: "outdoor_area", parent_space_id: null }));
const motion = (): CampusMotionProjection => ({ schema_version: 1, school_id: "school", campus_id: "campus", as_of: iso(0), environment: { kind: "simulation", namespace_id: "world" }, subjects: [{ subject_key: "person", kind: "self", claims: [claim("prior", "a", -600, 0), claim("next", "b", 120, 600)] }], points: [], limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: [] });
const simulation = (s = 100): ExecutionEnvironment => ({ mode: "simulation", institutionId: "school", namespaceId: "world", runId: "run", virtualClock: { now: iso(s), timeZone: "UTC" }, runStatus: "paused" });
afterEach(() => { cleanup(); context.environment = { mode: "live" }; });

describe("people source and selected clock", () => {
  it("rejects foreign institutions/campuses/worlds and clears immediately when authority data disappears", () => {
    context.environment = simulation(); const input = motion();
    const { result, rerender } = renderHook(({ schoolId, campusId, data }) => useScenePeople(scene, places, schoolId, campusId, "v1", data), { initialProps: { schoolId: "school", campusId: "campus", data: input } });
    expect(result.current.data?.tracks.length).toBeGreaterThan(0);
    rerender({ schoolId: "other", campusId: "campus", data: input }); expect(result.current.data).toBeNull();
    rerender({ schoolId: "school", campusId: "other", data: input }); expect(result.current.data).toBeNull();
    rerender({ schoolId: "school", campusId: "campus", data: { ...input, environment: { kind: "simulation", namespace_id: "other-world" } } }); expect(result.current.data).toBeNull();
    rerender({ schoolId: "school", campusId: "campus", data: input }); expect(result.current.data).not.toBeNull();
    rerender({ schoolId: "school", campusId: "campus", data: undefined }); expect(result.current.data).toBeNull();
  });
  it("uses only confirmed Simulation time and resets retargeting on same-source backward seeks", () => {
    context.environment = simulation(); const input = motion();
    const { result, rerender } = renderHook(({ data }) => useScenePeople(scene, places, "school", "campus", "v1", data), { initialProps: { data: input } });
    const revised = { ...input, as_of: iso(100), subjects: [{ ...input.subjects[0]!, claims: [input.subjects[0]!.claims[0]!, { ...claim("next", "c", 120, 600), source: { domain: "activities", record_id: "next", revision: 2 } }] }] };
    rerender({ data: revised }); expect(result.current.data?.tracks.some(track => track.retargeted)).toBe(true);
    expect(result.current.clock).toMatchObject({ instant: at + 100_000, live: false, running: false });
    context.environment = simulation(90); rerender({ data: revised }); expect(result.current.data?.tracks.some(track => track.retargeted)).toBe(false);
    expect(result.current.clock.instant).toBe(at + 90_000);
    const sampled = sampleScenePeople(result.current.data!, result.current.clock.instant);
    rerender({ data: revised }); expect(sampleScenePeople(result.current.data!, result.current.clock.instant)).toEqual(sampled);
    act(() => result.current.setEnabled(false)); expect(result.current.data).toBeNull(); expect(result.current.compiled).not.toBeNull();
  });
  it("withdraws movement when a layout changes and reuses source tracks on clock-only forward updates", () => {
    context.environment = simulation(); const input = motion();
    const { result, rerender } = renderHook(({ routingAvailable }) => useScenePeople(scene, places, "school", "campus", "v1", input, { routingAvailable }), { initialProps: { routingAvailable: true } });
    const first = result.current.data; context.environment = simulation(101); rerender({ routingAvailable: true }); expect(result.current.data).toBe(first);
    rerender({ routingAvailable: false }); expect(result.current.data?.tracks.some(track => track.route)).toBe(false);
  });
});
