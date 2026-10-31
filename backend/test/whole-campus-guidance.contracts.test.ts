import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import { provisionWorkspaceSchema, updateStartingGoalsSchema, wholeCampusGuidanceResume } from "../src/institution-onboarding/progressive-onboarding.contracts.js";

const user = { id: "owner", active_school_id: "campus", is_active: true } as AuthUser;
const workspace = { guidance: "whole_campus" as const, school_id: "campus", owner_user_id: "owner" };

describe("whole-campus guidance is an optional starting preference", () => {
  it("can start without a campus name, goal, map, person list or setup checklist", () => {
    expect(provisionWorkspaceSchema.parse({ guidance: "whole_campus" })).toEqual({ guidance: "whole_campus" });
  });
  it("expands the historical shortcut into three recommendations, never all capabilities", () => {
    expect(provisionWorkspaceSchema.parse({ goals: ["whole_campus"] })).toEqual({
      goals: ["gate", "timetable", "facilities"], guidance: "whole_campus",
    });
    expect(updateStartingGoalsSchema.parse({ goals: ["whole_campus", "messages"], primary: "messages" })).toEqual({
      goals: ["gate", "timetable", "facilities", "messages"], primary: "messages", guidance: "whole_campus",
    });
  });
  it("distinguishes omission, enabling and leaving guidance without changing explicit goals", () => {
    expect(provisionWorkspaceSchema.parse({})).not.toHaveProperty("guidance");
    expect(provisionWorkspaceSchema.parse({ guidance: null })).toEqual({ guidance: null });
    expect(updateStartingGoalsSchema.parse({ goals: ["fees", "messages"], guidance: "whole_campus" })).toEqual({
      goals: ["fees", "messages"], guidance: "whole_campus",
    });
  });
  it.each([
    { guidance: "all" }, { guidance: { intent: "whole_campus" } }, { guidance: "whole_campus", campus_id: "foreign" },
    { guidance: "whole_campus", role: "admin" }, { guidance: "whole_campus", completed: true },
    { goals: ["whole_campus"], guidance: null }, { goals: ["gate", "gate"] }, { goals: [] },
  ])("rejects unknown fields, authority claims and conflicting intent %#", input => {
    expect(provisionWorkspaceSchema.safeParse(input).success).toBe(false);
  });
  it("requires a selected primary goal", () => {
    expect(updateStartingGoalsSchema.safeParse({ goals: ["gate"], primary: "fees" }).success).toBe(false);
  });
});

describe("whole-campus preferred landing is fixed and scoped", () => {
  it("returns a fixed allowlisted path bound to the active owner and institution", () => {
    expect(wholeCampusGuidanceResume(user, workspace, true)).toEqual({ kind: "whole_campus", path: "/more/setup/whole-campus",
      actor_user_id: "owner", school_id: "campus", requires_recheck: true });
    const untrusted = { ...workspace, resume_path: "https://evil.invalid" };
    expect(wholeCampusGuidanceResume(user, untrusted, true)).toHaveProperty("path", "/more/setup/whole-campus");
  });
  it.each([
    [{ ...user, active_school_id: "other" }, workspace, true],
    [{ ...user, active_school_id: null }, workspace, true],
    [{ ...user, is_active: false }, workspace, true],
    [user, { ...workspace, owner_user_id: "other" }, true],
    [user, { ...workspace, guidance: null }, true],
    [user, workspace, false],
    [user, null, true],
  ] as const)("does not resume without the current owner, active campus and eligibility %#", (actor, source, eligible) => {
    expect(wholeCampusGuidanceResume(actor, source, eligible)).toBeNull();
  });
});
