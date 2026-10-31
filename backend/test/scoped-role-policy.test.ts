import { describe, expect, it } from "vitest";
import { DEFAULT_STAFF_PERMISSIONS } from "../src/roles/permissions.js";
import { ROLE_CONTEXTS, roleOptions, rolePermissions } from "../src/roles/scoped-role-policy.js";

describe("gate action in the role editor policy", () => {
  it("keeps session teaching explicit without adding attendance or private assignment authority", () => {
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("learning.sessions.manage");
    expect(roleOptions().permissions).toContainEqual(expect.objectContaining({ code: "learning.sessions.manage" }));
    for (const context of ["institution", "class"]) expect(rolePermissions(context, ["learning.sessions.manage"])).toEqual(["learning.sessions.manage"]);
    for (const context of ROLE_CONTEXTS.filter(item => !["institution", "class"].includes(item.code))) {
      expect(() => rolePermissions(context.code, ["learning.sessions.manage"])).toThrow("supported actions");
    }
  });
  it("keeps assignment management explicit and class scoped without granting other teaching actions", () => {
    expect(rolePermissions("class", ["learning.assignments.manage"])).toEqual(["learning.assignments.manage"]);
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("learning.assignments.manage");
    expect(roleOptions().permissions).toContainEqual(expect.objectContaining({ code: "learning.assignments.manage" }));
    for (const context of ROLE_CONTEXTS.filter(item => item.code !== "class")) {
      expect(() => rolePermissions(context.code, ["learning.assignments.manage"])).toThrow("supported actions");
    }
  });
  it("requires an explicit class-only learning publication grant without adding attendance or messaging", () => {
    expect(rolePermissions("class", ["learning.work.publish"])).toEqual(["learning.work.publish"]);
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("learning.work.publish");
    const options = roleOptions();
    expect(options.contexts.find(context => context.code === "class")?.permissions).toContain("learning.work.publish");
    for (const context of ROLE_CONTEXTS.filter(item => item.code !== "class")) {
      expect(() => rolePermissions(context.code, ["learning.work.publish"])).toThrow("supported actions");
    }
  });
  it("offers separate campus attendance actions without activating review or recording through an unrelated role", () => {
    expect(rolePermissions("institution", ["attendance.record"])).toEqual(["attendance.record", "attendance.view"]);
    expect(rolePermissions("institution", ["attendance.review"])).toEqual(["attendance.review", "attendance.view"]);
    expect(rolePermissions("institution", ["messages.view"])).toEqual(["messages.view"]);
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("attendance.review");
    expect(() => rolePermissions("class", ["attendance.review"])).toThrow("supported actions");
  });
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
