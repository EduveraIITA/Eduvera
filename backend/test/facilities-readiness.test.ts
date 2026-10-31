import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { rolePermissions } from "../src/roles/scoped-role-policy.js";
import { progressiveCapabilitySchema } from "../src/institution-activation/progressive-setup.contracts.js";
import { RolesService } from "../src/roles/roles.service.js";
import { facilitiesDestination, parseFacilitiesContinuation } from "../src/institution-onboarding/facilities-readiness.js";

describe("Facilities progressive entry boundaries", () => {
  const id = "cd0e6b39-b8d3-4b32-ad73-2526487152d8";
  it("retains only the exact owning repair destination", () => {
    expect(parseFacilitiesContinuation(facilitiesDestination(id))).toEqual({ repair_id: id });
    for (const path of [`https://example.test/areas/facilities?repair_id=${id}`, `//example.test/areas/facilities?repair_id=${id}`,
      `/areas/facilities?repair_id=${id}&repair_id=${id}`, `/areas/facilities?repair_id=${id}&person_id=${id}`,
      `/areas/facilities?repair_id=${id}#history`, `/areas/facilities?repair_id=arbitrary`, `/areas/facilities/other?repair_id=${id}`]) {
      expect(parseFacilitiesContinuation(path), path).toBeNull();
    }
  });
  it("makes the goal additive without granting Staff repair or room-entry authority", () => {
    expect(progressiveCapabilitySchema.parse("facilities")).toBe("facilities");
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("facilities.manage");
    expect(rolePermissions("institution", ["facilities.manage"])).toEqual(["facilities.manage"]);
    expect(() => rolePermissions("class", ["facilities.manage"])).toThrow();
  });
  it("does not widen an assigned-resource exception to institution access", async () => {
    const roles = new RolesService({} as never);
    await expect(roles.addException({} as never, id, id, { permission: "facilities.manage", scope_kind: "assigned_resources",
      reason: "Fictional repair access review", valid_from: "2026-10-24", valid_until: "2026-10-25" }))
      .rejects.toThrow("institution-scoped access exception");
  });
});
