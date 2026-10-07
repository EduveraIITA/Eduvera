import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration=await readFile(new URL("../migrations/046_work_profiles_and_calculated_access.sql",import.meta.url),"utf8");
const alignment=await readFile(new URL("../migrations/047_work_profile_domain_alignment.sql",import.meta.url),"utf8");

describe("work-profile calculated access migration",()=>{
  it("separates eligibility, assignments and bounded exceptions",()=>{
    expect(migration).toContain("RENAME COLUMN recommended_permissions TO capability_permissions");
    expect(migration).toContain("PRIMARY KEY (school_id,user_id,role_id)");
    expect(migration).toContain("CREATE TABLE school_access_exceptions");
    expect(migration).toContain("valid_until date NOT NULL");
    expect(migration).toContain("review_due_on date NOT NULL");
  });

  it("migrates legacy grants without keeping them authoritative",()=>{
    expect(migration).toContain("migration_profile");
    expect(migration).toContain("migration_individual");
    expect(migration).toContain("UPDATE school_custom_roles SET permissions='{}'::text[]");
    expect(migration).toContain("DELETE FROM school_permission_grants");
  });

  it("protects exception storage and seeds operational profiles consistently",()=>{
    expect(migration).toContain("validate_school_access_exception");
    expect(migration).toContain("ALTER TABLE school_access_exceptions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("'transport_coordinator'");
    expect(migration).toContain("'assessment_coordinator'");
  });

  it("keeps classroom-event capabilities in the platform-owned catalogue",()=>{
    expect(alignment).toContain("WHERE code='subject_teacher'");
    expect(alignment).toContain("'dayplans.respond'");
    expect(alignment).toContain("'events.view'");
    expect(alignment).toContain("'events.manage'");
  });
});
