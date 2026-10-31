import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { CompiledQuery, type DatabaseConnection, type TransactionSettings } from "kysely";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSimulationBranch,
  SimulationBranchDriver,
  simulationBranchSchema,
} from "../src/database/simulation-branch.driver.js";
import type { StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { CampusViewService } from "../src/campus-view/campus-view.service.js";

const enabled = process.env.SIMULATION_COLD_COW_TEST_ISOLATED === "true";
const targetUrl = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_COLD_COW_DATABASE_URL)
  : "postgresql://invalid.invalid/cold_cow_test";
const fixtureKey = `cold-cow-native:${randomUUID()}`;
const ownedSchemas = new Set<string>();
const observations: unknown[] = [];
let pool: Pool;
let ownsMetadata = false;
let initialPublicCounts: unknown;

function quoted(value: string): string {
  if (!/^[a-z_][a-z_0-9]*$/u.test(value)) throw new Error("Invalid owned fixture schema.");
  return `"${value}"`;
}

function nativeClient(connection: DatabaseConnection): PoolClient {
  return (connection as DatabaseConnection & { client: PoolClient }).client;
}

async function publicCounts(): Promise<unknown> {
  return (await pool.query(`SELECT
    count(*) FILTER(WHERE relation.relkind IN ('r','p'))::int AS tables,
    count(*) FILTER(WHERE relation.relkind='v')::int AS views
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'`)).rows[0];
}

async function assertTargetBeforeMutation(): Promise<void> {
  const expected = process.env.SIMULATION_COLD_COW_EXPECT_DATABASE;
  if (!expected) throw new Error("Set the exact expected cold-COW test database name.");
  const identity = (await pool.query<{ name: string; version: number }>(
    "SELECT current_database() AS name,current_setting('server_version_num')::int AS version",
  )).rows[0];
  expect(identity?.name).toBe(expected);
  expect(identity?.version).toBeGreaterThanOrEqual(170000);
  expect(identity?.version).toBeLessThan(180000);
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const applied = (await pool.query<{ name: string; checksum: string }>(
    "SELECT name,checksum FROM public.node_schema_migrations ORDER BY name",
  )).rows;
  expect(applied.map((migration) => migration.name)).toEqual(files);
  for (const migration of applied) {
    const source = await readFile(new URL(migration.name, migrationDirectory));
    expect(migration.checksum).toBe(createHash("sha256").update(source).digest("hex"));
  }
  const existing = (await pool.query<{ name: string }>(
    "SELECT nspname AS name FROM pg_namespace WHERE nspname='dt_simulation'",
  )).rows;
  expect(existing, "Never borrow or drop an existing Simulation metadata store.").toEqual([]);
  initialPublicCounts = await publicCounts();
  observations.push({ guard: identity, matching_migrations: files.length, public_counts: initialPublicCounts });
}

async function mechanicalSnapshot(): Promise<StoredSimulationSnapshot> {
  const id = randomUUID();
  const template = `dt_template_${randomUUID().replaceAll("-", "")}`;
  ownedSchemas.add(template);
  await pool.query(`CREATE SCHEMA ${quoted(template)}`);
  await pool.query(`CREATE TABLE ${quoted(template)}.cold_capture_rows(id integer PRIMARY KEY,value text NOT NULL)`);
  const snapshot: StoredSimulationSnapshot = {
    id, origin_run_id: null, school_id: randomUUID(), captured_at: "2026-10-25T00:00:00.000Z",
    content_hash: createHash("sha256").update("mechanical cold-COW fixture").digest("hex"),
    template_schema: template,
    catalogue: {
      tables: [{ name: "cold_capture_rows", columns: ["id", "value"], foreign_keys: [], triggers: [], trigger_functions: [], defaults: [] }],
      functions: [], views: [], extensions: [], extension_objects: [],
    },
    counts: { cold_capture_rows: 1 }, time_zone: "UTC", compatibility_manifest: null, compatibility_hash: null,
  };
  await pool.query(`INSERT INTO dt_simulation.snapshots
    (id,school_id,captured_at,content_hash,template_schema,catalogue,counts,time_zone)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
  [id, snapshot.school_id, snapshot.captured_at, snapshot.content_hash, template, JSON.stringify(snapshot.catalogue), JSON.stringify(snapshot.counts), snapshot.time_zone]);
  await pool.query(`INSERT INTO dt_simulation.snapshot_tables(snapshot_id,table_name,rows)
    VALUES($1,'cold_capture_rows','[{"id":1,"value":"frozen source"}]'::jsonb)`, [id]);
  return snapshot;
}

async function branch(snapshot: StoredSimulationSnapshot): Promise<SimulationBranchDriver> {
  const run = randomUUID();
  ownedSchemas.add(simulationBranchSchema(run));
  const address = { run_id: run, school_id: snapshot.school_id, scenario_id: randomUUID(), namespace_id: `cold-cow:${run}` };
  return new SimulationBranchDriver(pool, await createSimulationBranch(pool, snapshot, address), snapshot);
}

async function waitForBlockedReader(readerPid: number, writerPid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = (await pool.query<{ blocked: boolean }>(`SELECT
      $2::int=ANY(pg_blocking_pids($1::int)) AND EXISTS(
        SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted
      ) AS blocked`, [readerPid, writerPid])).rows[0]?.blocked;
    if (blocked) return;
    // This observes the server lock barrier; elapsed time never triggers the race.
    await setTimeout(10);
  }
  throw new Error("Reader never reached the writer-held COW advisory gate.");
}

async function waitForBackendExit(pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await pool.query("SELECT pid FROM pg_stat_activity WHERE pid=$1", [pid])).rowCount) return;
    await setTimeout(10);
  }
  throw new Error("The canceled transaction-entry backend was not discarded.");
}

describe.runIf(enabled)("native cold-COW transaction visibility", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: targetUrl, max: 8, application_name: fixtureKey,
      options: "-c statement_timeout=15000 -c lock_timeout=12000" });
    await assertTargetBeforeMutation();
    // Mechanical storage fixtures only: no operational people, authority or public rows.
    // SnapshotStore.initialize deliberately cannot initialize an operational-schema DB.
    // CREATE without IF NOT EXISTS makes ownership exclusive; cleanup requires this flag.
    await pool.query("CREATE SCHEMA dt_simulation");
    ownsMetadata = true;
    await pool.query(`CREATE TABLE dt_simulation.snapshots(
      id uuid PRIMARY KEY,origin_run_id uuid,school_id uuid NOT NULL,captured_at timestamptz NOT NULL,
      content_hash text NOT NULL,template_schema text NOT NULL,catalogue jsonb NOT NULL,counts jsonb NOT NULL,
      time_zone text NOT NULL,compatibility_manifest jsonb,compatibility_hash char(64));
      CREATE TABLE dt_simulation.snapshot_tables(
        snapshot_id uuid NOT NULL REFERENCES dt_simulation.snapshots(id),table_name text NOT NULL,
        rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),PRIMARY KEY(snapshot_id,table_name));
      CREATE TABLE dt_simulation.worlds(
        run_id uuid PRIMARY KEY,school_id uuid NOT NULL,scenario_id uuid NOT NULL,namespace_id text NOT NULL UNIQUE,
        snapshot_id uuid NOT NULL REFERENCES dt_simulation.snapshots(id),schema_name text NOT NULL UNIQUE,
        virtual_now timestamptz NOT NULL,time_zone text NOT NULL,revision bigint NOT NULL DEFAULT 1,
        domain_read_only boolean NOT NULL DEFAULT false);
      CREATE TABLE dt_simulation.materialized_tables(
        run_id uuid NOT NULL REFERENCES dt_simulation.worlds(run_id),table_name text NOT NULL,
        PRIMARY KEY(run_id,table_name))`);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (ownsMetadata) {
        for (const schema of [...ownedSchemas].reverse()) await pool.query(`DROP SCHEMA IF EXISTS ${quoted(schema)} CASCADE`);
        await pool.query("DROP SCHEMA dt_simulation CASCADE");
        expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname=ANY($1::text[])",
          [["dt_simulation", ...ownedSchemas]])).rows).toEqual([]);
        expect(await publicCounts()).toEqual(initialPublicCounts);
        expect((await pool.query(`SELECT lock.pid FROM pg_locks lock JOIN pg_stat_activity activity ON activity.pid=lock.pid
          WHERE lock.locktype='advisory' AND activity.application_name=$1`, [fixtureKey])).rows).toEqual([]);
        observations.push({ cleanup: "all exact owned schemas removed; public relation counts unchanged; no fixture advisory locks" });
      }
      console.info("COLD_COW_NATIVE_RECEIPT", JSON.stringify(observations));
    } finally { await pool.end(); }
  });

  it("retains a native operational read slot while overlapping campus views wait on projection evidence", async () => {
    const snapshot = await mechanicalSnapshot();
    const owner = await branch(snapshot);
    const limitedName = `cold-cow-projection:${randomUUID()}`;
    const limitedPool = new Pool({ connectionString: targetUrl, max: 3, connectionTimeoutMillis: 1_000,
      application_name: limitedName, options: "-c statement_timeout=15000 -c lock_timeout=12000" });
    const driver = new SimulationBranchDriver(limitedPool, owner.branch, snapshot);
    const blocker = await pool.connect();
    const key = `projection-admission:${snapshot.id}`;
    const namespacedKey = `${owner.branch.namespace_id}:${key}`;
    const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const campusId = randomUUID();
    const spaces = Array.from({ length: 20 }, (_, index) => ({ id: randomUUID(), campus_id: campusId,
      parent_space_id: null, name: `Mechanical place ${index}`, code: `P${index}`, kind: "classroom", capacity: null, revision: 1 }));
    let started = 0;
    const temporal = { resolveAtBatch: async ({ subjects }: { subjects: unknown[] }) => {
      started += 1;
      const connection = await driver.acquireConnection();
      try {
        await connection.executeQuery(CompiledQuery.raw("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]));
        return subjects.map(() => []);
      } finally { await driver.releaseConnection(connection); }
    } };
    const repository = {
      hasActiveAdminMembership: async () => true,
      school: async () => ({ id: snapshot.school_id, name: "Mechanical campus", code: "MECH", timezone: "UTC" }),
      campuses: async () => [{ id: campusId, name: "Mechanical campus", code: "MECH", campus_type: "main", is_primary: true, timezone: "UTC" }],
      spaces: async () => spaces, examSpaceExpectations: async () => [], dayOccurrences: async () => [],
      gateActivityToday: async () => [], activeVisitorCount: async () => 0, motionParticipants: async () => [],
    };
    const service = new CampusViewService(repository as never, temporal as never,
      { recentActivity: async () => [], operationalSignals: async () => [] } as never);
    const user = { id: randomUUID(), role: "admin", active_school_id: snapshot.school_id, is_active: true } as const;
    let locked = false;
    let requests: Array<Promise<unknown>> = [];
    try {
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [namespacedKey]);
      locked = true;
      requests = [service.view(user as never, snapshot.school_id, {}), service.view(user as never, snapshot.school_id, {})];
      for (const request of requests) void request.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      let blocked = 0;
      while (Date.now() < deadline) {
        blocked = (await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name=$1 AND $2::int=ANY(pg_blocking_pids(pid))`, [limitedName, blockerPid])).rows[0]!.count;
        if (blocked >= 2) break;
        await setTimeout(10);
      }
      // The gate is a server-observed barrier. No delay manufactures capacity.
      expect(blocked).toBe(2);
      expect(started).toBe(2);
      expect(limitedPool.totalCount).toBe(2);
      expect(limitedPool.waitingCount).toBe(0);
      const operational = await driver.acquireConnection();
      let actual: unknown;
      try {
        actual = (await operational.executeQuery(CompiledQuery.raw(`SELECT id,value,
          current_setting('thatcampus.namespace_id') AS namespace FROM cold_capture_rows WHERE id=1`))).rows;
      } finally { await driver.releaseConnection(operational); }
      expect(actual).toEqual([{ id: 1, value: "frozen source", namespace: owner.branch.namespace_id }]);
      await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [namespacedKey]);
      locked = false;
      const results = await Promise.all(requests) as Array<{ spaces: Array<{ id: string }> }>;
      expect(results.map(result => result.spaces.map(space => space.id))).toEqual([spaces.map(space => space.id), spaces.map(space => space.id)]);
      expect(started).toBe(2);
      expect(limitedPool.waitingCount).toBe(0);
      expect(limitedPool.idleCount).toBe(limitedPool.totalCount);
      observations.push({ lifecycle: "campus projection read admission", shared_pool_max: 3, concurrent_views: 2,
        places_per_view: spaces.length, blocked_projection_reads: blocked, queued_pool_acquisitions: 0,
        operational_read_before_barrier_release: actual, all_places_retained_in_order: true });
    } finally {
      if (locked) await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [namespacedKey]);
      blocker.release();
      await Promise.allSettled(requests);
      await driver.destroy(); await owner.destroy();
      await limitedPool.end();
    }
  });

  const cases = [
    { isolationLevel: "read committed", accessMode: "read write" },
    { isolationLevel: "repeatable read", accessMode: "read write" },
    { isolationLevel: "repeatable read", accessMode: "read only" },
    { isolationLevel: "serializable", accessMode: "read only" },
  ] as const satisfies readonly TransactionSettings[];

  it.each(cases)("first $isolationLevel / $accessMode read sees a concurrent committed cold copy", async (settings) => {
    const snapshot = await mechanicalSnapshot();
    const primary = await branch(snapshot);
    const sibling = await branch(snapshot);
    const writer = await primary.acquireConnection();
    const reader = await primary.acquireConnection();
    const siblingReader = await sibling.acquireConnection();
    let writerOpen = false;
    let readerOpen = false;
    let pendingBegin: Promise<void> | undefined;
    const writerPid = (await nativeClient(writer).query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const readerPid = (await nativeClient(reader).query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    try {
      expect((await pool.query<{ relkind: string }>(`SELECT relation.relkind FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname=$1 AND relation.relname='cold_capture_rows'`, [primary.branch.schema_name])).rows[0]?.relkind).toBe("v");
      await primary.beginTransaction(writer, { isolationLevel: "read committed" });
      writerOpen = true;
      expect((await writer.executeQuery(CompiledQuery.raw("UPDATE cold_capture_rows SET value='committed copy' WHERE id=1 RETURNING value"))).rows)
        .toEqual([{ value: "committed copy" }]);
      // beginTransaction must wait here, before any read of the captured relation.
      pendingBegin = primary.beginTransaction(reader, settings).then(() => { readerOpen = true; });
      // Attach rejection handling immediately while the observer checks the barrier.
      void pendingBegin.catch(() => undefined);
      await waitForBlockedReader(readerPid, writerPid);
      await primary.commitTransaction(writer);
      writerOpen = false;
      await pendingBegin;
      const actual = (await reader.executeQuery<{ id: number; value: string }>(CompiledQuery.raw("SELECT id,value FROM cold_capture_rows WHERE id=1"))).rows;
      const isolation = (await nativeClient(reader).query<{ transaction_isolation: string }>("SHOW transaction_isolation")).rows[0]?.transaction_isolation;
      const readOnly = (await nativeClient(reader).query<{ transaction_read_only: string }>("SHOW transaction_read_only")).rows[0]?.transaction_read_only;
      await primary.commitTransaction(reader);
      readerOpen = false;
      const warm = (await reader.executeQuery(CompiledQuery.raw("SELECT id,value FROM cold_capture_rows WHERE id=1"))).rows;
      const otherBranch = (await siblingReader.executeQuery(CompiledQuery.raw("SELECT id,value FROM cold_capture_rows WHERE id=1"))).rows;
      const captured = (await pool.query("SELECT rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1 AND table_name='cold_capture_rows'", [snapshot.id])).rows[0]?.rows;
      observations.push({ settings, writer_pid: writerPid, reader_pid: readerPid, observed_blocked_gate: true,
        first_read: actual, warm_read: warm, sibling_read: otherBranch, captured, isolation, read_only: readOnly });
      expect(isolation).toBe(settings.isolationLevel);
      expect(readOnly).toBe(settings.accessMode === "read only" ? "on" : "off");
      expect(warm).toEqual([{ id: 1, value: "committed copy" }]);
      expect(otherBranch).toEqual([{ id: 1, value: "frozen source" }]);
      expect(captured).toEqual([{ id: 1, value: "frozen source" }]);
      expect(actual, "The first cold read must not invent a missing record from a snapshot taken before the COW gate opens.")
        .toEqual([{ id: 1, value: "committed copy" }]);
    } finally {
      // Release the writer first even if the barrier assertion fails, so the reader cannot hang.
      if (writerOpen) await primary.rollbackTransaction(writer);
      await pendingBegin?.catch(() => undefined);
      if (readerOpen) await primary.rollbackTransaction(reader);
      await primary.releaseConnection(writer);
      await primary.releaseConnection(reader);
      await sibling.releaseConnection(siblingReader);
      await primary.destroy();
      await sibling.destroy();
      expect((await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND pid=ANY($1::int[])", [[writerPid, readerPid]])).rows).toEqual([]);
    }
  });

  it("discards a canceled transaction-entry waiter without leaking its session or gate", async () => {
    const snapshot = await mechanicalSnapshot();
    const driver = await branch(snapshot);
    const writer = await driver.acquireConnection();
    const reader = await driver.acquireConnection();
    const writerPid = (await nativeClient(writer).query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const readerPid = (await nativeClient(reader).query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    let writerOpen = false;
    let pendingBegin: Promise<void> | undefined;
    let replacement: DatabaseConnection | undefined;
    try {
      await driver.beginTransaction(writer, { isolationLevel: "read committed" });
      writerOpen = true;
      pendingBegin = driver.beginTransaction(reader, { isolationLevel: "repeatable read", accessMode: "read only" });
      void pendingBegin.catch(() => undefined);
      await waitForBlockedReader(readerPid, writerPid);
      expect((await pool.query<{ canceled: boolean }>("SELECT pg_cancel_backend($1) AS canceled", [readerPid])).rows[0]?.canceled).toBe(true);
      await expect(pendingBegin).rejects.toMatchObject({ code: "57014" });
      // Kysely may release after a rejected begin; neither release may reuse the backend.
      await driver.releaseConnection(reader);
      await driver.releaseConnection(reader);
      await waitForBackendExit(readerPid);
      expect((await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND pid=$1", [readerPid])).rows).toEqual([]);
      expect((await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND pid=$1 AND granted", [writerPid])).rowCount).toBeGreaterThan(0);
      await driver.rollbackTransaction(writer);
      writerOpen = false;
      replacement = await driver.acquireConnection();
      expect((await replacement.executeQuery(CompiledQuery.raw("SELECT id,value FROM cold_capture_rows WHERE id=1"))).rows)
        .toEqual([{ id: 1, value: "frozen source" }]);
      observations.push({ lifecycle: "canceled gate waiter", observed_blocked_gate: true, cancellation_code: "57014",
        discarded_backend: readerPid, idempotent_release: true, writer_gate_retained_until_rollback: true,
        replacement_read: "frozen source" });
    } finally {
      if (writerOpen) await driver.rollbackTransaction(writer);
      await pendingBegin?.catch(() => undefined);
      await driver.releaseConnection(writer);
      await driver.releaseConnection(reader);
      if (replacement) await driver.releaseConnection(replacement);
      await driver.destroy();
      expect((await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND pid=ANY($1::int[])", [[writerPid, readerPid]])).rows).toEqual([]);
    }
  });

  it("retains the outer COW gate when rolling a cold copy back to a savepoint", async () => {
    const snapshot = await mechanicalSnapshot();
    const driver = await branch(snapshot);
    const writer = await driver.acquireConnection();
    const reader = await driver.acquireConnection();
    const writerPid = (await nativeClient(writer).query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const readerPid = (await nativeClient(reader).query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    let writerOpen = false;
    let readerOpen = false;
    let pendingBegin: Promise<void> | undefined;
    try {
      await driver.beginTransaction(writer, { isolationLevel: "read committed" });
      writerOpen = true;
      await driver.savepoint(writer, "before_cold_copy");
      await writer.executeQuery(CompiledQuery.raw("UPDATE cold_capture_rows SET value='savepoint copy' WHERE id=1"));
      await driver.rollbackToSavepoint(writer, "before_cold_copy");
      await driver.releaseSavepoint(writer, "before_cold_copy");
      pendingBegin = driver.beginTransaction(reader, { isolationLevel: "repeatable read", accessMode: "read only" })
        .then(() => { readerOpen = true; });
      void pendingBegin.catch(() => undefined);
      // A savepoint rollback must not release the transaction-entry COW lock.
      await waitForBlockedReader(readerPid, writerPid);
      await driver.rollbackTransaction(writer);
      writerOpen = false;
      await pendingBegin;
      const firstRead = (await reader.executeQuery(CompiledQuery.raw("SELECT id,value FROM cold_capture_rows WHERE id=1"))).rows;
      expect(firstRead).toEqual([{ id: 1, value: "frozen source" }]);
      await driver.commitTransaction(reader);
      readerOpen = false;
      expect((await pool.query<{ relkind: string }>(`SELECT relation.relkind FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE namespace.nspname=$1 AND relation.relname='cold_capture_rows'`, [driver.branch.schema_name])).rows[0]?.relkind).toBe("v");
      expect((await pool.query("SELECT table_name FROM dt_simulation.materialized_tables WHERE run_id=$1", [driver.branch.run_id])).rows).toEqual([]);
      observations.push({ lifecycle: "savepoint cold-copy rollback", observed_blocked_gate_after_savepoint_rollback: true,
        first_read: firstRead, native_relation_after_rollback: "view", materialized_tables: [] });
    } finally {
      if (writerOpen) await driver.rollbackTransaction(writer);
      await pendingBegin?.catch(() => undefined);
      if (readerOpen) await driver.rollbackTransaction(reader);
      await driver.releaseConnection(writer);
      await driver.releaseConnection(reader);
      await driver.destroy();
      expect((await pool.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND pid=ANY($1::int[])", [[writerPid, readerPid]])).rows).toEqual([]);
    }
  });
});
