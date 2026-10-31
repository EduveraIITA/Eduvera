import { describe, expect, it } from "vitest";
import type { AuthUser, SchoolMembership } from "../auth/AuthContext";
import { workspaceAssignedWorkOnly, workspaceAssistantPortal } from "./workspaceAssistantContext";

const user: AuthUser = { id: "account", username: "amit", email: "amit@example.test", first_name: "Amit", last_name: "", display_name: "Amit", role: "staff", active_school_id: "current" };
const membership: SchoolMembership = { id: "member", school_id: "current", school_name: "Campus", role: "member", access_scope: "assigned_work" };
describe("assistant follows the selected campus app scope", () => {
  it.each<AuthUser["role"]>(["staff", "admin", "student", "parent", "member"])("does not infer an assistant from a global %s account role", role => {
    const auth = { user: { ...user, role }, memberships: [membership] };
    expect(workspaceAssignedWorkOnly(auth)).toBe(true); expect(workspaceAssistantPortal(auth)).toBeNull();
  });
  it("does not let a different campus membership widen assigned-work access", () => {
    const auth = { user, memberships: [membership, { ...membership, id: "other", school_id: "elsewhere", role: "admin" as const, access_scope: "campus" as const }] };
    expect(workspaceAssignedWorkOnly(auth)).toBe(true); expect(workspaceAssistantPortal(auth)).toBeNull();
  });
  it("retains assistant eligibility with an independent current-campus membership", () => {
    const auth = { user, memberships: [membership, { ...membership, id: "internal", role: "staff" as const, access_scope: "campus" as const }] };
    expect(workspaceAssignedWorkOnly(auth)).toBe(false); expect(workspaceAssistantPortal(auth)).toBe("teacher");
  });
  it("does not downgrade legacy campus memberships or infer a selected campus", () => {
    expect(workspaceAssignedWorkOnly({ user, memberships: [{ ...membership, access_scope: undefined }] })).toBe(false);
    expect(workspaceAssignedWorkOnly({ user: { ...user, active_school_id: null }, memberships: [membership] })).toBe(false);
  });
});
