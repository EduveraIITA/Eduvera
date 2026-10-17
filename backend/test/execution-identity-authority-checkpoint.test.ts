import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/128_execution_identity_authority_checkpoint.sql", import.meta.url),
  "utf8",
);
const core = readFileSync(
  new URL("../src/campus-model-core/campus-model-core.service.ts", import.meta.url),
  "utf8",
);
const moduleSource = readFileSync(
  new URL("../src/campus-model-core/campus-model-core.module.ts", import.meta.url),
  "utf8",
);

describe("execution identity, authority and projection isolation", () => {
  it("seals versioned configuration separately inside an execution namespace", () => {
    expect(migration).toContain("CREATE TABLE campus_model_execution_snapshots");
    expect(migration).toContain("CREATE TABLE campus_model_execution_snapshot_items");
    expect(migration).toContain("UNIQUE(realm_id,environment_namespace_id,source_snapshot_ref)");
    expect(migration).toContain("Sealed execution snapshots and authority evidence are immutable");
    expect(core).toContain("A Simulation run must seal its exact server-selected source snapshot.");
    expect(core).toContain("source_snapshot_ref !== environment.source_snapshot_ref");
  });

  it("keeps the real human agent distinct from an environment-local simulation actor", () => {
    expect(migration).toContain("CREATE TABLE campus_model_execution_actor_bindings");
    expect(migration).toContain("'live_agent','simulation_counterpart','delegate'");
    expect(migration).toContain("A Live agent cannot act inside a Simulation namespace");
    expect(migration).toContain("FOREIGN KEY(source_agent_id,school_id) REFERENCES campus_model_agents");
    expect(core).toContain("A Live human agent cannot be installed as the actor inside Simulation.");
  });

  it("uses captured authority in Simulation and current effective authority in Live", () => {
    expect(migration).toContain("CREATE TABLE campus_model_authority_snapshot_grants");
    expect(migration).toContain("CREATE TABLE campus_model_authority_receipts");
    expect(core).toContain("selectedEnvironment?.kind === \"simulation\"");
    expect(core).toContain("FROM campus_model_authority_snapshot_grants");
    expect(core).toContain("FROM campus_model_agent_authorities authority");
    expect(core).toContain("execution_snapshot_or_actor_binding_missing");
  });

  it("binds an accepted command to an allowed receipt in the same address and trace", () => {
    expect(migration).toContain("campus_model_commands_authority_receipt_address_fk");
    expect(core).toContain("receipt.correlation_id !== input.correlation_id");
    expect(core).toContain("receipt.decision !== \"allowed\"");
    expect(core).toContain("authority_receipt_id,operating_rule_version_ref");
  });

  it("stores projection progress per realm, environment and consumer", () => {
    expect(migration).toContain("CREATE TABLE campus_model_environment_projection_checkpoints");
    expect(migration).toContain("PRIMARY KEY(realm_id,environment_namespace_id,consumer)");
    expect(core).toContain("A projection checkpoint cannot move backwards.");
  });

  it("publishes all three boundaries as injectable model-core ports", () => {
    for (const port of [
      "AUTHORITY_EVALUATION_PORT",
      "PROJECTION_CHECKPOINT_PORT",
      "EXECUTION_SNAPSHOT_PORT",
    ]) {
      expect(moduleSource).toContain(`provide: ${port}`);
      expect(moduleSource).toContain(`    ${port},`);
    }
  });
});
