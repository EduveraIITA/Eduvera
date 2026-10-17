import { ForbiddenException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import { countConflictingIntervals } from "../src/campus-scenarios/campus-operations-scenario.executor.js";
import {
  buildScenarioIdentityMappings,
  isFutureScenarioWindow,
  scenarioDateWindows,
  type CampusScenarioRepository,
} from "../src/campus-scenarios/campus-scenario.repository.js";
import { CampusScenarioService } from "../src/campus-scenarios/campus-scenario.service.js";
import type { CampusScenarioRepositorySnapshot } from "../src/campus-scenarios/scenario-contracts.js";

const SCHOOL_ID = "00000000-0000-4000-8000-000000000001";
const CAMPUS_ID = "00000000-0000-4000-8000-000000000002";
const AGENT_ID = "00000000-0000-4000-8000-000000000003";
const PERSON_ID = "00000000-0000-4000-8000-000000000004";
const SPACE_ID = "00000000-0000-4000-8000-000000000005";
const CLASS_ID = "00000000-0000-4000-8000-000000000006";
const POLICY_VERSION_ID = "00000000-0000-4000-8000-000000000008";

const user: AuthUser = {
  id: "00000000-0000-4000-8000-000000000007",
  username: "admin",
  email: "admin@example.test",
  first_name: "Admin",
  last_name: "User",
  role: "admin",
  is_active: true,
  active_school_id: SCHOOL_ID,
};

interface FakeScenarioOptions {
  teacher_agent_id?: string | null;
  space_capacity?: number | null;
}

class FakeScenarioRepository {
  constructor(
    private readonly sessionStart: string,
    private readonly sessionEnd: string,
    private readonly authorized = true,
    private readonly options: FakeScenarioOptions = {},
  ) {}

  hasActiveAdminMembership() { return Promise.resolve(this.authorized); }
  school() { return Promise.resolve({ id: SCHOOL_ID, name: "Test School", timezone: "Asia/Kolkata" }); }
  campuses() {
    return Promise.resolve([{ id: CAMPUS_ID, name: "Main", code: "MAIN", timezone: "Asia/Kolkata", is_primary: true, revision: 2 }]);
  }
  resolveTarget(_school: string, _campus: string, type: "teacher_unavailable" | "space_unavailable") {
    return Promise.resolve(type === "teacher_unavailable" ? {
      id: AGENT_ID, label: "Test teacher", type, effective_ref: user.id,
      user_id: user.id, person_id: PERSON_ID, revision: 3,
    } : {
      id: SPACE_ID, label: "Room 1", type, effective_ref: SPACE_ID,
      user_id: null, person_id: null, revision: 4,
    });
  }
  approvedScenarioPolicy() {
    const now = Date.now();
    return {
      id: POLICY_VERSION_ID,
      behaviour_key: "scenario_coverage_response_cohort",
      version: 1,
      configuration: {
        scenario_policy: {
          calibration: {
            method: "historical_coverage_reviewed",
            calibrated_at: new Date(now - 60 * 60 * 1_000).toISOString(),
            sample_size: 20,
            window: {
              from: new Date(now - 30 * 24 * 60 * 60 * 1_000).toISOString(),
              to: new Date(now - 60 * 60 * 1_000).toISOString(),
            },
          },
          parameters: {
            acceptance_probability: 1,
            relocation_probability: 1,
            response_minutes_mean: 10,
            response_minutes_standard_deviation: 0,
          },
          sample_count: 20,
        },
      },
      effective_from: new Date(now - 24 * 60 * 60 * 1_000).toISOString(),
      effective_until: null,
      approved_at: new Date(now - 24 * 60 * 60 * 1_000).toISOString(),
      configuration_schema_version: 1,
      configuration_hash: "a".repeat(64),
    };
  }
  snapshot(input: {
    captured_at: string;
    horizon_to: string;
    scenario_id: string;
    behaviour_policy_version_id: string | null;
  }): Promise<CampusScenarioRepositorySnapshot> {
    const teacherAgentId = this.options.teacher_agent_id === undefined
      ? AGENT_ID
      : this.options.teacher_agent_id;
    const spaceCapacity = this.options.space_capacity === undefined
      ? 30
      : this.options.space_capacity;
    return Promise.resolve({
      snapshot: {
        kind: "campus_operations_snapshot",
        version: 1,
        school_id: SCHOOL_ID,
        campus_id: CAMPUS_ID,
        timezone: "Asia/Kolkata",
        captured_at: input.captured_at,
        horizon: { from: input.captured_at, to: input.horizon_to },
        sessions: [{
          occurrence_key: "session-1",
          occurrence_date: this.sessionStart.slice(0, 10),
          starts_at: this.sessionStart,
          ends_at: this.sessionEnd,
          class_section_id: CLASS_ID,
          teacher_agent_id: teacherAgentId,
          teacher_person_id: teacherAgentId ? PERSON_ID : null,
          teacher_assignment_present: true,
          space_id: SPACE_ID,
          space_capacity: spaceCapacity,
          expected_count: 25,
          source_kind: "published_timetable",
          source_revision: 7,
          source_version: 2,
        }],
        coverage_evidence: {
          offered_count: 20, responded_count: 16, accepted_count: 12,
          median_response_minutes: 8, source_max_at: input.captured_at,
          evidence_hash: "b".repeat(64),
        },
      },
      target: {
        id: AGENT_ID, label: "Test teacher", type: "teacher_unavailable",
        effective_ref: user.id, user_id: user.id, person_id: PERSON_ID, revision: 3,
      },
      configuration_snapshot: [],
      identities: teacherAgentId ? [{
        source: { kind: "human", human_agent_id: AGENT_ID, person_id: PERSON_ID },
        delegates: [],
        counterpart: {
          kind: "scenario_counterpart",
          scenario_counterpart_id: `${input.scenario_id}:agent:${AGENT_ID}`,
          scenario_id: input.scenario_id,
          source_agent_id: AGENT_ID,
          source_agent_kind: "human",
          behaviour_policy_version_id: input.behaviour_policy_version_id,
        },
      }] : [],
      source_revisions: {
        schedule: "max:7", spaces: "max:4", agents: "max:3",
        enrolments: "max:2", coverage_evidence: "b".repeat(64),
        behaviour_policy: input.behaviour_policy_version_id ? "a".repeat(64) : "none",
      },
      approved_behaviour_policy: input.behaviour_policy_version_id
        ? this.approvedScenarioPolicy()
        : null,
      counts: {
        sessions: 1,
        spaces: 1,
        teachers: 1,
        agents: 1,
        agent_kinds: { human: 1, team: 0, device: 0, integration: 0, software: 0 },
        enrolments: 25,
      },
    });
  }
}

function fixture(authorized = true, options: FakeScenarioOptions = {}) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const end = new Date(start.getTime() + 45 * 60 * 1_000);
  const repository = new FakeScenarioRepository(start.toISOString(), end.toISOString(), authorized, options);
  const service = new CampusScenarioService(repository as unknown as CampusScenarioRepository);
  return { service, start: start.toISOString(), end: end.toISOString() };
}

describe("Campus scenario API service", () => {
  it("captures every active Model Core agent kind as an isolated counterpart", () => {
    const mappings = buildScenarioIdentityMappings({
      scenario_id: "scenario-1",
      behaviour_policy_version_id: POLICY_VERSION_ID,
      agents: [
        { id: "human-1", agent_kind: "human", person_id: "person-1", external_ref: null, revision: 1 },
        { id: "team-1", agent_kind: "team", person_id: null, external_ref: "team:office", revision: 2 },
        { id: "device-1", agent_kind: "device", person_id: null, external_ref: "device:gate-a", revision: 3 },
        { id: "integration-1", agent_kind: "integration", person_id: null, external_ref: "integration:calendar", revision: 4 },
        { id: "software-1", agent_kind: "software", person_id: null, external_ref: "software:coverage", revision: 5 },
      ],
    });

    expect(mappings).toHaveLength(5);
    expect(mappings.map((mapping) => "source" in mapping ? mapping.source.kind : "legacy"))
      .toEqual(["human", "team", "device", "integration", "software"]);
    const human = mappings[0];
    const device = mappings[2];
    expect(human && "counterpart" in human
      ? human.counterpart.behaviour_policy_version_id
      : null).toBe(POLICY_VERSION_ID);
    expect(device && "counterpart" in device
      ? device.counterpart.behaviour_policy_version_id
      : "unexpected").toBeNull();
  });

  it("fails closed on malformed or duplicate source-agent identity records", () => {
    const capture = (agents: Parameters<typeof buildScenarioIdentityMappings>[0]["agents"]) => (
      buildScenarioIdentityMappings({
        scenario_id: "scenario-1",
        behaviour_policy_version_id: null,
        agents,
      })
    );

    expect(() => capture([
      { id: "human-1", agent_kind: "human", person_id: null, external_ref: null, revision: 1 },
    ])).toThrow("person ID is missing");
    expect(() => capture([
      { id: "device-1", agent_kind: "device", person_id: null, external_ref: " ", revision: 1 },
    ])).toThrow("external reference is missing");
    expect(() => capture([
      { id: "team-1", agent_kind: "team", person_id: "person-1", external_ref: "team:office", revision: 1 },
    ])).toThrow("has a person identity");
    expect(() => capture([
      { id: "same", agent_kind: "human", person_id: "person-1", external_ref: null, revision: 1 },
      { id: "same", agent_kind: "software", person_id: null, external_ref: "software:1", revision: 1 },
    ])).toThrow("duplicate source agent");
    expect(() => capture([
      { id: "unknown-1", agent_kind: "robot", person_id: null, external_ref: "robot:1", revision: 1 },
    ])).toThrow("unsupported agent kind");
  });

  it("keeps catalogue identities endpoint-effective and uses the class home space only as fallback", () => {
    const source = readFileSync(
      new URL("../src/campus-scenarios/campus-scenario.repository.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("endpoint.user_id=schedule.teacher_user_id");
    expect(source).toContain("endpoint.status='active'");
    expect(source).toContain("endpoint.effective_from<=((day.school_day+schedule.starts_at)");
    expect(source).toContain("endpoint.effective_until>((day.school_day+schedule.starts_at)");
    expect(source).not.toContain("agent.user_id=schedule.teacher_user_id");
    expect(source).toContain("COALESCE(schedule.space_id,placement.home_space_id) AS space_id");
    expect(source).toContain("selected_space.id=COALESCE(schedule.space_id,placement.home_space_id)");
  });

  it("does not recommend an in-progress or same-day session as a future scenario window", () => {
    const capturedAt = "2026-10-17T05:00:00.000Z";
    expect(isFutureScenarioWindow({
      occurrence_date: "2026-10-17",
      starts_at: "2026-10-17T04:00:00.000Z",
      ends_at: "2026-10-17T04:45:00.000Z",
    }, capturedAt, "2026-10-24T05:00:00.000Z", "Asia/Kolkata")).toBe(false);
    expect(isFutureScenarioWindow({
      occurrence_date: "2026-10-17",
      starts_at: "2026-10-17T06:00:00.000Z",
      ends_at: "2026-10-17T06:45:00.000Z",
    }, capturedAt, "2026-10-24T05:00:00.000Z", "Asia/Kolkata")).toBe(false);
    expect(isFutureScenarioWindow({
      occurrence_date: "2026-10-18",
      starts_at: "2026-10-18T03:30:00.000Z",
      ends_at: "2026-10-18T04:15:00.000Z",
    }, capturedAt, "2026-10-24T05:00:00.000Z", "Asia/Kolkata")).toBe(true);
    expect(isFutureScenarioWindow({
      occurrence_date: "2026-10-24",
      starts_at: "2026-10-24T04:30:00.000Z",
      ends_at: "2026-10-24T05:15:00.000Z",
    }, capturedAt, "2026-10-24T05:00:00.000Z", "Asia/Kolkata")).toBe(false);
  });

  it("groups a target's scheduled use into a complete per-date intervention window", () => {
    expect(scenarioDateWindows([
      { date: "2026-10-19", starts_at: "2026-10-19T03:30:00.000Z", ends_at: "2026-10-19T04:15:00.000Z" },
      { date: "2026-10-19", starts_at: "2026-10-19T07:00:00.000Z", ends_at: "2026-10-19T07:45:00.000Z" },
      { date: "2026-10-20", starts_at: "2026-10-20T04:20:00.000Z", ends_at: "2026-10-20T05:05:00.000Z" },
    ])).toEqual([
      { date: "2026-10-19", starts_at: "2026-10-19T03:30:00.000Z", ends_at: "2026-10-19T07:45:00.000Z" },
      { date: "2026-10-20", starts_at: "2026-10-20T04:20:00.000Z", ends_at: "2026-10-20T05:05:00.000Z" },
    ]);
  });

  it("counts nested and large conflict groups with an interval sweep", () => {
    const base = Date.parse("2026-10-19T03:30:00.000Z");
    const intervals = Array.from({ length: 20_000 }, (_, index) => ({
      key: `session-${index}`,
      starts_at: new Date(base + index).toISOString(),
      ends_at: new Date(base + 60 * 60 * 1_000).toISOString(),
      resource_ref: "teacher-1",
    }));
    expect(countConflictingIntervals(intervals)).toBe(20_000);
    expect(countConflictingIntervals([
      {
        key: "outer",
        starts_at: "2026-10-19T03:30:00.000Z",
        ends_at: "2026-10-19T06:30:00.000Z",
        resource_ref: "room-1",
      },
      {
        key: "inner",
        starts_at: "2026-10-19T04:30:00.000Z",
        ends_at: "2026-10-19T05:00:00.000Z",
        resource_ref: "room-1",
      },
      {
        key: "nested-tail",
        starts_at: "2026-10-19T05:30:00.000Z",
        ends_at: "2026-10-19T06:00:00.000Z",
        resource_ref: "room-1",
      },
    ])).toBe(3);
  });

  it("creates, retrieves and discards an isolated deterministic scenario", async () => {
    const { service, start, end } = fixture();
    const response = await service.create(user, SCHOOL_ID, {
      campus_id: CAMPUS_ID,
      horizon_days: 7,
      intervention: { type: "teacher_unavailable", target_id: AGENT_ID, starts_at: start, ends_at: end },
    });

    expect(response.evidence_mode).toBe("simulation");
    expect(response.run.side_effect_policy).toEqual({
      mode: "sink_only", production_writes: false, production_messages: false, production_connectors: false,
    });
    expect(response.run.execution_environment).toMatchObject({
      mode: "simulation",
      run_id: response.run.id,
      virtual_clock: { time_zone: "Asia/Kolkata" },
      source_snapshot_at: response.run.snapshot_at,
      expires_at: response.run.expires_at,
    });
    expect(response.run.execution_environment.namespace_id).toMatch(/^scenario:/);
    expect(response.run.projection_capabilities.application_parity).toBe(false);
    expect(response.run.projection_capabilities).toEqual({
      application_parity: false,
      supported: ["campus_performance"],
      unsupported: ["today", "timetable", "attendance", "requests", "notifications", "campus_view"],
    });
    expect(response.run.metrics.find((metric) => metric.key === "affected_sessions")?.scenario.p50).toBe(1);
    expect(response.run.metrics.find((metric) => metric.key === "uncovered_sessions")?.scenario.p50).toBe(1);
    expect(response.run.metrics.find((metric) => metric.key === "modelled_positive_response_rate_percent")?.availability).toBe("unavailable");
    expect(response.run.source_snapshot.counts.sessions).toBe(1);
    expect(response.run.source_snapshot.consistency).toBe("repeatable_read_transaction");
    expect(response.run.uncertainty_status).toBe("deterministic");
    expect(response.run.metrics.find((metric) => metric.key === "modelled_response_acceptances")?.scenario.p50).toBeNull();

    expect((await service.get(user, SCHOOL_ID, response.run.id)).run.id).toBe(response.run.id);
    await expect(service.resolveAuthorizedRun({
      actor_id: user.id,
      institution_id: SCHOOL_ID,
      run_id: response.run.id,
    })).resolves.toMatchObject({
      institution_id: SCHOOL_ID,
      run_id: response.run.id,
      namespace_id: response.run.execution_environment.namespace_id,
      time_zone: "Asia/Kolkata",
    });
    expect(await service.discard(user, SCHOOL_ID, response.run.id)).toMatchObject({ discarded: true });
    await expect(service.resolveAuthorizedRun({
      actor_id: user.id,
      institution_id: SCHOOL_ID,
      run_id: response.run.id,
    })).resolves.toBeNull();
    await expect(service.get(user, SCHOOL_ID, response.run.id)).rejects.toThrow("not found or expired");
  });

  it("uses an explicit cohort policy for ranges without inventing a teacher assignment", async () => {
    const { service, start, end } = fixture();
    const response = await service.create(user, SCHOOL_ID, {
      horizon_days: 7,
      intervention: { type: "teacher_unavailable", target_id: AGENT_ID, starts_at: start, ends_at: end },
      behaviour_policy_version_id: POLICY_VERSION_ID,
    });

    const responses = response.run.metrics.find((metric) => metric.key === "modelled_response_acceptances");
    expect(responses?.scenario).toEqual({ p10: 1, p50: 1, p90: 1 });
    expect(response.run.metrics.find((metric) => metric.key === "uncovered_sessions")?.scenario.p50).toBe(1);
    expect(response.run.metrics.find((metric) => metric.key === "unresolved_intervention_sessions")?.scenario.p50).toBe(1);
    expect(response.run.unsupported_domains).toContain("resource_allocation");
    expect(response.run.uncertainty_status).toBe("calibrated_ensemble");
  });

  it("requires an active institution administrator", async () => {
    const { service, start, end } = fixture(false);
    await expect(service.create(user, SCHOOL_ID, {
      horizon_days: 7,
      intervention: { type: "teacher_unavailable", target_id: AGENT_ID, starts_at: start, ends_at: end },
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolveAuthorizedRun({
      actor_id: user.id,
      institution_id: SCHOOL_ID,
      run_id: "00000000-0000-4000-8000-000000000009",
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps missing identity and capacity evidence explicit instead of reporting certain zeroes", async () => {
    const { service, start, end } = fixture(true, {
      teacher_agent_id: null,
      space_capacity: null,
    });
    const response = await service.create(user, SCHOOL_ID, {
      horizon_days: 7,
      intervention: {
        type: "space_unavailable",
        target_id: SPACE_ID,
        starts_at: start,
        ends_at: end,
      },
    });
    expect(response.run.metrics.find((metric) => metric.key === "teacher_identity_unknown_sessions")?.scenario.p50).toBe(1);
    expect(response.run.metrics.find((metric) => metric.key === "uncovered_sessions")?.scenario.p50).toBe(0);
    expect(response.run.metrics.find((metric) => metric.key === "uncovered_sessions")?.availability).toBe("partial");
    expect(response.run.metrics.find((metric) => metric.key === "teacher_conflict_sessions")?.availability).toBe("partial");
    expect(response.run.metrics.find((metric) => metric.key === "over_capacity_sessions")?.availability).toBe("partial");
  });

  it("evicts the oldest completed transient run instead of locking an institution", async () => {
    const { service, start, end } = fixture();
    const runIds: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await service.create(user, SCHOOL_ID, {
        horizon_days: 7,
        intervention: {
          type: "teacher_unavailable",
          target_id: AGENT_ID,
          starts_at: start,
          ends_at: end,
        },
      });
      runIds.push(response.run.id);
    }
    await expect(service.get(user, SCHOOL_ID, runIds[0]!)).rejects.toThrow("not found or expired");
    await expect(service.get(user, SCHOOL_ID, runIds[10]!)).resolves.toMatchObject({
      run: { id: runIds[10] },
    });
  });
});
