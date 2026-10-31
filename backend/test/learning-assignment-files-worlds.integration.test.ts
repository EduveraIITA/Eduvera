import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { bindSimulationResources, unbindSimulationResources } from "../src/common/simulation-resources.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import * as files from "../src/common/environment-files.js";
import { createLearningAssignmentFixture, learningAssignmentServices } from "./learning-assignments.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/assignment_files_unused_test";
const target = process.env.LEARNING_ASSIGNMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
async function content(stream: AsyncIterable<unknown>) { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return Buffer.concat(chunks).toString(); }
describe.skipIf(!enabled)("individual assignment files and selected-world attempts", () => {
  it("binds immutable bytes to an exact attempt; rejects spoofed files and storage failure without an accepted record", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish({ submission_mode: "files" }), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "" });
    const upload = { filename: "program.txt", mimetype: "text/plain", data: Buffer.from("print('hello from the learner')") };
    const command = { command_id: randomUUID(), expected_revision: 1, file_id: randomUUID() };
    await expect(f.assignments.upload(f.learner.actor, id, f.learner.id, command, { ...upload, mimetype: "application/pdf" })).rejects.toThrow("Use a PDF");
    const failing = vi.spyOn(files, "writeFile").mockRejectedValueOnce(new Error("Injected disk failure"));
    await expect(f.assignments.upload(f.learner.actor, id, f.learner.id, command, upload)).rejects.toThrow(); failing.mockRestore();
    expect(await db.selectFrom("learning_assignment_files").select("id").where("assignment_id", "=", id).execute()).toEqual([]);
    expect(await f.assignments.upload(f.learner.actor, id, f.learner.id, command, upload)).toMatchObject({ revision: 2, replayed: false });
    expect(await f.assignments.upload(f.learner.actor, id, f.learner.id, command, upload)).toMatchObject({ revision: 2, replayed: true });
    await expect(f.assignments.file(f.teacher, id, f.learner.id, command.file_id)).rejects.toThrow("private");
    await expect(f.assignments.file(f.guardian, id, f.learner.id, command.file_id)).rejects.toThrow("private");
    const receipt = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, attempt_id: randomUUID() });
    expect(await content((await f.assignments.file(f.teacher, id, f.learner.id, command.file_id)).stream)).toBe(upload.data.toString());
    expect(await content((await f.assignments.file(f.guardian, id, f.learner.id, command.file_id)).stream)).toBe(upload.data.toString());
    // Wrong bytes must never be served under the immutable accepted manifest.
    const corrupt = vi.spyOn(files, "readEnvironmentStoredFile").mockResolvedValueOnce({ stream: Readable.from([Buffer.alloc(upload.data.length, 120)]),
      content_type: "text/plain", original_name: "program.txt", size_bytes: upload.data.length, evidence_mode: "simulation", source_content_omitted: false });
    await expect(f.assignments.file(f.teacher, id, f.learner.id, command.file_id)).rejects.toThrow("does not match"); corrupt.mockRestore();
    expect(await db.selectFrom("learning_assignment_attempts").select("manifest_hash").where("id", "=", receipt.attempt_id).executeTakeFirst()).toEqual({ manifest_hash: receipt.manifest_hash });
    await expect(f.assignments.file(f.secondLearner.actor, id, f.learner.id, command.file_id)).rejects.toThrow();
    await f.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: receipt.attempt_id,
      decision: "request_changes", feedback: "Replace the example with your own program." });
    await f.assignments.detach(f.learner.actor, id, f.learner.id, command.file_id, { command_id: randomUUID(), expected_revision: 3 });
    const own = await f.assignments.detail(f.learner.actor, id, f.learner.id);
    expect(own).toMatchObject({ files: [], attempts: [{ files: [{ id: command.file_id }] }] });
    expect(await content((await f.assignments.file(f.teacher, id, f.learner.id, command.file_id)).stream)).toBe(upload.data.toString());
  });

  it.runIf(Boolean(target))("captures file metadata without Live bytes, replaces omitted files and completes only the isolated world", async () => {
    const f = await createLearningAssignmentFixture(db), source = await f.publish(), id = source.assignment_id;
    await f.assignments.saveWork(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 0, body: "Live draft retained" });
    const liveFile = { command_id: randomUUID(), expected_revision: 1, file_id: randomUUID() };
    await f.assignments.upload(f.learner.actor, id, f.learner.id, liveFile, { filename: "live-program.txt", mimetype: "text/plain", data: Buffer.from("LIVE ORIGINAL MUST NOT BE FETCHED") });
    const first = await f.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, attempt_id: randomUUID() });
    const now = new Date().toISOString(), store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2), opened: Kysely<Database>[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: f.schoolId, scenario_id: scenario, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "assignment-file-world-test", checked_at: now });
        const resources = new SimulationResourceStore(store.pool, environment), router = new ExecutionEffectRouter();
        router.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects: router, effectReplay: resources }); namespaces.push(namespace);
        return { ...learningAssignmentServices(database), database, resources, namespace, run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        const omitted = await world.assignments.file(f.teacher, id, f.learner.id, liveFile.file_id);
        expect(omitted.source_content_omitted).toBe(true);
        expect(await content(omitted.stream)).not.toContain("LIVE ORIGINAL MUST NOT BE FETCHED");
        await world.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 1, review_id: randomUUID(), attempt_id: first.attempt_id,
          decision: "request_changes", feedback: "Scenario-only request for revision" });
        await expect(world.assignments.submit(f.learner.actor, id, f.learner.id, { command_id: randomUUID(), expected_revision: 3, attempt_id: randomUUID() })).rejects.toThrow("omitted in Simulation");
        await world.assignments.detach(f.learner.actor, id, f.learner.id, liveFile.file_id, { command_id: randomUUID(), expected_revision: 3 });
        const upload = { command_id: randomUUID(), expected_revision: 4, file_id: randomUUID() };
        await world.assignments.upload(f.learner.actor, id, f.learner.id, upload, { filename: "scenario-program.txt", mimetype: "text/plain", data: Buffer.from("SCENARIO ONLY PROGRAM") });
        const command = { command_id: randomUUID(), expected_revision: 5, attempt_id: randomUUID() };
        const second = await world.assignments.submit(f.learner.actor, id, f.learner.id, command);
        expect(await world.assignments.submit(f.learner.actor, id, f.learner.id, command)).toMatchObject({ attempt_id: second.attempt_id, replayed: true });
        expect(await content((await world.assignments.file(f.teacher, id, f.learner.id, upload.file_id)).stream)).toBe("SCENARIO ONLY PROGRAM");
        await world.assignments.review(f.teacher, id, f.learner.id, { command_id: randomUUID(), expected_revision: 2, review_id: randomUUID(), attempt_id: second.attempt_id,
          decision: "reviewed", feedback: "Scenario review complete" });
        expect(await world.assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "reviewed", attempts: [{ attempt_number: 2 }, { attempt_number: 1 }] });
        expect((await world.assignments.projectWork(f.learner.actor)).filter(item => item.assignment_id === id)).toEqual([]);
        expect(await world.assignments.projectWork(f.teacher)).toEqual([]);
        const outcomes = await world.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"]).where("correlation_id", "=", command.command_id).execute();
        expect(outcomes).toEqual([{ state: "accepted", environment_namespace_id: world.namespace }]);
        expect((await world.resources.list(1, 10)).counts.artifacts).toBe(1);
      });
      const unchanged = async (assignments: typeof f.assignments) => {
        expect(await assignments.detail(f.learner.actor, id, f.learner.id)).toMatchObject({ state: "submitted", files: [{ id: liveFile.file_id }], attempts: [{ attempt_number: 1, review: null }] });
        expect(await assignments.projectWork(f.teacher)).toContainEqual(expect.objectContaining({ attempt_id: first.attempt_id, action: "review" }));
      };
      await unchanged(f.assignments); await sibling.run(() => unchanged(sibling.assignments));
      expect(await content((await f.assignments.file(f.teacher, id, f.learner.id, liveFile.file_id)).stream)).toBe("LIVE ORIGINAL MUST NOT BE FETCHED");
      expect((await sibling.resources.list(1, 10)).counts.artifacts).toBe(0);
    } finally { for (const namespace of namespaces) unbindSimulationResources(namespace); await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
