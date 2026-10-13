import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "migrations", "065_feedback_governance_realtime_authorization.sql"), "utf8");

describe("feedback and governance realtime authorization migration", () => {
  it("wraps the existing authorization chain for both event types", () => {
    expect(migration).toContain("event_user_is_authorized_before_feedback_governance");
    expect(migration).toContain("event_name='teacher_feedback.updated'");
    expect(migration).toContain("event_name='governance.policy.rejected'");
    expect(migration).toContain("ELSE event_user_is_authorized_before_feedback_governance(");
  });

  it("rechecks campaign eligibility and current administrator authority", () => {
    expect(migration).toContain("campaign.audience='students'");
    expect(migration).toContain("campaign.audience='parents'");
    expect(migration).toContain("JOIN guardian_relationships relationship");
    expect(migration).toContain("enrollment.is_active");
    expect(migration).toContain("membership.role='admin'");
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("account.is_active");
  });

  it("retains the function hardening contract", () => {
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path=public");
    expect(migration).toContain("REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC");
    expect(migration).toContain("ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO");
  });
});
