import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { academicScaffoldingCounts, createLearningOfferingFixture, learningOfferingServices } from "./learning-offerings.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/offering_worlds_unused_test";
const target = process.env.LEARNING_ASSIGNMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());
async function content(stream: AsyncIterable<unknown>) {
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString();
}

describe.skipIf(!enabled || !target)("canonical-person offering selected-world operation", () => {
  it("captures person-based contexts, replaces omitted evidence and changes only one real COW branch", async () => {
    const f = await createLearningOfferingFixture(db), offering = await f.create(), source = await f.publish(offering.id), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Live offering submission" });
    const liveFile = { command_id: randomUUID(), expected_revision: 1, file_id: randomUUID() };
    await f.assignments.upload(f.learner.actor, id, f.learner.id, liveFile, { filename: "live-offering.txt", mimetype: "text/plain", data: Buffer.from("LIVE OFFERING FILE MUST NOT BE READ BY A BRANCH") });
    const first = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, attempt_id: randomUUID() });
    const now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2);
    const opened: Kysely<Database>[] = [], namespaces: string[] = [];
    const branchOnly = { offering_id: randomUUID(), assignment_id: randomUUID() };
    try {
      const snapshot = await store.capture(f.schoolId, now);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: f.schoolId, scenario_id: scenario, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environmentAt = (instant: string) => simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: instant,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "learning-offering-world-test", checked_at: now });
        const environment = environmentAt(now);
        const resources = new SimulationResourceStore(store.pool, environment), router = new ExecutionEffectRouter();
        router.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects: router, effectReplay: resources }); namespaces.push(namespace);
        return { ...learningOfferingServices(database), database, resources, namespace,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation),
          runAt: <T>(instant: string, operation: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(instant), operation) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        const omitted = await world.assignments.file(f.instructor.actor, id, f.learner.id, liveFile.file_id);
        expect(omitted.source_content_omitted).toBe(true);
        expect(await content(omitted.stream)).not.toContain("LIVE OFFERING FILE MUST NOT BE READ BY A BRANCH");
        await world.assignments.review(f.instructor.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: first.attempt_id,
          decision: "request_changes", feedback: "Revise this branch's offering work only." });
        await expect(world.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 3, attempt_id: randomUUID() })).rejects.toThrow("omitted in Simulation");
        await world.assignments.detach(f.learner.actor, id, f.learner.id, liveFile.file_id, { command_id: randomUUID(), expected_revision: 3 });
        const upload = { command_id: randomUUID(), expected_revision: 4, file_id: randomUUID() };
        await world.assignments.upload(f.learner.actor, id, f.learner.id, upload, { filename: "scenario-offering.txt", mimetype: "text/plain", data: Buffer.from("RUN-LOCAL OFFERING FILE") });
        const command = { command_id: randomUUID(), expected_revision: 5, attempt_id: randomUUID() };
        const second = await world.assignments.submit(f.learner.actor, id, f.learner.id, command);
        expect(await world.assignments.submit(f.learner.actor, id, f.learner.id, command)).toMatchObject({ attempt_id: second.attempt_id, replayed: true });
        expect(await content((await world.assignments.file(f.instructor.actor, id, f.learner.id, upload.file_id)).stream)).toBe("RUN-LOCAL OFFERING FILE");
        await world.assignments.review(f.instructor.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, review_id: randomUUID(), attempt_id: second.attempt_id,
          decision: "reviewed", feedback: "Only the selected world is complete." });
        expect(await world.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "reviewed", attempts: [{ attempt_number: 2 }, { attempt_number: 1 }] });
        expect((await world.assignments.projectWork(f.instructor.actor)).filter(item => item.assignment_id === id)).toEqual([]);
        expect(await world.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"]).where("correlation_id", "=", command.command_id).execute())
          .toEqual([{ state: "accepted", environment_namespace_id: world.namespace }]);
        const enrollment = (await sql<{ id: string; revision: number }>`SELECT id,revision FROM learning_offering_enrollments
          WHERE school_id=${f.schoolId}::uuid AND offering_id=${offering.id}::uuid AND person_id=${f.learner.id}::uuid`.execute(world.database)).rows[0]!;
        await world.offerings.endEnrollment(f.owner, offering.id, enrollment.id, { command_id: randomUUID(), expected_revision: enrollment.revision, reason: "Scenario-only enrollment end." });
        expect(await academicScaffoldingCounts(world.database, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
        expect((await world.resources.list(1, 10)).counts.artifacts).toBe(1);
      });
      // Server-owned request clocks exercise the same services on dates independent of the host clock.
      // This is selected-clock integration evidence, not a claim about the durable time-advance worker.
      const future = new Date(Date.parse(now) + 2 * 86_400_000).toISOString(), ended = new Date(Date.parse(now) + 3 * 86_400_000).toISOString();
      const startsOn = future.slice(0, 10), endsOn = ended.slice(0, 10);
      let enrollmentId = "", appointmentId = "";
      await world.runAt(future, async () => {
        expect((await sql<{ instant: Date }>`SELECT now() AS instant`.execute(world.database)).rows[0]!.instant.toISOString()).toBe(future);
        const learner = await world.people.detail(f.owner, f.schoolId, f.learner.id), instructor = await world.people.detail(f.owner, f.schoolId, f.instructor.id);
        const setup = { command_id: randomUUID(), offering_id: branchOnly.offering_id, name: "A run-local independent learning group",
          participants: [f.reference(learner)], instructor: f.reference(instructor), starts_on: startsOn };
        const created = await world.offerings.create(f.owner, setup);
        expect(await world.offerings.create(f.owner, setup)).toMatchObject({ ...created, replayed: true });
        const secondLearner = await world.people.detail(f.owner, f.schoolId, f.secondLearner.id);
        const enrollment = { command_id: randomUUID(), expected_revision: 1, participants: [f.reference(secondLearner)], starts_on: startsOn };
        const enrolled = await world.offerings.enroll(f.owner, branchOnly.offering_id, enrollment);
        expect(await world.offerings.enroll(f.owner, branchOnly.offering_id, enrollment)).toMatchObject({ ...enrolled, replayed: true });
        const detail = await world.offerings.detail(f.owner, branchOnly.offering_id);
        expect(detail).toMatchObject({ today: startsOn, starts_on: startsOn, learner_count: 2, can_manage: true });
        expect(detail.enrollments).toContainEqual(expect.objectContaining({ person_id: f.learner.id, starts_on: startsOn, ends_on: null }));
        enrollmentId = detail.enrollments.find(item => item.person_id === f.learner.id)!.id; appointmentId = detail.current_instructor!.id;
        const draft = f.input(branchOnly.offering_id, { assignment_id: branchOnly.assignment_id, title: "Branch-only assignment" });
        const saved = await world.assignments.save(f.instructor.actor, draft);
        expect(await world.assignments.save(f.instructor.actor, draft)).toMatchObject({ ...saved, replayed: true });
        const preview = await world.assignments.detail(f.instructor.actor, branchOnly.assignment_id);
        if (preview.context !== "offering" || !preview.publication_preview) throw new Error("Expected a run-local offering publication preview.");
        const publication = { command_id: randomUUID(), expected_revision: saved.revision, audience_hash: preview.publication_preview.audience_hash };
        const accepted = await world.assignments.publish(f.instructor.actor, branchOnly.assignment_id, publication);
        expect(await world.assignments.publish(f.instructor.actor, branchOnly.assignment_id, publication)).toMatchObject({ ...accepted, replayed: true });
        expect(await world.assignments.detail(f.learner.actor, branchOnly.assignment_id, f.learner.id)).toMatchObject({ can_write: true, item: { published_at: new Date(future) } });
        const traces = await world.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"])
          .where("correlation_id", "in", [setup.command_id, enrollment.command_id, draft.command_id, publication.command_id]).where("handler_key", "in", ["learning.offerings", "learning.assignments"]).execute();
        expect(traces).toHaveLength(4); expect(traces.every(trace => trace.state === "accepted" && trace.environment_namespace_id === world.namespace)).toBe(true);
        expect((await sql<{ total: number }>`SELECT count(*)::int AS total FROM learning_offering_teaching_assignments
          WHERE school_id=${f.schoolId}::uuid AND offering_id=${branchOnly.offering_id}::uuid`.execute(world.database)).rows[0]!.total).toBe(1);
      });
      await world.runAt(ended, async () => {
        expect(await world.offerings.endEnrollment(f.owner, branchOnly.offering_id, enrollmentId,
          { command_id: randomUUID(), expected_revision: 1, reason: "End at this world's selected date." })).toMatchObject({ ends_on: endsOn });
        expect(await world.assignments.detail(f.learner.actor, branchOnly.assignment_id, f.learner.id)).toMatchObject({ can_write: false });
        expect(await world.offerings.endInstructor(f.owner, branchOnly.offering_id, appointmentId,
          { command_id: randomUUID(), expected_revision: 1, reason: "Teaching responsibility ends at this world's selected date." })).toMatchObject({ ends_on: endsOn });
        await expect(world.assignments.list(f.instructor.actor, { offering_id: branchOnly.offering_id })).rejects.toThrow();
      });
      await world.runAt(future, async () => {
        expect(await world.assignments.list(f.instructor.actor, { offering_id: branchOnly.offering_id })).toMatchObject({ can_create: true, items: [{ id: branchOnly.assignment_id }] });
        expect(await world.assignments.detail(f.learner.actor, branchOnly.assignment_id, f.learner.id)).toMatchObject({ can_write: true });
      });
      const unchanged = async (services: ReturnType<typeof learningOfferingServices>, database: DatabaseService) => {
        expect(await services.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "submitted", files: [{ id: liveFile.file_id }], attempts: [{ id: first.attempt_id, review: null }] });
        expect(await services.assignments.projectWork(f.instructor.actor)).toContainEqual(expect.objectContaining({ assignment_id: id, action: "review", attempt_id: first.attempt_id }));
        expect((await sql<{ ends_on: string | null }>`SELECT ends_on FROM learning_offering_enrollments
          WHERE school_id=${f.schoolId}::uuid AND offering_id=${offering.id}::uuid AND person_id=${f.learner.id}::uuid`.execute(database)).rows).toEqual([{ ends_on: null }]);
        expect((await sql`SELECT id FROM learning_offerings WHERE id=${branchOnly.offering_id}::uuid`.execute(database)).rows).toEqual([]);
        expect((await sql`SELECT id FROM learning_offering_enrollments WHERE offering_id=${branchOnly.offering_id}::uuid`.execute(database)).rows).toEqual([]);
        expect((await sql`SELECT id FROM learning_offering_teaching_assignments WHERE offering_id=${branchOnly.offering_id}::uuid`.execute(database)).rows).toEqual([]);
        expect(await database.selectFrom("learning_assignments").select("id").where("id", "=", branchOnly.assignment_id).execute()).toEqual([]);
      };
      await unchanged(f, db); await sibling.run(() => unchanged(sibling, sibling.database));
      expect((await sibling.resources.list(1, 10)).counts.artifacts).toBe(0);
      expect(await content((await f.assignments.file(f.instructor.actor, id, f.learner.id, liveFile.file_id)).stream)).toBe("LIVE OFFERING FILE MUST NOT BE READ BY A BRANCH");
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      await Promise.all(opened.map(database => database.destroy())); await store.pool.end();
    }
  }, 120_000);
});
