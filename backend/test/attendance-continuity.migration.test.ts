import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../migrations/030_attendance_continuity.sql", import.meta.url));
const provenanceMigrationPath = fileURLToPath(new URL("../migrations/031_attendance_snapshot_provenance.sql", import.meta.url));

describe("attendance continuity migration", () => {
  it("separates immutable observations from accepted attendance facts", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE attendance_capture_batches");
    expect(sql).toContain("CREATE TABLE attendance_observations");
    expect(sql).toContain("CREATE TABLE attendance_reconciliation_cases");
    expect(sql).toContain("status IN ('pending','accepted','quarantined','rejected')");
    expect(sql).toContain("prevent_attendance_observation_mutation");
    expect(sql).toContain("Attendance observations are append-only");
  });

  it("binds captures to tenant, roster revision, source and expiry", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const provenance = await readFile(provenanceMigrationPath, "utf8");

    expect(sql).toContain("roster_fingerprint char(64)");
    expect(sql).toContain("expected_register_revision integer NOT NULL");
    expect(sql).toContain("roster_expires_at timestamptz NOT NULL");
    expect(sql).toContain("validate_attendance_capture_scope");
    expect(sql).toContain("batch_row.id IS NULL");
    expect(sql).toContain("source_requires_review");
    expect(sql).toContain("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC");
    expect(provenance).toContain("roster_captured_at timestamptz");
    expect(provenance).toContain("ALTER COLUMN roster_captured_at SET NOT NULL");
  });
});
