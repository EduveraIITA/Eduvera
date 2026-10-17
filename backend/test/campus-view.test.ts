import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { CampusModelCorePort } from "../src/campus-model-core/campus-model-core.port.js";
import type {
  ExpectedTemporalAssertion,
  ObservedTemporalAssertion,
  TemporalContextPort,
} from "../src/campus-model-core/temporal-context.port.js";
import { CampusViewController } from "../src/campus-view/campus-view.controller.js";
import type { CampusViewRepository } from "../src/campus-view/campus-view.repository.js";
import { CampusViewService } from "../src/campus-view/campus-view.service.js";
import { generatedSchematic, type CampusViewSpaceRecord } from "../src/campus-view/contracts.js";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  school: "00000000-0000-4000-8000-000000000002",
  campus: "00000000-0000-4000-8000-000000000003",
  otherCampus: "00000000-0000-4000-8000-000000000004",
  floor: "00000000-0000-4000-8000-000000000005",
  room: "00000000-0000-4000-8000-000000000006",
  gate: "00000000-0000-4000-8000-000000000007",
  expected: "00000000-0000-4000-8000-000000000008",
  observed: "00000000-0000-4000-8000-000000000009",
  accepted: "00000000-0000-4000-8000-000000000010",
};

const user = {
  id: ids.user,
  username: "admin",
  email: "admin@example.test",
  first_name: "Asha",
  last_name: "Admin",
  role: "admin",
  is_active: true,
  active_school_id: ids.school,
} as AuthUser;

const campus = {
  id: ids.campus,
  name: "North campus",
  code: "NORTH",
  campus_type: "main" as const,
  is_primary: true,
  timezone: "Asia/Kolkata",
  revision: 2,
};

const spaces: CampusViewSpaceRecord[] = [
  { id: ids.floor, campus_id: ids.campus, parent_space_id: null, name: "First floor", code: "F1", kind: "floor", capacity: null, revision: 1 },
  { id: ids.room, campus_id: ids.campus, parent_space_id: ids.floor, name: "Room 101", code: "R101", kind: "classroom", capacity: 30, revision: 3 },
  { id: ids.gate, campus_id: ids.campus, parent_space_id: ids.floor, name: "North gate", code: "GATE", kind: "gate", capacity: null, revision: 1 },
];

const expected: ExpectedTemporalAssertion = {
  assertion_id: ids.expected,
  dimension: "expected",
  assertion_type: "scheduled_context",
  subject: { type: "entity", id: ids.room, label: "Room 101" },
  context: {
    occurrence_id: "occurrence-1",
    occurrence_revision_id: "occurrence-revision-1",
    schedule_version_id: "schedule-1",
    period_number: 1,
    class_entity_id: "class-1",
    class_label: "Class 6A",
    subject_entity_id: "subject-1",
    subject_label: "Mathematics",
    space_entity_id: ids.room,
    space_label: "Room 101",
    title: "Mathematics",
    slot_type: "class",
  },
  valid_from: "2026-10-16T03:30:00.000Z",
  valid_until: "2026-10-16T04:15:00.000Z",
  recorded_at: "2026-10-15T08:00:00.000Z",
  source: {
    event_id: "event-1",
    event_type: "timetable.schedule_published",
    source_domain: "timetable",
    source_record_id: "schedule-1",
    source_revision: 4,
    journal_sequence: "1",
    change: {
      event_id: "event-1",
      event_type: "timetable.schedule_published",
      source_domain: "timetable",
      source_record_id: "schedule-1",
      source_revision: 4,
      journal_sequence: "1",
      change_kind: "published",
    },
    condition: null,
  },
  certainty: "planned",
  freshness: "current",
  contradictions: [],
};

function observation(id: string, dimension: "observed" | "accepted", state: "pending" | "accepted"): ObservedTemporalAssertion {
  return {
    assertion_id: id,
    dimension,
    assertion_type: "direct_observation",
    subject: { type: "entity", id: "person-1", label: "Aarav Sharma", kind: "student" },
    context: { entity_id: ids.gate, label: "North gate", kind: "space" },
    observation: { kind: "movement.gate_observed", state, payload: { direction: "in" } },
    observed_at: "2026-10-16T03:35:00.000Z",
    recorded_at: "2026-10-16T03:35:01.000Z",
    source: {
      observation_id: id,
      source_type: "gate.movement",
      source_ref: "reader-1",
      source_record_id: `movement-${id}`,
      captured_by_agent_id: "device-1",
      captured_by_kind: "device",
      captured_by_label: "North gate reader",
    },
    certainty: dimension === "accepted" ? "accepted" : "observed",
    freshness: "point_in_time",
    contradictions: [],
  };
}

function dependencies(options: { authorized?: boolean } = {}) {
  const repository = {
    hasActiveAdminMembership: vi.fn().mockResolvedValue(options.authorized ?? true),
    school: vi.fn().mockResolvedValue({ id: ids.school, name: "Example school", code: "EX", timezone: "Asia/Kolkata" }),
    campuses: vi.fn().mockResolvedValue([campus]),
    spaces: vi.fn().mockResolvedValue(spaces),
    examSpaceExpectations: vi.fn().mockResolvedValue([]),
    dayOccurrences: vi.fn().mockResolvedValue([]),
    gateActivityToday: vi.fn().mockResolvedValue([]),
    activeVisitorCount: vi.fn().mockResolvedValue(0),
  };
  const temporalContext = {
    resolveAt: vi.fn().mockImplementation(({ subject }: { subject: { domain_id: string } }) => {
      if (subject.domain_id === ids.room) return Promise.resolve([expected]);
      if (subject.domain_id === ids.gate) return Promise.resolve([
        observation(ids.observed, "observed", "pending"),
        observation(ids.accepted, "accepted", "accepted"),
      ]);
      return Promise.resolve([]);
    }),
  };
  const campusModel = {
    recentActivity: vi.fn().mockResolvedValue([{
      id: "activity-1", kind: "setup", action: "space.created", subject_label: "Room 101",
      item_count: 1, state: "accepted", occurred_at: "2026-10-16T03:20:00.000Z", actor_label: "Asha Admin",
    }]),
    operationalSignals: vi.fn().mockResolvedValue([{
      id: "signal-1", kind: "expected_after_exit", severity: "review", owner: "gate",
      student_id: "student-1", person_label: "Aarav Sharma", class_label: "Class 6A",
      activity_label: "Mathematics", gate_label: "North gate", gate_observed_at: "2026-10-16T03:32:00.000Z",
      expected_from: "2026-10-16T03:30:00.000Z", expected_until: "2026-10-16T04:15:00.000Z", attendance_status: null,
    }]),
  };
  const service = new CampusViewService(
    repository as unknown as CampusViewRepository,
    temporalContext as unknown as TemporalContextPort,
    campusModel as unknown as CampusModelCorePort,
  );
  return { service, repository, temporalContext, campusModel };
}

describe("Campus View route and authorization", () => {
  it("publishes the stable school-scoped GET route", () => {
    const routeHandler = Object.getOwnPropertyDescriptor(CampusViewController.prototype, "view")?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, CampusViewController)).toBe("api/v1/schools/:schoolId/campus-view");
    expect(Reflect.getMetadata(PATH_METADATA, routeHandler)).toBe("/");
    expect(Reflect.getMetadata(METHOD_METADATA, routeHandler)).toBe(RequestMethod.GET);
  });

  it("forwards the authenticated user and optional as-of selection", async () => {
    const view = vi.fn().mockResolvedValue({ schema_version: 1 });
    const controller = new CampusViewController({ view } as unknown as CampusViewService);
    const request = { authUser: user } as AuthenticatedRequest;
    await controller.view(request, ids.school, ids.campus, "2026-10-16T03:45:00.000Z");
    expect(view).toHaveBeenCalledWith(user, ids.school, { campus_id: ids.campus, at: "2026-10-16T03:45:00.000Z" });
  });

  it("fails before reading topology when active admin membership is absent", async () => {
    const { service, repository, temporalContext } = dependencies({ authorized: false });
    await expect(service.view(user, ids.school, {})).rejects.toThrow("active institution administrator");
    expect(repository.school).not.toHaveBeenCalled();
    expect(temporalContext.resolveAt).not.toHaveBeenCalled();
  });

  it("rejects an invalid school or time before querying membership", async () => {
    const { service, repository } = dependencies();
    await expect(service.view(user, "not-a-school", {})).rejects.toThrow("valid campus and ISO date/time");
    await expect(service.view(user, ids.school, { at: "tomorrow" })).rejects.toThrow("valid campus and ISO date/time");
    expect(repository.hasActiveAdminMembership).not.toHaveBeenCalled();
  });

  it("never selects a campus outside the authorized institution result set", async () => {
    const { service, repository, temporalContext } = dependencies();
    await expect(service.view(user, ids.school, { campus_id: ids.otherCampus })).rejects.toThrow("Campus not found in this institution");
    expect(repository.campuses).toHaveBeenCalledWith(ids.school);
    expect(repository.spaces).not.toHaveBeenCalled();
    expect(temporalContext.resolveAt).not.toHaveBeenCalled();
  });
});

describe("Campus View projection", () => {
  it("keeps timetable, point observations, accepted evidence and unknown state distinct", async () => {
    const { service, repository, temporalContext } = dependencies();
    const result = await service.view(user, ids.school, { at: "2026-10-16T03:45:00.000Z" });

    expect(result).toMatchObject({
      schema_version: 1,
      school: { id: ids.school },
      selected_campus_id: ids.campus,
      plan: { source_kind: "generated_schematic", surveyed: false },
    });
    expect(repository.spaces).toHaveBeenCalledWith(ids.school, ids.campus);
    expect(temporalContext.resolveAt).toHaveBeenCalledTimes(3);
    expect(temporalContext.resolveAt).toHaveBeenCalledWith(expect.objectContaining({
      school_id: ids.school,
      at: "2026-10-16T03:45:00.000Z",
      recorded_as_of: expect.any(String),
    }));

    const floor = result.spaces.find((item) => item.id === ids.floor)!;
    const room = result.spaces.find((item) => item.id === ids.room)!;
    const gate = result.spaces.find((item) => item.id === ids.gate)!;
    expect(floor.state_dimension).toBe("unknown");
    expect(room).toMatchObject({ floor_id: ids.floor, floor_label: "First floor", state_dimension: "expected", expected_activity: "Mathematics" });
    expect(room.assertions.expected[0]).toMatchObject({
      dimension: "expected",
      source: { label: "Published timetable" },
      freshness: { status: "current_at_as_of" },
      spatial_claim: "expected_context_only",
      observed_at: null,
    });
    expect(room.assertions.observed).toEqual([]);
    expect(room.assertions.accepted).toEqual([]);
    expect(gate.state_dimension).toBe("unknown");
    expect(gate.assertions.observed).toHaveLength(1);
    expect(gate.assertions.accepted).toHaveLength(1);
    expect(gate.assertions.accepted[0]).toMatchObject({
      source: { label: "Gate observation", captured_by: "North gate reader" },
      freshness: { status: "point_in_time", age_seconds: 600, expires_at: null },
      spatial_claim: "point_observation_only",
    });
    expect(JSON.stringify(result)).not.toMatch(/live_location|known_location|continuous_presence/u);
  });

  it("labels cross-domain signals without turning gate or attendance evidence into room location", async () => {
    const { service } = dependencies();
    const result = await service.view(user, ids.school, { at: "2026-10-16T03:45:00.000Z" });
    expect(result.signals[0]?.evidence).toEqual({
      gate: { dimension: "accepted", spatial_claim: "campus_presence_only", source: "Gate observation" },
      timetable: { dimension: "expected", spatial_claim: "expected_context_only", source: "Published timetable" },
      attendance: { dimension: "unknown", spatial_claim: "none", source: null },
    });
    expect(result.signals[0]).toMatchObject({
      scope: { type: "institution", id: ids.school },
      freshness: { status: "bounded_cross_check", gate_age_seconds: 780, expires_at: "2026-10-16T04:15:00.000Z" },
    });
  });

  it("shows current timetable responsibility and accepted gate counts without claiming physical location", async () => {
    const { service, repository } = dependencies();
    repository.dayOccurrences.mockResolvedValue([{
      id: "occurrence-revision-1",
      occurrence_id: "occurrence-1",
      space_id: ids.room,
      title: "Mathematics",
      slot_type: "class",
      class_label: "Class 6A",
      subject_label: "Mathematics",
      responsible_agent_id: "teacher-agent-1",
      teacher_label: "Kavita Mehta",
      expected_count: 25,
      starts_at: "2026-10-16T03:30:00.000Z",
      ends_at: "2026-10-16T04:15:00.000Z",
      source_domain: "timetable",
      source_record_id: "schedule-1",
      source_revision: 4,
    }]);
    repository.gateActivityToday.mockResolvedValue([{
      gate_label: "North gate",
      space_id: ids.gate,
      entry_count: 18,
      exit_count: 2,
      accepted_count: 20,
      latest_observed_at: "2026-10-16T03:40:00.000Z",
    }]);
    repository.activeVisitorCount.mockResolvedValue(3);

    const result = await service.view(user, ids.school, { at: "2026-10-16T03:45:00.000Z" });
    const room = result.spaces.find((item) => item.id === ids.room)!;
    const gate = result.spaces.find((item) => item.id === ids.gate)!;

    expect(room.expected_now[0]).toMatchObject({
      title: "Mathematics",
      teacher: { label: "Kavita Mehta" },
      expected_count: 25,
      state: "in_progress",
      dimension: "expected",
      spatial_claim: "expected_context_only",
    });
    expect(gate.gate_activity_today).toMatchObject({
      entries: 18,
      exits: 2,
      accepted_points: 20,
      dimension: "accepted",
      spatial_claim: "point_observation_only",
    });
    expect(gate.state_dimension).toBe("unknown");
    expect(result.operations).toMatchObject({
      current_expected_sessions: 1,
      expected_teachers: 1,
      gate_movements: { entries: 18, exits: 2, accepted_points: 20 },
      visitors_inside: { count: 3 },
    });
    expect(result.day_activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Mathematics", state_dimension: "expected", spatial_claim: "expected_context_only" }),
      expect.objectContaining({ title: "North gate", state_dimension: "accepted", spatial_claim: "point_observation_only" }),
    ]));
    expect(JSON.stringify(result)).not.toMatch(/teacher_present|current_teacher_location|currently_inside/u);
  });

  it("projects an accepted examination plan as expected room use with an exact domain link", async () => {
    const { service, repository } = dependencies();
    repository.examSpaceExpectations.mockResolvedValue([{
      id: "exam-expectation-1",
      space_id: ids.room,
      assessment_id: "00000000-0000-4000-8000-000000000011",
      sitting_id: "00000000-0000-4000-8000-000000000012",
      title: "English mid-term examination",
      class_label: "Class 7A",
      subject_label: "English",
      expected_count: 27,
      effective_from: "2026-10-16T03:30:00.000Z",
      effective_until: "2026-10-16T05:00:00.000Z",
      source_revision: 2,
      recorded_at: "2026-10-15T09:00:00.000Z",
    }]);
    const result = await service.view(user, ids.school, { at: "2026-10-16T03:45:00.000Z" });
    const exam = result.spaces.find((item) => item.id === ids.room)!.assertions.expected
      .find((item) => item.source.domain === "assessments");
    expect(exam).toMatchObject({
      context: { title: "English mid-term examination", class_label: "Class 7A", expected_count: 27 },
      source: { label: "Scheduled examination", record_id: "00000000-0000-4000-8000-000000000011" },
      target_path: "/principal/assessments?assessment=00000000-0000-4000-8000-000000000011",
      spatial_claim: "expected_context_only",
    });
  });

  it("returns an honest empty projection when no active campus exists", async () => {
    const { service, repository, temporalContext } = dependencies();
    repository.campuses.mockResolvedValue([]);
    const result = await service.view(user, ids.school, {});
    expect(result).toMatchObject({ selected_campus_id: null, plan: null, spaces: [], activity: [], signals: [] });
    expect(temporalContext.resolveAt).not.toHaveBeenCalled();
  });

  it("generates deterministic, floor-aware rectangles from real space identities", () => {
    const first = generatedSchematic(campus, spaces);
    const second = generatedSchematic(campus, [...spaces].reverse());
    expect(second.version).toBe(first.version);
    expect(first.elements).toHaveLength(2);
    expect(first.elements.map((element) => element.space_id).sort()).toEqual([ids.gate, ids.room].sort());
    expect(first.elements.every((element) => element.floor_id === ids.floor)).toBe(true);
    expect(first.elements.every((element) => element.kind === "space" && element.width > 0 && element.height > 0)).toBe(true);
    expect(first.explanation).toMatch(/schematic, not a surveyed floor plan/i);

    const changed = generatedSchematic(campus, spaces.map((space) => space.id === ids.room ? { ...space, revision: space.revision + 1 } : space));
    expect(changed.version).not.toBe(first.version);
  });

  it("uses bounded configured schematic placement without presenting it as a surveyed map", () => {
    const configured = generatedSchematic(campus, spaces.map((space) => space.id === ids.room ? {
      ...space,
      attributes: { schematic: { x: 810, y: 425, width: 180, height: 105 } },
    } : space.id === ids.gate ? {
      ...space,
      attributes: { schematic: { x: 350, y: 560, width: 105, height: 42 }, aliases: ["North Gate"] },
    } : space));

    expect(configured).toMatchObject({
      source_kind: "generated_schematic",
      placement_kind: "configured_schematic",
      surveyed: false,
      view_box: { x: 0, y: 0, width: 1022, height: 634 },
    });
    expect(configured.elements.find((item) => item.space_id === ids.room)).toMatchObject({ x: 810, y: 425, width: 180, height: 105 });
    expect(configured.explanation).toMatch(/placement hints.*not a surveyed floor plan/i);
  });
});
