import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { rolePermissions } from "../src/roles/scoped-role-policy.js";
import { progressiveCapabilitySchema } from "../src/institution-activation/progressive-setup.contracts.js";
import { RolesService } from "../src/roles/roles.service.js";
import { accommodationDestination, parseAccommodationContinuation, readAccommodationReadiness, vettedAccommodationResume } from "../src/institution-onboarding/accommodation-readiness.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { retainOperatingDestination } from "../src/institution-onboarding/operating-resume.js";
import type { AuthUser } from "../src/common/request.js";

describe("Accommodation progressive entry boundaries", () => {
  const id = "cd0e6b39-b8d3-4b32-ad73-2526487152d8";
  const user = { id, active_school_id: id, is_active: true } as AuthUser;
  it("retains only the exact native stay destination", () => {
    expect(parseAccommodationContinuation(accommodationDestination(id))).toEqual({ stay_id: id });
    for (const path of [`https://example.test/areas/accommodation?stay_id=${id}`, `//example.test/areas/accommodation?stay_id=${id}`,
      `/areas/accommodation?stay_id=${id}&stay_id=${id}`, `/areas/accommodation?stay_id=${id}&resident_id=${id}`,
      `/areas/accommodation?stay_id=${id}&run_id=${id}`, `/areas/accommodation?stay_id=${id}#history`,
      "/areas/accommodation?stay_id=arbitrary", `/areas/accommodation/other?stay_id=${id}`]) {
      expect(parseAccommodationContinuation(path), path).toBeNull();
    }
  });
  it("adds the goal without granting default Staff setup or custody authority", () => {
    expect(progressiveCapabilitySchema.parse("accommodation")).toBe("accommodation");
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("accommodation.manage");
    expect(rolePermissions("institution", ["accommodation.manage"])).toEqual(["accommodation.manage"]);
    for (const scope of ["class", "event", "assessment", "trip"]) {
      expect(() => rolePermissions(scope, ["accommodation.manage"])).toThrow();
    }
  });
  it("rejects an assigned-resource exception before any database write", async () => {
    const roles = new RolesService({} as never);
    await expect(roles.addException({} as never, id, id, { permission: "accommodation.manage", scope_kind: "assigned_resources",
      reason: "Fictional residence duty", valid_from: "2026-10-24", valid_until: "2026-10-25" }))
      .rejects.toThrow("institution-scoped access exception");
  });
  it("never treats missing canonical identity or another setup owner as accepted work", async () => {
    expect((await readAccommodationReadiness({} as never, undefined, user, id)).operation)
      .toMatchObject({ state: "unavailable", action: "unavailable", scope: null, source_revision: null, requires_recheck: true });
    expect(await vettedAccommodationResume({} as never, undefined, user, { school_id: id,
      owner_user_id: "another-owner", resume_path: accommodationDestination(id) }))
      .toEqual({ step: "first_use", path: "/areas/accommodation" });
  });
  it("qualifies readiness by the selected world and never writes Live onboarding from Simulation", async () => {
    const environment = simulationRequestEnvironment({ institution_id: id, scenario_id: id, run_id: id,
      virtual_now: "2026-10-24T10:00:00Z", source_snapshot_ref: "snapshot", manifest_ref: "test", checked_at: "2026-10-24T10:00:00Z" });
    await executionEnvironmentStorage.run(environment, async () => {
      const result = await readAccommodationReadiness({} as never, undefined, user, id);
      expect(result.operation).toMatchObject({ environment_namespace_id: `scenario:${id}:run:${id}`,
        evaluated_at: "2026-10-24T10:00:00.000Z", state: "unavailable" });
      // An empty object cannot perform a database query: the control-plane
      // guard must return before touching this deliberately absent connection.
      await expect(retainOperatingDestination({} as never, user, id, "accommodation", accommodationDestination(id),
        { onlyPending: true, source: "accepted_accommodation_arrangement" })).resolves.toBeUndefined();
    });
  });
});
