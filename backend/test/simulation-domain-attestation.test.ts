import { describe, expect, it } from "vitest";
import { assertSimulationDomainAttestationBinding } from "../src/campus-model-core/campus-model-core.service.js";
import { attendanceBulkSchema } from "../src/school/school.service.js";

const sourceSnapshotRef = `sha256:${"a".repeat(64)}`;
const binding = {
  execution_actor_id: "00000000-0000-4000-8000-000000000001",
  snapshot_id: "00000000-0000-4000-8000-000000000002",
  actor_mode: "simulation_counterpart",
  source_snapshot_ref: sourceSnapshotRef,
  authority_snapshot_ref: sourceSnapshotRef,
};

describe("Simulation owning-domain authority attestation", () => {
  it("accepts only a counterpart bound to the exact sealed source snapshot", () => {
    expect(assertSimulationDomainAttestationBinding(binding, sourceSnapshotRef))
      .toBe(binding);
    expect(() => assertSimulationDomainAttestationBinding(undefined, sourceSnapshotRef))
      .toThrow(/no active counterpart/iu);
    expect(() => assertSimulationDomainAttestationBinding({
      ...binding,
      source_snapshot_ref: `sha256:${"b".repeat(64)}`,
    }, sourceSnapshotRef)).toThrow(/sealed source snapshot/iu);
    expect(() => assertSimulationDomainAttestationBinding({
      ...binding,
      actor_mode: "live_agent",
    }, sourceSnapshotRef)).toThrow(/active counterpart/iu);
  });

  it("does not expose authority attestation as an attendance HTTP input", () => {
    const result = attendanceBulkSchema.safeParse({
      class_section_id: "00000000-0000-4000-8000-000000000003",
      date: "2026-10-19",
      expected_revision: 0,
      records: [{
        student_id: "00000000-0000-4000-8000-000000000004",
        status: "present",
        remarks: "",
      }],
      authority_attestation: {
        decision: "allowed",
        evaluator_domain: "caller",
      },
    });
    expect(result.success).toBe(false);
  });
});
