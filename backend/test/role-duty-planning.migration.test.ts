import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(new URL("../migrations/045_role_duty_planning.sql", import.meta.url), "utf8");

describe("role duty planning migration", () => {
  it("stores role duties separately from access permissions", () => {
    expect(migration).toContain("CREATE TABLE school_custom_role_duties");
    expect(migration).toContain("recommended_permissions");
    expect(migration).not.toContain("required_permissions");
  });

  it("treats transport attendant as a first-class duty and protects the relation", () => {
    expect(migration).toContain("'transport_attendant','Transport attendant'");
    expect(migration).toContain("ARRAY['departure.collect']::text[]");
    expect(migration).toContain("ALTER TABLE school_custom_role_duties ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE school_custom_role_duties FROM PUBLIC");
  });
});
