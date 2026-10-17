import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "kysely";
import { AssessmentModelBridgeService, type ExamSittingModelSnapshot } from "../src/assessments/assessment-model-bridge.service.js";
import type { CampusModelCorePort } from "../src/campus-model-core/campus-model-core.port.js";
import type { Database } from "../src/database/types.js";

const snapshot: ExamSittingModelSnapshot = {
  schoolId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  assessmentId: "33333333-3333-4333-8333-333333333333",
  sittingId: "44444444-4444-4444-8444-444444444444",
  title: "English mid-term examination",
  classLabel: "Class 7A",
  subjectLabel: "English",
  state: "ready",
  scheduledStart: "2026-10-19T03:30:00.000Z",
  scheduledEnd: "2026-10-19T05:00:00.000Z",
  expectedCount: 27,
  sittingRevision: 2,
  policyRevision: 4,
  space: { id: "55555555-5555-4555-8555-555555555555", name: "Examination Hall", kind: "auditorium", revision: 3 },
};

function command() {
  return {
    idempotencyKey: "exam-plan-44444444",
    correlationId: "66666666-6666-4666-8666-666666666666",
    expectedRevision: 1,
  };
}

describe("assessment model bridge", () => {
  it("records a room-bound examination expectation without claiming observed presence", async () => {
    const recordAcceptedChange = vi.fn().mockResolvedValue({ command_id: "command", target_entity_id: "entity", actor_agent_id: "agent", relationship_ids: ["relationship"] });
    const service = new AssessmentModelBridgeService({ recordAcceptedChange } as unknown as CampusModelCorePort);
    await service.recordPlan({} as Transaction<Database>, snapshot, command());
    const input = recordAcceptedChange.mock.calls[0]![1];
    expect(input).toMatchObject({
      command_type: "examination.sitting.plan",
      source_domain: "assessments",
      operating_rule_version_ref: "assessment_operation_policy:4",
      target: { domain: "assessments", domain_id: snapshot.sittingId },
      outcome: { code: "exam_sitting_ready", resulting_revision: 2 },
    });
    expect(input.relationships).toEqual([expect.objectContaining({
      relation_type: "scheduled_in",
      effective_from: snapshot.scheduledStart,
      effective_until: snapshot.scheduledEnd,
      metadata: expect.objectContaining({ assessment_id: snapshot.assessmentId, expected_count: 27 }),
    })]);
    expect(input.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "space",
        domain: "campus_topology",
        domain_id: snapshot.space.id,
        metadata: { space_kind: "auditorium" },
      }),
    ]));
  });

  it("keeps candidate attendance separate from academic results", async () => {
    const recordAcceptedChange = vi.fn().mockResolvedValue({});
    const service = new AssessmentModelBridgeService({ recordAcceptedChange } as unknown as CampusModelCorePort);
    await service.recordAttendance({} as Transaction<Database>, { ...snapshot, state: "in_progress", sittingRevision: 3 }, {
      ...command(), expectedRevision: 2, recordedCount: 26, outstandingCount: 1,
    });
    const input = recordAcceptedChange.mock.calls[0]![1];
    expect(input.command_type).toBe("examination.attendance.record");
    expect(input.safe_context).toMatchObject({ recorded_count: 26, outstanding_count: 1 });
    expect(JSON.stringify(input)).not.toMatch(/assessment_results|marks|grade/);
  });

  it("uses stable action outcome codes", async () => {
    const recordAcceptedChange = vi.fn().mockResolvedValue({});
    const service = new AssessmentModelBridgeService({ recordAcceptedChange } as unknown as CampusModelCorePort);
    await service.recordAction({} as Transaction<Database>, { ...snapshot, state: "completed", sittingRevision: 5 }, {
      ...command(),
      action: "complete",
      explanation: "The invigilator completed the sitting.",
    });
    expect(recordAcceptedChange.mock.calls[0]![1].outcome.code).toBe("exam_sitting_completed");
  });
});
