import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "migrations/053_timetable_curriculum_ownership.sql"), "utf8");

describe("timetable curriculum ownership repair", () => {
  it("uses the existing institution-table owner instead of assuming a deployment role name", () => {
    expect(migration).toContain("'public.students'::regclass");
    expect(migration).toContain("ALTER TABLE public.curriculum_subject_targets OWNER TO %I");
    expect(migration).toContain("ALTER FUNCTION public.validate_curriculum_subject_target_scope() OWNER TO %I");
    expect(migration).not.toMatch(/OWNER TO (postgres|omnischool|service_role)/);
  });

  it("retains RLS and denies direct browser access without widening grants", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(migration).toContain(`REVOKE ALL ON TABLE public.curriculum_subject_targets FROM ${role}`);
    }
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY|SECURITY DEFINER|GRANT ALL/i);
  });
});
