import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptedCoverageImportPayload } from "../src/staff-operations/staff-coverage-reconciliation.service.js";

const service = readFileSync(
  resolve(process.cwd(), "src/staff-operations/staff-coverage-reconciliation.service.ts"),
  "utf8",
);

const evidence = {
  school_id: "00000000-0000-4000-8000-000000000001",
  substitution_id: "00000000-0000-4000-8000-000000000002",
  coverage_task_revision: 4,
  source_occurrence_key: "a".repeat(64),
  source_kind: "published_timetable" as const,
  source_schedule_id: "00000000-0000-4000-8000-000000000003",
  source_record_id: "00000000-0000-4000-8000-000000000004",
  source_revision: 2,
  source_version: null,
  original_teacher_user_id: "00000000-0000-4000-8000-000000000005",
  replacement_teacher_user_id: "00000000-0000-4000-8000-000000000006",
};

describe("accepted coverage temporal bootstrap bridge", () => {
  it("creates exact accepted evidence without inventing a user command", () => {
    expect(acceptedCoverageImportPayload(
      evidence,
      "2026-10-16T12:00:00.000Z",
    )).toEqual({
      school_id: evidence.school_id,
      status: "accepted",
      revision: 4,
      substitution_id: evidence.substitution_id,
      effective_timetable: true,
      occurrence_key: "a".repeat(64),
      source_kind: "published_timetable",
      source_record_id: evidence.source_record_id,
      source_revision: 2,
      source_version: null,
      source_schedule_id: evidence.source_schedule_id,
      original_teacher_user_id: evidence.original_teacher_user_id,
      replacement_teacher_user_id: evidence.replacement_teacher_user_id,
      import_reason: "pre_core_projection_backfill",
      imported_at: "2026-10-16T12:00:00.000Z",
    });
    const bootstrap = service.slice(
      service.indexOf("async prepareEffectiveCoverageProjection"),
      service.indexOf("async createTasksForApprovedLeave"),
    );
    expect(bootstrap).not.toContain("INSERT INTO staff_coverage_commands");
  });

  it("only imports retained substitutions that have no live command receipt", () => {
    expect(service).toContain("NOT EXISTS(\n          SELECT 1 FROM staff_coverage_commands command");
    expect(service).toContain("command.substitution_id=substitution.id");
    expect(service).toContain("substitution.state='effective' AND task.status='accepted'");
    expect(service).toContain("FOR SHARE OF substitution,task");
  });

  it("retains a non-notifying canonical outbox event and fails closed on mismatch", () => {
    expect(service).toContain("staff.coverage.accepted-import");
    expect(service).toContain("'{}'::uuid[],${JSON.stringify(payload)}::jsonb");
    expect(service).toContain("notification_user_ids='{}'::uuid[]");
    expect(service).toContain("notification_payload IS NULL");
    expect(service).toContain("retained accepted-cover import key belongs to different evidence");
  });

  it("uses planned truth first and retained immutable source evidence only when needed", () => {
    expect(service).toContain("planned_school_schedule_v2(substitution.school_id,substitution.duty_date)");
    expect(service).toContain("WHEN planned.id IS NOT NULL THEN 'planned_schedule'");
    expect(service).toContain("WHEN published_version.id IS NOT NULL OR dated_period.id IS NOT NULL");
    expect(service).toContain("ELSE 'coverage_task'");
    expect(service).toContain("schedule.teacher_user_id=substitution.original_teacher_user_id");
  });

  it("imports before stale rows close and delegates exclusively through the core port", () => {
    const reconcile = service.slice(service.indexOf("async reconcileEffectiveCoverage"));
    expect(reconcile.indexOf("prepareEffectiveCoverageProjection"))
      .toBeLessThan(reconcile.indexOf("reconcile_staff_timetable_substitution_details"));
    expect(service).toContain("async prepareEffectiveCoverageProjection(");
    expect(service).toContain("Promise<CoverageProjectionPreparationReceipt>");
    expect(service).toContain("this.temporal.recordImportedAcceptedScheduleSubstitution");
    expect(service).toContain('projection.projection_status === "source_mismatch"');
    expect(service).not.toContain("INSERT INTO campus_model_events");
    expect(service).not.toContain("INSERT INTO campus_model_schedule_occurrences");
  });
});
