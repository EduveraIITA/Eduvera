import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
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
import { LearningAssignmentHandoverService } from "../src/learning/learning-assignment-handover.service.js";
import { learningAssignmentServices } from "./learning-assignments.test-support.js";
import { assignmentHandoverFixture } from "./learning-assignment-handover.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/handover_worlds_unused_test";
const target = process.env.LEARNING_ASSIGNMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
describe.skipIf(!enabled || !target)("assignment review handover selected-world operation", () => {
  it("captures both handover tables and changes exact review ownership only in one real COW branch", async () => {
    const f = await assignmentHandoverFixture(db), source = await f.publish(), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Captured immutable submission" });
    const attempt = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: randomUUID() });
    const originalAttempt = await db.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow();
    const now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2), opened: Kysely<Database>[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now); await initializeSimulationResources(store.pool);
      const open = async () => {
        const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: f.schoolId, scenario_id: scenario, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "assignment-handover-world-test", checked_at: now });
        const resources = new SimulationResourceStore(store.pool, environment), router = new ExecutionEffectRouter();
        router.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects: router, effectReplay: resources }); namespaces.push(namespace);
        const services = learningAssignmentServices(database);
        return { ...services, handovers: new LearningAssignmentHandoverService(database, services.context, services.model), database, environment, namespace,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        expect(await world.database.selectFrom("learning_assignment_review_handovers").select("id").execute()).toEqual([]);
        expect(await world.database.selectFrom("learning_assignment_handover_messages").select("message_id").execute()).toEqual([]);
        await world.database.updateTable("staff_responsibility_assignments").set({ status: "revoked" }).where("id", "=", f.assignmentId).execute();
        expect(await world.assignments.projectWork(f.learner.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, state: "needs_reassignment" }));
        const preview = await world.handovers.detail(f.owner, id), input = { command_id: randomUUID(), expected_revision: preview.revision, reviewer_id: f.otherTeacher.id, preview_hash: preview.preview_hash, reason: "Selected-world reviewer replacement." };
        const supersede = world.core.supersedeDomainMessage.bind(world.core);
        const foreignWorld = vi.spyOn(world.core, "supersedeDomainMessage").mockImplementation((tx, value) =>
          executionEnvironmentStorage.run(sibling.environment, () => supersede(tx, value)));
        try { await expect(world.handovers.transfer(f.owner, id, input)).rejects.toThrow(); } finally { foreignWorld.mockRestore(); }
        expect(await world.database.selectFrom("learning_assignments").select("revision").where("id", "=", id).executeTakeFirstOrThrow()).toEqual({ revision: 2 });
        expect(await world.database.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", id).execute()).toEqual([]);
        const receipt = await world.handovers.transfer(f.owner, id, input);
        expect(await world.handovers.transfer(f.owner, id, input)).toMatchObject({ ...receipt, replayed: true });
        const handovers = await world.database.selectFrom("learning_assignment_review_handovers").selectAll().where("assignment_id", "=", id).execute();
        const messages = await world.database.selectFrom("learning_assignment_handover_messages").selectAll().where("assignment_id", "=", id).execute();
        expect(handovers).toHaveLength(1); expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ handover_id: input.command_id, attempt_id: attempt.attempt_id, kind: "review" });
        expect(await world.database.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow()).toEqual(originalAttempt);
        await expect(world.assignments.detail(f.teacher, id, f.learner.id)).rejects.toThrow();
        expect(await world.assignments.projectWork(f.otherTeacher)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "review", attempt_id: attempt.attempt_id }));
        await world.assignments.review(f.otherTeacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, attempt_id: attempt.attempt_id, review_id: randomUUID(), decision: "reviewed", feedback: "Completed only in this branch." });
        expect(await world.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "reviewed" });
      });
      const unchanged = async (database: DatabaseService, services: ReturnType<typeof learningAssignmentServices>) => {
        expect(await database.selectFrom("learning_assignments").select(["revision", "reviewer_id"]).where("id", "=", id).executeTakeFirstOrThrow()).toEqual({ revision: 2, reviewer_id: f.teacher.id });
        expect(await database.selectFrom("learning_assignment_review_handovers").select("id").where("assignment_id", "=", id).execute()).toEqual([]);
        expect(await database.selectFrom("learning_assignment_handover_messages").select("message_id").where("assignment_id", "=", id).execute()).toEqual([]);
        expect(await services.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "submitted", attempts: [{ id: attempt.attempt_id, review: null }] });
        expect(await database.selectFrom("learning_assignment_attempts").selectAll().where("id", "=", attempt.attempt_id).executeTakeFirstOrThrow()).toEqual(originalAttempt);
      };
      await unchanged(db, f); await sibling.run(() => unchanged(sibling.database, sibling));
      // Server-authoritative identity/world mismatch is refused, never a Live lookup fallback.
      await executionEnvironmentStorage.run({ ...world.environment, institution_id: randomUUID() }, async () => {
        await expect(world.handovers.detail(f.owner, id)).rejects.toThrow();
      });
    } finally { for (const namespace of namespaces) unbindSimulationResources(namespace); await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
