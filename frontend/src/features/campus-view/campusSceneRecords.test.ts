import { describe, expect, it } from "vitest";
import { campusActivityTrail, campusDateFormatter, campusSceneRecords } from "./campusSceneRecords";
import type { CampusExpectedUse, CampusViewResponse, CampusViewSpace } from "./types";

const expected: CampusExpectedUse = { id: "occurrence", occurrence_id: "stable", space_id: "room", title: "Robotics club", slot_type: "activity", class_label: null, subject_label: null, teacher: null, expected_count: 8, starts_at: "2026-10-25T09:00:00Z", ends_at: "2026-10-25T11:00:00Z", state: "in_progress", dimension: "expected", spatial_claim: "expected_context_only", source: { domain: "activities", record_id: "activity", revision: 2, label: "Published activity", target_path: "/areas/activities?activity=activity" } };
const room: CampusViewSpace = { id: "room", campus_id: "campus", name: "Room 201", code: "201", kind: "classroom", parent_space_id: null, floor_id: "", floor_label: "", capacity: 10, assertions: { expected: [], accepted: [], observed: [] }, expected_now: [expected], day_activity_count: 1, gate_activity_today: null, state_dimension: "expected", signal_count: 0 };
const fixture = (): CampusViewResponse => ({ schema_version: 1, school: { id: "school", name: "School" }, campuses: [{ id: "campus", name: "Campus", code: "MAIN", is_primary: true }], selected_campus_id: "campus", as_of: "2026-10-25T10:00:00Z", generated_at: "2026-10-25T10:00:00Z", plan: null, spaces: [structuredClone(room)], activity: [], signals: [], operations: null });

describe("canonical campus operational source records", () => {
  it("deduplicates mirrored occurrence, assertion and day-list evidence without summing expected people", () => {
    const data = fixture();
    data.spaces[0]!.assertions.expected.push({ id: "assertion", dimension: "expected", label: "Same club", source_label: "Published activity", source_domain: "activities", source_record_id: "activity", valid_from: expected.starts_at, valid_until: expected.ends_at, freshness: "not_applicable", count: 8 });
    data.activity.push({ id: "schedule:occurrence", title: expected.title, detail: "Expected activity", occurred_at: expected.starts_at, ends_at: expected.ends_at, source_label: "Published activity", state: "in_progress", state_dimension: "expected", space_id: "room" });
    const records = campusSceneRecords(data, "campus");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ temporal: "current", expectedCount: 8, targetPath: "/areas/activities?activity=activity" });
    expect(campusActivityTrail(data)).toHaveLength(1);
  });
  it("requires the confirmed half-open validity window before showing an expected group", () => {
    const data = fixture();
    data.as_of = expected.ends_at;
    expect(campusSceneRecords(data, "campus")).toEqual([]);
    data.as_of = "invalid";
    expect(campusSceneRecords(data, "campus")).toEqual([]);
  });
  it("keeps fresh point observations historical and leaves authoritative unknown state explicit", () => {
    const data = fixture(), space = data.spaces[0]!;
    space.expected_now = []; space.state_dimension = "unknown";
    space.assertions.observed = [{ id: "point", dimension: "observed", label: "Door capture", source_label: "Door device", spatial_claim: "point_observation_only", freshness: "fresh", observed_at: data.as_of }];
    const records = campusSceneRecords(data, "campus");
    expect(records.find(record => record.dimension === "observed")).toMatchObject({ temporal: "historical" });
    expect(records.find(record => record.dimension === "unknown")).toMatchObject({ title: "No current assertion", spaceId: "room" });
  });
  it("retains institution signals and unlocated current assignments without invented space IDs", () => {
    const data = fixture();
    data.activity.push({ id: "schedule:unlocated", title: "Unassigned activity", detail: "Place not supplied", occurred_at: expected.starts_at, ends_at: expected.ends_at, source_label: "Published activity", state: "in_progress", state_dimension: "expected", space_id: null });
    data.signals.push({ id: "review", severity: "review", title: "Review evidence", target_path: "/areas/in-out/manage" });
    const unlocated = campusSceneRecords(data, "campus").filter(record => !record.spaceId);
    expect(unlocated).toHaveLength(2);
    expect(unlocated.find(record => record.dimension === "expected")?.expectedCount).toBeUndefined();
    expect(campusSceneRecords(data, "other").some(record => record.spaceId === "room")).toBe(false);
  });
  it("retains distinct same-name assignments and their independent source counts", () => {
    const data = fixture();
    data.spaces[0]!.expected_now.push({ ...expected, id: "second", occurrence_id: "second", expected_count: 3 });
    expect(campusSceneRecords(data, "campus").map(record => record.expectedCount)).toEqual([8, 3]);
  });
  it("formats evidence in campus time and uses UTC for invalid legacy timezone", () => {
    const date = new Date("2026-10-25T12:00:00Z");
    expect(campusDateFormatter("Asia/Kolkata").format(date)).toContain("5:30");
    expect(campusDateFormatter("bad/timezone").format(date)).toBe(campusDateFormatter("UTC").format(date));
  });
});
