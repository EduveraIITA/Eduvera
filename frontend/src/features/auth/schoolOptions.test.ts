import { describe, expect, it } from "vitest";
import type { SchoolMembership } from "./AuthContext";
import { schoolOptions } from "./schoolOptions";

describe("institution selector options", () => {
  it("presents a multi-role campus once without changing the membership records", () => {
    const memberships: SchoolMembership[] = [
      { id: "staff", school_id: "campus-1", school_name: "Your campus", role: "staff", permissions: ["sis.manage"] },
      { id: "admin", school_id: "campus-1", school_name: "Your campus", role: "admin" },
    ];
    expect(schoolOptions(memberships)).toEqual([{ school_id: "campus-1", school_name: "Your campus" }]);
    expect(memberships.map((membership) => membership.role)).toEqual(["staff", "admin"]);
    expect(memberships[0].permissions).toEqual(["sis.manage"]);
  });

  it("keeps equally named institutions with different IDs distinct in their original order", () => {
    expect(schoolOptions([
      { school_id: "campus-2", school_name: "Your campus" },
      { school_id: "campus-1", school_name: "Your campus" },
      { school_id: "campus-2", school_name: "Your campus" },
    ])).toEqual([
      { school_id: "campus-2", school_name: "Your campus" },
      { school_id: "campus-1", school_name: "Your campus" },
    ]);
  });
});
