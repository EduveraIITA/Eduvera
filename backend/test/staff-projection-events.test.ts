import { describe, expect, it } from "vitest";
import { staffProjectionUpdateEvent, type StaffProjectionMutation } from "../src/staff-operations/staff-operations.service.js";

const schoolId = "10000000-0000-4000-8000-000000000001";
const aggregateId = "20000000-0000-4000-8000-000000000002";

describe("staff user-panel convergence events", () => {
  it.each([
    ["profile_created", "staff.access.updated", "staff_profile", ["staff-operations", "principal.home", "institution-activation", "campus-view"]],
    ["onboarding_updated", "staff.access.updated", "staff_profile", ["staff.access", "staff-operations", "teacher.home", "teacher.attendance", "principal.home", "institution-activation", "campus-view"]],
    ["leave_policy_created", "administration.updated", "staff_leave_policy", ["staff-operations"]],
    ["leave_policy_updated", "administration.updated", "staff_leave_policy", ["staff-operations"]],
    ["leave_balance_adjusted", "administration.updated", "staff_leave_balance_adjustment", ["staff-operations"]],
    ["coverage_policy_updated", "administration.updated", "staff_coverage_policy", ["staff-operations"]],
  ] satisfies Array<[StaffProjectionMutation, string, string, string[]]>)("builds the %s contract with only its affected projections", (mutation, eventType, aggregateType, refresh) => {
    const event = staffProjectionUpdateEvent({
      mutation,
      schoolId,
      aggregateId,
      revision: 3,
      audienceUserIds: ["user-2", "user-1", "user-2"],
    });

    expect(event).toEqual({
      eventType,
      aggregateType,
      aggregateId,
      audienceUserIds: ["user-1", "user-2"],
      idempotencyNamespace: `staff.${mutation}`,
      payload: { school_id: schoolId, action: mutation, revision: 3, refresh },
    });
  });

  it("adds the invitation projection without broadening every profile event", () => {
    const event = staffProjectionUpdateEvent({
      mutation: "profile_created",
      schoolId,
      aggregateId,
      revision: 1,
      audienceUserIds: ["admin-1"],
      metadata: { status: "onboarding" },
      extraRefresh: ["principal.administration", "staff-operations"],
    });

    expect(event.payload).toEqual({
      school_id: schoolId,
      action: "profile_created",
      revision: 1,
      status: "onboarding",
      refresh: ["staff-operations", "principal.home", "institution-activation", "campus-view", "principal.administration"],
    });
  });
});
