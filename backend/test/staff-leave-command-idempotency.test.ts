import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRetainedStaffLeaveOutbox,
  staffLeaveCommandHash,
} from "../src/staff-operations/staff-operations.service.js";

const migration = readFileSync(resolve(process.cwd(), "migrations/108_staff_leave_command_idempotency.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/staff-operations/staff-operations.service.ts"), "utf8");

describe("staff leave command idempotency", () => {
  it("hashes semantic command identity deterministically and includes the target", () => {
    const left = staffLeaveCommandHash("decide", "11111111-1111-4111-8111-111111111111", {
      expected_revision: 1,
      note: "Cover arranged",
      decision: "approved",
    });
    const same = staffLeaveCommandHash("decide", "11111111-1111-4111-8111-111111111111", {
      decision: "approved",
      note: "Cover arranged",
      expected_revision: 1,
    });
    const changed = staffLeaveCommandHash("decide", "22222222-2222-4222-8222-222222222222", {
      decision: "approved",
      note: "Cover arranged",
      expected_revision: 1,
    });
    expect(left).toBe(same);
    expect(changed).not.toBe(left);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts only the retained outbox event that matches the original identity and payload", () => {
    const retained = {
      id: "33333333-3333-4333-8333-333333333333",
      school_id: "44444444-4444-4444-8444-444444444444",
      event_type: "staff.leave.submitted",
      aggregate_type: "staff_leave_request",
      aggregate_id: "55555555-5555-4555-8555-555555555555",
      payload_matches: true,
      audience_matches: true,
      notification_users_match: true,
      notification_payload_matches: true,
    };
    const expected = {
      school_id: retained.school_id,
      event_type: retained.event_type,
      aggregate_type: retained.aggregate_type,
      aggregate_id: retained.aggregate_id,
    };
    expect(assertRetainedStaffLeaveOutbox(retained, expected)).toBe(retained.id);
    expect(() => assertRetainedStaffLeaveOutbox({ ...retained, event_type: "staff.leave.approved" }, expected)).toThrow(/different event details/i);
    expect(() => assertRetainedStaffLeaveOutbox({ ...retained, payload_matches: false }, expected)).toThrow(/different event details/i);
    expect(() => assertRetainedStaffLeaveOutbox({ ...retained, audience_matches: false }, expected)).toThrow(/different event details/i);
    expect(() => assertRetainedStaffLeaveOutbox({ ...retained, notification_users_match: false }, expected)).toThrow(/different event details/i);
    expect(() => assertRetainedStaffLeaveOutbox({ ...retained, notification_payload_matches: false }, expected)).toThrow(/different event details/i);
  });

  it("stores a tenant-and-actor-scoped receipt linked to its request and outbox event", () => {
    expect(migration).toContain("CREATE TABLE staff_leave_commands");
    expect(migration).toContain("UNIQUE(school_id,actor_id,command_id)");
    expect(migration).toContain("CHECK(command_type IN ('submit','decide','withdraw'))");
    expect(migration).toContain("REFERENCES staff_leave_requests(id,school_id) ON DELETE RESTRICT");
    expect(migration).toContain("REFERENCES event_outbox(id,school_id) ON DELETE RESTRICT");
    expect(migration).toContain("REFERENCES campus_model_events(id,school_id) ON DELETE RESTRICT");
    expect(migration).toContain("staff_leave_requests_id_school_unique UNIQUE(id,school_id)");
    expect(migration).toContain("CHECK(jsonb_typeof(result)='object')");
    expect(migration).toContain("authority_receipt jsonb NOT NULL");
    expect(migration).toContain("coordination_receipt jsonb NOT NULL");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("checks a retained command before duplicate business-state guards", () => {
    const submit = service.slice(service.indexOf("async requestLeave"), service.indexOf("async decideLeave"));
    const decide = service.slice(service.indexOf("async decideLeave"), service.indexOf("async assignCoverage"));
    const withdraw = service.slice(service.indexOf("async withdrawLeave"));
    expect(submit.indexOf("priorLeaveCommand")).toBeGreaterThanOrEqual(0);
    expect(submit.indexOf("priorLeaveCommand")).toBeLessThan(submit.indexOf("const overlap"));
    expect(decide.indexOf("priorLeaveCommand")).toBeLessThan(decide.indexOf('request.status !== "submitted"'));
    expect(withdraw.indexOf("priorLeaveCommand")).toBeLessThan(withdraw.indexOf('current.status !== "submitted"'));
    expect(service).toContain('.returning("id").executeTakeFirst()');
    expect(service).toContain("payload_matches");
    expect(service).toContain("audience_matches");
    expect(service).toContain("notification_users_match");
    expect(service).toContain("notification_payload_matches");
  });
});
