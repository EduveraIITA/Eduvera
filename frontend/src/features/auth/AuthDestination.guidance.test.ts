import { describe, expect, it } from "vitest";
import { authDestination } from "./AuthContext";

type Input = Parameters<typeof authDestination>[0];
function founder(): Input {
  return {
    status: "authenticated", companyOperator: false,
    user: { id: "founder", username: "meera", email: "meera@example.test", first_name: "Meera", last_name: "Rao", display_name: "Meera Rao", role: "admin", email_verified: true, active_school_id: "campus-one" },
    memberships: [{ id: "membership", school_id: "campus-one", school_name: "Cedar Institute", role: "admin", access_scope: "campus" }],
    onboarding: { status: "ready", guidance: "whole_campus", guidance_resume: { kind: "whole_campus", path: "/more/setup/whole-campus", actor_user_id: "founder", school_id: "campus-one", requires_recheck: true } },
  };
}

describe("whole-campus guidance destination", () => {
  it("resumes the vetted guide only for its active normal campus administrator", () => {
    expect(authDestination(founder())).toBe("/more/setup/whole-campus");
    expect(authDestination(founder(), { resumeUnfinishedSetup: false })).toBe("/today");
    const auth = founder();
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding!, guidance: null } })).toBe("/today");
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding!, guidance_resume: null } })).toBe("/today");
  });

  it("never interprets retained guidance as authority for another actor, campus or work-only account", () => {
    const auth = founder();
    expect(authDestination({ ...auth, user: { ...auth.user!, id: "someone-else" } })).toBe("/today");
    expect(authDestination({ ...auth, user: { ...auth.user!, active_school_id: "campus-two" } })).toBe("/today");
    expect(authDestination({ ...auth, user: { ...auth.user!, active_school_id: null } })).toBe("/today");
    for (const role of ["staff", "student", "member"] as const) {
      expect(authDestination({ ...auth, memberships: [{ ...auth.memberships[0], role }] })).toBe("/today");
    }
    expect(authDestination({ ...auth, memberships: [{ ...auth.memberships[0], access_scope: "assigned_work" }] })).toBe("/today");
    expect(authDestination({ ...auth, executionEnvironment: { mode: "live", institutionId: "campus-two" } })).toBe("/today");
  });

  it("keeps account verification and the selected Simulation ahead of a Live guide", () => {
    const auth = founder();
    expect(authDestination({ ...auth, user: { ...auth.user!, email_verified: false } })).toBe("/account/security");
    expect(authDestination({ ...auth, executionEnvironment: { mode: "simulation", namespaceId: "scenario:one", runId: "run-one", institutionId: "campus-one", virtualClock: { now: "2026-10-26T10:00:00Z", timeZone: "Asia/Kolkata" } } })).toBe("/today");
  });

  it("refuses query strings, arbitrary redirects and unverified guide evidence", () => {
    const auth = founder(), guide = auth.onboarding!.guidance_resume!;
    for (const path of ["//elsewhere.test", "/more/setup/whole-campus?school=another", "/more/setup/whole-campus#share", "/areas/facilities"]) {
      expect(authDestination({ ...auth, onboarding: { ...auth.onboarding!, guidance_resume: { ...guide, path: path as typeof guide.path } } })).toBe("/today");
    }
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding!, guidance_resume: { ...guide, requires_recheck: false as true } } })).toBe("/today");
  });

  it("preserves an accepted own source continuation ahead of general guidance", () => {
    const auth = founder(), id = "86bca69e-c591-46cb-b04a-ff0895410a75";
    const path = `/areas/timetable/planning?plan=${id}&plan_revision=2&date=2026-10-26&section=drafts`;
    expect(authDestination({ ...auth, onboarding: { ...auth.onboarding!, resume: { step: "first_use", goal: "timetable", path, continuation: { kind: "activity_plan", actor_user_id: "founder", school_id: "campus-one", source_id: id, source_revision: 2, requires_recheck: true } } } })).toBe(path);
  });
});
