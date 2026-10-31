import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionEnvironmentView } from "../src/auth/session-execution-environment.js";
import type { AuthUser } from "../src/common/request.js";
import type { WorkspaceRepositorySnapshot } from "../src/workspace/workspace.contracts.js";
import { ResponsibilityClassWorkspaceService } from "../src/attendance/responsibility-class-workspace.service.js";

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000002",
  agent: "00000000-0000-4000-8000-000000000003",
  assignment: "00000000-0000-4000-8000-000000000004",
  classA: "00000000-0000-4000-8000-000000000005",
  classB: "00000000-0000-4000-8000-000000000006",
};

const user: AuthUser = {
  id: ids.user,
  username: "operator",
  email: "operator@example.test",
  first_name: "Campus",
  last_name: "Operator",
  role: "admin",
  is_active: true,
  active_school_id: ids.school,
};

const instant = new Date("2026-10-19T04:00:00.000Z");
const snapshot: WorkspaceRepositorySnapshot = {
  institution: { id: ids.school, name: "Cambridge International School", timezone: "Asia/Kolkata" },
  membership_roles: ["admin"],
  realm_id: "00000000-0000-4000-8000-000000000010",
  environment_namespace_id: `live:${ids.school}`,
  acting_agent_id: ids.agent,
  owner_agent_ids: [ids.agent],
  messages: [],
  relationships: [],
  assignments: [{
    id: ids.assignment,
    owner_agent_id: ids.agent,
    capability_key: "attendance",
    action_key: "attendance.view",
    scope: { kind: "class", id: ids.classA, label: "Class 6A" },
    effective_from: "2026-10-01T00:00:00.000Z",
    effective_until: null,
    effective_schedule: null,
    authority_source_kind: "appointment",
    authority_source_ref: "class:6a",
    fallback_agent_id: null,
    source_domain: "academic_structure",
    source_record_id: "class:6a",
    source_revision: 1,
    revision: 1,
    projection_source: "canonical",
  }],
};

function harness(
  current: WorkspaceRepositorySnapshot = snapshot,
  reading = {
    institution_id: ids.school,
    namespace_id: `live:${ids.school}`,
    local_date: "2026-10-19",
    iso_instant: instant.toISOString(),
  },
) {
  const repository = { load: vi.fn().mockResolvedValue(current) };
  const school = {
    assignedClassesScreen: vi.fn().mockResolvedValue({ date: "2026-10-19", classes: [{ class_section_id: ids.classA }] }),
    assignedClassUpdates: vi.fn().mockResolvedValue({ results: [] }),
    teacherAttendanceScreen: vi.fn().mockResolvedValue({ class: { id: ids.classA }, roster: [] }),
  };
  const clock = {
    now: vi.fn().mockReturnValue(instant),
    read: vi.fn().mockReturnValue(reading),
  };
  return {
    instance: new ResponsibilityClassWorkspaceService(repository as never, school as never, clock as never),
    repository,
    school,
  };
}

const live: ExecutionEnvironmentView = {
  mode: "live",
  institution_id: ids.school,
  namespace_id: `live:${ids.school}`,
};

describe("responsibility class workspace", () => {
  it("derives the directory only from effective class-scoped responsibility", async () => {
    const test = harness();
    const result = await test.instance.classes(user, null, live);

    expect(test.school.assignedClassesScreen).toHaveBeenCalledWith(user, [ids.classA], "2026-10-19", []);
    expect(result).toMatchObject({
      date: "2026-10-19",
      context: { institution_id: ids.school, environment: { kind: "live", namespace_id: `live:${ids.school}` } },
    });
  });

  it("does not let administrator membership replace an assigned class responsibility", async () => {
    const test = harness({ ...snapshot, assignments: [] });

    await expect(test.instance.classes(user, null, live)).rejects.toThrow(/No assigned class responsibility/);
    expect(test.school.assignedClassesScreen).not.toHaveBeenCalled();
  });

  it("rejects a direct roster outside the composed class scope", async () => {
    const test = harness();

    await expect(test.instance.classDetail(user, null, live, ids.classB, "2026-10-19"))
      .rejects.toThrow(/not within your current responsibility/);
    expect(test.school.teacherAttendanceScreen).not.toHaveBeenCalled();
  });

  it("keeps a view-only class register read-only despite broad membership", async () => {
    const test = harness();

    const result = await test.instance.classDetail(user, null, live, ids.classA, "2026-10-19");

    expect(result).toMatchObject({
      availability: {
        can_mark: false,
        reason: expect.stringMatching(/allows viewing.*not recording/i),
      },
    });
  });

  it("uses the same scoped classes for recent work and verifies the environment namespace", async () => {
    const test = harness();
    await test.instance.updates(user, null, live, "2026-10-18");
    expect(test.school.assignedClassUpdates).toHaveBeenCalledWith(user, [ids.classA], "2026-10-18");

    const mismatch = harness({ ...snapshot, environment_namespace_id: "scenario:other" });
    await expect(mismatch.instance.classes(user, null, live)).rejects.toThrow(/active execution environment/);
  });

  it("binds the same responsibility surface to a Simulation namespace and virtual date", async () => {
    const namespace = "scenario:forecast:run:october" as const;
    const simulation: ExecutionEnvironmentView = {
      mode: "simulation",
      institution_id: ids.school,
      scenario_id: "forecast",
      run_id: "october",
      namespace_id: namespace,
      virtual_clock: { now: "2026-11-03T04:00:00.000Z", time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-19T04:00:00.000Z",
      expires_at: "2026-11-04T04:00:00.000Z",
    };
    const test = harness(
      { ...snapshot, environment_namespace_id: namespace },
      {
        institution_id: ids.school,
        namespace_id: namespace,
        local_date: "2026-11-03",
        iso_instant: simulation.virtual_clock.now,
      },
    );
    const executionEnvironment = { kind: "simulation" } as never;

    const result = await test.instance.classes(user, executionEnvironment, simulation);

    expect(test.repository.load).toHaveBeenCalledWith(expect.objectContaining({
      execution_environment: executionEnvironment,
    }));
    expect(test.school.assignedClassesScreen).toHaveBeenCalledWith(user, [ids.classA], "2026-11-03", []);
    expect(result.context).toMatchObject({
      environment: { kind: "simulation", namespace_id: namespace },
      as_of: simulation.virtual_clock.now,
    });
  });
});
