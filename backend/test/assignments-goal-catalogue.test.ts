import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Assignments progressive catalogue upgrade", () => {
  it("registers the delivered outcome without manufacturing an appointment, authority or Finance first use", () => {
    const migration = readFileSync(new URL("../migrations/187_assignments_progressive_goal.sql", import.meta.url), "utf8");
    expect(migration).toContain("INSERT INTO progressive_onboarding_goal_catalog");
    expect(migration).toContain("'assignments','Assignments'");
    expect(migration).toContain("'/more/setup/capabilities?task=assignments'");
    expect(migration).not.toMatch(/\b(?:GRANT|CREATE TABLE|ALTER TABLE|staff_role|teaching_assignments|mandate|fees)\b/i);
    expect(migration).toContain("ON CONFLICT (goal_key) DO UPDATE");
  });
});
