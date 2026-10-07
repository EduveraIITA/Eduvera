import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(new URL("../migrations/051_work_type_origin_integrity.sql", import.meta.url), "utf8");

describe("work type origin integrity migration", () => {
  it("requires institute work types to clone a same-institution built-in workflow", () => {
    expect(migration).toContain("NEW.cloned_from_type_id IS NULL");
    expect(migration).toContain("school_id=NEW.school_id");
    expect(migration).toContain("source_kind='system'");
  });

  it("keeps origin and access policy immutable", () => {
    expect(migration).toContain("Work type origin is immutable");
    expect(migration).toContain("NEW.capability_permissions IS DISTINCT FROM base.capability_permissions");
    expect(migration).toContain("NEW.scope_kind IS DISTINCT FROM base.scope_kind");
  });
});
