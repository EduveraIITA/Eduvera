import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { bindSimulationResources, unbindSimulationResources } from "../src/common/simulation-resources.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { createElectiveFixture, electiveServices } from "./learning-elective-change.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/elective_worlds_unused_test";
const target = process.env.LEARNING_ASSIGNMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; }); afterAll(() => db.destroy());
describe.skipIf(!enabled || !target)("elective review selected-world ownership", () => {
  it("captures all three immutable tables and applies Finance/roster only in one real COW branch; Live and sibling stay pending", async () => {
    const f = await createElectiveFixture(db), input = f.input(); await f.service.request(f.owner, input); await f.classify(input.change_id, "requires_financial_review");
    const delivery = (await sql<{ delivery: { message_id: string; source_revision: number } }>`SELECT data->'delivery' AS delivery FROM learning_elective_change_actions
      WHERE school_id=${f.schoolId}::uuid AND change_id=${input.change_id}::uuid AND kind='request'`.execute(db)).rows[0]!.delivery;
    const candidate = { message_id: delivery.message_id, change_id: input.change_id, source_revision: delivery.source_revision };
    expect(await f.service.financeWorkSources(f.owner, f.schoolId, [candidate])).toEqual([{ ...candidate, revision: 2 }]);
    const declinedApply = { command_id: randomUUID(), expected_revision: 2 };
    await expect(f.service.apply(f.owner, input.change_id, declinedApply)).rejects.toThrow("Finance");
    const now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2), opened: Kysely<Database>[] = [], namespaces: string[] = [];
    const tables = ["learning_elective_changes", "learning_elective_change_actions", "fee_elective_change_reviews", "learning_elective_change_refusals"];
    try {
      const snapshot = await store.capture(f.schoolId, now); expect(snapshot.counts.learning_elective_changes).toBe(1); expect(snapshot.counts.learning_elective_change_actions).toBe(2); expect(snapshot.counts.fee_elective_change_reviews).toBe(1); expect(snapshot.counts.learning_elective_change_refusals).toBe(1);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: f.schoolId, scenario_id: scenario, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "elective-review-world-test", checked_at: now });
        const resources = new SimulationResourceStore(store.pool, environment), router = new ExecutionEffectRouter();
        router.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects: router, effectReplay: resources }); namespaces.push(namespace);
        return { ...electiveServices(database), database, environment, namespace, resources,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open();
      const before = async (database: DatabaseService) => Promise.all(tables.map(table => sql`SELECT * FROM ${sql.table(table)} WHERE school_id=${f.schoolId}::uuid ORDER BY id`.execute(database).then(value => value.rows)));
      const liveBefore = await before(db), siblingBefore = await sibling.run(() => before(sibling.database));
      await world.run(async () => {
        expect(await before(world.database)).toEqual(siblingBefore);
        expect(await world.service.financeWorkSources(f.owner, f.schoolId, [candidate])).toEqual([{ ...candidate, revision: 2 }]);
        try { await world.service.apply(f.owner, input.change_id, declinedApply); throw new Error("Expected retained terminal refusal"); }
        catch (cause) { expect((cause as { getResponse(): unknown }).getResponse()).toMatchObject({ code: "elective_change_refused", fields: { elective_change_refusal: { environment_namespace_id: world.namespace, receipt_state: "completed" } } }); }
        const workspace = await world.service.financeWorkspace(f.owner, f.schoolId, input.change_id), command = { command_id: randomUUID(), expected_revision: workspace.revision,
          expected_ledger_basis_hash: workspace.ledger_basis_hash, outcome: "no_financial_change", reason: "Reviewed exact branch-local current ledger. No adjustment is needed in this rehearsal." };
        const record = world.finance.record.bind(world.finance), wrongWorld = vi.spyOn(world.finance, "record").mockImplementation((tx, value, data) => executionEnvironmentStorage.run(sibling.environment, () => record(tx, value, data)));
        try { await expect(world.service.classify(f.owner, f.schoolId, input.change_id, command)).rejects.toThrow(); } finally { wrongWorld.mockRestore(); }
        expect(await before(world.database)).toEqual(siblingBefore);
        expect(await world.service.classify(f.owner, f.schoolId, input.change_id, command)).toMatchObject({ revision: 3, state: "no_financial_change" });
        expect(await world.service.financeWorkSources(f.owner, f.schoolId, [candidate])).toEqual([]);
        expect(await world.service.classify(f.owner, f.schoolId, input.change_id, command)).toMatchObject({ replayed: true });
        const apply = { command_id: randomUUID(), expected_revision: 3 };
        expect(await world.service.apply(f.owner, input.change_id, apply)).toMatchObject({ revision: 4, state: "applied" });
        expect(await world.service.apply(f.owner, input.change_id, apply)).toMatchObject({ replayed: true });
        const counts = (await before(world.database)).map(rows => rows.length); expect(counts).toEqual([1, 4, 2, 1]);
        const latest = await world.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"]).where("correlation_id", "=", apply.command_id).where("handler_key", "=", "learning.elective_change").execute();
        expect(latest).toEqual([{ state: "accepted", environment_namespace_id: world.namespace }]);
        expect((await sql`SELECT id FROM learning_offering_enrollments WHERE school_id=${f.schoolId}::uuid AND offering_id=${f.destination.id}::uuid AND person_id=${f.learner.id}::uuid`.execute(world.database)).rows).toHaveLength(1);
      });
      expect(await before(db)).toEqual(liveBefore); expect(await sibling.run(() => before(sibling.database))).toEqual(siblingBefore);
      expect(await f.service.financeWorkSources(f.owner, f.schoolId, [candidate])).toEqual([{ ...candidate, revision: 2 }]);
      expect(await sibling.run(() => sibling.service.financeWorkSources(f.owner, f.schoolId, [candidate]))).toEqual([{ ...candidate, revision: 2 }]);
      for (const current of [() => f.service.detail(f.owner, input.change_id), () => sibling.run(() => sibling.service.detail(f.owner, input.change_id))]) expect(await current()).toMatchObject({ revision: 2, state: "requires_financial_review", can_apply: false });
      expect((await sql`SELECT ends_on FROM learning_offering_enrollments WHERE id=${f.selection.source_enrollment.id}::uuid`.execute(db)).rows).toEqual([{ ends_on: null }]);
      expect((await world.resources.list(1, 10)).effects.total).toBe(0);
    } finally { for (const namespace of namespaces) unbindSimulationResources(namespace); for (const database of opened) await database.destroy(); await store.pool.end(); }
  }, 120_000);
});
