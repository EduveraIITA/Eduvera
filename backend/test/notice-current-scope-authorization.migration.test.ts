import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/067_notice_current_scope_authorization.sql", import.meta.url),
  "utf8",
);

describe("notice current-scope authorization migration", () => {
  it("treats authorship as provenance and requires every stored class audience to remain in scope", () => {
    expect(migration).toMatch(/CREATE FUNCTION notice_actor_is_current_manager\s*\(/);
    expect(migration).toMatch(/membership\.role='admin'/);
    expect(migration).toMatch(/membership\.role='staff'[\s\S]*notice\.created_by=actor/);
    expect(migration).toMatch(/AND EXISTS \([\s\S]*FROM school_notice_audiences audience/);
    expect(migration).toMatch(/AND NOT EXISTS \([\s\S]*audience\.audience_kind<>'class_guardians'/);
    expect(migration).toMatch(/NOT staff_has_class_permission\([\s\S]*actor,[\s\S]*action,[\s\S]*audience\.class_section_id/);
    expect(migration).toContain("action=ANY(ARRAY['messages.view','messages.send'])");
  });

  it("rechecks that same view policy for durable notice replay while preserving exact recipients", () => {
    expect(migration).toMatch(/WHEN event_name='notice\.updated'/);
    expect(migration).toMatch(/notice_actor_is_current_manager\([\s\S]*'messages\.view'/);
    expect(migration).toMatch(/recipient\.id::text=event_payload->>'recipient_id'/);
    expect(migration).toMatch(/JOIN guardian_relationships relationship[\s\S]*relationship\.student_id=recipient\.student_id/);
    expect(migration).not.toMatch(/membership\.role='staff'\s+AND notice\.created_by=membership\.user_id/);
  });

  it("does not expose either authorization function to public execution", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION notice_actor_is_current_manager(uuid,uuid,uuid,text) FROM PUBLIC");
    expect(migration).toContain("REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC");
    expect(migration).toMatch(/ALTER FUNCTION notice_actor_is_current_manager\(uuid,uuid,uuid,text\) OWNER TO %I/);
    expect(migration).toMatch(/ALTER FUNCTION event_user_is_authorized\(uuid,text,jsonb,uuid\) OWNER TO %I/);
  });
});
