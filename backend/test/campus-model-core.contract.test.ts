import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptedCampusModelChangeSchema, campusModelRelationshipSchema } from "../src/campus-model-core/contracts.js";

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

  it("keeps model-core persistence out of the campus-topology feature", () => {
    const source = readFileSync(new URL("../src/institution-setup/institution-setup.service.ts", import.meta.url), "utf8");
    expect(source).toContain("CAMPUS_MODEL_CORE_PORT");
    expect(source).not.toMatch(/(?:selectFrom|insertInto|updateTable)\(["']campus_model_/);
  });
});
