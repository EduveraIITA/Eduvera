import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cancelledScheduleSubstitutionOutboxEvidence,
  cancelledScheduleSubstitutionProjectionSchema,
  cancelledScheduleSubstitutionSuccessorAssignment,
} from "../src/campus-model-core/contracts.js";

const core = readFileSync(
  resolve(process.cwd(), "src/campus-model-core/campus-model-core.service.ts"),
  "utf8",
);
const projection = core.slice(
  core.indexOf("async recordCancelledScheduleSubstitution"),
  core.indexOf("async resolveAt"),
);
const closureProjection = core.slice(
  core.indexOf("async recordCalendarClosure"),
  core.indexOf("async recordPublishedDayPlan"),
);
const migration = readFileSync(
  resolve(process.cwd(), "migrations/114_campus_model_substitution_cancellation_lineage.sql"),
  "utf8",
);

const ids = {
  school: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  original: "10000000-0000-4000-8000-000000000003",
  replacement: "10000000-0000-4000-8000-000000000004",
  substitution: "10000000-0000-4000-8000-000000000005",
  task: "10000000-0000-4000-8000-000000000006",
  outbox: "10000000-0000-4000-8000-000000000007",
  source: "10000000-0000-4000-8000-000000000008",
  correlation: "10000000-0000-4000-8000-000000000009",
};

function cancellationInput() {
  return {
    school_id: ids.school,
    actor_user_id: ids.actor,
    substitution_id: ids.substitution,
    coverage_task_id: ids.task,
    coverage_task_revision: 5,
    source_outbox_event_id: ids.outbox,
    occurrence_key: "b".repeat(64),
    reason: "replacement_unavailable" as const,
    source_kind: "published_timetable" as const,
    source_record_id: ids.source,
    source_revision: 2,
    source_version: null,
    original_teacher_user_id: ids.original,
    replacement_teacher_user_id: ids.replacement,
    cancelled_at: "2026-10-16T08:45:00+05:30",
    correlation_id: ids.correlation,
  };
}

describe("cancelled timetable substitution temporal contract", () => {
  it("binds cancellation to the exact authoritative task revision and source identity", () => {
    const input = cancelledScheduleSubstitutionProjectionSchema.parse(cancellationInput());
    expect(cancelledScheduleSubstitutionOutboxEvidence(input)).toEqual({
      school_id: ids.school,
      status: "cancelled",
      revision: 5,
      substitution_id: ids.substitution,
      occurrence_key: "b".repeat(64),
      reason: "replacement_unavailable",
      source_kind: "published_timetable",
      source_record_id: ids.source,
      source_revision: 2,
      source_version: null,
      original_teacher_user_id: ids.original,
      replacement_teacher_user_id: ids.replacement,
      effective_timetable: false,
    });
    expect(projection).toContain("event_type='staff.coverage.cancelled'");
    expect(projection).toContain("aggregate_type='staff_coverage_task'");
    expect(projection).toContain(
      "payload @> ${JSON.stringify(authoritativeOutboxEvidence)}::jsonb",
    );
  });

  it("keeps dated-plan version identity strict", () => {
    expect(() => cancelledScheduleSubstitutionProjectionSchema.parse({
      ...cancellationInput(),
      source_kind: "daily_plan",
    })).toThrow(/published plan version/i);
    expect(cancelledScheduleSubstitutionProjectionSchema.parse({
      ...cancellationInput(),
      source_kind: "daily_plan",
      source_version: 3,
    }).source_version).toBe(3);
  });

  it("appends a causally linked cancellation decision", () => {
    expect(projection).toContain("event_kind='decision'");
    expect(projection).toContain("event_type='timetable.substitution_effective'");
    expect(projection).toContain("'decision','timetable.substitution_cancelled'");
    expect(projection).toContain("${accepted.id}::uuid");
    expect(projection).toContain("accepted_event_id: accepted.id");
    expect(projection).toContain("source_revision<${input.coverage_task_revision}");
  });

  it("requires only the cancellation actor to remain active", () => {
    expect(projection.match(/ensureHumanAgent/g)).toHaveLength(1);
    expect(projection).toContain(
      "this.ensureHumanAgent(transaction, input.school_id, input.actor_user_id)",
    );
    expect(projection).toContain("JOIN campus_model_agents original_agent");
    expect(projection).toContain("JOIN campus_model_agents replacement_agent");
    expect(projection).toContain(
      "original_agent.id=(accepted_event.payload->>'original_teacher_agent_id')::uuid",
    );
    expect(projection).toContain(
      "replacement_agent.id=(accepted_event.payload->>'replacement_teacher_agent_id')::uuid",
    );
    expect(projection).not.toContain("replacement_agent.status='active'");
    expect(projection).not.toContain("original_agent.status='active'");
  });

  it("selects the successor assignment from the cancellation reason", () => {
    expect(cancelledScheduleSubstitutionSuccessorAssignment("coverage_obligation_changed"))
      .toBe("original_teacher");
    expect(cancelledScheduleSubstitutionSuccessorAssignment("replacement_unavailable"))
      .toBe("unassigned");
    expect(cancelledScheduleSubstitutionSuccessorAssignment("source_changed"))
      .toBe("unchanged_later_source");
  });

  it("leaves a later timetable, day-plan or closure projection untouched", () => {
    const replacedBranch = projection.slice(
      projection.indexOf("if (!current || current.change_event_id !== accepted.id)"),
      projection.indexOf('if (successorAssignment === "unchanged_later_source"'),
    );
    expect(replacedBranch).toContain('projection_status: "source_replaced"');
    expect(replacedBranch).toContain('successor_assignment: "unchanged_later_source"');
    expect(replacedBranch).not.toContain("UPDATE campus_model_schedule_occurrences");
    expect(projection.indexOf('projection_status: "source_replaced"'))
      .toBeLessThan(projection.indexOf("WITH closed AS"));
  });

  it("fails closed when the accepted occurrence lineage does not match", () => {
    const mismatchStart = projection.indexOf(
      'if (successorAssignment === "unchanged_later_source"',
    );
    const mismatchBranch = projection.slice(
      mismatchStart,
      projection.indexOf("const successor = await", mismatchStart),
    );
    expect(mismatchBranch).toContain(
      "current.responsible_agent_id !== accepted.replacement_teacher_agent_id",
    );
    expect(mismatchBranch).toContain("current.basis_source_record_id !== input.source_record_id");
    expect(mismatchBranch).toContain('projection_status: "source_mismatch"');
    expect(mismatchBranch).toContain("successor_assignment: null");
    expect(mismatchBranch).not.toContain("UPDATE campus_model_schedule_occurrences");
  });

  it("appends either the retained original agent or an explicitly unassigned successor", () => {
    expect(migration).toContain("'substitution_cancelled'");
    expect(projection).toContain("recorded_until=GREATEST");
    expect(projection).toContain("AND occurrence.change_event_id=${accepted.id}::uuid");
    expect(projection).toContain(
      'const expectedSuccessorAgentId = successorAssignment === "original_teacher"',
    );
    expect(projection).toContain("${expectedSuccessorAgentId}::uuid");
    expect(projection).toContain('projection_status: "applied_original_teacher"');
    expect(projection).toContain('projection_status: "applied_unassigned"');
    expect(projection).toContain("closed.id,'substitution_cancelled'");
    expect(projection).not.toContain("DELETE FROM campus_model_schedule_occurrences");
  });

  it("replays the reason-specific successor from immutable history", () => {
    const replayStart = projection.indexOf("const priorSuccessor");
    const replayBranch = projection.slice(
      replayStart,
      projection.indexOf("const current", replayStart),
    );
    expect(replayBranch).toContain("change_event_id=${event.id}::uuid");
    expect(replayBranch).toContain("change_kind='substitution_cancelled'");
    expect(replayBranch).not.toContain("recorded_until IS NULL");
    expect(replayBranch).toContain("priorSuccessor.responsible_agent_id !== expectedSuccessorAgentId");
    expect(replayBranch).toContain("return appliedReceipt(1, !inserted)");
  });

  it("does not resurrect a cancelled substitute when a later closure is removed", () => {
    expect(closureProjection).toContain("basis_change.id=closed.basis_event_id");
    expect(closureProjection).toContain(
      "accepted.payload->>'occurrence_key'=closed.logical_occurrence_key",
    );
    expect(closureProjection).toContain(
      "accepted.payload->>'source_record_id'=basis_change.source_record_id",
    );
    expect(closureProjection).toContain(
      "accepted.payload->>'source_revision'=basis_change.source_revision::text",
    );
    expect(closureProjection).toContain(
      "cancelled.event_type='timetable.substitution_cancelled'",
    );
    expect(closureProjection).toContain(
      "cancelled.causation_event_id=accepted_change.id",
    );
    expect(closureProjection).toContain(
      "cancelled.journal_sequence>accepted_change.journal_sequence",
    );
    expect(closureProjection).toContain(
      "cancellation.payload->>'successor_assignment'='original_teacher'",
    );
    expect(closureProjection).toContain(
      "(accepted_change.payload->>'original_teacher_agent_id')::uuid",
    );
    expect(closureProjection).toContain(
      "(accepted_change.payload->>'replacement_teacher_agent_id')::uuid",
    );
    expect(closureProjection).toMatch(
      /WHEN \$\{input\.action\}='removed' AND cancellation\.id IS NOT NULL\s+THEN NULL::uuid/,
    );
  });
});
