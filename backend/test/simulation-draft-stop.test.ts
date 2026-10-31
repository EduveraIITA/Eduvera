import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type QueryResult,
} from "kysely";
import { describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SimulationRepository } from "../src/simulation/simulation.repository.js";

const schoolId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";
const runId = "30000000-0000-4000-8000-000000000001";
const scenarioId = "40000000-0000-4000-8000-000000000001";
const now = "2026-10-28T12:00:00.000Z";
const input = {
  run_id: runId,
  school_id: schoolId,
  owner_id: ownerId,
  now,
  retention_expires_at: "2026-11-27T12:00:00.000Z",
  draft_precondition: { expected_revision: 2, expected_status: "draft" as const },
};

function row(overrides: Record<string, unknown> = {}) {
  const result: Record<string, unknown> = {
    id: runId, school_id: schoolId, scenario_id: scenarioId,
    namespace_id: `scenario:${scenarioId}:run:${runId}`, created_by_user_id: ownerId,
    kind: "scenario", name: "Unstarted rehearsal", status: "draft", speed: 20,
    deterministic_seed: "test-seed", time_zone: "Asia/Kolkata", source_snapshot_ref: "test-snapshot",
    source_snapshot_hash: "a".repeat(64), source_snapshot_at: now, source_revisions: {},
    world_ref: "test-world", world_revision: 1, manifest_ref: "test-manifest", manifest_checked_at: now,
    limitations: [], virtual_started_at: now, virtual_now: now, simulated_elapsed_ms: 0,
    resource_reservation_bytes: 100, observed_storage_bytes: 0, lease_recovery_count: 0,
    retention_policy_version: 1, gc_state: "retained", gc_lease_fence: 0, gc_failure_count: 0,
    event_count: 0, checkpoint_count: 1, created_at: now, updated_at: now,
    lease_fence: 0, failure_count: 0, revision: 2,
  };
  for (const key of ["pending_advance_from", "pending_advance_to", "pending_advance_world_revision",
    "end_at", "retention_expires_at", "storage_measured_at", "resource_paused_at", "resource_pause_reason",
    "retention_started_at", "pinned_at", "pinned_by_user_id", "gc_lease_owner", "gc_lease_token", "gc_lease_until",
    "gc_failure_reason", "gc_next_attempt_at", "world_discarded_at", "wall_anchor_at", "virtual_anchor_at",
    "next_wake_at", "next_event_at", "last_checkpoint_at", "failure_reason", "started_at", "paused_at",
    "stopped_at", "completed_at", "lease_owner", "lease_token", "lease_until"]) result[key] = null;
  return { ...result, ...overrides };
}

function fixture(current = row(), membership = true, found = true) {
  const queries: CompiledQuery[] = [];
  const effects: string[] = [];
  class StopDriver extends DummyDriver {
    override acquireConnection(): Promise<DatabaseConnection> {
      return Promise.resolve({
        executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
          queries.push(query);
          let rows: unknown[] = [];
          if (query.sql.includes("FROM school_memberships membership")) rows = membership ? [{ id: "membership" }] : [];
          else if (query.sql.includes("SELECT * FROM simulation_runs")) rows = found ? [current] : [];
          else if (query.sql.includes("UPDATE simulation_runs")) {
            effects.push("stop");
            rows = [{ ...current, status: "stopped", revision: Number(current.revision) + 1, stopped_at: now }];
          }
          return Promise.resolve({ rows: rows as R[] });
        },
        streamQuery: async function* () { yield await Promise.resolve({ rows: [] }); },
      });
    }
    override beginTransaction() { effects.push("begin"); return Promise.resolve(); }
    override commitTransaction() { effects.push("commit"); return Promise.resolve(); }
    override rollbackTransaction() { effects.push("rollback"); return Promise.resolve(); }
  }
  const db = new Kysely<Database>({ dialect: {
    createDriver: () => new StopDriver(), createAdapter: () => new PostgresAdapter(),
    createQueryCompiler: () => new PostgresQueryCompiler(), createIntrospector: (database) => new PostgresIntrospector(database),
  } });
  return { db, repository: new SimulationRepository(db as DatabaseService), queries, effects };
}

describe("conditional Simulation draft stop transaction", () => {
  it("locks the institution, active account/membership and exact owned tenant run before stopping the reviewed draft", async () => {
    const { db, repository, queries, effects } = fixture();
    try {
      expect(await repository.stop(input)).toMatchObject({ status: "stopped", revision: 3 });
      expect(effects).toEqual(["begin", "stop", "commit"]);
      expect(queries[1]?.sql).toContain("FOR UPDATE");
      expect(queries[2]?.sql).toContain("membership.is_active AND account.is_active");
      expect(queries[2]?.sql).toContain("FOR SHARE OF membership,account");
      expect(queries[3]?.sql).toContain("FOR UPDATE");
      expect(queries[3]?.parameters).toEqual([runId, schoolId, ownerId]);
      expect(queries[4]?.sql).toContain("world_discarded_at IS NULL AND gc_state NOT IN ('deleting','deleted')");
    } finally { await db.destroy(); }
  });

  it.each([
    { revision: 3 },
    { status: "running", revision: 3 },
    { status: "running", revision: 2 },
    { status: "paused" },
    { status: "stopped" },
  ])("rolls back a stale draft or concurrent start without updating any run: %j", async (overrides) => {
    const { db, repository, effects } = fixture(row(overrides));
    try {
      await expect(repository.stop(input)).rejects.toBeInstanceOf(ConflictException);
      expect(effects).toEqual(["begin", "rollback"]);
    } finally { await db.destroy(); }
  });

  it.each([
    { lease_token: "lease" },
    { pending_advance_to: now, pending_advance_from: now, pending_advance_world_revision: 1 },
    { world_discarded_at: now },
    { gc_state: "deleting" },
    { gc_state: "deleted" },
  ])("retains the existing work/removal safety boundary: %j", async (overrides) => {
    const { db, repository, effects } = fixture(row(overrides));
    try {
      await expect(repository.stop(input)).rejects.toBeInstanceOf(ConflictException);
      expect(effects).toEqual(["begin", "rollback"]);
    } finally { await db.destroy(); }
  });

  it("rechecks active authority inside the transaction before run access", async () => {
    const { db, repository, queries, effects } = fixture(row(), false);
    try {
      await expect(repository.stop(input)).rejects.toBeInstanceOf(ForbiddenException);
      expect(queries.some((query) => query.sql.includes("FROM simulation_runs"))).toBe(false);
      expect(effects).toEqual(["begin", "rollback"]);
    } finally { await db.destroy(); }
  });

  it("does not reveal or mutate a different owner/tenant's run", async () => {
    const { db, repository, effects } = fixture(row(), true, false);
    try {
      await expect(repository.stop(input)).rejects.toBeInstanceOf(NotFoundException);
      expect(effects).toEqual(["begin", "rollback"]);
    } finally { await db.destroy(); }
  });

  it.each(["draft", "running", "paused"])("preserves explicit normal Stop without a draft precondition for %s", async (status) => {
    const { db, repository, effects } = fixture(row({ status, revision: 7 }));
    try {
      expect(await repository.stop({ run_id: runId, school_id: schoolId, owner_id: ownerId, now,
        retention_expires_at: input.retention_expires_at })).toMatchObject({ status: "stopped", revision: 8 });
      expect(effects).toEqual(["begin", "stop", "commit"]);
    } finally { await db.destroy(); }
  });
});
