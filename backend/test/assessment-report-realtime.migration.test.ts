import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "migrations", "064_assessment_report_realtime_authorization.sql"), "utf8");

describe("assessment and report realtime authorization migration", () => {
  it("wraps the existing authorization chain and handles both event types", () => {
    expect(migration).toContain("event_user_is_authorized_before_assessment_reports");
    expect(migration).toContain("event_name='assessment.updated'");
    expect(migration).toContain("event_name='academic_report.updated'");
    expect(migration).toContain("ELSE event_user_is_authorized_before_assessment_reports(");
  });

  it("rechecks staff resource authority and keeps family access publish-only", () => {
    expect(migration).toContain("assessment_staff_assignments assignment");
    expect(migration).toContain("staff_has_resource_permission(");
    expect(migration).toContain("'reports.comment'=ANY(binding.permissions)");
    expect(migration.match(/event_payload->>'action'='publish'/g)).toHaveLength(4);
    expect(migration).toContain("FROM assessment_results result");
    expect(migration).toContain("FROM grading_report_students report");
    expect(migration).toContain("JOIN guardian_relationships relationship");
  });

  it("retains the function hardening contract", () => {
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET search_path=public");
    expect(migration).toContain("REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC");
    expect(migration).toContain("ALTER FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) OWNER TO");
  });
});
