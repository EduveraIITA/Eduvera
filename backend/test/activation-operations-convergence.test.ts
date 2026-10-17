import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const activation = readFileSync(new URL("../src/institution-activation/institution-activation.service.ts", import.meta.url), "utf8");
const operations = readFileSync(new URL("../src/operations/operations.service.ts", import.meta.url), "utf8");
const membershipAuthorization = readFileSync(resolve(process.cwd(), "migrations/110_membership_access_event_authorization.sql"), "utf8");

describe("activation and legacy administration projection convergence", () => {
  it("retains quick-start catalogue and timetable events in the owning transaction", () => {
    expect(activation).toContain('eventType: "administration.updated"');
    expect(activation).toContain('eventType: "timetable.updated"');
    expect(activation).toContain('idempotencyKey: `activation:term:');
    expect(activation).toContain('idempotencyKey: `activation:class:');
    expect(activation).toContain('idempotencyKey: `activation:subject:');
    expect(activation).toContain('idempotencyKey: `activation:timetable:');
    expect(activation).toContain('"institution-activation"');
    expect(activation.indexOf("await this.enqueueUpdate(db")).toBeGreaterThan(activation.indexOf("this.db.transaction().execute"));
  });

  it.each([
    "student_created",
    "student_updated",
    "students_imported",
    "guardian_linked",
    "student_enrolled",
    "term_rollover_completed",
  ])("emits a people event for %s", (action) => {
    expect(operations).toContain(`action: "${action}"`);
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

