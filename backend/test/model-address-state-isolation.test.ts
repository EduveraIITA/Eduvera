import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/126_model_relationship_command_address.sql", import.meta.url),
  "utf8",
);
const core = readFileSync(
  new URL("../src/campus-model-core/campus-model-core.service.ts", import.meta.url),
  "utf8",
);

describe("ModelAddress state isolation", () => {
  it("binds relationship endpoints and command targets to one realm/environment", () => {
    expect(migration).toContain("campus_model_relationships_source_address_fk");
    expect(migration).toContain("campus_model_relationships_target_address_fk");
    expect(migration).toContain("campus_model_commands_target_address_fk");
    expect(migration).toContain("campus_model_command_outcomes_result_address_fk");
  });

  it("scopes mutable relationship and command idempotency to ModelAddress", () => {
    expect(migration).toContain("UNIQUE(realm_id,environment_namespace_id,relation_type");
    expect(migration).toContain("UNIQUE(realm_id,environment_namespace_id,idempotency_key)");
    expect(core).toContain("ON CONFLICT(realm_id,environment_namespace_id,relation_type");
    expect(core).toContain("ON CONFLICT(realm_id,environment_namespace_id,idempotency_key)");
  });

  it("uses the server-resolved namespace rather than adapter input", () => {
    expect(core).toContain("const modelScope = await this.resolveScope(transaction, input.school_id)");
    expect(core).toContain("${modelScope.environment_namespace_id}");
  });
});
