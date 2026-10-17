import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptedScheduleSubstitutionOutboxEvidence,
  acceptedScheduleSubstitutionProjectionSchema,
} from "../src/campus-model-core/contracts.js";

const core = readFileSync(
  resolve(process.cwd(), "src/campus-model-core/campus-model-core.service.ts"),
  "utf8",
);
const projection = core.slice(
  core.indexOf("async recordAcceptedScheduleSubstitution"),
  core.indexOf("async resolveAt"),
);

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  actor: "00000000-0000-4000-8000-000000000002",
  original: "00000000-0000-4000-8000-000000000003",
  substitution: "00000000-0000-4000-8000-000000000004",
  task: "00000000-0000-4000-8000-000000000005",
  outbox: "00000000-0000-4000-8000-000000000006",
  schedule: "00000000-0000-4000-8000-000000000007",
  period: "00000000-0000-4000-8000-000000000008",
  classSection: "00000000-0000-4000-8000-000000000009",
  correlation: "00000000-0000-4000-8000-000000000010",
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

function publishedInput() {
  return {
    school_id: ids.school,
    actor_user_id: ids.actor,
    substitution_id: ids.substitution,
    coverage_task_id: ids.task,
    coverage_task_revision: 4,
    source_outbox_event_id: ids.outbox,
    occurrence_key: "a".repeat(64),
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
    duty_date: "2026-10-16",
    period_number: 1,
    starts_at: "09:00",
    ends_at: "09:45",
    title: "Mathematics",
    slot_type: "class" as const,
    room_snapshot: "Room 201",
    original_teacher_user_id: ids.original,
    replacement_teacher_user_id: ids.actor,
    accepted_at: "2026-10-16T08:30:00+05:30",
    correlation_id: ids.correlation,
  };
}

describe("accepted timetable substitution temporal contract", () => {
  it("binds the accepted actor and source snapshots to one exact occurrence", () => {
    expect(acceptedScheduleSubstitutionProjectionSchema.parse(publishedInput())).toMatchObject({
      actor_user_id: ids.actor,
      replacement_teacher_user_id: ids.actor,
      source_kind: "published_timetable",
      source_record_id: ids.schedule,
      source_schedule_id: ids.period,
    });
    expect(() => acceptedScheduleSubstitutionProjectionSchema.parse({
      ...publishedInput(),
      actor_user_id: ids.original,
    })).toThrow(/replacement teacher/i);
  });

  it("matches the exact accepted decision, revision and substitution outbox evidence", () => {
    const input = acceptedScheduleSubstitutionProjectionSchema.parse(publishedInput());
    expect(acceptedScheduleSubstitutionOutboxEvidence(input)).toEqual({
      school_id: ids.school,
      status: "accepted",
      revision: 4,
      substitution_id: ids.substitution,
      effective_timetable: true,
      occurrence_key: "a".repeat(64),
      source_kind: "published_timetable",
      source_record_id: ids.schedule,
      source_revision: 2,
      source_version: null,
      source_schedule_id: ids.period,
      original_teacher_user_id: ids.original,
      replacement_teacher_user_id: ids.actor,
    });
    expect(projection).toContain(
      "payload @> ${JSON.stringify(authoritativeOutboxEvidence)}::jsonb",
    );
    expect(projection).toContain(
      "The accepted cover does not match its authoritative domain event.",
    );
  });

  it("requires versioned entity identities for dated plans and legacy backfill", () => {
    const daily = {
      ...publishedInput(),
      source_kind: "daily_plan" as const,
      source_version: 3,
      schedule: entity("schedule", "day_plan", `${ids.schedule}:3`, "Class 6A plan"),
      period: entity("schedule_period", "day_plan", `${ids.period}:3`, "Mathematics"),
    };
    expect(acceptedScheduleSubstitutionProjectionSchema.parse(daily).source_version).toBe(3);
    expect(() => acceptedScheduleSubstitutionProjectionSchema.parse({
      ...daily,
      source_version: null,
    })).toThrow(/published plan version/i);

    const legacy = {
      ...publishedInput(),
      source_kind: "legacy_timetable" as const,
      source_record_id: ids.period,
      schedule: entity(
        "schedule",
        "timetable",
        `legacy:${ids.period}:2026-10-16`,
        "Class 6A legacy timetable",
      ),
    };
    expect(acceptedScheduleSubstitutionProjectionSchema.parse(legacy).source_kind)
      .toBe("legacy_timetable");
  });

  it("records the accepted cover as a decision and rejects mismatched source lineage", () => {
    expect(projection).toContain("event_type='staff.coverage.accepted'");
    expect(projection).toContain("'decision','timetable.substitution_effective'");
    expect(projection).toContain("...authoritativeOutboxEvidence");
    expect(projection).toContain("coverage_task_id: input.coverage_task_id");
    expect(projection).toContain("AS source_matches");
    expect(projection.indexOf('projection_status: "source_mismatch"'))
      .toBeLessThan(projection.indexOf("WITH closed AS"));
  });

  it("does not resurrect a closed occurrence and retains append-only history", () => {
    expect(projection).toContain("'timetable.schedule_projection_backfilled'");
    expect(projection).toContain("import_reason: \"missing_temporal_occurrence\"");
    expect(projection).toContain("if (!sourceHasHistory)");
    expect(projection).toContain(
      'projection_status: sourceHasHistory ? "source_closed" : "awaiting_source_projection"',
    );
    expect(projection).toContain("recorded_until=GREATEST");
    expect(projection).toContain("closed.id,'substituted'");
    expect(projection).not.toContain("DELETE FROM campus_model_schedule_occurrences");
  });

  it("replays an already appended substitution without requiring it to remain current", () => {
    const replayStart = projection.indexOf("const priorReplacement");
    const replayQuery = projection.slice(
      replayStart,
      projection.indexOf("if (!current)", replayStart),
    );
    expect(replayQuery).toContain("change_event_id=${event.id}::uuid");
    expect(replayQuery).not.toContain("recorded_until IS NULL");
    expect(replayQuery).toContain('projection_status: "applied"');
    expect(replayQuery).toContain("replayed: !inserted");
  });
});
