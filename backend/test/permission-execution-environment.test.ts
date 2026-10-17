import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { createLiveExecutionEnvironment, createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { PermissionGuard } from "../src/roles/permission.guard.js";
import type { RolesService } from "../src/roles/roles.service.js";

const schoolId = "school-cis";

function requestContext(executionEnvironment: ReturnType<typeof createLiveExecutionEnvironment> | ReturnType<typeof createSimulationExecutionEnvironment>) {
  const request = {
    params: {},
    query: {},
    body: {},
    authUser: {
      id: "user-1",
      username: "teacher",
      email: "teacher@example.test",
      first_name: "Test",
      last_name: "Teacher",
      avatar_url: null,
      role: "staff" as const,
      is_active: true,
      email_verified_at: null,
      active_school_id: schoolId,
    },
    executionEnvironment,
  };
  return {
    request,
    context: {
      getHandler: () => function handler() {},
      getClass: () => class DomainController {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

describe("PermissionGuard execution environment", () => {
  it("resolves domain authority inside the selected Simulation data-plane scope", async () => {
    const scope = new ExecutionDataPlaneScope();
    const environment = createSimulationExecutionEnvironment({
      institution_id: schoolId,
      scenario_id: "scenario-1",
      run_id: "run-1",
      virtual_clock: {
        now: () => new Date("2026-10-19T03:30:00.000Z"),
        nowIso: () => "2026-10-19T03:30:00.000Z",
        advanceBy: () => "2026-10-19T03:30:00.000Z",
        advanceTo: () => "2026-10-19T03:30:00.000Z",
      },
      source_snapshot_ref: "snapshot:1",
      coverage_gate: {
        status: "passed",
        manifest_ref: "coverage:1",
        checked_at: "2026-10-17T06:30:00.000Z",
      },
      expires_at: "2099-10-19T03:30:00.000Z",
    });
    const effective = vi.fn(() => {
      expect(scope.current()).toBe(environment);
      return Promise.resolve({ role: "staff", permissions: ["attendance.view"] });
    });
    const guard = new PermissionGuard(
      { getAllAndOverride: () => "attendance.view" } as unknown as Reflector,
      {} as DatabaseService,
      { effective } as unknown as RolesService,
      scope,
    );
    const { context } = requestContext(environment);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(effective).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }), schoolId);
    expect(scope.current()).toBeUndefined();
  });

  it("leaves ordinary Live authority on the default Live database path", async () => {
    const scope = new ExecutionDataPlaneScope();
    const environment = createLiveExecutionEnvironment({
      institution_id: schoolId,
      clock: {
        now: () => new Date("2026-10-17T06:30:00.000Z"),
        nowIso: () => "2026-10-17T06:30:00.000Z",
      },
    });
    const effective = vi.fn(() => {
      expect(scope.current()).toBeUndefined();
      return Promise.resolve({ role: "staff", permissions: ["attendance.view"] });
    });
    const guard = new PermissionGuard(
      { getAllAndOverride: () => "attendance.view" } as unknown as Reflector,
      {} as DatabaseService,
      { effective } as unknown as RolesService,
      scope,
    );
    const { context } = requestContext(environment);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(effective).toHaveBeenCalledOnce();
  });
});
