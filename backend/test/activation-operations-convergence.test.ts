import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const operations = readFileSync(new URL("../src/operations/operations.service.ts", import.meta.url), "utf8");
const operationsController = readFileSync(new URL("../src/operations/operations.controller.ts", import.meta.url), "utf8");
const peopleController = readFileSync(new URL("../src/people/people.controller.ts", import.meta.url), "utf8");
const membershipAuthorization = readFileSync(resolve(process.cwd(), "migrations/110_membership_access_event_authorization.sql"), "utf8");

describe("legacy administration projection convergence", () => {
  // Actual creation/update/import/enrollment/rollover events and the guardian
  // accepted command/outbox/replay are verified by operations.integration.test.
  it("keeps guardian attachment on its owning People route rather than an account-coupled Operations creator", () => {
    expect(operations).not.toContain("async guardian(");
    expect(operationsController).not.toContain('@Post("schools/:schoolId/guardians/")');
    expect(peopleController).toContain('@Post("guardian-links")');
  });

  it("sends membership access changes to the affected account and permits its self-scoped revocation signal", () => {
    expect(operations).toContain('event_type: "staff.access.updated"');
    expect(operations).toContain("affected_user_id: input.affectedUserId");
    expect(membershipAuthorization).toContain("event_name='staff.access.updated'");
    expect(membershipAuthorization).toContain("event_payload->>'affected_user_id'=candidate_user_id::text");
    expect(membershipAuthorization).toContain("membership.school_id=event_school_id");
    expect(membershipAuthorization).not.toContain("membership.is_active\n");
  });
});

