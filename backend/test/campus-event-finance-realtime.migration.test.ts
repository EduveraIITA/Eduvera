import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/020_campus_event_finance_realtime_authorization.sql"),
  "utf8",
);

describe("campus-event finance realtime authorization migration", () => {
  it("limits unassigned fee managers to finance-originated campus-event updates", () => {
    expect(migration).toMatch(/permission\.permission='fees\.manage'/);
    expect(migration).toMatch(/change_kind'.*participant_withdrawn.*refund_recorded/s);
    expect(migration).toMatch(/campus_event_staff/);
    expect(migration).toMatch(/event_user_is_authorized_before_campus_events/);
  });

  it("retains the hardened function posture", () => {
    expect(migration).toMatch(/SECURITY INVOKER/);
    expect(migration).toMatch(/SET search_path=public/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION event_user_is_authorized\(uuid,text,jsonb,uuid\) FROM PUBLIC/);
    expect(migration).toMatch(/ALTER FUNCTION event_user_is_authorized\(uuid,text,jsonb,uuid\) OWNER TO/);
  });
});
