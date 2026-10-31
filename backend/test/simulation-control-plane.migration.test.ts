import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../migrations/149_simulation_runs.sql", import.meta.url), "utf8");
const fencingMigration = readFileSync(
  new URL("../migrations/150_simulation_worker_fencing.sql", import.meta.url),
  "utf8",
);
const lifecycleMigration = readFileSync(
  new URL("../migrations/151_simulation_resource_lifecycle.sql", import.meta.url),
  "utf8",
);
const worker = readFileSync(new URL("../src/simulation/simulation-worker.service.ts", import.meta.url), "utf8");
const repository = readFileSync(new URL("../src/simulation/simulation.repository.ts", import.meta.url), "utf8");

describe("durable Simulation schema", () => {
  it("retains lifecycle, snapshots, aligned checkpoints, metrics and safe draft provenance", () => {
    for (const table of [
      "simulation_runs",
      "simulation_run_checkpoints",
      "simulation_run_metric_samples",
      "simulation_run_draft_changes",
      "simulation_run_behaviour_configurations",
      "simulation_run_scheduled_events",
    ]) expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).toMatch(/'preparing','draft','running','paused','stopped','completed','failed'/u);
    expect(migration).toContain("end_at IS NULL");
    expect(migration).toContain("UNIQUE(run_id,simulated_elapsed_ms)");
    expect(migration).toContain("simulation_runs_due_idx");
    expect(migration).toContain("lease_fence bigint NOT NULL DEFAULT 0");
    expect(migration).not.toContain("CREATE TRIGGER");
  });

  it("uses one bounded worker loop rather than one timer per run", () => {
    expect(worker.match(/= setInterval/gu)).toHaveLength(1);
    expect(worker).toContain("this.policy.worker_max_runs_per_poll");
    expect(worker).toContain("timer.unref()");
    expect(worker).toContain("advanceNextDueRun");
    expect(worker).toContain("failNextStalePreparation");
  });

  it("upgrades an already-created control plane with idempotent worker fencing", () => {
    expect(fencingMigration).toContain("ADD COLUMN IF NOT EXISTS lease_fence");
    expect(fencingMigration).toContain("ADD COLUMN IF NOT EXISTS lease_token uuid");
    expect(fencingMigration).toContain("simulation_run_checkpoints_lease_shape_chk");
    expect(fencingMigration).toContain("gen_random_uuid()");
  });

  it("does not let pause or stop clear an expired lease that may still be executing", () => {
    const guards = repository.match(/AND lease_token IS NULL/gu) ?? [];
    expect(guards).toHaveLength(2);
  });

  it("adds terminal-only retention, institution admission locks and fenced cleanup receipts", () => {
    expect(lifecycleMigration).toContain("simulation_institution_resource_states");
    expect(lifecycleMigration).toContain("simulation_run_gc_receipts");
    expect(lifecycleMigration).toContain("simulation_runs_tenant_due_idx");
    expect(lifecycleMigration).toContain("simulation_runs_gc_due_idx");
    expect(lifecycleMigration).toContain("status IN ('stopped','completed','failed')");
    expect(lifecycleMigration).toContain("pinned_at IS NULL");
    expect(lifecycleMigration).toContain("world_discarded_at");
    expect(lifecycleMigration).not.toMatch(/WHERE status IN \('preparing','draft','running','paused'\).*retention_expires_at/su);
  });

  it("serializes capacity decisions and excludes selected sessions from cleanup", () => {
    expect(repository).toContain("simulation_institution_resource_states");
    expect(repository).toContain("FOR UPDATE OF state SKIP LOCKED");
    expect(repository).toContain("maxLeasesPerInstitution");
    expect(repository).toContain("auth_session_execution_environments");
    expect(repository).toContain("pg_try_advisory_xact_lock");
    expect(repository).toContain("simulation-retention:");
  });

  it("uses the database clock to recover abandoned preparation without deleting target data", () => {
    expect(repository).toContain("created_at<=clock_timestamp()");
    expect(repository).toContain("status='failed'");
    expect(repository).toContain("preparation timed out");
    expect(repository).not.toContain("DELETE FROM dt_simulation");
  });
});
