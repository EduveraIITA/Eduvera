import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { ResponsibilityAssignmentProjection, WorkspaceRepositorySnapshot } from "../src/workspace/workspace.contracts.js";
import { ResponsibilityAttendanceWorkspaceService } from "../src/attendance/responsibility-attendance-workspace.service.js";

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000002",
  agent: "00000000-0000-4000-8000-000000000003",
  classA: "00000000-0000-4000-8000-000000000004",
  classB: "00000000-0000-4000-8000-000000000005",
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

function assignment(action: string, scope: ResponsibilityAssignmentProjection["scope"], index: number): ResponsibilityAssignmentProjection {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    owner_agent_id: ids.agent,
    capability_key: action.split(".")[0]!,
    action_key: action,
    scope,
    effective_from: "2026-10-01T00:00:00.000Z",
    effective_until: null,
    effective_schedule: null,
    authority_source_kind: "permission_assignment",
    authority_source_ref: `assignment:${index}`,
    fallback_agent_id: null,
    source_domain: "access_assignments",
    source_record_id: `assignment:${index}:${action}`,
    source_revision: 1,
    revision: 1,
    projection_source: "canonical",
  };
}

function snapshot(assignments: ResponsibilityAssignmentProjection[], namespace = `live:${ids.school}`): WorkspaceRepositorySnapshot {
  return {
    institution: { id: ids.school, name: "Cambridge International School", timezone: "Asia/Kolkata" },
    membership_roles: ["admin"],
    realm_id: "00000000-0000-4000-8000-000000000099",
    environment_namespace_id: namespace,
    acting_agent_id: ids.agent,
    owner_agent_ids: [ids.agent],
    assignments,
    messages: [],
    relationships: [],
  };
}

function harness(
  assignments: ResponsibilityAssignmentProjection[],
  namespace?: string,
  clockNamespace = `live:${ids.school}`,
) {
  const workspaceRepository = { load: vi.fn().mockResolvedValue(snapshot(assignments, namespace)) };
  const attendanceRepository = {
    dailyRegisters: vi.fn().mockResolvedValue([{ class_section_id: ids.classA }]),
    thresholds: vi.fn().mockResolvedValue([{
      id: "student-1", class_section_id: ids.classA, name: "Aarav Sharma",
      admission_number: "CIS-001", class_name: "Class 6A", recorded_days: 12,
      percentage: 72.5, threshold: 75,
    }]),
    continuity: vi.fn().mockResolvedValue({
      date: "2026-10-19",
      summary: { pending: 0, quarantined: 1, accepted: 0, rejected: 0 },
      cases: [{ id: "case-1" }],
    }),
  };
  const attendanceModel = { responsibilityWorkspace: vi.fn().mockResolvedValue({
    mode: "daily_class",
    campus_mode: "none",
    capture_channels: ["staff_roll_call"],
    registers: [],
  }) };
  const instant = new Date("2026-10-19T04:00:00.000Z");
  const clock = {
    now: vi.fn().mockReturnValue(instant),
    read: vi.fn().mockReturnValue({
      environment_kind: "live",
      namespace_id: clockNamespace,
      institution_id: ids.school,
      instant,
      iso_instant: instant.toISOString(),
      time_zone: "Asia/Kolkata",
      local_date: "2026-10-19",
      local_time: "09:30:00",
    }),
  };
  return {
    service: new ResponsibilityAttendanceWorkspaceService(
      workspaceRepository as never,
      attendanceRepository as never,
      attendanceModel as never,
      clock as never,
    ),
    workspaceRepository,
    attendanceRepository,
    attendanceModel,
  };
}

const liveView = {
  mode: "live" as const,
  institution_id: ids.school,
  namespace_id: `live:${ids.school}` as const,
};

describe("responsibility-native Attendance workspace", () => {
  it("does not turn administrator membership into operational attendance authority", async () => {
    const test = harness([]);

    await expect(test.service.workspace(user, null, liveView, {
      surface: "registers", date: "2026-10-19", case_id: undefined,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(test.attendanceModel.responsibilityWorkspace).not.toHaveBeenCalled();
    expect(test.attendanceRepository.dailyRegisters).not.toHaveBeenCalled();
  });

  it("keeps view and record class scopes separate without a persona or role bypass", async () => {
    const test = harness([
      assignment("attendance.record", { kind: "class", id: ids.classA, label: "Class 6A" }, 1),
      assignment("attendance.view", { kind: "class", id: ids.classB, label: "Class 6B" }, 2),
    ]);

    const result = await test.service.workspace(user, null, liveView, {
      surface: "registers", date: "2026-10-19", case_id: undefined,
    });

    expect(test.attendanceModel.responsibilityWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      school_id: ids.school,
      date: "2026-10-19",
      view_all: false,
      record_all: false,
      view_class_ids: expect.arrayContaining([ids.classA, ids.classB]),
      record_class_ids: [ids.classA],
    }));
    expect(test.attendanceRepository.dailyRegisters).toHaveBeenCalledWith(expect.objectContaining({
      access: expect.objectContaining({
        view_class_ids: expect.arrayContaining([ids.classA, ids.classB]),
        record_class_ids: [ids.classA],
      }),
    }));
    expect(result).toMatchObject({
      surface: "registers",
      registers: [{ class_section_id: ids.classA }],
      continuity: null,
      authority: { capabilities: ["attendance.record", "attendance.view"] },
      context: { institution_id: ids.school, environment: { kind: "live", namespace_id: `live:${ids.school}` } },
    });
  });

  it("scopes coordination cases independently from register visibility", async () => {
    const test = harness([
      assignment("followups.manage", { kind: "class", id: ids.classA, label: "Class 6A" }, 1),
      assignment("attendance.view", { kind: "institution", id: ids.school, label: "Cambridge" }, 2),
    ]);

    const result = await test.service.workspace(user, null, liveView, {
      surface: "coordination", date: "2026-10-19", case_id: undefined,
    });

    expect(test.attendanceRepository.continuity).toHaveBeenCalledWith(expect.objectContaining({
      access: { coordinate_all: false, coordinate_class_ids: [ids.classA] },
    }));
    expect(test.attendanceModel.responsibilityWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      view_all: true,
      record_all: false,
    }));
    expect(result.continuity).toMatchObject({ summary: { quarantined: 1 } });
    expect(result.authority.capabilities).toEqual(["followups.manage"]);
  });

  it("projects attendance thresholds only inside the exact view scope", async () => {
    const test = harness([
      assignment("attendance.view", { kind: "class", id: ids.classA, label: "Class 6A" }, 1),
    ]);

    const result = await test.service.workspace(user, null, liveView, {
      surface: "thresholds", date: "2026-10-19", case_id: undefined,
    });

    expect(test.attendanceRepository.thresholds).toHaveBeenCalledWith({
      school_id: ids.school,
      date: "2026-10-19",
      access: {
        view_all: false,
        record_all: false,
        view_class_ids: [ids.classA],
        record_class_ids: [],
      },
    });
    expect(result.thresholds).toEqual([expect.objectContaining({ name: "Aarav Sharma", class_section_id: ids.classA })]);
    expect(result.authority).toMatchObject({ capabilities: ["attendance.view"] });
    expect(result.continuity).toBeNull();
  });

  it("fails closed when the loaded projection namespace differs from the session environment", async () => {
    const test = harness([
      assignment("attendance.view", { kind: "class", id: ids.classA, label: "Class 6A" }, 1),
    ], "scenario:other:run:other");

    await expect(test.service.workspace(user, null, liveView, {
      surface: "registers", date: "2026-10-19", case_id: undefined,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(test.attendanceModel.responsibilityWorkspace).not.toHaveBeenCalled();
  });

  it("keeps a matching Simulation namespace and virtual clock bound through the same contract", async () => {
    const namespace = "scenario:00000000-0000-4000-8000-000000000010:run:00000000-0000-4000-8000-000000000011" as const;
    const test = harness([
      assignment("attendance.view", { kind: "class", id: ids.classA, label: "Class 6A" }, 1),
    ], namespace, namespace);
    const environmentView = {
      mode: "simulation" as const,
      institution_id: ids.school,
      scenario_id: "00000000-0000-4000-8000-000000000010",
      run_id: "00000000-0000-4000-8000-000000000011",
      namespace_id: namespace,
      virtual_clock: { now: "2026-10-19T04:00:00.000Z", time_zone: "Asia/Kolkata" },
      source_snapshot_at: "2026-10-18T04:00:00.000Z",
      expires_at: "2026-10-20T04:00:00.000Z",
    };

    const result = await test.service.workspace(user, null, environmentView, {
      surface: "registers", date: undefined, case_id: undefined,
    });

    expect(result.context.environment).toEqual({ kind: "simulation", namespace_id: namespace });
    expect(result.date).toBe("2026-10-19");
  });
});
