import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CompiledQuery, sql, type DatabaseConnection, type QueryResult, type Transaction } from "kysely";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { measureSimulationWorld, garbageCollectSimulationWorld } from "../src/database/simulation-world-lifecycle.js";
import { bindSimulationResources, unbindSimulationResources, captureSimulationProviderEffect, simulationLogicalDigest } from "../src/common/simulation-resources.js";
import { ExecutionEffectRouter, RunScopedInMemoryExecutionEffectSink } from "../src/campus-model-core/execution-effects.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { PersistedSimulationRun } from "../src/simulation/simulation.contracts.js";
import {
  createSimulationBranch,
  SimulationBranchDriver,
  simulationBranchSchema,
} from "../src/database/simulation-branch.driver.js";
import {
  SimulationSnapshotStore,
  type StoredSimulationSnapshot,
} from "../src/database/simulation-snapshot-store.js";
import {
  ExecutionDataPlaneRegistry,
  ExecutionDataPlaneScope,
  REQUIRED_APPLICATION_SIMULATION_MODULES,
} from "../src/database/execution-data-plane.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { PublishedScheduleProjection } from "../src/campus-model-core/contracts.js";
import { AuthService } from "../src/auth/auth.service.js";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthUser, AuthenticatedRequest } from "../src/common/request.js";
import type { FastifyRequest } from "fastify";
import { SimulationRepository } from "../src/simulation/simulation.repository.js";
import { SimulationService } from "../src/simulation/simulation.service.js";
import { DEFAULT_SIMULATION_RESOURCE_POLICY } from "../src/simulation/simulation-resource-policy.js";
import { PeopleImportService } from "../src/people/people-import.service.js";
import { TransportRetentionService } from "../src/departure-coordination/transport-retention.service.js";
import type { SchoolEventService } from "../src/school/school-event.service.js";
import {
  SimulationWorldService,
  type SimulationDomainRuntime,
} from "../src/database/simulation-world.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { CoordinationService } from "../src/coordination/coordination.service.js";
import { FollowupModelBridgeService } from "../src/coordination/followup-model-bridge.service.js";
import { SchoolEventService as FollowupSchoolEventService } from "../src/school/school-event.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";

const enabled = process.env.SIMULATION_DATABASE_TEST_ISOLATED === "true";
const sourceUrl = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_TEST_SOURCE_DATABASE_URL)
  : "postgresql://invalid.invalid/simulation_source_test";
const targetUrl = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_TEST_TARGET_DATABASE_URL)
  : "postgresql://invalid.invalid/simulation_target_test";

const schoolA = "10000000-0000-4000-8000-000000000001";
const schoolB = "10000000-0000-4000-8000-000000000002";
const userA = "20000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";
const campusA = "30000000-0000-4000-8000-000000000001";
const campusB = "30000000-0000-4000-8000-000000000002";
const spaceA = "40000000-0000-4000-8000-000000000001";
const spaceB = "40000000-0000-4000-8000-000000000002";
const scenarioDeviceAgent = "70000000-0000-4000-8000-000000000001";
const runA = "50000000-0000-4000-8000-000000000001";
const runB = "50000000-0000-4000-8000-000000000002";
const runRestart = "50000000-0000-4000-8000-000000000003";
const runFence = "50000000-0000-4000-8000-000000000004";
const runLargeA = "50000000-0000-4000-8000-000000000005";
const runLargeB = "50000000-0000-4000-8000-000000000006";
const scenarioA = "60000000-0000-4000-8000-000000000001";
const scenarioB = "60000000-0000-4000-8000-000000000002";
const scenarioRestart = "60000000-0000-4000-8000-000000000003";
const scenarioFence = "60000000-0000-4000-8000-000000000004";
const scenarioLargeA = "60000000-0000-4000-8000-000000000005";
const scenarioLargeB = "60000000-0000-4000-8000-000000000006";
const capturedAt = "2026-10-19T07:30:00.000Z";

function compiled(sql: string, parameters: readonly unknown[] = []): CompiledQuery {
  return CompiledQuery.raw(sql, [...parameters]);
}

async function execute<R>(
  connection: DatabaseConnection,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<QueryResult<R>> {
  return connection.executeQuery<R>(compiled(sql, parameters));
}

async function seedLiveFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO users(id,username,email,password_hash,first_name,last_name,role,is_active)
      VALUES
        ($1,'simulation-fixture-a','simulation-fixture-a@example.test','password-secret-a','Simulation','A','admin',true),
        ($2,'simulation-fixture-b','simulation-fixture-b@example.test','password-secret-b','Simulation','B','admin',true)
      ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,is_active=true`, [userA, userB]);
    await client.query(`INSERT INTO schools(id,name,code,timezone,created_by_user_id)
      VALUES($1,'Simulation Fixture A','SIM-FIXTURE-A','UTC',$3),
        ($2,'Simulation Fixture B','SIM-FIXTURE-B','UTC',$4)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,timezone=excluded.timezone`, [schoolA, schoolB, userA, userB]);
    await client.query(`INSERT INTO school_memberships(id,user_id,school_id,role,is_active)
      VALUES
        ('21000000-0000-4000-8000-000000000001',$1,$3,'admin',true),
        ('21000000-0000-4000-8000-000000000002',$2,$4,'admin',true)
      ON CONFLICT(user_id,school_id,role) DO UPDATE SET is_active=true`, [userA, userB, schoolA, schoolB]);
    await client.query(`INSERT INTO institution_campuses(id,school_id,name,code,is_primary,timezone,created_by,updated_by)
      VALUES($1,$3,'Fixture Campus A','MAIN-A',true,'UTC',$5,$5),
        ($2,$4,'Fixture Campus B','MAIN-B',true,'UTC',$6,$6)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='active'`, [campusA, campusB, schoolA, schoolB, userA, userB]);
    await client.query(`INSERT INTO campus_spaces(id,school_id,campus_id,name,code,kind,capacity,created_by,updated_by)
      VALUES($1,$3,$5,'Room A Live','ROOM-A','classroom',30,$7,$7),
        ($2,$4,$6,'Room B Private','ROOM-B','classroom',40,$8,$8)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,capacity=excluded.capacity,parent_space_id=NULL`,
    [spaceA, spaceB, schoolA, schoolB, campusA, campusB, userA, userB]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.runIf(enabled)("durable isolated Simulation world", () => {
  const live = new Pool({ connectionString: sourceUrl, max: 2 });
  let store: SimulationSnapshotStore;
  let snapshotA: StoredSimulationSnapshot;
  let snapshotB: StoredSimulationSnapshot;

  beforeAll(async () => {
    process.env.DATABASE_URL = sourceUrl;
    process.env.CAMPUS_SIMULATION_DATABASE_URL = targetUrl;
    await seedLiveFixtures(live);
    await live.query(
      "UPDATE campus_spaces SET name='Room A Live',capacity=30,parent_space_id=NULL WHERE id=$1",
      [spaceA],
    );
    await live.query(
      "UPDATE campus_spaces SET name='Room B Private',capacity=40,parent_space_id=NULL WHERE id=$1",
      [spaceB],
    );

    const target = new Pool({ connectionString: targetUrl, max: 1 });
    try {
      const branchSchemas = (await target.query<{ schema_name: string }>(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dt_run_%'",
      )).rows;
      for (const row of branchSchemas) {
        if (!/^dt_run_[0-9a-f]{32}$/u.test(row.schema_name)) {
          throw new Error("Refusing to clean an unexpected Simulation test schema.");
        }
        await target.query(`DROP SCHEMA "${row.schema_name}" CASCADE`);
      }
      const snapshotSchemas = (await target.query<{ schema_name: string }>(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dt_snapshot_%'",
      )).rows;
      for (const row of snapshotSchemas) {
        if (!/^dt_snapshot_[0-9a-f]{32}$/u.test(row.schema_name)) {
          throw new Error("Refusing to clean an unexpected shared snapshot test schema.");
        }
        await target.query(`DROP SCHEMA "${row.schema_name}" CASCADE`);
      }
      await target.query("DROP SCHEMA IF EXISTS dt_simulation CASCADE");
      const templates = (await target.query<{ schema_name: string }>(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'dt_template_%'",
      )).rows;
      for (const row of templates) {
        if (!/^dt_template_[0-9a-f]{16}$/u.test(row.schema_name)) {
          throw new Error("Refusing to clean an unexpected Simulation template schema.");
        }
        await target.query(`DROP SCHEMA "${row.schema_name}" CASCADE`);
      }
    } finally {
      await target.end();
    }

    store = new SimulationSnapshotStore(sourceUrl, targetUrl, 4);
    await store.initialize();
    snapshotA = await store.capture(schoolA, capturedAt);
    snapshotB = await store.capture(schoolB, capturedAt);
  }, 120_000);

  afterAll(async () => {
    await live.query(
      "UPDATE campus_spaces SET name='Room A Live',capacity=30,parent_space_id=NULL WHERE id=$1",
      [spaceA],
    ).catch(() => undefined);
    await store?.pool.end().catch(() => undefined);
    await live.query("DELETE FROM schools WHERE id=ANY($1::uuid[])", [[schoolA, schoolB]]).catch(() => undefined);
    await live.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[userA, userB]]).catch(() => undefined);
    await live.end();
  });

  it("captures exactly one tenant and strips credentials and authenticated sessions", async () => {
    expect(snapshotA.school_id).toBe(schoolA);
    expect(snapshotA.compatibility_manifest).toMatchObject({
      schema_version: 1,
      capture_format_version: 1,
      behaviour_contract_abi: 2,
    });
    expect(snapshotA.compatibility_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshotA.counts.schools).toBe(1);
    expect(snapshotA.counts.school_memberships).toBe(1);
    expect(snapshotA.counts.campus_spaces).toBe(1);
    expect(snapshotA.counts.auth_sessions).toBe(0);
    expect(snapshotB.counts.campus_spaces).toBe(1);

    const users = (await store.pool.query<{ rows: Array<Record<string, unknown>> }>(
      "SELECT rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1 AND table_name='users'",
      [snapshotA.id],
    )).rows[0]!.rows;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: "20000000-0000-4000-8000-000000000001",
      password_hash: "simulation-disabled",
    });
    expect(JSON.stringify(users)).not.toContain("password-secret-a");

    const capturedRows = (await store.pool.query<{ table_name: string; rows: unknown }>(
      "SELECT table_name,rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1",
      [snapshotA.id],
    )).rows;
    const serialized = JSON.stringify(capturedRows);
    expect(serialized).not.toContain(schoolB);
    expect(serialized).not.toContain(spaceB);
    expect(serialized).not.toContain("Room B Private");
  });

  it("retains immutable snapshots after Live changes", async () => {
    await expect(store.pool.query(
      "UPDATE dt_simulation.snapshots SET time_zone='UTC' WHERE id=$1",
      [snapshotA.id],
    )).rejects.toMatchObject({ code: "P0001" });
    await expect(store.pool.query(
      "DELETE FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1 AND table_name='campus_spaces'",
      [snapshotA.id],
    )).rejects.toMatchObject({ code: "P0001" });

    await live.query("UPDATE campus_spaces SET name='Room A Live after snapshot' WHERE id=$1", [spaceA]);
    const rows = (await store.pool.query<{ rows: Array<{ name: string }> }>(
      "SELECT rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$1 AND table_name='campus_spaces'",
      [snapshotA.id],
    )).rows[0]!.rows;
    expect(rows).toEqual([expect.objectContaining({ name: "Room A Live" })]);
  });

  it("refuses legacy and catalogue-tampered retained snapshots without changing their source", async () => {
    const legacySnapshotId = randomUUID();
    const legacyRunId = randomUUID();
    const legacyScenarioId = randomUUID();
    const namespaceId = `scenario:${legacyScenarioId}:run:${legacyRunId}` as const;
    const liveBefore = (await live.query<{ name: string }>("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0]!;
    await store.pool.query(`INSERT INTO dt_simulation.snapshots(
        id,school_id,captured_at,content_hash,template_schema,catalogue,counts,time_zone,
        compatibility_manifest,compatibility_hash)
      SELECT $1,school_id,captured_at,content_hash,template_schema,catalogue,counts,time_zone,NULL,NULL
      FROM dt_simulation.snapshots WHERE id=$2`, [legacySnapshotId, snapshotA.id]);
    await store.pool.query(`INSERT INTO dt_simulation.snapshot_tables(snapshot_id,table_name,rows)
      SELECT $1,table_name,rows FROM dt_simulation.snapshot_tables WHERE snapshot_id=$2`,
    [legacySnapshotId, snapshotA.id]);
    const legacySnapshot = await store.getSnapshot(legacySnapshotId);
    const branch = await createSimulationBranch(store.pool, legacySnapshot, {
      run_id: legacyRunId,
      school_id: schoolA,
      scenario_id: legacyScenarioId,
      namespace_id: namespaceId,
    });
    expect(branch.snapshot_id).toBe(legacySnapshotId);

    const tamperedSnapshotId = randomUUID();
    const tamperedRunId = randomUUID();
    const tamperedScenarioId = randomUUID();
    const tamperedNamespace = `scenario:${tamperedScenarioId}:run:${tamperedRunId}` as const;
    await store.pool.query(`INSERT INTO dt_simulation.snapshots(
        id,school_id,captured_at,content_hash,template_schema,catalogue,counts,time_zone,
        compatibility_manifest,compatibility_hash)
      SELECT $1,school_id,captured_at,content_hash,template_schema,
        catalogue||'{"compatibility_probe":"tampered"}'::jsonb,counts,time_zone,
        compatibility_manifest,compatibility_hash
      FROM dt_simulation.snapshots WHERE id=$2`, [tamperedSnapshotId, snapshotA.id]);
    await store.pool.query(`INSERT INTO dt_simulation.worlds(
        run_id,school_id,scenario_id,namespace_id,snapshot_id,schema_name,virtual_now,time_zone)
      VALUES($1,$2,$3,$4,$5,$6,$7,'UTC')`, [tamperedRunId, schoolA, tamperedScenarioId,
      tamperedNamespace, tamperedSnapshotId, simulationBranchSchema(tamperedRunId), capturedAt]);
    const world = new SimulationWorldService(
      new ExecutionDataPlaneRegistry(),
      new ExecutionDataPlaneScope(),
    );
    try {
      await expect(world.open({
        id: legacyRunId,
        school_id: schoolA,
        scenario_id: legacyScenarioId,
        namespace_id: namespaceId,
        virtual_now: capturedAt,
        source_snapshot_at: capturedAt,
      } as PersistedSimulationRun)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "simulation_snapshot_incompatible",
          incompatibilities: expect.arrayContaining(["compatibility_manifest_missing"]),
          recovery: expect.stringContaining("fresh Simulation run"),
        }),
      });
      await expect(world.open({
        id: tamperedRunId,
        school_id: schoolA,
        scenario_id: tamperedScenarioId,
        namespace_id: tamperedNamespace,
        virtual_now: capturedAt,
        source_snapshot_at: capturedAt,
      } as PersistedSimulationRun)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "simulation_snapshot_incompatible",
          incompatibilities: expect.arrayContaining(["schema_catalogue_hash_mismatch"]),
        }),
      });

      const original = await store.getSnapshot(snapshotA.id);
      expect(original.compatibility_manifest).toEqual(snapshotA.compatibility_manifest);
      expect(original.compatibility_hash).toBe(snapshotA.compatibility_hash);
      expect(original.content_hash).toBe(snapshotA.content_hash);
      expect((await live.query<{ name: string }>("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0])
        .toEqual(liveBefore);
      expect((await store.pool.query("SELECT 1 FROM dt_simulation.worlds WHERE run_id=$1", [legacyRunId])).rowCount)
        .toBe(1);
    } finally {
      await world.onApplicationShutdown();
    }
  });

  it("records idempotent zero-release cleanup for a failed preparation with no captured world", async () => {
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const token = randomUUID();
    const input = {
      run: {
        id: runId,
        school_id: schoolA,
        namespace_id: `scenario:${scenarioId}:run:${runId}`,
        status: "failed",
        gc_state: "deleting",
        gc_lease_token: token,
        gc_lease_fence: 1,
        gc_lease_until: "2099-01-01T00:00:00.000Z",
        pinned_at: null,
        retention_expires_at: "2026-01-01T00:00:00.000Z",
        world_ref: null,
        source_snapshot_ref: null,
      } as PersistedSimulationRun,
      gc_token: token,
      gc_fence: 1,
      requested_at: "2026-10-19T12:00:00.000Z",
    };
    const liveBefore = (await live.query<{ name: string }>("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0];
    const snapshotCount = Number((await store.pool.query<{ count: string }>(
      "SELECT count(*) FROM dt_simulation.snapshots",
    )).rows[0]!.count);

    const collected = await garbageCollectSimulationWorld(store.pool, input);
    expect(collected).toMatchObject({ released_bytes: 0, retained_shared_snapshot: false });
    expect(await garbageCollectSimulationWorld(store.pool, input)).toEqual(collected);
    expect((await store.pool.query<{ snapshot_id: string | null; result: unknown }>(
      "SELECT snapshot_id,result FROM dt_simulation.gc_receipts WHERE run_id=$1",
      [runId],
    )).rows[0]).toMatchObject({ snapshot_id: null, result: collected });
    expect(Number((await store.pool.query<{ count: string }>(
      "SELECT count(*) FROM dt_simulation.snapshots",
    )).rows[0]!.count)).toBe(snapshotCount);
    expect((await live.query<{ name: string }>("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0])
      .toEqual(liveBefore);
  });

  it("reclaims only the exact origin snapshot of a failed post-capture preparation", async () => {
    const runId = randomUUID();
    const scenarioId = randomUUID();
    const token = randomUUID();
    const liveBefore = (await live.query<{ name: string }>("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0];
    const captured = await store.capture(schoolA, capturedAt, runId);
    expect(captured.origin_run_id).toBe(runId);
    expect((await store.pool.query("SELECT 1 FROM dt_simulation.worlds WHERE run_id=$1", [runId])).rowCount).toBe(0);
    const input = {
      run: {
        id: runId,
        school_id: schoolA,
        namespace_id: `scenario:${scenarioId}:run:${runId}`,
        status: "failed",
        gc_state: "deleting",
        gc_lease_token: token,
        gc_lease_fence: 1,
        gc_lease_until: "2099-01-01T00:00:00.000Z",
        pinned_at: null,
        retention_expires_at: "2026-01-01T00:00:00.000Z",
        world_ref: null,
        source_snapshot_ref: null,
      } as PersistedSimulationRun,
      gc_token: token,
      gc_fence: 1,
      requested_at: "2026-10-19T12:00:00.000Z",
    };

    const collected = await garbageCollectSimulationWorld(store.pool, input);
    expect(collected.released_bytes).toBeGreaterThan(0);
    expect(collected.retained_shared_snapshot).toBe(false);
    expect(await garbageCollectSimulationWorld(store.pool, input)).toEqual(collected);
    expect((await store.pool.query("SELECT 1 FROM dt_simulation.snapshots WHERE id=$1", [captured.id])).rowCount).toBe(0);
    expect((await store.pool.query<{ snapshot_id: string | null }>(
      "SELECT snapshot_id FROM dt_simulation.gc_receipts WHERE run_id=$1",
      [runId],
    )).rows[0]?.snapshot_id).toBe(captured.id);
    expect((await store.pool.query("SELECT 1 FROM dt_simulation.snapshots WHERE id=ANY($1::uuid[])",
      [[snapshotA.id, snapshotB.id]])).rowCount).toBe(2);
    expect((await live.query<{ name: string }>("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0])
      .toEqual(liveBefore);
  }, 120_000);

  it("captures with a one-connection target pool without starving its own template lease", async () => {
    const singleConnectionStore = new SimulationSnapshotStore(sourceUrl, targetUrl, 1);
    try {
      const captured = await singleConnectionStore.capture(schoolA, capturedAt);
      expect(captured.school_id).toBe(schoolA);
      expect(captured.compatibility_hash).toMatch(/^[a-f0-9]{64}$/u);
    } finally { await singleConnectionStore.pool.end(); }
  }, 15_000);

  it("shares one indexed immutable large snapshot relation while preserving branch COW", async () => {
    await live.query(`INSERT INTO campus_spaces(
        id,school_id,campus_id,name,code,kind,capacity,created_by,updated_by)
      SELECT md5('simulation-large-space:'||number::text)::uuid,$1::uuid,$2::uuid,
        'Large room '||number::text,'LARGE-'||lpad(number::text,4,'0'),'classroom',20,$3::uuid,$3::uuid
      FROM generate_series(1,500) number
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,capacity=excluded.capacity`,
    [schoolA, campusA, userA]);
    let driverA: SimulationBranchDriver | undefined;
    let driverB: SimulationBranchDriver | undefined;
    try {
      const large = await store.capture(schoolA, "2026-10-19T07:31:00.000Z");
      expect(large.counts.campus_spaces).toBe(501);
      const branchA = await createSimulationBranch(store.pool, large, {
        run_id: runLargeA,
        school_id: schoolA,
        scenario_id: scenarioLargeA,
        namespace_id: `scenario:${scenarioLargeA}:run:${runLargeA}`,
      });
      const branchB = await createSimulationBranch(store.pool, large, {
        run_id: runLargeB,
        school_id: schoolA,
        scenario_id: scenarioLargeB,
        namespace_id: `scenario:${scenarioLargeB}:run:${runLargeB}`,
      });
      const snapshotSchema = `dt_snapshot_${large.id.replaceAll("-", "")}`;
      expect(snapshotSchema).toMatch(/^dt_snapshot_[0-9a-f]{32}$/u);
      expect((await store.pool.query(
        "SELECT 1 FROM pg_tables WHERE schemaname=$1 AND tablename='campus_spaces'",
        [snapshotSchema],
      )).rowCount).toBe(1);
      expect((await store.pool.query(
        "SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND tablename='campus_spaces'",
        [snapshotSchema],
      )).rowCount).toBeGreaterThan(0);
      await expect(store.pool.query(
        `UPDATE "${snapshotSchema}".campus_spaces SET name='Forbidden' WHERE id=$1`,
        [spaceA],
      )).rejects.toMatchObject({ code: "P0001" });

      await live.query("DELETE FROM campus_spaces WHERE school_id=$1 AND code LIKE 'LARGE-%'", [schoolA]);
      driverA = new SimulationBranchDriver(store.pool, branchA, large);
      driverB = new SimulationBranchDriver(store.pool, branchB, large);
      await driverA.init();
      await driverB.init();
      const connectionA = await driverA.acquireConnection();
      const connectionB = await driverB.acquireConnection();
      try {
        expect((await execute<{ count: string }>(connectionA, "SELECT count(*)::text AS count FROM campus_spaces")).rows[0]?.count).toBe("501");
        expect((await execute<{ count: string }>(connectionB, "SELECT count(*)::text AS count FROM campus_spaces")).rows[0]?.count).toBe("501");
        await execute(connectionA, "UPDATE campus_spaces SET name=$1 WHERE id=$2", ["Large branch A", spaceA]);
        expect((await execute<{ name: string }>(connectionA, "SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0]?.name).toBe("Large branch A");
        expect((await execute<{ name: string }>(connectionB, "SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows[0]?.name).toBe("Room A Live after snapshot");
      } finally {
        await driverA.releaseConnection(connectionA);
        await driverB.releaseConnection(connectionB);
      }
    } finally {
      await driverA?.destroy();
      await driverB?.destroy();
      await live.query("DELETE FROM campus_spaces WHERE school_id=$1 AND code LIKE 'LARGE-%'", [schoolA]);
    }
  }, 120_000);

  it("isolates simultaneous runs with lazy copy-on-write and native invariants", async () => {
    const branchA = await createSimulationBranch(store.pool, snapshotA, {
      run_id: runA,
      school_id: schoolA,
      scenario_id: scenarioA,
      namespace_id: `scenario:${scenarioA}:run:${runA}`,
    });
    const branchB = await createSimulationBranch(store.pool, snapshotA, {
      run_id: runB,
      school_id: schoolA,
      scenario_id: scenarioB,
      namespace_id: `scenario:${scenarioB}:run:${runB}`,
    });
    const driverA = new SimulationBranchDriver(store.pool, branchA, snapshotA);
    const driverB = new SimulationBranchDriver(store.pool, branchB, snapshotA);
    await driverA.init();
    await driverB.init();
    const connectionA = await driverA.acquireConnection();
    const connectionB = await driverB.acquireConnection();
    try {
      const frozenBeforeWrite = (await execute<{ name: string; revision: number }>(
        connectionA,
        "SELECT name,revision FROM campus_spaces WHERE id=$1",
        [spaceA],
      )).rows[0]!;
      expect(frozenBeforeWrite).toMatchObject({ name: "Room A Live" });
      expect((await execute<{ name: string }>(
        connectionA,
        "SELECT name FROM campus_spaces ORDER BY id",
      )).rows).toEqual([{ name: "Room A Live" }]);

      const updated = (await execute<{ name: string; capacity: number; revision: number; updated_at: Date }>(
        connectionA,
        "UPDATE campus_spaces SET name=$1 WHERE id=$2 RETURNING name,capacity,revision,updated_at",
        ["Room A Simulated", spaceA],
      )).rows[0]!;
      expect(updated).toMatchObject({
        name: "Room A Simulated",
        capacity: 30,
        revision: frozenBeforeWrite.revision + 1,
      });
      expect(new Date(updated.updated_at).toISOString()).toBe(capturedAt);

      expect((await execute<{ name: string }>(
        connectionB,
        "SELECT name FROM campus_spaces WHERE id=$1",
        [spaceA],
      )).rows).toEqual([{ name: "Room A Live" }]);
      expect((await live.query<{ name: string }>(
        "SELECT name FROM campus_spaces WHERE id=$1",
        [spaceA],
      )).rows).toEqual([{ name: "Room A Live after snapshot" }]);

      await expect(execute(
        connectionA,
        "UPDATE campus_spaces SET capacity=0 WHERE id=$1",
        [spaceA],
      )).rejects.toMatchObject({ code: "23514" });
      await expect(execute(
        connectionA,
        `INSERT INTO campus_spaces(id,school_id,campus_id,name,code,kind,capacity)
          VALUES($1,$2,$3,'Broken room','BROKEN','classroom',10)`,
        ["40000000-0000-4000-8000-000000000099", schoolA, "30000000-0000-4000-8000-000000000099"],
      )).rejects.toMatchObject({ code: "23503" });

      await execute(connectionA, "UPDATE guardian_relationships SET relationship=relationship WHERE false");
      expect((await execute<{ permitted: boolean | null }>(
        connectionA,
        "SELECT guardian_may_sign_leave(NULL::guardian_relationships, DATE '2026-10-19') AS permitted",
      )).rows).toEqual([{ permitted: null }]);
      expect((await execute<{ argument_types: string }>(
        connectionA,
        `SELECT pg_get_function_identity_arguments(procedure.oid) AS argument_types
          FROM pg_proc procedure
          JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
          WHERE namespace.nspname=current_schema()
            AND procedure.proname='guardian_may_sign_leave'`,
      )).rows[0]?.argument_types).toContain("guardian_relationships");

      await execute(
        connectionA,
        `INSERT INTO campus_model_agents(id,school_id,agent_kind,external_ref,label,status)
          VALUES($1,$2,'device','camera:east-gate','East gate camera','active')`,
        [scenarioDeviceAgent, schoolA],
      );
      expect((await execute<{
        source_agent_id: string;
        environment_namespace_id: string;
        actor_mode: string;
        behaviour_policy_version_ref: string | null;
        authority_snapshot_ref: string | null;
      }>(
        connectionA,
        `SELECT source_agent_id,environment_namespace_id,actor_mode,
          behaviour_policy_version_ref,authority_snapshot_ref
        FROM campus_model_execution_actor_bindings WHERE source_agent_id=$1`,
        [scenarioDeviceAgent],
      )).rows).toEqual([{
        source_agent_id: scenarioDeviceAgent,
        environment_namespace_id: branchA.namespace_id,
        actor_mode: "simulation_counterpart",
        behaviour_policy_version_ref: null,
        authority_snapshot_ref: `sha256:${snapshotA.content_hash}`,
      }]);
      expect((await live.query(
        "SELECT 1 FROM campus_model_agents WHERE id=$1",
        [scenarioDeviceAgent],
      )).rowCount).toBe(0);
    } finally {
      await driverA.releaseConnection(connectionA);
      await driverB.releaseConnection(connectionB);
      await driverA.destroy();
      await driverB.destroy();
    }
  }, 120_000);

  it("reopens retained worlds after the store client is reinitialized", async () => {
    const creatorStore = new SimulationSnapshotStore(sourceUrl, targetUrl, 2);
    await creatorStore.initialize();
    const retainedBeforeRestart = await creatorStore.getSnapshot(snapshotA.id);
    const branchBeforeRestart = await createSimulationBranch(creatorStore.pool, retainedBeforeRestart, {
      run_id: runRestart,
      school_id: schoolA,
      scenario_id: scenarioRestart,
      namespace_id: `scenario:${scenarioRestart}:run:${runRestart}`,
    });
    const creatorDriver = new SimulationBranchDriver(
      creatorStore.pool,
      branchBeforeRestart,
      retainedBeforeRestart,
    );
    await creatorDriver.init();
    const creatorConnection = await creatorDriver.acquireConnection();
    try {
      await execute(
        creatorConnection,
        "UPDATE campus_spaces SET name=$1 WHERE id=$2",
        ["Room A Retained", spaceA],
      );
    } finally {
      await creatorDriver.releaseConnection(creatorConnection);
      await creatorDriver.destroy();
      await creatorStore.pool.end();
    }

    const reopenedStore = new SimulationSnapshotStore(sourceUrl, targetUrl, 2);
    try {
      await reopenedStore.initialize();
      const retained = await reopenedStore.getSnapshot(snapshotA.id);
      const branch = await createSimulationBranch(reopenedStore.pool, retained, {
        run_id: runRestart,
        school_id: schoolA,
        scenario_id: scenarioRestart,
        namespace_id: `scenario:${scenarioRestart}:run:${runRestart}`,
      });
      expect(branch).toMatchObject({
        run_id: runRestart,
        school_id: schoolA,
        schema_name: simulationBranchSchema(runRestart),
        snapshot_id: snapshotA.id,
      });
      expect((await reopenedStore.pool.query(
        "SELECT 1 FROM dt_simulation.materialized_tables WHERE run_id=$1 AND table_name='campus_spaces'",
        [runRestart],
      )).rowCount).toBe(1);

      const reopenedDriver = new SimulationBranchDriver(reopenedStore.pool, branch, retained);
      await reopenedDriver.init();
      const reopenedConnection = await reopenedDriver.acquireConnection();
      try {
        expect((await execute<{ name: string }>(
          reopenedConnection,
          "SELECT name FROM campus_spaces WHERE id=$1",
          [spaceA],
        )).rows).toEqual([{ name: "Room A Retained" }]);
      } finally {
        await reopenedDriver.releaseConnection(reopenedConnection);
        await reopenedDriver.destroy();
      }
    } finally {
      await reopenedStore.pool.end();
    }
  }, 120_000);

  it("serializes concurrent advances, replays exactly once and rejects stale or mismatched fences", async () => {
    await createSimulationBranch(store.pool, snapshotA, {
      run_id: runFence,
      school_id: schoolA,
      scenario_id: scenarioFence,
      namespace_id: `scenario:${scenarioFence}:run:${runFence}`,
    });
    const registry = new ExecutionDataPlaneRegistry();
    const scope = new ExecutionDataPlaneScope();
    const runtimeAdvance = vi.fn().mockResolvedValue(undefined);
    const runtime: SimulationDomainRuntime = { advance: runtimeAdvance };
    const world = new SimulationWorldService(registry, scope, runtime);
    const first = {
      institution_id: schoolA,
      scenario_id: scenarioFence,
      run_id: runFence,
      namespace_id: `scenario:${scenarioFence}:run:${runFence}` as const,
      kind: "baseline" as const,
      deterministic_seed: "fence-test-seed",
      world_ref: `simulation-world:${runFence}`,
      world_revision: 1,
      checkpoint_ref: `simulation-world:${runFence}:captured`,
      virtual_from: capturedAt,
      virtual_to: "2026-10-19T07:35:00.000Z",
      lease_token: "70000000-0000-4000-8000-000000000002",
      lease_fence: 2,
      lease_until: "2099-10-19T07:35:00.000Z",
    };
    try {
      const [left, right] = await Promise.all([world.advance(first), world.advance(first)]);
      expect(left).toEqual(right);
      expect(runtimeAdvance).toHaveBeenCalledTimes(1);
      expect((await store.pool.query(
        "SELECT 1 FROM dt_simulation.checkpoints WHERE run_id=$1 AND checkpoint_ref=$2",
        [runFence, left.checkpoint_ref],
      )).rowCount).toBe(1);

      await expect(world.advance({
        ...first,
        namespace_id: `scenario:${scenarioFence}:run:70000000-0000-4000-8000-000000000099`,
      })).rejects.toThrow(/identity mismatch/iu);

      await expect(world.advance({
        ...first,
        world_revision: left.world_revision,
        virtual_from: first.virtual_to,
        virtual_to: "2026-10-19T07:40:00.000Z",
        lease_token: "70000000-0000-4000-8000-000000000001",
        lease_fence: 1,
      })).rejects.toThrow(/newer Simulation worker fence/iu);
      expect(runtimeAdvance).toHaveBeenCalledTimes(1);
    } finally {
      await registry.discardAll();
      await world.onApplicationShutdown();
    }
  }, 120_000);

  it("projects published recurring timetables in Live and an isolated run with stable replay and no sibling leakage", async () => {
    const runId = randomUUID(); const siblingId = randomUUID(); const scenarioId = randomUUID();
    const address = (id: string) => ({ run_id: id, school_id: schoolA, scenario_id: scenarioId,
      namespace_id: `scenario:${scenarioId}:run:${id}` as const });
    await createSimulationBranch(store.pool, snapshotA, address(runId));
    const sibling = await createSimulationBranch(store.pool, snapshotA, address(siblingId));
    const registry = new ExecutionDataPlaneRegistry(); const scope = new ExecutionDataPlaneScope();
    const db = new DatabaseService(scope, registry);
    const core = new CampusModelCoreService(db, scope);
    const input: PublishedScheduleProjection = {
      school_id: schoolA, actor_user_id: userA, schedule_version_id: randomUUID(), schedule_revision: 3,
      starts_on: "2026-10-19", ends_on: "2026-10-26", timezone: "Asia/Kolkata", published_at: capturedAt,
      class_section: { kind: "class", domain: "academic_structure", domain_id: randomUUID(),
        label: "Timetable projection fixture", lifecycle_state: "active", source_revision: 1, metadata: {} },
      periods: [{ period_id: randomUUID(), weekday: 1, period_number: 2, starts_at: "09:00", ends_at: "09:45",
        title: "Recurring fixture lesson", slot_type: "activity", subject: null, teacher_user_id: userA,
        space: { kind: "space", domain: "campus_topology", domain_id: spaceA,
          label: "Room A Live", lifecycle_state: "active", source_revision: 1, metadata: {} }, room_snapshot: "Room A" }],
      correlation_id: randomUUID(), causation_event_id: null,
    };
    const personId = randomUUID();
    const projectAndAssert = async (transaction: Transaction<Database>, namespace: string) => {
      await sql`INSERT INTO school_people(id,school_id,first_name,last_name)
        VALUES(${personId}::uuid,${schoolA}::uuid,'Simulation','A')`.execute(transaction);
      await sql`WITH staff_fixture_input(school_id,person_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status) AS (VALUES (${schoolA}::uuid,${personId}::uuid,${userA}::uuid,'TEMPORAL-FIXTURE','Simulation','A','simulation-fixture-a@example.test','non_teaching','Timetable administrator','full_time','2026-01-01','active')) INSERT INTO staff_profiles(school_id,person_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status) SELECT input.school_id::uuid,input.person_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status FROM staff_fixture_input input`.execute(transaction);
      const first = await core.recordPublishedSchedule(transaction, input);
      expect(first).toMatchObject({ occurrence_count: 2, replayed: false });
      expect(await core.recordPublishedSchedule(transaction, input)).toEqual({ ...first, replayed: true });
      const projected = (await sql<{
        occurrence_date: string; starts_at: Date; ends_at: Date; environment_namespace_id: string;
        basis_event_id: string; change_event_id: string; title: string; period_number: number;
        source_revision: number; state: string; logical_occurrence_key: string;
      }>`SELECT occurrence_date::text,starts_at,ends_at,environment_namespace_id,
          basis_event_id,change_event_id,title,period_number,source_revision,state,logical_occurrence_key
        FROM campus_model_schedule_occurrences WHERE school_id=${schoolA}::uuid
          AND schedule_entity_id=${first.schedule_entity_id}::uuid ORDER BY occurrence_date`.execute(transaction)).rows;
      expect(projected.map((occurrence) => occurrence.occurrence_date)).toEqual(["2026-10-19", "2026-10-26"]);
      for (const occurrence of projected) {
        expect(occurrence).toMatchObject({ environment_namespace_id: namespace,
          basis_event_id: first.event_id, change_event_id: first.event_id,
          title: "Recurring fixture lesson", period_number: 2, source_revision: 3, state: "expected" });
        expect(occurrence.logical_occurrence_key).toMatch(/^[a-f0-9]{64}$/u);
        expect(occurrence.starts_at.toISOString()).toBe(`${occurrence.occurrence_date}T03:30:00.000Z`);
        expect(occurrence.ends_at.toISOString()).toBe(`${occurrence.occurrence_date}T04:15:00.000Z`);
      }
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_events
        WHERE school_id=${schoolA}::uuid AND source_record_id=${input.schedule_version_id}
          AND event_type='timetable.schedule_published'`.execute(transaction)).rows[0]?.count).toBe(1);
      return projected;
    };
    const rollback = new Error("rollback Live timetable projection fixture");
    let liveProjection: Awaited<ReturnType<typeof projectAndAssert>> = [];
    const runtimeAdvance = vi.fn(async () => {
      const projected = await db.transaction().execute((transaction) => projectAndAssert(transaction, address(runId).namespace_id));
      expect(projected.map((row) => row.logical_occurrence_key)).toEqual(liveProjection.map((row) => row.logical_occurrence_key));
    });
    const world = new SimulationWorldService(registry, scope, { advance: runtimeAdvance });
    try {
      // Test the same projection against real Live PostgreSQL, then roll its fixture back.
      try {
        await db.transaction().execute(async (transaction) => {
          liveProjection = await projectAndAssert(transaction, `live:${schoolA}`);
          throw rollback;
        });
      } catch (error) { if (error !== rollback) throw error; }
      const advance = { institution_id: schoolA, ...address(runId), kind: "baseline" as const,
        deterministic_seed: "timetable-publication-test", world_ref: `simulation-world:${runId}`,
        world_revision: 1, checkpoint_ref: `simulation-world:${runId}:captured`, virtual_from: capturedAt,
        virtual_to: "2026-10-19T07:35:00.000Z", lease_token: randomUUID(), lease_fence: 1,
        lease_until: "2099-10-19T07:35:00.000Z" };
      const result = await world.advance(advance);
      expect(await world.advance(advance)).toEqual(result);
      expect(runtimeAdvance).toHaveBeenCalledTimes(1);
      expect((await live.query("SELECT 1 FROM campus_model_events WHERE source_record_id=$1", [input.schedule_version_id])).rows).toEqual([]);
      const siblingDriver = new SimulationBranchDriver(store.pool, sibling, snapshotA);
      await siblingDriver.init(); const connection = await siblingDriver.acquireConnection();
      try {
        expect((await execute(connection, "SELECT 1 FROM campus_model_events WHERE source_record_id=$1", [input.schedule_version_id])).rows).toEqual([]);
        expect((await execute(connection, "SELECT 1 FROM campus_model_entities WHERE domain_id=$1", [input.class_section.domain_id])).rows).toEqual([]);
      } finally { await siblingDriver.releaseConnection(connection); await siblingDriver.destroy(); }
    } finally { await db.destroy(); await registry.discardAll(); await world.onApplicationShutdown(); }
  }, 120_000);

  it("measures new submissions and later finalization separately across both register grains", async () => {
    const runId = randomUUID(); const siblingId = randomUUID(); const scenarioId = randomUUID();
    const address = (id: string) => ({ run_id: id, school_id: schoolA, scenario_id: scenarioId,
      namespace_id: `scenario:${scenarioId}:run:${id}` as const });
    await createSimulationBranch(store.pool, snapshotA, address(runId));
    const sibling = await createSimulationBranch(store.pool, snapshotA, address(siblingId));
    const registry = new ExecutionDataPlaneRegistry(); const scope = new ExecutionDataPlaneScope();
    const db = new DatabaseService(scope, registry);
    const termId = randomUUID(); const classId = randomUUID(); const subjectId = randomUUID();
    const runtimeAdvance = vi.fn(async () => {
      await sql`INSERT INTO academic_terms(id,school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active)
        VALUES(${termId}::uuid,${schoolA}::uuid,'2026-27','Metric fixture','2026-01-01','2026-12-31',85,true)`.execute(db);
      await sql`INSERT INTO class_sections(id,school_id,academic_year,grade,section,board,room_number)
        VALUES(${classId}::uuid,${schoolA}::uuid,'2026-27','Metric','A','Fixture','')`.execute(db);
      await sql`INSERT INTO subjects(id,school_id,code,name,short_name)
        VALUES(${subjectId}::uuid,${schoolA}::uuid,'METRIC','Metric fixture','Metric')`.execute(db);
      const samples = [
        { state: "locked", submitted: "07:20", locked: "07:34" }, // captured submission becomes final
        { state: "locked", submitted: "07:10", locked: "07:25" }, // already final at capture
        { state: "submitted", submitted: "07:32", locked: null }, // new submission, not yet final
        { state: "locked", submitted: "07:20", locked: "07:40" }, // beyond committed checkpoint
        { state: "draft", submitted: "07:31", locked: "07:32" }, // reopened, not currently final
        { state: "locked", submitted: "07:20", locked: "07:30" }, // capture boundary is exclusive
      ];
      for (const [index, sample] of samples.entries()) {
        const submittedAt = `2026-10-19T${sample.submitted}:00.000Z`;
        const lockedAt = sample.locked ? `2026-10-19T${sample.locked}:00.000Z` : null;
        await sql`INSERT INTO attendance_registers(school_id,class_section_id,term_id,date,state,revision,
          submitted_by,submitted_at,locked_by,locked_at)
          VALUES(${schoolA}::uuid,${classId}::uuid,${termId}::uuid,${`2026-10-${19 + index}`}::date,
            ${sample.state},2,${userA}::uuid,${submittedAt}::timestamptz,
            ${lockedAt ? userA : null}::uuid,${lockedAt}::timestamptz)`.execute(db);
        await sql`INSERT INTO attendance_session_registers(school_id,class_section_id,term_id,subject_id,
          schedule_slot_id,session_date,period_number,starts_at,ends_at,title,state,revision,
          submitted_by,submitted_at,locked_by,locked_at)
          VALUES(${schoolA}::uuid,${classId}::uuid,${termId}::uuid,${subjectId}::uuid,${randomUUID()}::uuid,
            '2026-10-19',${index + 1},'07:00','08:00','Metric fixture',${sample.state},2,
            ${userA}::uuid,${submittedAt}::timestamptz,${lockedAt ? userA : null}::uuid,${lockedAt}::timestamptz)`.execute(db);
      }
    });
    const world = new SimulationWorldService(registry, scope, { advance: runtimeAdvance });
    const input = { institution_id: schoolA, ...address(runId), kind: "baseline" as const,
      deterministic_seed: "register-metric-test", world_ref: `simulation-world:${runId}`,
      world_revision: 1, checkpoint_ref: `simulation-world:${runId}:captured`, virtual_from: capturedAt,
      virtual_to: "2026-10-19T07:35:00.000Z", lease_token: randomUUID(), lease_fence: 1,
      lease_until: "2099-10-19T07:35:00.000Z" };
    try {
      const result = await world.advance(input);
      expect(result.metrics).toEqual(expect.arrayContaining([
        { key: "submitted_registers", label: "New attendance submissions since snapshot", unit: "registers", value: 2 },
        { key: "finalized_registers", label: "Attendance registers finalized since snapshot", unit: "registers", value: 2 },
      ]));
      expect(await world.advance(input)).toEqual(result);
      expect(runtimeAdvance).toHaveBeenCalledTimes(1);
      expect((await live.query("SELECT 1 FROM attendance_registers WHERE class_section_id=$1", [classId])).rows).toEqual([]);
      const siblingDriver = new SimulationBranchDriver(store.pool, sibling, snapshotA);
      await siblingDriver.init(); const connection = await siblingDriver.acquireConnection();
      try {
        expect((await execute(connection, "SELECT 1 FROM attendance_registers WHERE class_section_id=$1", [classId])).rows).toEqual([]);
        expect((await execute(connection, "SELECT 1 FROM attendance_session_registers WHERE class_section_id=$1", [classId])).rows).toEqual([]);
      } finally { await siblingDriver.releaseConnection(connection); await siblingDriver.destroy(); }
    } finally {
      await db.destroy(); await registry.discardAll(); await world.onApplicationShutdown();
    }
  }, 120_000);

  it("uses the same configured attendance follow-up bridge in Live and one isolated run without leaking work", async () => {
    const registry = new ExecutionDataPlaneRegistry(), scope = new ExecutionDataPlaneScope(), database = new DatabaseService(scope, registry);
    const core = new CampusModelCoreService(database, scope), suffix = randomUUID(), starts = new Date(), date = starts.toISOString().slice(0, 10);
    const fixture = await database.transaction().execute(async tx => {
      const actor = await tx.insertInto("users").values({ username: `followup-${suffix}`, email: `followup-${suffix}@example.test`, password_hash: "isolated-test-only",
        first_name: "Follow-up", last_name: "Owner", role: "admin" }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      const school = await new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, actor, "UTC");
      const person = await tx.insertInto("school_people").values({ school_id: school, first_name: "Passive learner" }).returning("id").executeTakeFirstOrThrow();
      const learner = await tx.insertInto("students").values({ school_id: school, person_id: person.id, admission_number: "FOLLOWUP", user_id: null,
        date_of_birth: null, blood_group: null, emergency_contact: null }).returning("id").executeTakeFirstOrThrow();
      const guardianPerson = await tx.insertInto("school_people").values({ school_id: school, first_name: "Passive guardian" }).returning("id").executeTakeFirstOrThrow();
      const guardian = await tx.insertInto("parents").values({ user_id: null }).returning("id").executeTakeFirstOrThrow();
      await tx.insertInto("guardian_school_profiles").values({ school_id: school, guardian_id: guardian.id, person_id: guardianPerson.id }).execute();
      await tx.insertInto("guardian_relationships").values({ school_id: school, guardian_id: guardian.id, student_id: learner.id, relationship: "guardian" }).execute();
      const term = (await sql<{ id: string }>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on)
        VALUES(${school}::uuid,'2026-2027','Follow-up fixture',${`${date.slice(0, 4)}-01-01`}::date,${`${date.slice(0, 4)}-12-31`}::date) RETURNING id`.execute(tx)).rows[0]!;
      const section = (await sql<{ id: string }>`INSERT INTO class_sections(school_id,academic_year,grade,section)
        VALUES(${school}::uuid,'2026-2027','Follow-up','A') RETURNING id`.execute(tx)).rows[0]!;
      const enrollment = await tx.insertInto("enrollments").values({ student_id: learner.id, class_section_id: section.id, term_id: term.id, roll_number: 1,
        enrolled_on: date }).returning("id").executeTakeFirstOrThrow();
      const occurrence = randomUUID(), register = randomUUID();
      await sql`INSERT INTO schedule_activity_occurrences(id,school_id,activity_id,period_id,source,source_ref,source_revision,title,purpose,local_date,
        starts_at,ends_at,timezone,attendance_mode,context_kind,context_ref,term_id)
        VALUES(${occurrence}::uuid,${school}::uuid,${section.id}::uuid,NULL,'academic',${`daily:${section.id}:${term.id}`},1,'Daily fixture','teaching',
          ${date}::date,${`${date}T00:00:00Z`}::timestamptz,${`${date}T23:59:00Z`}::timestamptz,'UTC','roll_call','academic_class',${section.id}::uuid,${term.id}::uuid)`.execute(tx);
      await sql`INSERT INTO activity_attendance_registers(id,school_id,occurrence_id,roster_fingerprint,roster_source_revision,policy_revision,policy_snapshot)
        VALUES(${register}::uuid,${school}::uuid,${occurrence}::uuid,${"a".repeat(64)},1,1,'{}'::jsonb)`.execute(tx);
      await sql`INSERT INTO activity_attendance_roster(school_id,register_id,person_id,label,participation_role,requirement,source_kind,source_ref,source_revision)
        VALUES(${school}::uuid,${register}::uuid,${person.id}::uuid,'Passive learner','participant','required','class',${enrollment.id},1)`.execute(tx);
      await sql`UPDATE activity_attendance_roster SET academic_student_id=${learner.id}::uuid,
        academic_enrollment_id=${enrollment.id}::uuid,academic_source_revision=1
        WHERE register_id=${register}::uuid AND person_id=${person.id}::uuid`.execute(tx);
      await sql`UPDATE activity_attendance_registers SET context_source_kind='daily_class',context_source_id=${`${section.id}:${term.id}:${date}`},
        context_imported_revision=0,context_imported_at=now(),context_state='active',context_activated_at=now(),
        context_snapshot=${JSON.stringify({ context: { class_id: section.id, term_id: term.id, date, legacy_register_id: null } })}::jsonb
        WHERE id=${register}::uuid AND school_id=${school}::uuid`.execute(tx);
      const entry = (await sql<{ id: string }>`INSERT INTO activity_attendance_entries(school_id,register_id,person_id,status,remarks,capture_channel,observed_at,recorded_by,revision)
        VALUES(${school}::uuid,${register}::uuid,${person.id}::uuid,'absent','','human_roll_call',now(),${actor.id}::uuid,1) RETURNING id`.execute(tx)).rows[0]!;
      const identity = await core.resolveAccountEndpoint(tx, { school_id: school, user_id: actor.id, at: new Date().toISOString() });
      if (!identity.acting) throw new Error("The isolated follow-up owner must have a current canonical person endpoint.");
      const agents = [identity.agent_id];
      for (const index of [1, 2]) {
        const account = await tx.insertInto("users").values({ username: `followup-guardian-${index}-${suffix}`, email: `followup-guardian-${index}-${suffix}@example.test`,
          password_hash: "isolated-test-only", first_name: `Guardian ${index}`, last_name: "Recipient", role: "parent" }).returning("id").executeTakeFirstOrThrow();
        await tx.insertInto("school_memberships").values({ school_id: school, user_id: account.id, role: "guardian", is_active: true }).execute();
        const recipientPerson = await tx.insertInto("school_people").values({ school_id: school, first_name: `Guardian ${index}` }).returning("id").executeTakeFirstOrThrow();
        const recipient = await tx.insertInto("parents").values({ user_id: account.id }).returning("id").executeTakeFirstOrThrow();
        await tx.insertInto("guardian_school_profiles").values({ school_id: school, guardian_id: recipient.id, person_id: recipientPerson.id }).execute();
        await tx.insertInto("guardian_relationships").values({ school_id: school, guardian_id: recipient.id, student_id: learner.id, relationship: "guardian" }).execute();
        const endpoint = await core.linkAccountEndpoint(tx, { school_id: school, person_id: recipientPerson.id, user_id: account.id, actor_user_id: actor.id,
          effective_from: new Date().toISOString(), effective_until: null, source_domain: "people", source_record_id: recipient.id, source_revision: 1,
          metadata: { fixture: "simulation_followup_guardian" } });
        agents.push(endpoint.agent_id);
      }
      for (const [action, selector] of [["opened", "attendance_followup_guardians"], ["assisted_reply", "attendance_followup_owner"]]) {
        const behaviour = (await sql<{ id: string }>`INSERT INTO campus_model_behaviour_versions(school_id,behaviour_key,version,status,effective_from,configuration,
          configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at)
          VALUES(${school}::uuid,${`isolated_followup_${action}`},1,'approved',now()-interval '1 minute','{"workflow":"attendance_followup","fixture":true}',
            1,${identity.agent_id}::uuid,${identity.agent_id}::uuid,now()) RETURNING id`.execute(tx)).rows[0]!;
        await sql`INSERT INTO campus_model_event_subscriptions(school_id,behaviour_version_id,subscription_key,source_domain,event_type,reaction_kind,message_kind,
          message_schema_version,recipient_selector,response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority)
          VALUES(${school}::uuid,${behaviour.id}::uuid,${`followup_${action}`},'coordination',${`coordination.followup.${action}`},'attendance_followup','request',1,
            ${JSON.stringify({ mode: "explicit_authorized_agents", selector_key: selector, required_capability: "coordination.followup.respond",
              scope_mode: "event_scope", min_recipients: 1, max_recipients: 2 })}::jsonb,NULL,NULL,1,NULL,3)`.execute(tx);
      }
      for (const agent of agents) await sql`INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,effective_from,grant_source,grant_reference_id,approved_by)
        VALUES(${school}::uuid,${agent}::uuid,'coordination.followup.respond',now()-interval '1 minute','manual',${`isolated-fixture:${suffix}`},${actor.id}::uuid)`.execute(tx);
      return { actor, school, student: learner.id, guardian: guardian.id, entry: entry.id };
    });
    const snapshot = await store.capture(fixture.school, new Date().toISOString());
    const runId = randomUUID(), siblingId = randomUUID(), scenario = randomUUID(), virtualTo = new Date(Date.parse(snapshot.captured_at) + 300000).toISOString();
    const address = (id: string) => ({ school_id: fixture.school, run_id: id, scenario_id: scenario, namespace_id: `scenario:${scenario}:run:${id}` as const });
    await createSimulationBranch(store.pool, snapshot, address(runId));
    const sibling = await createSimulationBranch(store.pool, snapshot, address(siblingId));
    const runJourney = async (db: DatabaseService, namespace: string) => {
      const kernel = new CampusModelCoreService(db, scope), service = new CoordinationService(db, new FollowupSchoolEventService(db, kernel), new FollowupModelBridgeService(kernel, kernel, kernel));
      const supersede = vi.spyOn(kernel, "supersedeDomainMessage");
      const req = { authUser: { ...fixture.actor, active_school_id: fixture.school }, requestId: randomUUID() } as AuthenticatedRequest;
      const body = { student_id: fixture.student, attendance_date: date, question: "Please clarify the recorded absence.",
        due_at: new Date(Date.parse(virtualTo) + 86400000).toISOString(), idempotency_key: randomUUID() };
      const opened = await service.create(req, body);
      expect(opened.coordination.status).toBe("routed");
      expect(await service.create(req, body)).toEqual(opened);
      const response = { context: "staff", kind: "assisted_reply", guardian_id: fixture.guardian, channel: "phone", observed_at: virtualTo,
        body: "Guardian gave a private explanation by phone.", expected_revision: 1, idempotency_key: randomUUID() };
      const reviewed = await service.respond(req, opened.id, response);
      expect(reviewed.coordination.status).toBe("routed");
      expect(supersede).toHaveBeenCalledTimes(2);
      expect(await service.respond(req, opened.id, response)).toEqual(reviewed);
      expect((await service.respond(req, opened.id, { context: "staff", kind: "resolved", outcome: "absence_explained", body: "Explanation reviewed; attendance remains unchanged.",
        expected_revision: 2, idempotency_key: randomUUID() })).coordination.status).toBe("closed");
      expect((await sql<{ status: string; revision: number }>`SELECT status,revision FROM activity_attendance_entries WHERE id=${fixture.entry}::uuid`.execute(db)).rows[0])
        .toEqual({ status: "absent", revision: 1 });
      const events = (await sql<{ environment_namespace_id: string; payload: unknown }>`SELECT environment_namespace_id,payload FROM campus_model_events
        WHERE source_domain='coordination' AND source_record_id=${opened.id}`.execute(db)).rows;
      expect(events).toHaveLength(3);
      expect(events.every(event => event.environment_namespace_id === namespace)).toBe(true);
      expect(JSON.stringify(events)).not.toContain("private explanation");
      expect((await sql<{ state: string }>`SELECT message.state FROM campus_model_operational_messages message JOIN campus_model_reactions reaction ON reaction.id=message.reaction_id
        JOIN campus_model_events event ON event.id=reaction.trigger_event_id WHERE event.source_domain='coordination' AND event.source_record_id=${opened.id}`.execute(db)).rows.map(message => message.state).sort())
        .toEqual(["cancelled", "cancelled", "responded"]);
      return opened.id;
    };
    const rollback = new Error("rollback Live follow-up journey");
    const runtime = vi.fn(async () => { await runJourney(database, address(runId).namespace_id); });
    const world = new SimulationWorldService(registry, scope, { advance: runtime });
    try {
      try { await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: fixture.school,
        clock: { now: () => new Date(virtualTo), nowIso: () => virtualTo } }), () => database.transaction().execute(async tx => {
          const transactional = new Proxy(tx, { get(target, property) {
            if (property === "transaction") return () => ({ execute: (action: (inner: Transaction<Database>) => Promise<unknown>) => action(tx) });
            const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
          } }) as unknown as DatabaseService;
          await runJourney(transactional, `live:${fixture.school}`); throw rollback;
        })); } catch (error) { if (error !== rollback) throw error; }
      const input = { institution_id: fixture.school, ...address(runId), kind: "baseline" as const, deterministic_seed: "attendance-followup-test",
        world_ref: `simulation-world:${runId}`, world_revision: 1, checkpoint_ref: `simulation-world:${runId}:captured`, virtual_from: snapshot.captured_at,
        virtual_to: virtualTo, lease_token: randomUUID(), lease_fence: 1, lease_until: "2099-10-19T07:35:00.000Z" };
      const result = await world.advance(input);
      expect(await world.advance(input)).toEqual(result);
      expect(runtime).toHaveBeenCalledTimes(1);
      expect((await live.query("SELECT 1 FROM attendance_followups WHERE school_id=$1", [fixture.school])).rows).toEqual([]);
      expect((await live.query("SELECT 1 FROM campus_model_commands WHERE school_id=$1 AND source_domain='coordination'", [fixture.school])).rows).toEqual([]);
      const siblingDriver = new SimulationBranchDriver(store.pool, sibling, snapshot); await siblingDriver.init();
      const connection = await siblingDriver.acquireConnection();
      try { expect((await execute(connection, "SELECT 1 FROM attendance_followups WHERE school_id=$1", [fixture.school])).rows).toEqual([]); }
      finally { await siblingDriver.releaseConnection(connection); await siblingDriver.destroy(); }
    } finally { await database.destroy(); await registry.discardAll(); await world.onApplicationShutdown(); }
  }, 120_000);

  it.each(["measurement", "control", "legacy-reconciliation"] as const)("recovers a committed partial world after %s fails before control completion", async failure => {
    const registry=new ExecutionDataPlaneRegistry(),scope=new ExecutionDataPlaneScope(),database=new DatabaseService(scope,registry);
    const runtimeAdvance=vi.fn(async()=>{await sql`UPDATE campus_spaces SET capacity=capacity+1 WHERE id=${spaceA}::uuid`.execute(database);});
    const world=new SimulationWorldService(registry,scope,{advance:runtimeAdvance}),repository=new SimulationRepository(database),simulations=new SimulationService(repository,world);
    const actor:AuthUser={id:userA,username:'simulation-fixture-a',email:'simulation-fixture-a@example.test',first_name:'Simulation',last_name:'A',role:'admin',is_active:true,active_school_id:schoolA};
    const liveBefore=(await live.query('SELECT capacity FROM campus_spaces WHERE id=$1',[spaceA])).rows;
    let runId:string|undefined;
    try{
      const created=await simulations.create(actor,schoolA,{kind:'scenario',speed:1,idempotency_key:`checkpoint-crash:${randomUUID()}`});runId=created.run.id;
      const baselineCheckpoints=(await repository.requireOwned(runId,userA,schoolA)).checkpoint_count;
      await simulations.start(actor,schoolA,runId,{});
      await sql`UPDATE simulation_runs SET wall_anchor_at=clock_timestamp()-interval '2 minutes',virtual_anchor_at=virtual_started_at,next_wake_at='2000-01-01T00:00:00Z' WHERE id=${runId}::uuid`.execute(database);
      if(failure==='control')vi.spyOn(repository,'completeAdvance').mockRejectedValueOnce(new Error('Injected failure after world commit before control commit'));
      else vi.spyOn(world,'measure').mockRejectedValueOnce(new Error('Injected failure after world commit before measurement'));
      const failed=await simulations.advanceNextDueRun(`crash-first:${runId}`);
      expect(failed).toMatchObject({id:runId,failure_count:1,world_revision:1,checkpoint_count:baselineCheckpoints});
      const pending=(await repository.requireOwned(runId,userA,schoolA)).pending_advance!;
      expect(Date.parse(pending.virtual_to)-Date.parse(pending.virtual_from)).toBeLessThan(300_000);
      const worldCommitted=(await store.pool.query<{virtual_now:Date;revision:string}>('SELECT virtual_now,revision FROM dt_simulation.worlds WHERE run_id=$1',[runId])).rows[0]!;
      expect(new Date(worldCommitted.virtual_now).toISOString()).toBe(pending.virtual_to);expect(Number(worldCommitted.revision)).toBe(2);
      await sql`UPDATE simulation_runs SET wall_anchor_at=clock_timestamp()-interval '3 minutes',next_wake_at='2000-01-01T00:00:00Z'
        ${failure==='legacy-reconciliation'?sql`,pending_advance_from=NULL,pending_advance_to=NULL,pending_advance_world_revision=NULL`:sql``} WHERE id=${runId}::uuid`.execute(database);
      const recovered=await simulations.advanceNextDueRun(`crash-retry:${runId}`);
      expect(recovered).toMatchObject({id:runId,virtual_now:pending.virtual_to,world_revision:2,checkpoint_count:baselineCheckpoints+1,pending_advance:null});
      expect(runtimeAdvance).toHaveBeenCalledOnce();
      expect((await store.pool.query('SELECT 1 FROM dt_simulation.checkpoints WHERE run_id=$1',[runId])).rowCount).toBe(1);
      expect((await live.query('SELECT capacity FROM campus_spaces WHERE id=$1',[spaceA])).rows).toEqual(liveBefore);
    }finally{
      vi.restoreAllMocks();if(runId)await sql`DELETE FROM simulation_runs WHERE id=${runId}::uuid`.execute(database);
      await registry.discardAll();await world.onApplicationShutdown();await database.destroy();
    }
  },120_000);

  it("explicit owner removal frees admission through fenced COW cleanup while retaining history, a sibling and Live", async () => {
    const registry = new ExecutionDataPlaneRegistry(), scope = new ExecutionDataPlaneScope();
    const database = new DatabaseService(scope, registry), world = new SimulationWorldService(registry, scope);
    const repository = new SimulationRepository(database);
    const simulations = new SimulationService(repository, world, { ...DEFAULT_SIMULATION_RESOURCE_POLICY,
      max_worlds_per_institution: 2, max_running_runs_per_institution: 2, max_leases_per_institution: 2,
      max_pinned_runs_per_institution: 2, gc_enabled: false });
    const auth = new AuthService(database, new AuditService(database), {} as never, {} as never, simulations, registry, simulations);
    const actor: AuthUser = { id: userA, username: "simulation-fixture-a", email: "simulation-fixture-a@example.test",
      first_name: "Simulation", last_name: "A", role: "admin", is_active: true, active_school_id: schoolA };
    const request = { ip: "127.0.0.1", headers: {} } as FastifyRequest;
    const before = (await live.query("SELECT name,capacity FROM campus_spaces WHERE id=$1", [spaceA])).rows;
    let sessionHash: string | undefined;
    try {
      const created = await simulations.create(actor, schoolA, { kind: "scenario", speed: 20, idempotency_key: `owner-remove:${randomUUID()}` });
      const sibling = await simulations.duplicate(actor, schoolA, created.run.id, { idempotency_key: `owner-remove-sibling:${randomUUID()}` });
      await expect(simulations.create(actor, schoolA, { kind: "baseline", speed: 20, idempotency_key: `owner-remove-full:${randomUUID()}` }))
        .rejects.toMatchObject({ response: { resource: "worlds" } });
      const original = await repository.requireOwned(created.run.id, userA, schoolA);
      await world.open(original);
      const environment = simulationRequestEnvironment({ institution_id: schoolA, scenario_id: original.scenario_id, run_id: original.id,
        virtual_now: original.virtual_now!, source_snapshot_ref: original.source_snapshot_ref!, manifest_ref: original.manifest_ref!, checked_at: original.manifest_checked_at! });
      await scope.run(environment, () => sql`UPDATE campus_spaces SET name='Run-only removal example' WHERE id=${spaceA}::uuid`.execute(database));
      const stopped = await simulations.stop(actor, schoolA, created.run.id);
      const pinned = await simulations.pin(actor, schoolA, original.id);
      await expect(simulations.remove(actor, schoolA, original.id, { expected_revision: pinned.run.revision })).rejects.toThrow("Only an ended");
      const unpinned = await simulations.unpin(actor, schoolA, original.id);
      const session = await auth.createSession(actor, request); sessionHash = AuthService.tokenHash(session.rawToken);
      await auth.selectExecutionEnvironment(actor, sessionHash, { mode: "simulation", run_id: original.id }, request);
      await expect(simulations.remove(actor, schoolA, original.id, { expected_revision: unpinned.run.revision })).rejects.toThrow("Return every session");
      await auth.selectExecutionEnvironment(actor, sessionHash, { mode: "live" }, request);
      const body = { expected_revision: unpinned.run.revision };
      const removed = await simulations.remove(actor, schoolA, original.id, body);
      expect(removed.run).toMatchObject({ id: original.id, retention: { state: "deleted" },
        metrics: stopped.run.metrics, draft_changes: stopped.run.draft_changes, available_actions: [] });
      expect(await simulations.remove(actor, schoolA, original.id, body)).toEqual(removed);
      expect((await store.pool.query("SELECT 1 FROM dt_simulation.worlds WHERE run_id=$1", [original.id])).rowCount).toBe(0);
      expect((await store.pool.query("SELECT 1 FROM dt_simulation.worlds WHERE run_id=$1", [sibling.run.id])).rowCount).toBe(1);
      expect((await live.query("SELECT reason,retained_shared_snapshot FROM simulation_run_gc_receipts WHERE run_id=$1", [original.id])).rows)
        .toEqual([{ reason: "owner_requested", retained_shared_snapshot: true }]);
      const siblingRun = await repository.requireOwned(sibling.run.id, userA, schoolA); await world.open(siblingRun);
      const siblingEnvironment = simulationRequestEnvironment({ institution_id: schoolA, scenario_id: siblingRun.scenario_id, run_id: siblingRun.id,
        virtual_now: siblingRun.virtual_now!, source_snapshot_ref: siblingRun.source_snapshot_ref!, manifest_ref: siblingRun.manifest_ref!, checked_at: siblingRun.manifest_checked_at! });
      expect((await scope.run(siblingEnvironment, () => sql`SELECT name,capacity FROM campus_spaces WHERE id=${spaceA}::uuid`.execute(database))).rows).toEqual(before);
      expect((await live.query("SELECT name,capacity FROM campus_spaces WHERE id=$1", [spaceA])).rows).toEqual(before);
      const replacement = await simulations.create(actor, schoolA, { kind: "baseline", speed: 20, idempotency_key: `owner-remove-room:${randomUUID()}` });
      expect(replacement.run.status).toBe("draft");
      expect((await simulations.list(actor, schoolA, { view: "retained" })).page?.total).toBe(2);
    } finally {
      if (sessionHash) await database.deleteFrom("auth_sessions").where("token_hash", "=", sessionHash).execute();
      await registry.discardAll(); await world.onApplicationShutdown(); await database.destroy();
    }
  }, 120_000);

  it("keeps completed and stopped retained worlds selectable across Auth, registry reuse and process restart", async () => {
    const registry = new ExecutionDataPlaneRegistry();
    const scope = new ExecutionDataPlaneScope();
    const database = new DatabaseService(scope, registry);
    const world = new SimulationWorldService(registry, scope);
    const repository = new SimulationRepository(database);
    const simulations = new SimulationService(repository, world);
    const auth = new AuthService(database, new AuditService(database), {} as never, {} as never,
      simulations, registry, simulations);
    const actor: AuthUser = { id: userA, username: "simulation-fixture-a", email: "simulation-fixture-a@example.test",
      first_name: "Simulation", last_name: "A", role: "admin", is_active: true, active_school_id: schoolA };
    const request = { ip: "127.0.0.1", headers: {} } as FastifyRequest;
    const createdRuns: string[] = [];
    let sessionToken = "";
    let worldClosed = false;
    const before = (await live.query("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows;
    try {
      const session = await auth.createSession(actor, request);
      sessionToken = session.rawToken;
      const sessionHash = AuthService.tokenHash(sessionToken);
      for (const terminal of ["completed", "stopped"] as const) {
        const created = await simulations.create(actor, schoolA, { kind: "scenario", speed: 20,
          end_at: terminal === "completed" ? new Date(Date.now() + 60_000).toISOString() : null,
          idempotency_key: `retention-auth:${randomUUID()}` });
        const runId = created.run.id;
        createdRuns.push(runId);
        await simulations.start(actor, schoolA, runId, {});
        await auth.selectExecutionEnvironment(actor, sessionHash, { mode: "simulation", run_id: runId }, request);
        expect((await auth.resolveSession(sessionToken))?.executionEnvironmentView)
          .toMatchObject({ mode: "simulation", run_status: "running", expires_at: "9999-12-31T23:59:59.999Z" });
        const beforeSealEnvironment=(await auth.resolveSession(sessionToken))!.executionEnvironment!;
        const importId=randomUUID(),termId=randomUUID();
        await scope.run(beforeSealEnvironment,async()=>{
          await sql`INSERT INTO academic_terms(id,school_id,academic_year,name,starts_on,ends_on,is_active)
            VALUES(${termId}::uuid,${schoolA}::uuid,'2026-27',${`Terminal privacy ${runId}`},'2026-04-01','2027-03-31',true)`.execute(database);
          await sql`INSERT INTO people_imports(id,school_id,term_id,created_by,filename,upload_key,source_digest,row_count,expires_at)
            VALUES(${importId}::uuid,${schoolA}::uuid,${termId}::uuid,${userA}::uuid,'terminal.csv',${randomUUID()}::uuid,
              ${'0'.repeat(64)},1,now()-interval '1 hour')`.execute(database);
          await sql`INSERT INTO people_import_rows(school_id,import_id,row_number,raw_values)
            VALUES(${schoolA}::uuid,${importId}::uuid,2,'{"private":"terminal raw details"}'::jsonb)`.execute(database);
        });
        if (terminal === "stopped") {
          await simulations.pause(actor, schoolA, runId);
          expect((await auth.resolveSession(sessionToken))?.executionEnvironmentView)
            .toMatchObject({ run_status: "paused", expires_at: "9999-12-31T23:59:59.999Z" });
          await simulations.resume(actor, schoolA, runId, {});
          await simulations.stop(actor, schoolA, runId);
        } else {
          await sql`UPDATE simulation_runs SET wall_anchor_at=clock_timestamp()-interval '10 seconds',
            virtual_anchor_at=virtual_started_at,next_wake_at='2000-01-01T00:00:00Z'
            WHERE id=${runId}::uuid`.execute(database);
          expect(await simulations.advanceNextDueRun(`retention-test:${runId}`))
            .toMatchObject({ id: runId, status: "completed" });
        }
        const retained = await repository.requireOwned(runId, userA, schoolA);
        expect(retained.retention_expires_at).not.toBeNull();
        const resolved = await auth.resolveSession(sessionToken);
        expect(resolved?.executionEnvironmentView).toMatchObject({ mode: "simulation", run_status: terminal,
          expires_at: retained.retention_expires_at });
        const environment = resolved?.executionEnvironment;
        if (!environment || environment.kind !== "simulation") throw new Error("A retained world must stay executable for reads.");
        expect(registry.assertEnvironmentReady(environment)?.expires_at).toBe(retained.retention_expires_at);
        expect(await scope.run(environment, () => database.selectFrom("campus_spaces").select("name").where("id", "=", spaceA).execute()))
          .toEqual(before);
        await expect(scope.run(environment,()=>sql`UPDATE campus_spaces SET capacity=capacity+1 WHERE id=${spaceA}::uuid`.execute(database))).rejects.toThrow('read-only');
        const seal=(await store.pool.query<{domain_read_only:boolean;terminal_privacy_receipt:unknown}>('SELECT domain_read_only,terminal_privacy_receipt FROM dt_simulation.worlds WHERE run_id=$1',[runId])).rows[0]!;
        expect(seal.domain_read_only).toBe(true);expect(seal.terminal_privacy_receipt).toMatchObject({policy:'terminal-import-privacy/v1',expired_import_count:1});
        await scope.run(environment,async()=>{
          const beforeRead=await sql<{revision:number}>`SELECT revision FROM people_imports WHERE id=${importId}::uuid`.execute(database);
          expect((await sql`SELECT raw_values FROM people_import_rows WHERE import_id=${importId}::uuid`.execute(database)).rows).toEqual([{raw_values:{}}]);
          expect(await new PeopleImportService(database,{} as SchoolEventService).detail(actor,importId,schoolA)).toMatchObject({state:'expired',revision:beforeRead.rows[0]!.revision,review:null});
          expect((await sql`SELECT revision FROM people_imports WHERE id=${importId}::uuid`.execute(database)).rows).toEqual(beforeRead.rows);
        });
        expect((await live.query('SELECT 1 FROM people_imports WHERE id=$1',[importId])).rowCount).toBe(0);
        await auth.selectExecutionEnvironment(actor, sessionHash, { mode: "live" }, request);
        expect((await auth.resolveSession(sessionToken))?.executionEnvironmentView).toMatchObject({ mode: "live" });
        await auth.selectExecutionEnvironment(actor, sessionHash, { mode: "simulation", run_id: runId }, request);
        await simulations.pin(actor, schoolA, runId);
        expect((await auth.resolveSession(sessionToken))?.executionEnvironmentView)
          .toMatchObject({ run_status: terminal, expires_at: "9999-12-31T23:59:59.999Z" });
        await simulations.unpin(actor, schoolA, runId);
        expect((await auth.resolveSession(sessionToken))?.executionEnvironmentView)
          .toMatchObject({ run_status: terminal, expires_at: expect.not.stringContaining("9999") });
      }

      await registry.discardAll();
      await world.onApplicationShutdown();
      worldClosed = true;
      const restartedRegistry = new ExecutionDataPlaneRegistry();
      const restartedScope = new ExecutionDataPlaneScope();
      const restartedDb = new DatabaseService(restartedScope, restartedRegistry);
      const restartedWorld = new SimulationWorldService(restartedRegistry, restartedScope);
      const restartedSimulations = new SimulationService(new SimulationRepository(restartedDb), restartedWorld);
      const restartedAuth = new AuthService(restartedDb, new AuditService(restartedDb), {} as never, {} as never,
        restartedSimulations, restartedRegistry, restartedSimulations);
      try {
        const reopened = await restartedAuth.resolveSession(sessionToken);
        expect(reopened?.executionEnvironmentView).toMatchObject({ mode: "simulation", run_status: "stopped" });
        const environment = reopened?.executionEnvironment;
        if (!environment || environment.kind !== "simulation") throw new Error("Restart must reopen retained Simulation reads.");
        expect(await restartedScope.run(environment, () => restartedDb.selectFrom("campus_spaces").select("name").where("id", "=", spaceA).execute()))
          .toEqual(before);
        await sql`UPDATE simulation_runs SET created_at=clock_timestamp()-interval '3 seconds',
          retention_started_at=clock_timestamp()-interval '2 seconds',
          retention_expires_at=clock_timestamp()-interval '1 second'
          WHERE id=${createdRuns.at(-1)!}::uuid`.execute(restartedDb);
        expect((await restartedAuth.resolveSession(sessionToken))?.executionEnvironmentView)
          .toMatchObject({ mode: "simulation", unavailable: true });
        await restartedAuth.selectExecutionEnvironment(actor, AuthService.tokenHash(sessionToken), { mode: "live" }, request);
        expect((await restartedAuth.resolveSession(sessionToken))?.executionEnvironmentView).toMatchObject({ mode: "live" });
      } finally {
        await restartedRegistry.discardAll();
        await restartedWorld.onApplicationShutdown();
        await restartedDb.destroy();
      }
      expect((await live.query("SELECT name FROM campus_spaces WHERE id=$1", [spaceA])).rows).toEqual(before);
    } finally {
      if (sessionToken) await database.deleteFrom("auth_sessions").where("token_hash", "=", AuthService.tokenHash(sessionToken)).execute();
      if (createdRuns.length) await sql`DELETE FROM simulation_runs WHERE id=ANY(${createdRuns}::uuid[])`.execute(database);
      await registry.discardAll();
      if (!worldClosed) await world.onApplicationShutdown();
      await database.destroy();
    }
  }, 120_000);

  it("runs People expiry and Transport retention through native services in one branch only and survives reopen", async () => {
    const runId = randomUUID(); const otherRunId = randomUUID(); const scenarioId = randomUUID();
    const branch = await createSimulationBranch(store.pool, snapshotA, { run_id: runId, school_id: schoolA,
      scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
    const otherBranch = await createSimulationBranch(store.pool, snapshotA, { run_id: otherRunId, school_id: schoolA,
      scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${otherRunId}` });
    const virtualNow = "2026-10-20T07:30:00.000Z";
    const environment = simulationRequestEnvironment({ institution_id: schoolA, run_id: runId, scenario_id: scenarioId,
      virtual_now: virtualNow, source_snapshot_ref: `sha256:${snapshotA.content_hash}`,
      manifest_ref: `native-workers:${runId}`, checked_at: capturedAt });
    const registry = new ExecutionDataPlaneRegistry();
    const scope = new ExecutionDataPlaneScope();
    const driver = new SimulationBranchDriver(store.pool, branch, snapshotA);
    const effects = new ExecutionEffectRouter();
    const effectCoverage = effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map((kind) => (
      new RunScopedInMemoryExecutionEffectSink(kind, `native-worker:${kind}`, environment)
    )) });
    await registry.prepare({ environment, driver, effectCoverage, coverage: {
      manifest_ref: environment.coverage_gate.manifest_ref,
      checked_at: environment.coverage_gate.checked_at,
      enabled_modules: [],
      modules: REQUIRED_APPLICATION_SIMULATION_MODULES.map((module_id) => ({ module_id, capabilities: {
        snapshot: "supported" as const, queries: "supported" as const, commands: "supported" as const,
        events: "supported" as const, realtime: "supported" as const,
      } })),
      storage_mode: "isolated_copy_on_write",
      event_outbox_mode: "isolated",
      operational_message_mode: "sink_only",
      file_storage_mode: "isolated",
      external_connector_mode: "sink_only",
      realtime_mode: "isolated",
      uncovered_effects: [],
    } });
    const db = new DatabaseService(scope, registry);
    const termId = randomUUID(); const importId = randomUUID(); const routeId = randomUUID(); const tripId = randomUUID();
    let expiredSampleId = ""; let retainedSampleId = "";
    try {
      await scope.run(environment, async () => {
        await sql`INSERT INTO academic_terms(id,school_id,academic_year,name,starts_on,ends_on,is_active)
          VALUES(${termId}::uuid,${schoolA}::uuid,'2026-27','Simulation native workers','2026-04-01','2027-03-31',true)`.execute(db);
        await sql`INSERT INTO people_imports(id,school_id,term_id,created_by,filename,upload_key,source_digest,row_count,expires_at)
          VALUES(${importId}::uuid,${schoolA}::uuid,${termId}::uuid,${userA}::uuid,'simulation.csv',${randomUUID()}::uuid,
            ${"0".repeat(64)},1,'2026-10-20T07:00:00Z')`.execute(db);
        await sql`INSERT INTO people_import_rows(school_id,import_id,row_number,raw_values)
          VALUES(${schoolA}::uuid,${importId}::uuid,2,'{"private":"must be cleared"}'::jsonb)`.execute(db);
        await sql`INSERT INTO departure_policies(school_id,location_retention_hours,updated_by)
          VALUES(${schoolA}::uuid,1,${userA}::uuid)
          ON CONFLICT(school_id) DO UPDATE SET location_retention_hours=1,updated_by=excluded.updated_by`.execute(db);
        await sql`INSERT INTO transport_routes(id,school_id,code,name,created_by,updated_by)
          VALUES(${routeId}::uuid,${schoolA}::uuid,${`SIM-${runId.slice(0, 8)}`},'Simulation route',${userA}::uuid,${userA}::uuid)`.execute(db);
        await sql`INSERT INTO transport_trips(id,school_id,route_id,service_date,direction,scheduled_departure_time,
          assigned_collector_user_id,collector_assignment_status,created_by)
          VALUES(${tripId}::uuid,${schoolA}::uuid,${routeId}::uuid,'2026-10-20','to_institution','07:00',
            ${userA}::uuid,'pending',${userA}::uuid)`.execute(db);
        expiredSampleId = String((await sql<{ id: string }>`INSERT INTO transport_location_samples(
          school_id,trip_id,recorded_by,latitude,longitude,accuracy_metres,observed_at,received_at)
          VALUES(${schoolA}::uuid,${tripId}::uuid,${userA}::uuid,28.6139,77.2090,10,'2026-10-20T05:00:00Z','2026-10-20T05:00:00Z') RETURNING id`.execute(db)).rows[0]!.id);
        retainedSampleId = String((await sql<{ id: string }>`INSERT INTO transport_location_samples(
          school_id,trip_id,recorded_by,latitude,longitude,accuracy_metres,observed_at,received_at)
          VALUES(${schoolA}::uuid,${tripId}::uuid,${userA}::uuid,28.6140,77.2091,10,'2026-10-20T07:00:00Z','2026-10-20T07:00:00Z') RETURNING id`.execute(db)).rows[0]!.id);

        await new PeopleImportService(db, {} as SchoolEventService).expireDrafts();
        await new TransportRetentionService(db).purgeExpired();
        expect((await sql<{ state: string }>`SELECT state FROM people_imports WHERE id=${importId}::uuid`.execute(db)).rows[0])
          .toEqual({ state: "expired" });
        expect((await sql<{ raw_values: Record<string, unknown> }>`SELECT raw_values FROM people_import_rows WHERE import_id=${importId}::uuid`.execute(db)).rows[0])
          .toEqual({ raw_values: {} });
        expect((await db.selectFrom("transport_location_samples").select("id").where("trip_id", "=", tripId).execute()).map((row) => String(row.id)))
          .toEqual([retainedSampleId]);
      });

      const otherDriver = new SimulationBranchDriver(store.pool, otherBranch, snapshotA);
      await otherDriver.init();
      const otherConnection = await otherDriver.acquireConnection();
      try {
        expect((await execute(otherConnection, "SELECT 1 FROM people_imports WHERE id=$1", [importId])).rows).toEqual([]);
        expect((await execute(otherConnection, "SELECT 1 FROM transport_location_samples WHERE trip_id=$1", [tripId])).rows).toEqual([]);
      } finally {
        await otherDriver.releaseConnection(otherConnection);
        await otherDriver.destroy();
      }
      expect((await live.query("SELECT 1 FROM people_imports WHERE id=$1", [importId])).rows).toEqual([]);
      expect((await live.query("SELECT 1 FROM transport_location_samples WHERE trip_id=$1", [tripId])).rows).toEqual([]);
    } finally {
      await db.destroy();
    }

    const reopenedDriver = new SimulationBranchDriver(store.pool, branch, snapshotA);
    await reopenedDriver.init();
    const reopened = await reopenedDriver.acquireConnection();
    try {
      expect((await execute<{ state: string }>(reopened, "SELECT state FROM people_imports WHERE id=$1", [importId])).rows)
        .toEqual([{ state: "expired" }]);
      expect((await execute<{ id: string }>(reopened, "SELECT id::text AS id FROM transport_location_samples WHERE trip_id=$1", [tripId])).rows)
        .toEqual([{ id: retainedSampleId }]);
      expect((await execute(reopened, "SELECT 1 FROM transport_location_samples WHERE id=$1", [expiredSampleId])).rows).toEqual([]);
    } finally {
      await reopenedDriver.releaseConnection(reopened);
      await reopenedDriver.destroy();
    }
  }, 120_000);

  it("persists isolated effects/files, protects receipts and collects terminal forks without deleting a shared snapshot", async () => {
    const snapshot = await store.capture(schoolA, capturedAt);
    const runId = randomUUID(); const secondId = randomUUID(); const scenarioId = randomUUID();
    const address = (id: string) => ({ run_id: id, school_id: schoolA, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${id}` });
    await createSimulationBranch(store.pool, snapshot, address(runId));
    await createSimulationBranch(store.pool, snapshot, address(secondId));
    await initializeSimulationResources(store.pool);
    const environment = simulationRequestEnvironment({ institution_id: schoolA, run_id: runId, scenario_id: scenarioId,
      virtual_now: capturedAt, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'resource-test', checked_at: capturedAt });
    const resources = new SimulationResourceStore(store.pool, environment);
    const router = new ExecutionEffectRouter();
    router.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
    bindSimulationResources({ environment, artifacts: resources, effects: router, effectReplay: resources });
    try {
      const capture = () => captureSimulationProviderEffect({ kind: 'connector_call', provider: 'test', operation: 'capture',
        logicalKey: 'private-address@example.test', idempotencyKey: 'stable-retry', payload: { evidence_mode: 'simulation', external: false } });
      const first = await executionEnvironmentStorage.run(environment, capture);
      const laterEnvironment = simulationRequestEnvironment({ institution_id: schoolA, run_id: runId, scenario_id: scenarioId,
        virtual_now: "2026-10-20T07:30:00.000Z", source_snapshot_ref: `sha256:${snapshot.content_hash}`,
        manifest_ref: 'resource-test', checked_at: capturedAt });
      const retry = await executionEnvironmentStorage.run(laterEnvironment, capture);
      expect(retry).toMatchObject({ sink_record_id: first!.sink_record_id, status: 'deduplicated' });
      const key = simulationLogicalDigest('private/source/path.txt');
      await resources.write(key, Buffer.from('isolated bytes'), true);
      await expect(resources.write(key, Buffer.from('overwrite'), true)).rejects.toMatchObject({ code: 'EEXIST' });
      expect((await new SimulationResourceStore(store.pool, environment).read(key))?.toString()).toBe('isolated bytes');
      const otherEnvironment = simulationRequestEnvironment({ institution_id: schoolA, run_id: secondId, scenario_id: scenarioId,
        virtual_now: capturedAt, source_snapshot_ref: 'source', manifest_ref: 'other-resource-test', checked_at: capturedAt });
      expect(await new SimulationResourceStore(store.pool, otherEnvironment).read(key)).toBeNull();
      const list = await resources.list(1, 5);
      expect(list.counts).toMatchObject({ artifacts: 1, artifact_bytes: 14, effects: { connector_call: 1 } });
      expect(JSON.stringify(list)).not.toContain('private-address');
      await expect(store.pool.query('DELETE FROM dt_simulation.effects WHERE run_id=$1', [runId])).rejects.toMatchObject({ code: 'P0001' });
      const usage = await measureSimulationWorld(store.pool, { id: runId, school_id: schoolA, namespace_id: environment.namespace_id } as PersistedSimulationRun);
      expect(usage.exclusive_bytes).toBeGreaterThanOrEqual(14);
      expect(usage.shared_snapshot_bytes).toBeGreaterThan(0);
      const gc = (id: string) => {
        const token = randomUUID();
        return { run: { id, school_id: schoolA, namespace_id: address(id).namespace_id, status: 'stopped', gc_state: 'deleting',
          gc_lease_token: token, gc_lease_fence: 1, gc_lease_until: '2099-01-01T00:00:00Z', pinned_at: null, retention_expires_at: '2026-01-01T00:00:00Z' } as PersistedSimulationRun,
          gc_token: token, gc_fence: 1, requested_at: new Date().toISOString() };
      };
      const firstInput = gc(runId);
      await expect(garbageCollectSimulationWorld(store.pool, { ...firstInput, run: { ...firstInput.run, pinned_at: capturedAt } })).rejects.toThrow(/unpinned/iu);
      const firstCollected = await garbageCollectSimulationWorld(store.pool, firstInput);
      expect(firstCollected.retained_shared_snapshot).toBe(true);
      expect(await garbageCollectSimulationWorld(store.pool, firstInput)).toEqual(firstCollected);
      expect((await store.pool.query('SELECT 1 FROM dt_simulation.snapshots WHERE id=$1', [snapshot.id])).rowCount).toBe(1);
      const secondCollected = await garbageCollectSimulationWorld(store.pool, gc(secondId));
      expect(secondCollected.retained_shared_snapshot).toBe(false);
      expect((await store.pool.query('SELECT 1 FROM dt_simulation.snapshots WHERE id=$1', [snapshot.id])).rowCount).toBe(0);
      expect((await store.pool.query('SELECT 1 FROM dt_simulation.gc_receipts WHERE run_id=ANY($1::uuid[])', [[runId, secondId]])).rowCount).toBe(2);
      expect((await live.query('SELECT name FROM campus_spaces WHERE id=$1', [spaceA])).rows[0]?.name).not.toBeUndefined();
    } finally { unbindSimulationResources(environment.namespace_id); }
  }, 120_000);
});
