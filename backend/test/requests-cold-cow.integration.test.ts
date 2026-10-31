import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { Kysely, PostgresDialect, type Dialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { RequestsService, type WorkspaceRequestContext } from "../src/requests/requests.service.js";
import type { RequestInboxItem } from "../src/requests/requests.types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.SIMULATION_REQUESTS_DATABASE_TEST_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/source_test";
const targetUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_REQUESTS_TARGET_DATABASE_URL) : "postgresql://invalid.invalid/target_test";

describe.runIf(enabled)("native cold-COW Requests read admission", () => {
  const sourcePool = new Pool({ connectionString: sourceUrl, max: 2 });
  const source = new Kysely<Database>({ dialect: new PostgresDialect({ pool: sourcePool }) });
  const locks = new Pool({ connectionString: targetUrl, max: 1 });
  let store: SimulationSnapshotStore;
  let campus: Kysely<Database> | undefined;
  let actor: AuthUser;
  let schoolId: string;
  const runId = randomUUID(), scenarioId = randomUUID();
  const instant = "2026-10-28T12:00:00.000Z";
  const execution = new ExecutionDataPlaneScope();
  let read: RequestsService;
  let environment: ReturnType<typeof simulationRequestEnvironment>;

  beforeAll(async () => {
    types.setTypeParser(1082, value => value);
    const suffix = randomUUID();
    const user = await source.insertInto("users").values({ username: `cold-requests-${suffix}`,
      email: `cold-requests-${suffix}@example.test`, password_hash: "unused-isolated-test",
      first_name: "Synthetic", last_name: "Coordinator", role: "admin" }).returningAll().executeTakeFirstOrThrow();
    schoolId = (await source.insertInto("schools").values({ name: "Synthetic cold Requests campus",
      code: `cold-requests-${suffix.slice(0, 12)}`, timezone: "Asia/Kolkata" }).returning("id").executeTakeFirstOrThrow()).id;
    await source.insertInto("school_memberships").values({ school_id: schoolId, user_id: user.id, role: "admin" }).execute();
    actor = { ...user, active_school_id: schoolId };
    store = new SimulationSnapshotStore(sourceUrl, targetUrl, 4);
    const snapshot = await store.capture(schoolId, instant, runId);
    const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: schoolId,
      scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
    const postgres = new PostgresDialect({ pool: store.pool });
    const dialect: Dialect = { createDriver: () => new SimulationBranchDriver(store.pool, branch, snapshot),
      createAdapter: () => postgres.createAdapter(), createQueryCompiler: () => postgres.createQueryCompiler(),
      createIntrospector: database => postgres.createIntrospector(database) };
    campus = new Kysely<Database>({ dialect });
    read = new RequestsService(campus as DatabaseService, undefined, execution);
    environment = simulationRequestEnvironment({ institution_id: schoolId, scenario_id: scenarioId, run_id: runId,
      virtual_now: instant, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "cold-requests-test", checked_at: instant });
  }, 30_000);

  afterAll(async () => {
    await campus?.destroy();
    await store?.pool.end();
    await locks.end();
    await source.destroy();
  });

  it("retains a control connection while cold domain leaves wait on the native COW gate, then returns complete ordinary Work", async () => {
    const probe = read as unknown as { principalOperationalItems: (scope: unknown) => Promise<RequestInboxItem[]> };
    const context = { school_id: schoolId, school_name: "Synthetic cold Requests campus", timezone: "Asia/Kolkata", student_id: null, student_name: null };
    const guard = await locks.connect();
    let work: Promise<RequestInboxItem[][]> | undefined;
    try {
      await guard.query("BEGIN");
      await guard.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`cow:${runId}`]);
      work = Promise.all([
        execution.run(environment, () => probe.principalOperationalItems(context)),
        execution.run(environment, () => probe.principalOperationalItems(context)),
      ]);
      for (let index = 0; index < 100 && store.pool.totalCount - store.pool.idleCount < 3; index += 1) await setTimeout(10);
      expect(store.pool.totalCount - store.pool.idleCount).toBe(3);
      expect(store.pool.waitingCount).toBe(0);
      const started = performance.now();
      const control = await Promise.race([
        store.pool.query("SELECT domain_read_only FROM dt_simulation.worlds WHERE run_id=$1", [runId]),
        setTimeout(500).then(() => { throw new Error("Control read starved behind cold Work projections"); }),
      ]);
      expect(control.rows).toEqual([{ domain_read_only: false }]);
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      await guard.query("ROLLBACK");
      guard.release();
      await work;
    }
    expect(await work).toEqual([[], []]);
    const projected: WorkspaceRequestContext = { ...context, environment_namespace_id: environment.namespace_id,
      recorded_at: instant, membership_roles: ["admin"], relationships: [], assignments: [{
        action_key: "attendance.view", capability_key: "attendance", scope: { kind: "institution", id: schoolId },
      }] };
    const live = new RequestsService(source as DatabaseService);
    const before = await live.workspaceItems(actor, { ...projected, environment_namespace_id: `live:${schoolId}` });
    const [first, repeated] = await Promise.all([
      execution.run(environment, () => read.workspaceItems(actor, projected)),
      execution.run(environment, () => read.workspaceItems(actor, projected)),
    ]);
    expect(first).toEqual(before);
    expect(repeated).toEqual(first);
    expect(await live.workspaceItems(actor, { ...projected, environment_namespace_id: `live:${schoolId}` })).toEqual(before);
    expect(Number((await store.pool.query("SELECT count(*) count FROM dt_simulation.materialized_tables WHERE run_id=$1", [runId])).rows[0].count)).toBeGreaterThan(0);
  }, 30_000);
});
