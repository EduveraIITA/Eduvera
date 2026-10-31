import { describe, expect, it } from "vitest";
import { campusDayMotionClaims, projectCampusMotion, type CampusMotionClaimInput } from "../src/campus-view/campus-motion.projection.js";
import type { CampusViewDayOccurrence } from "../src/campus-view/campus-view.repository.js";

const claim = (overrides: Partial<CampusMotionClaimInput> = {}): CampusMotionClaimInput => ({
  identity: "canonical-person", kind: "person", occurrence_id: "logical-session", space_id: "room-a",
  starts_at: "2026-10-27T08:00:00.000Z", ends_at: "2026-10-27T09:00:00.000Z", expected_count: 1,
  source: { domain: "timetable", record_id: "approved-plan", revision: 2 }, ...overrides,
});
const base = () => ({ school_id: "institution-a", campus_id: "campus-a", viewer_user_id: "viewer-a", as_of: "2026-10-27T08:30:00.000Z",
  environment: { kind: "live" as const, namespace_id: "live:institution-a" }, space_ids: new Set(["room-a", "room-b"]), claims: [claim()] });
const occurrence = (overrides: Partial<CampusViewDayOccurrence> = {}): CampusViewDayOccurrence => ({
  id: "revision-a", occurrence_id: "logical-session", space_id: "room-a", title: "Review", slot_type: "activity",
  class_label: null, class_entity_id: null, subject_label: null, responsible_agent_id: null, teacher_label: null,
  responsible_person_id: null, expected_includes_responsible: false, expected_count: 2,
  starts_at: "2026-10-27T08:00:00.000Z", ends_at: "2026-10-27T09:00:00.000Z",
  source_domain: "timetable", source_record_id: "approved-plan", source_revision: 2, ...overrides,
});

describe("anonymous campus motion projection", () => {
  it("keeps one canonical human stable across roles, place changes and polling with exact source windows", () => {
    const initial = projectCampusMotion(base());
    const moved = projectCampusMotion({ ...base(), as_of: "2026-10-27T08:31:00.000Z", claims: [
      claim(), claim({ kind: "self", space_id: "room-b", source: { domain: "day_plan", record_id: "dated-plan", revision: 3 } }),
    ] });
    expect(moved.subjects).toHaveLength(1);
    expect(moved.subjects[0]?.subject_key).toBe(initial.subjects[0]?.subject_key);
    expect(moved.subjects[0]?.claims).toEqual([expect.objectContaining({ id: initial.subjects[0]?.claims[0]?.id,
      space_id: "room-b", starts_at: "2026-10-27T08:00:00.000Z", ends_at: "2026-10-27T09:00:00.000Z",
      spatial_claim: "expected_context_only", source: { domain: "day_plan", record_id: "dated-plan", revision: 3 } })]);
    expect(JSON.stringify(moved)).not.toContain("canonical-person");
    expect(moved.as_of).toBe("2026-10-27T08:31:00.000Z");
  });

  it("prevents identity joins across viewers, institutions, campuses and selected worlds", () => {
    const initial = projectCampusMotion(base()).subjects[0]!.subject_key;
    const changes = [{ viewer_user_id: "viewer-b" }, { school_id: "institution-b" }, { campus_id: "campus-b" },
      { environment: { kind: "simulation" as const, namespace_id: "scenario:a:run:b" } },
      { environment: { kind: "simulation" as const, namespace_id: "scenario:a:run:c" } }];
    expect(new Set([initial, ...changes.map(change => projectCampusMotion({ ...base(), ...change }).subjects[0]!.subject_key)]).size).toBe(6);
  });

  it("retains previous and future plan intervals without inventing current validity or coordinates", () => {
    const input = base(); input.as_of = "2026-10-27T12:30:00.000Z";
    input.claims.push(claim({ occurrence_id: "later", starts_at: "2026-10-27T14:00:00.000Z", ends_at: "2026-10-27T15:00:00.000Z", space_id: null }));
    const result = projectCampusMotion(input);
    expect(result.subjects[0]?.claims).toHaveLength(2);
    expect(result.subjects[0]?.claims[1]?.space_id).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/coordinates|latitude|longitude|confirmed/);
    expect(result.subjects[0]?.claims[0]?.ends_at).toBe("2026-10-27T09:00:00.000Z");
  });

  it("rejects invalid or foreign context, empty counts and source records without a revision", () => {
    const result = projectCampusMotion({ ...base(), claims: [
      claim({ space_id: "foreign-room" }), claim({ expected_count: 0 }), claim({ expected_count: 2 }),
      claim({ starts_at: "invalid" }), claim({ ends_at: "2026-10-27T07:00:00.000Z" }),
      claim({ source: { domain: "timetable", record_id: "plan", revision: 0 } }),
    ] });
    expect(result.subjects).toEqual([]);
    expect(projectCampusMotion({ ...base(), campus_id: null }).subjects).toEqual([]);
  });

  it("uses actual observation IDs/times without converting a scan into a position or interval", () => {
    const result = projectCampusMotion({ ...base(), as_of: "2026-10-27T14:00:00+05:30", points: [
      { id: "observation-a", space_id: "room-a", observed_at: "2026-10-27T08:29:00Z", dimension: "accepted",
        source: { domain: "gate.movement", record_id: "recorded-scan", revision: null } },
      { id: "future", space_id: "room-a", observed_at: "2026-10-27T08:31:00Z", dimension: "observed",
        source: { domain: "gate.movement", record_id: "future-scan", revision: null } },
      { id: "foreign", space_id: "foreign-room", observed_at: "2026-10-27T08:20:00Z", dimension: "accepted",
        source: { domain: "gate.movement", record_id: "foreign-scan", revision: null } },
    ] });
    expect(result.points).toEqual([{ id: "observation-a", space_id: "room-a", observed_at: "2026-10-27T08:29:00.000Z",
      dimension: "accepted", spatial_claim: "point_observation_only", source: { domain: "gate.movement", record_id: "recorded-scan", revision: null } }]);
    expect(result.subjects[0]?.claims[0]?.source.domain).toBe("timetable");
  });

  it("bounds subjects and claims explicitly, including bounded source reads", () => {
    const people = projectCampusMotion({ ...base(), claims: Array.from({ length: 150 }, (_, i) => claim({ identity: `person-${i}` })) });
    expect(people.subjects).toHaveLength(128); expect(people.limits.source_limited).toBe(true);
    const intervals = projectCampusMotion({ ...base(), claims: Array.from({ length: 530 }, (_, i) => claim({ occurrence_id: `period-${i}` })) });
    expect(intervals.subjects[0]?.claims).toHaveLength(512); expect(intervals.limits.source_limited).toBe(true);
    expect(projectCampusMotion({ ...base(), source_limited: true }).limits.source_limited).toBe(true);
    expect(projectCampusMotion(base()).limits.source_limited).toBe(false);
  });
});

describe("current plan participant projection", () => {
  it("emits complete anonymous participants with one human across responsible and participant sources", () => {
    const input = occurrence({ responsible_person_id: "person-a", expected_includes_responsible: true });
    const claims = campusDayMotionClaims([input], [{ occurrence_id: input.id, person_id: "person-a" }, { occurrence_id: input.id, person_id: "person-b" }]);
    expect(claims.map(item => [item.kind, item.identity, item.expected_count])).toEqual([["person", "person-a", 1], ["person", "person-b", 1]]);
    expect(projectCampusMotion({ ...base(), claims }).subjects).toHaveLength(2);
  });

  it("uses only one legitimate full-count group when private participant coverage is incomplete", () => {
    const input = occurrence({ responsible_person_id: "person-a", expected_includes_responsible: true });
    const claims = campusDayMotionClaims([input], [{ occurrence_id: input.id, person_id: "person-b" }]);
    expect(claims).toEqual([expect.objectContaining({ kind: "group", identity: "activity:logical-session", expected_count: 2 })]);
  });

  it("keeps a legacy class cohort stable between places, adding a responsible person only when excluded from its count", () => {
    const first = occurrence({ class_entity_id: "canonical-class", responsible_person_id: "person-a", expected_count: 30 });
    const second = occurrence({ id: "revision-b", occurrence_id: "logical-b", space_id: "room-b", class_entity_id: "canonical-class",
      responsible_person_id: "person-a", expected_count: 30, expected_includes_responsible: true });
    const claims = campusDayMotionClaims([first, second], []);
    expect(claims.map(item => item.expected_count)).toEqual([30, 1, 30]);
    const result = projectCampusMotion({ ...base(), claims });
    expect(result.subjects.find(item => item.kind === "group")?.claims).toHaveLength(2);
    expect(result.subjects.find(item => item.kind === "person")?.claims).toHaveLength(1);
  });

  it("does not replace a missing expected people count with a number of records", () => {
    expect(campusDayMotionClaims([occurrence({ expected_count: 0 })], [])).toEqual([]);
    expect(campusDayMotionClaims([occurrence({ expected_count: Number.NaN })], [])).toEqual([]);
  });
});
