import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acceptedCampusModelChangeSchema,
  campusModelObservationSchema,
  campusModelRelationshipSchema,
  campusTemporalContextQuerySchema,
  publishedScheduleProjectionSchema,
} from "../src/campus-model-core/contracts.js";

const schoolId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const campusId = "00000000-0000-4000-8000-000000000003";
const institutionId = "00000000-0000-4000-8000-000000000004";

describe("Campus Model Core contracts", () => {
  it("accepts a typed topology change without exposing generic graph writes", () => {
    const parsed = acceptedCampusModelChangeSchema.parse({
      school_id: schoolId,
      actor_user_id: actorId,
      command_type: "campus.created",
      target: { domain: "campus_topology", domain_id: campusId },
      idempotency_key: "campus-model:event-1",
      correlation_id: "00000000-0000-4000-8000-000000000005",
      source_domain: "campus_topology",
      entities: [
        { kind: "institution", domain: "institutions", domain_id: institutionId, label: "That Campus", lifecycle_state: "active", source_revision: 1 },
        { kind: "campus", domain: "campus_topology", domain_id: campusId, label: "Main campus", lifecycle_state: "active", source_revision: 1 },
      ],
      relationships: [{
        relation_type: "part_of",
        source: { domain: "campus_topology", domain_id: campusId },
        target: { domain: "institutions", domain_id: institutionId },
        effective_from: "2026-10-16T00:00:00.000Z",
        source_domain: "campus_topology",
        source_record_id: campusId,
        source_revision: 1,
      }],
      outcome: { code: "campus.created", explanation: "The campus was created." },
    });

    expect(parsed.relationships[0]?.relation_type).toBe("part_of");
    expect(parsed.entities).toHaveLength(2);
  });

  it("requires every relationship reference to have a typed snapshot", () => {
    const result = acceptedCampusModelChangeSchema.safeParse({
      school_id: schoolId,
      actor_user_id: actorId,
      command_type: "campus.created",
      target: { domain: "campus_topology", domain_id: campusId },
      idempotency_key: "campus-model:event-2",
      correlation_id: "00000000-0000-4000-8000-000000000006",
      source_domain: "campus_topology",
      entities: [{ kind: "campus", domain: "campus_topology", domain_id: campusId, label: "Main campus", lifecycle_state: "active", source_revision: 1 }],
      relationships: [{
        relation_type: "part_of",
        source: { domain: "campus_topology", domain_id: campusId },
        target: { domain: "institutions", domain_id: institutionId },
        effective_from: "2026-10-16T00:00:00.000Z",
        source_domain: "campus_topology",
        source_record_id: campusId,
        source_revision: 1,
      }],
      outcome: { code: "campus.created", explanation: "The campus was created." },
    });

    expect(result.success).toBe(false);
  });

  it("supports explicitly clearing a current relationship", () => {
    const result = campusModelRelationshipSchema.parse({
      relation_type: "home_space",
      source: { domain: "academic_structure", domain_id: campusId },
      target: null,
      operation: "clear",
      effective_from: "2026-10-16T00:00:00.000Z",
      source_domain: "campus_topology",
      source_record_id: campusId,
      source_revision: 2,
    });

    expect(result.operation).toBe("clear");
    expect(result.target).toBeNull();
  });

  it("accepts source-rich attendance evidence without treating it as domain truth", () => {
    const observation = campusModelObservationSchema.parse({
      school_id: schoolId,
      actor_user_id: actorId,
      kind: "attendance.status_observed",
      subject: { kind: "student", domain: "people", domain_id: institutionId, label: "Aarav Sharma", lifecycle_state: "active", source_revision: 1 },
      context: { kind: "class", domain: "academic_structure", domain_id: campusId, label: "Class 6A", lifecycle_state: "active", source_revision: 2 },
      source_type: "attendance.capture",
      source_ref: "00000000-0000-4000-8000-000000000007",
      source_record_id: "00000000-0000-4000-8000-000000000008",
      observed_at: "2026-10-16T03:30:00.000Z",
      received_at: "2026-10-16T03:31:00.000Z",
      evidence_refs: ["attendance_capture_batch:00000000-0000-4000-8000-000000000007"],
      payload: { attendance_status: "present" },
      state: "pending",
      idempotency_key: "attendance-observation:00000000-0000-4000-8000-000000000008",
    });

    expect(observation.state).toBe("pending");
    expect(observation.source_type).toBe("attendance.capture");
  });

  it("keeps published timetable expectations distinct from observations", () => {
    const schedule = publishedScheduleProjectionSchema.parse({
      school_id: schoolId,
      actor_user_id: actorId,
      schedule_version_id: "00000000-0000-4000-8000-000000000009",
      schedule_revision: 3,
      starts_on: "2026-10-19",
      ends_on: "2026-10-25",
      timezone: "Asia/Kolkata",
      published_at: "2026-10-16T08:30:00.000Z",
      class_section: { kind: "class", domain: "academic_structure", domain_id: campusId, label: "Class 6A", lifecycle_state: "active", source_revision: 1 },
      periods: [{
        period_id: "00000000-0000-4000-8000-000000000010",
        weekday: 1,
        period_number: 1,
        starts_at: "09:00:00",
        ends_at: "09:45:00",
        title: "Mathematics",
        slot_type: "class",
        teacher_user_id: actorId,
        room_snapshot: "Room 201",
      }],
      correlation_id: "00000000-0000-4000-8000-000000000011",
    });

    expect(schedule.periods[0]?.teacher_user_id).toBe(actorId);
    expect(schedule).not.toHaveProperty("observed_at");
  });

  it("requires an explicit subject and as-of instant for temporal resolution", () => {
    const query = campusTemporalContextQuerySchema.parse({
      school_id: schoolId,
      at: "2026-10-19T03:45:00.000Z",
      recorded_as_of: "2026-10-20T03:45:00.000Z",
      subject: { type: "human_agent", user_id: actorId },
    });
    expect(query.subject.type).toBe("human_agent");
    expect(query.at).not.toBe(query.recorded_as_of);
  });

  it("keeps model-core persistence out of the campus-topology feature", () => {
    const source = readFileSync(new URL("../src/institution-setup/institution-setup.service.ts", import.meta.url), "utf8");
    expect(source).toContain("CAMPUS_MODEL_CORE_PORT");
    expect(source).not.toMatch(/(?:selectFrom|insertInto|updateTable)\(["']campus_model_/);
  });

  it("keeps attendance behind the narrow observation ingress port", () => {
    const source = readFileSync(new URL("../src/school/school.service.ts", import.meta.url), "utf8");
    expect(source).toContain("OBSERVATION_INGRESS_PORT");
    expect(source).not.toContain("CAMPUS_MODEL_CORE_PORT");
    expect(source).not.toMatch(/(?:selectFrom|insertInto|updateTable)\(["']campus_model_/);
  });

  it("keeps schedule planning behind the temporal context port", () => {
    const source = readFileSync(new URL("../src/schedule-planning/schedule-planning.service.ts", import.meta.url), "utf8");
    expect(source).toContain("TEMPORAL_CONTEXT_PORT");
    expect(source).not.toMatch(/(?:selectFrom|insertInto|updateTable)\(["']campus_model_/);
  });
});
