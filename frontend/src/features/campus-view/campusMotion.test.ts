import { describe, expect, it } from "vitest";
import { campusMotionMatches } from "./campusMotion";
import type { CampusMotionProjection } from "./campusMotion.types";
import { createSimulationExecutionEnvironment, LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";

const valid: CampusMotionProjection = { schema_version: 1, school_id: "school", campus_id: "campus", as_of: "2026-10-27T10:00:00Z", environment: { kind: "live", namespace_id: "live:school" }, subjects: [{ subject_key: "opaque", kind: "self", claims: [{ id: "claim", space_id: "place", starts_at: "2026-10-27T09:00:00Z", ends_at: "2026-10-27T11:00:00Z", expected_count: 1, spatial_claim: "expected_context_only", source: { domain: "activities", record_id: "plan", revision: 2 } }] }], points: [], limits: { subjects: 128, claims: 512, points: 64, source_limited: false }, limitations: [] };
const match = (value: unknown) => campusMotionMatches(value, "school", "campus", LIVE_EXECUTION_ENVIRONMENT);
describe("campus population projection boundary", () => {
  it("accepts only bounded source claims in the exact institution, campus and world", () => {
    expect(match(valid)).toBe(true); expect(match({ ...valid, school_id: "foreign" })).toBe(false); expect(match({ ...valid, campus_id: "foreign" })).toBe(false);
    expect(match({ ...valid, environment: { kind: "simulation", namespace_id: "other" } })).toBe(false);
    const environment = createSimulationExecutionEnvironment({ namespaceId: "run-a", runId: "a", virtualClock: { now: valid.as_of, timeZone: "UTC" } });
    const data = { ...valid, environment: { kind: "simulation", namespace_id: "run-a" } };
    expect(campusMotionMatches(data, "school", "campus", environment)).toBe(true);
    expect(campusMotionMatches({ ...data, environment: { ...data.environment, namespace_id: "run-b" } }, "school", "campus", environment)).toBe(false);
  });
  it.each(["ends_at", "starts_at"])("rejects malformed %s and never promotes a point observation into expected people", key => {
    const data = structuredClone(valid); data.subjects[0]!.claims[0]![key as "ends_at" | "starts_at"] = "invalid"; expect(match(data)).toBe(false);
    expect(match({ ...valid, subjects: [{ ...valid.subjects[0], claims: [{ ...valid.subjects[0]!.claims[0], spatial_claim: "bounded_space_presence" }] }] })).toBe(false);
  });
  it("rejects duplicate subject identities, oversized payloads and count inflation for one person", () => {
    expect(match({ ...valid, subjects: [...valid.subjects, ...valid.subjects] })).toBe(false);
    expect(match({ ...valid, points: Array.from({ length: 65 }, () => ({})) })).toBe(false);
    const data = structuredClone(valid); data.subjects[0]!.claims[0]!.expected_count = 20; expect(match(data)).toBe(false);
    data.subjects[0]!.kind = "group"; expect(match(data)).toBe(true);
  });
});
