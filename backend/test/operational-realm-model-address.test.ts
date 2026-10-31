import { describe, expect, it } from "vitest";
import { campusModelObservationSchema } from "../src/campus-model-core/contracts.js";
import {
  createLiveExecutionEnvironment,
  createSimulationExecutionEnvironment,
} from "../src/campus-model-core/execution-environment.runtime.js";
import type { ExecutionClock, SimulationVirtualClock } from "../src/campus-model-core/execution-environment.contracts.js";
import {
  executionNamespaceForSchool,
  modelAddressSchema,
} from "../src/campus-model-core/operational-realm.js";

const schoolId = "00000000-0000-4000-8000-000000000001";
const realmId = "00000000-0000-4000-8000-000000000002";
const modelId = "00000000-0000-4000-8000-000000000003";
const instant = "2026-10-17T06:30:00.000Z";
const clock: ExecutionClock = { now: () => new Date(instant), nowIso: () => instant };
const virtualClock: SimulationVirtualClock = {
  ...clock,
  advanceBy: () => instant,
  advanceTo: () => instant,
};

function observation() {
  return {
    school_id: schoolId,
    actor_user_id: "00000000-0000-4000-8000-000000000004",
    kind: "attendance.status_observed",
    subject: { kind: "student", domain: "people", domain_id: "student-1", label: "Student", lifecycle_state: "active", source_revision: 1 },
    context: { kind: "class", domain: "academic_structure", domain_id: "class-1", label: "Class", lifecycle_state: "active", source_revision: 1 },
    source_type: "attendance.session",
    source_ref: "register-1",
    source_record_id: "record-1",
    observed_at: instant,
    received_at: instant,
    state: "accepted",
    idempotency_key: "attendance-model:record-1",
    contract_refs: {
      subject_type: { namespace: "thatcampus.people", type_key: "student", version: 1 },
      context_type: { namespace: "thatcampus.academic_structure", type_key: "class", version: 1 },
      observation_schema: { namespace: "thatcampus.attendance", schema_key: "attendance.status_observed", version: 1 },
      capability_manifest: { namespace: "thatcampus.attendance", capability_key: "attendance", version: 1 },
    },
  };
}

describe("OperationalRealm model addressing", () => {
  it("requires model identity to include both realm and environment namespace", () => {
    expect(modelAddressSchema.parse({
      realm_id: realmId,
      environment_namespace_id: `live:${schoolId}`,
      model_id: modelId,
    })).toMatchObject({ realm_id: realmId, model_id: modelId });
    expect(modelAddressSchema.safeParse({ realm_id: realmId, model_id: modelId }).success).toBe(false);
  });

  it("keeps Live and Simulation addresses distinct for the same model ID", () => {
    const live = createLiveExecutionEnvironment({ institution_id: schoolId, clock });
    const simulation = createSimulationExecutionEnvironment({
      institution_id: schoolId,
      scenario_id: "scenario-1",
      run_id: "run-1",
      virtual_clock: virtualClock,
      source_snapshot_ref: "snapshot-1",
      coverage_gate: { status: "passed", manifest_ref: "manifest-1", checked_at: instant },
      expires_at: "2026-10-17T07:30:00.000Z",
    });
    expect(executionNamespaceForSchool(schoolId, live)).not.toBe(
      executionNamespaceForSchool(schoolId, simulation),
    );
    expect(() => executionNamespaceForSchool("00000000-0000-4000-8000-000000000099", live))
      .toThrow("another operational realm");
  });

  it("accepts the reviewed Attendance adapter contract references", () => {
    expect(campusModelObservationSchema.parse(observation()).contract_refs)
      .toMatchObject({ capability_manifest: { capability_key: "attendance", version: 1 } });
  });

  it("rejects a semantic contract that does not match the domain entity kind", () => {
    const value = observation();
    value.contract_refs.subject_type.type_key = "teacher";
    expect(campusModelObservationSchema.safeParse(value).success).toBe(false);
  });
});
