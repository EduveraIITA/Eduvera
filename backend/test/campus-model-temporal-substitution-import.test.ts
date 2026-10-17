import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  importedAcceptedScheduleSubstitutionOutboxEvidence,
  importedAcceptedScheduleSubstitutionProjectionSchema,
} from "../src/campus-model-core/contracts.js";

const core = readFileSync(
  resolve(process.cwd(), "src/campus-model-core/campus-model-core.service.ts"),
  "utf8",
);
const importMethod = core.slice(
  core.indexOf("async recordImportedAcceptedScheduleSubstitution"),
  core.indexOf("private async replayAcceptedScheduleSubstitutionIfPresent"),
);
const replayMethod = core.slice(
  core.indexOf("private async replayAcceptedScheduleSubstitutionIfPresent"),
  core.indexOf("private async projectAcceptedScheduleSubstitution"),
);
const projectionMethod = core.slice(
  core.indexOf("private async projectAcceptedScheduleSubstitution"),
  core.indexOf("async recordCancelledScheduleSubstitution"),
);
const retainedIdentityMethod = core.slice(
  core.indexOf("private async requireRetainedHumanAgent"),
  core.indexOf("private async ensureHumanAgent"),
);

const ids = {
  school: "20000000-0000-4000-8000-000000000001",
  accepter: "20000000-0000-4000-8000-000000000002",
  original: "20000000-0000-4000-8000-000000000003",
  importer: "20000000-0000-4000-8000-000000000004",
  substitution: "20000000-0000-4000-8000-000000000005",
  task: "20000000-0000-4000-8000-000000000006",
  outbox: "20000000-0000-4000-8000-000000000007",
  schedule: "20000000-0000-4000-8000-000000000008",
  period: "20000000-0000-4000-8000-000000000009",
  classSection: "20000000-0000-4000-8000-000000000010",
  correlation: "20000000-0000-4000-8000-000000000011",
};

function entity(kind: string, domain: string, domainId: string, label: string, sourceRevision = 2) {
  return {
    kind,
    domain,
    domain_id: domainId,
    label,
    lifecycle_state: "active" as const,
    source_revision: sourceRevision,
    metadata: {},
  };
}

function importedInput() {
  const dutyDate = "2026-10-16";
  const occurrenceKey = createHash("sha256").update([
    ids.school,
    ids.classSection,
    dutyDate,
    "1",
  ].join(":")).digest("hex");
  return {
    school_id: ids.school,
    actor_user_id: ids.accepter,
    substitution_id: ids.substitution,
    coverage_task_id: ids.task,
    coverage_task_revision: 4,
    source_outbox_event_id: ids.outbox,
    occurrence_key: occurrenceKey,
    source_kind: "published_timetable" as const,
    source_schedule_id: ids.period,
    source_record_id: ids.schedule,
    source_revision: 2,
    source_version: null,
    schedule: entity("schedule", "timetable", ids.schedule, "Class 6A timetable"),
    period: entity("schedule_period", "timetable", ids.period, "Mathematics"),
    class_section: entity("class", "academic_structure", ids.classSection, "Class 6A", 1),
    subject: null,
    space: null,
    duty_date: dutyDate,
    period_number: 1,
    starts_at: "09:00",
    ends_at: "09:45",
    title: "Mathematics",
    slot_type: "class" as const,
    room_snapshot: "Room 201",
    original_teacher_user_id: ids.original,
    replacement_teacher_user_id: ids.accepter,
    accepted_at: "2026-10-16T08:30:00+05:30",
    correlation_id: ids.correlation,
    imported_by_user_id: ids.importer,
    imported_at: "2026-10-16T10:30:00+05:30",
    import_reason: "pre_core_projection_backfill" as const,
  };
}

describe("historical accepted-substitution projection import", () => {
  it("uses one strict recovery contract and canonical outbox payload", () => {
    const input = importedAcceptedScheduleSubstitutionProjectionSchema.parse(importedInput());
    expect(importedAcceptedScheduleSubstitutionOutboxEvidence(input)).toEqual({
      school_id: ids.school,
      status: "accepted",
      revision: 4,
      substitution_id: ids.substitution,
      effective_timetable: true,
      occurrence_key: input.occurrence_key,
      source_kind: "published_timetable",
      source_record_id: ids.schedule,
      source_revision: 2,
      source_version: null,
      source_schedule_id: ids.period,
      original_teacher_user_id: ids.original,
      replacement_teacher_user_id: ids.accepter,
      import_reason: "pre_core_projection_backfill",
      imported_at: "2026-10-16T10:30:00+05:30",
    });
    expect(() => importedAcceptedScheduleSubstitutionProjectionSchema.parse({
      ...importedInput(),
      import_reason: "manual_repair",
    })).toThrow();
    expect(() => importedAcceptedScheduleSubstitutionProjectionSchema.parse({
      ...importedInput(),
      unexpected: true,
    })).toThrow();
  });

  it("requires an active importer but resolves historical participants without reviving authority", () => {
    expect(importMethod).toContain(
      "this.ensureHumanAgent(transaction, input.school_id, importedByUserId)",
    );
    expect(importMethod.match(/requireRetainedHumanAgent/g)).toHaveLength(3);
    expect(retainedIdentityMethod).toContain("JOIN school_people person");
    expect(retainedIdentityMethod).toContain("FROM campus_model_agent_endpoints endpoint");
    expect(retainedIdentityMethod).toContain("agent.agent_kind='human'");
    expect(retainedIdentityMethod).not.toContain("endpoint.status=");
    expect(retainedIdentityMethod).not.toContain("agent.status=");
    expect(retainedIdentityMethod).not.toContain("school_memberships");
    expect(retainedIdentityMethod).not.toContain("staff_profiles");
  });

  it("accepts only the exact canonical non-notifying recovery event", () => {
    expect(importMethod).toContain("event_type='staff.coverage.accepted'");
    expect(importMethod).toContain("aggregate_type='staff_coverage_task'");
    expect(importMethod).toContain("staff.coverage.accepted-import");
    expect(importMethod).toContain(
      "payload=${JSON.stringify(authoritativeOutboxEvidence)}::jsonb",
    );
    expect(importMethod).toContain("audience_user_ids=ARRAY[]::uuid[]");
    expect(importMethod).toContain("notification_user_ids=ARRAY[]::uuid[]");
    expect(importMethod).toContain("notification_payload IS NULL");
  });

  it("reuses an exact live decision before requiring a recovery outbox", () => {
    expect(importMethod.indexOf("replayAcceptedScheduleSubstitutionIfPresent"))
      .toBeLessThan(importMethod.indexOf("const authoritativeOutboxEvidence"));
    expect(replayMethod).toContain("event.event_type='timetable.substitution_effective'");
    expect(replayMethod).toContain(
      "event.payload @> ${JSON.stringify(authoritativeIdentity)}::jsonb",
    );
    expect(replayMethod).toContain("occurrence.change_kind='substituted'");
    expect(replayMethod).toContain("existing.replacement_count === 1");
    expect(replayMethod).toContain('projection_status: "applied"');
    expect(replayMethod).toContain('projection_status: "source_mismatch"');
    expect(replayMethod).toContain('"source_closed"');
    expect(replayMethod).toContain('"awaiting_source_projection"');
    expect(replayMethod).toContain(
      "The retained accepted-cover decision contains different timetable evidence.",
    );
  });

  it("uses the same append-only decision path with explicit import provenance", () => {
    expect(importMethod).toContain("return this.projectAcceptedScheduleSubstitution");
    expect(importMethod).toContain('projection_mode: "historical_import"');
    expect(importMethod).toContain("imported_by_agent_id: importer.id");
    expect(importMethod).toContain("accepted_by_agent_id: actor.id");
    expect(projectionMethod).toContain("'decision','timetable.substitution_effective'");
    expect(projectionMethod).toContain("recorded_until=GREATEST");
    expect(projectionMethod).toContain("closed.id,'substituted'");
    expect(importMethod).not.toContain("recordCommand");
    expect(importMethod).not.toContain("publishCoordination");
  });
});
