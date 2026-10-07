import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(new URL("../migrations/050_work_types_and_direct_assignment_access.sql", import.meta.url), "utf8");

describe("work types and direct assignment access migration", () => {
  it("adds a configurable catalogue without exposing capability policy", () => {
    expect(migration).toContain("ADD COLUMN workflow_family");
    expect(migration).toContain("source_kind IN ('system','institute')");
    expect(migration).toContain("Work type workflow and access policy are immutable");
  });

  it("keeps optimistic concurrency and active-assignment access", () => {
    expect(migration).toContain("NEW.revision := OLD.revision + 1");
    expect(migration).toContain("assignment.status='active'");
    expect(migration).toContain("'fees.manage'=ANY(work_type.capability_permissions)");
    expect(migration).not.toContain("JOIN school_custom_role_duties");
  });
});
