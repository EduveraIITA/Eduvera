import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { ROLE_CONTEXTS, roleOptions, rolePermissions } from "../src/roles/scoped-role-policy.js";

describe("gate action in the role editor policy", () => {
  it("exposes Manage In & Out as an institution action", () => {
    const options = roleOptions();
    expect(options.permissions).toContainEqual(expect.objectContaining({ code: "gate.manage", group: "Gate & Safety", label: "Manage In & Out" }));
    expect(options.contexts.find(context => context.code === "institution")?.permissions).toContain("gate.manage");
  });

  it("accepts gate-only and combined institution roles without adding departure authority", () => {
    expect(rolePermissions("institution", ["gate.manage"])).toEqual(["gate.manage"]);
    expect(rolePermissions("institution", ["gate.manage", "messages.view"])).toEqual(["gate.manage", "messages.view"]);
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("gate.manage");
  });

  it.each(ROLE_CONTEXTS.filter(context => context.code !== "institution"))("rejects gate access in $code roles", context => {
    expect(() => rolePermissions(context.code, ["gate.manage"])).toThrow(/supported actions/);
  });
});
