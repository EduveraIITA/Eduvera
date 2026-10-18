import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");

describe("current-system migration convergence", () => {
  it("reuses the prior Stage visitor-photo schema without weakening its checks", async () => {
    const sql = await migration("100_gate_visitor_photos.sql");
    for (const column of ["photo_key", "photo_type", "photo_hash", "category"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(sql).toContain("conname = 'gate_visitor_photo_complete'");
    expect(sql).toContain("conname = 'gate_direct_visit_state'");
  });

  it("reuses the prior Stage staff-movement tables and indexes", async () => {
    const sql = await migration("101_gate_staff_movements.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS gate_staff_events");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS gate_staff_school_time_idx");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS gate_staff_profile_time_idx");
  });

  it("keeps historical model command references but makes them optional", async () => {
    const sql = await migration("102_organization_hierarchy.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS organization_structure_revisions");
    expect(sql).toContain("column_name = 'command_id'");
    expect(sql).toContain("ALTER COLUMN command_id DROP NOT NULL");
  });
});
