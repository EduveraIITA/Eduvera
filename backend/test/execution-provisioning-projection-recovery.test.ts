import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL(
  "../migrations/129_execution_provisioning_projection_recovery.sql",
  import.meta.url,
), "utf8");
const service = readFileSync(new URL(
  "../src/campus-model-core/execution-provisioning.service.ts",
  import.meta.url,
), "utf8");
const moduleSource = readFileSync(new URL(
  "../src/campus-model-core/campus-model-core.module.ts",
  import.meta.url,
), "utf8");

describe("execution provisioning and projection recovery", () => {
  it("uses versioned domain adapters rather than teaching the Core domain tables", () => {
    expect(migration).toContain("CREATE TABLE model_snapshot_adapter_definitions");
    expect(migration).toContain("CREATE TABLE realm_snapshot_adapter_activations");
    expect(migration).toContain("capability_manifest_id");
    expect(migration).toContain("Publish a new snapshot adapter version");
    expect(service).toContain("realm_model_contract_activations contract");
  });

  it("freezes the exact expected adapter coverage before capture", () => {
    expect(migration).toContain("CREATE TABLE campus_model_snapshot_expected_adapters");
    expect(migration).toContain("CREATE TABLE campus_model_snapshot_contributions");
    expect(service).toContain("Snapshot coverage is ambiguous for:");
    expect(service).toContain("This adapter is not part of the sealed snapshot coverage plan.");
    expect(service).toContain("missingModules.length ? \"blocked\" : \"collecting\"");
  });

  it("retains content, privacy and schema evidence for capture and restore", () => {
    for (const evidence of [
      "artifact_hash",
      "source_revision_watermark",
      "privacy_transform_ref",
      "capture_schema_version",
      "restore_schema_version",
      "manifest_hash",
    ]) expect(migration).toContain(evidence);
    expect(service).toContain("Every captured adapter must restore successfully before Simulation can become ready.");
    expect(service).toContain("does not match a captured adapter artifact");
  });

  it("requires environment-local authority for capture and recovery", () => {
    expect(service).toContain("model.snapshot.provision");
    expect(service).toContain("model.projection.recover");
    expect(service).toContain("environment_namespace_id=${namespaceId}");
    expect(migration).toContain("authority_receipt_id,realm_id,source_environment_namespace_id");
    expect(migration).toContain("authority_receipt_id,realm_id,environment_namespace_id");
  });

  it("uses request hashes for replay-safe provisioning and recovery", () => {
    expect(migration.match(/request_hash char\(64\)/g)?.length).toBe(3);
    expect(service).toContain("snapshot provision key was already used for another request");
    expect(service).toContain("projection recovery key was already used for another request");
    expect(service).toContain("already retained with different evidence");
  });

  it("provides bounded leases, configured retries and poison-event quarantine", () => {
    expect(migration).toContain("CREATE TABLE campus_model_projection_recovery_jobs");
    expect(migration).toContain("CREATE TABLE campus_model_projection_replay_quarantine");
    expect(migration).toContain("retry_policy_ref");
    expect(migration).toContain("retry_delays_seconds");
    expect(service).toContain("FOR UPDATE SKIP LOCKED");
    expect(service).toContain("The projection recovery lease is unavailable or expired.");
    expect(service).toContain("state='quarantined'");
  });

  it("cannot complete recovery before its environment-local checkpoint reaches the boundary", () => {
    expect(service).toContain("campus_model_environment_projection_checkpoints checkpoint");
    expect(service).toContain("checkpoint.environment_namespace_id=job.environment_namespace_id");
    expect(service).toContain("checkpoint.last_delivery_sequence>=job.through_sequence");
  });

  it("schedules bounded Simulation retention without silently selecting policy", () => {
    expect(migration).toContain("CREATE TABLE campus_model_environment_retention_jobs");
    expect(migration).toContain("retention_policy_ref");
    expect(service).toContain("Transient cleanup can be scheduled only for Simulation.");
    expect(service).toContain("model.environment.retention");
    expect(service).toContain("Provide one configured delay before every retry.");
    expect(service).toContain("status='expired'");
  });

  it("publishes provisioning, recovery and retention behind Core ports", () => {
    for (const port of ["EXECUTION_PROVISIONING_PORT", "PROJECTION_RECOVERY_PORT", "ENVIRONMENT_RETENTION_PORT"]) {
      expect(moduleSource).toContain(`provide: ${port}`);
      expect(moduleSource).toContain(`    ${port},`);
    }
  });
});
