import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/127_execution_trace_model_address.sql", import.meta.url),
  "utf8",
);
const core = readFileSync(
  new URL("../src/campus-model-core/campus-model-core.service.ts", import.meta.url),
  "utf8",
);

describe("environment-qualified execution trace", () => {
  it("addresses the complete event-to-message chain", () => {
    for (const table of [
      "campus_model_events",
      "campus_model_schedule_occurrences",
      "campus_model_reactions",
      "campus_model_coordination_exceptions",
      "campus_model_operational_messages",
      "campus_model_operational_message_outcomes",
    ]) {
      expect(migration).toContain(`ALTER TABLE ${table}`);
    }
  });

  it("requires children and causal links to remain inside one ModelAddress", () => {
    expect(migration).toContain("campus_model_events_causation_address_fk");
    expect(migration).toContain("campus_model_occurrences_source_event_address_fk");
    expect(migration).toContain("campus_model_reactions_trigger_address_fk");
    expect(migration).toContain("campus_model_messages_reaction_address_fk");
    expect(migration).toContain("campus_model_message_outcomes_message_address_fk");
    expect(migration).toContain("Execution record cannot cross a ModelAddress boundary");
  });

  it("uses environment-local replay keys for events, reactions and outcomes", () => {
    expect(migration).toContain("campus_model_events_address_idempotency_unique");
    expect(migration).toContain("campus_model_reactions_address_idempotency_unique");
    expect(migration).toContain("campus_model_message_outcomes_address_idempotency_unique");
    expect(core).not.toContain("ON CONFLICT(school_id,idempotency_key)");
    expect(core.match(/ON CONFLICT\(realm_id,environment_namespace_id,idempotency_key\)/g)?.length)
      .toBeGreaterThanOrEqual(7);
  });

  it("prevents execution addresses from being rewritten after insertion", () => {
    expect(migration).toContain("Execution ModelAddress is immutable");
    expect(migration.match(/EXECUTE FUNCTION inherit_campus_model_execution_address/g)?.length)
      .toBe(6);
  });
});
