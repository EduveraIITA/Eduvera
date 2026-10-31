import { describe, expect, it } from "vitest";
import type { SchoolMembership } from "./AuthContext";
import { profileConnectionAudience } from "./profileConnectionScope";

const member: SchoolMembership = { id: "membership", school_id: "campus", school_name: "Campus", role: "member", permissions: [] };
describe("profile connection perspectives", () => {
  it.each(["/today", "/teacher", "/principal", "/parent", "/student"])("does not turn an app-only member's %s return path into a legacy portal", path => {
    expect(profileConnectionAudience([member], path)).toBeNull();
  });
  it("retains an explicitly held operational relationship", () => {
    expect(profileConnectionAudience([{ ...member, role: "staff" }], "/today")).toBe("teacher");
  });
});
