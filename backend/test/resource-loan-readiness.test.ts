import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { rolePermissions } from "../src/roles/scoped-role-policy.js";
import { progressiveCapabilitySchema } from "../src/institution-activation/progressive-setup.contracts.js";
import { RolesService } from "../src/roles/roles.service.js";
import { parseResourceLoanContinuation, resourceLoanDestination } from "../src/resource-loans/resource-loan-readiness.js";

describe("Resources progressive entry boundaries",()=>{
  const id="cd0e6b39-b8d3-4b32-ad73-2526487152d8";
  it("retains only an exact canonical loan destination",()=>{
    expect(parseResourceLoanContinuation(resourceLoanDestination(id))).toEqual({loan_id:id});
    for(const path of [`https://example.test/areas/resources?loan_id=${id}`,`//example.test/areas/resources?loan_id=${id}`,
      `/areas/resources?loan_id=${id}&loan_id=${id}`,`/areas/resources?loan_id=${id}&person_id=${id}`,
      `/areas/resources?loan_id=${id}#history`,`/areas/resources?loan_id=arbitrary`,`/areas/resources/other?loan_id=${id}`]) {
      expect(parseResourceLoanContinuation(path),path).toBeNull();
    }
  });
  it("offers the additive starting goal without granting Staff custody or class scope",()=>{
    expect(progressiveCapabilitySchema.parse("resources")).toBe("resources");
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("resources.manage");
    expect(rolePermissions("institution",["resources.manage"])).toEqual(["resources.manage"]);
    expect(()=>rolePermissions("class",["resources.manage"])).toThrow();
  });
  it("rejects a resource-only exception before any database write instead of widening it to institution access",async()=>{
    const roles = new RolesService({} as never);
    await expect(roles.addException({} as never,id,id,{permission:"resources.manage",scope_kind:"assigned_resources",
      reason:"Fictional bounded access review",valid_from:"2026-10-24",valid_until:"2026-10-25"}))
      .rejects.toThrow("institution-scoped access exception");
  });
});
