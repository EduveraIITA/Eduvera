import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Kysely, PostgresDialect } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { createTeachingSessionFixture, teachingSessionServices } from "./teaching-sessions.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/teaching_files_unused_test";
const target = process.env.TEACHING_SESSIONS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
async function content(stream: AsyncIterable<unknown>) {
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString();
}

describe.skipIf(!enabled).sequential("teaching resources, immutable bytes and selected-world operation", () => {
  let f: Awaited<ReturnType<typeof createTeachingSessionFixture>>;
  let service: ReturnType<typeof teachingSessionServices>;
  let sessionId: string, fingerprint: string;
  const liveId = randomUUID(), privateId = randomUUID(), replacementId = randomUUID();
  const liveBytes = Buffer.from("LIVE ORIGINAL TEACHING FILE MUST NOT BE FETCHED IN A WORLD"), privateBytes = Buffer.from("PRIVATE instructor solution");
  beforeAll(async () => {
    f = await createTeachingSessionFixture(db); await f.allowClass(); service = teachingSessionServices(db, f.core);
    const source = (await service.context.sources(db, f.teacher, f.date)).sources.find(item => item.source_kind === "academic");
    if (!source) throw new Error("Expected the fictional academic lesson source.");
    sessionId = source.id; fingerprint = source.source_fingerprint;
  });

  it("rejects unsafe/storage-failed uploads, retains exact immutable versions and rechecks private downloads", async () => {
    const upload = { filename: "loop-example.txt", mimetype: "text/plain", data: liveBytes };
    const command = { command_id: randomUUID(), expected_revision: 0, source_fingerprint: fingerprint,
      material_id: liveId, title: "Loop example", shared: true };
    await expect(service.materials.upload(f.teacher, sessionId, f.date, command, { ...upload, mimetype: "application/pdf" })).rejects.toThrow("Use a PDF");
    await expect(service.materials.upload(f.teacher, sessionId, f.date, command, { ...upload, data: Buffer.alloc(0) })).rejects.toThrow("non-empty");
    const failed = vi.spyOn(files, "writeFile").mockRejectedValueOnce(new Error("Injected teaching artifact storage failure"));
    await expect(service.materials.upload(f.teacher, sessionId, f.date, command, upload)).rejects.toThrow(); failed.mockRestore();
    expect(await db.selectFrom("teaching_session_materials").select("id").where("session_id", "=", sessionId).execute()).toEqual([]);
    expect(await db.selectFrom("campus_model_commands").select("id").where("correlation_id", "=", command.command_id).execute()).toEqual([]);
    const outcomeFailed = vi.spyOn(service.core, "completeDomainCommand").mockRejectedValueOnce(new Error("Injected outcome failure after immutable bytes"));
    await expect(service.materials.upload(f.teacher, sessionId, f.date, command, upload)).rejects.toThrow("Injected outcome failure after immutable bytes"); outcomeFailed.mockRestore();
    expect(await db.selectFrom("teaching_session_materials").select("id").where("session_id", "=", sessionId).execute()).toEqual([]);
    expect(await service.materials.upload(f.teacher, sessionId, f.date, command, upload)).toMatchObject({ material_id: liveId, revision: 1, replayed: false });
    expect(await service.materials.upload(f.teacher, sessionId, f.date, command, upload)).toMatchObject({ material_id: liveId, revision: 1, replayed: true });
    await expect(service.materials.upload(f.teacher, sessionId, f.date, command, { ...upload, data: Buffer.from("DIFFERENT BYTES") })).rejects.toThrow("different teaching work");
    await service.materials.upload(f.teacher, sessionId, f.date, { command_id: randomUUID(), expected_revision: 1, source_fingerprint: fingerprint,
      material_id: privateId, title: "PRIVATE solution", shared: false }, { filename: "teacher-answer.py", mimetype: "text/x-python", data: privateBytes });
    expect(await content((await service.materials.file(f.learner.actor, sessionId, f.date, liveId)).stream)).toBe(liveBytes.toString());
    await expect(service.materials.file(f.learner.actor, sessionId, f.date, privateId)).rejects.toThrow("unavailable");
    await expect(service.materials.file(f.guardian, sessionId, f.date, liveId)).rejects.toThrow();
    await expect(service.materials.file(f.otherTeacher, sessionId, f.date, liveId)).rejects.toThrow();
    const corrupt = vi.spyOn(service.artifacts, "read").mockResolvedValueOnce({ stream: Readable.from([Buffer.alloc(liveBytes.length, 120)]),
      content_type: "text/plain", original_name: "loop-example.txt", size_bytes: liveBytes.length, evidence_mode: "simulation", source_content_omitted: false });
    await expect(service.materials.file(f.teacher, sessionId, f.date, liveId)).rejects.toThrow("integrity check"); corrupt.mockRestore();
    await service.materials.upload(f.teacher, sessionId, f.date, { command_id: randomUUID(), expected_revision: 2, source_fingerprint: fingerprint,
      material_id: replacementId, title: "Revised loop example", shared: true, replaces_material_id: liveId },
    { filename: "revised-loop.txt", mimetype: "text/plain", data: Buffer.from("REVISED LIVE TEACHING FILE") });
    expect(await db.selectFrom("teaching_session_materials").select(["size_bytes", "sha256"]).where("id", "=", liveId).executeTakeFirst())
      .toEqual({ size_bytes: liveBytes.length, sha256: createHash("sha256").update(liveBytes).digest("hex") });
    expect(await content((await service.materials.file(f.teacher, sessionId, f.date, liveId)).stream)).toBe(liveBytes.toString());
    const learner = await service.sessions.detail(f.learner.actor, sessionId, f.date);
    expect(learner.materials).toHaveLength(2); expect(JSON.stringify(learner)).not.toContain("PRIVATE");
    expect(learner.materials.find(item => item.id === replacementId)).toMatchObject({ replaces_material_id: liveId });
    await db.updateTable("staff_responsibility_types").set({ is_active: false }).where("id", "=", f.roleId).execute();
    try {
      await expect(service.materials.file(f.teacher, sessionId, f.date, liveId)).rejects.toThrow();
      await expect(service.materials.upload(f.teacher, sessionId, f.date, command, upload)).rejects.toThrow();
    } finally {
      // Restore only this explicitly created fictional role so the subsequent
      // independent snapshot test captures an eligible current instructor.
      await db.updateTable("staff_responsibility_types").set({ is_active: true }).where("id", "=", f.roleId).execute();
    }
    expect(await service.materials.upload(f.teacher, sessionId, f.date, command, upload)).toMatchObject({ revision: 1, replayed: true });
  }, 60_000);

  it.runIf(Boolean(target))("mutates one actual COW world, serves only run-local uploads and leaves Live and its sibling unchanged", async () => {
    await db.updateTable("staff_responsibility_types").set({ capability_permissions: ["learning.sessions.manage", "learning.work.publish"] })
      .where("id", "=", f.roleId).execute();
    const practice = await f.practice.publish(f.teacher, f.input({ date: f.date, title: "Captured fictional session practice" }));
    const now = `${f.date}T16:00:00.000Z`, store = new SimulationSnapshotStore(url, requireIsolatedTestDatabaseUrl(target), 2);
    const opened: Kysely<Database>[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      expect(snapshot.counts.teaching_sessions).toBe(1); expect(snapshot.counts.teaching_session_materials).toBe(3);
      await initializeSimulationResources(store.pool);
      const open = async () => {
        const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: f.schoolId, scenario_id: scenario, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenario, run_id: run, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "teaching-session-real-cow-test", checked_at: now });
        const resources = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects, effectReplay: resources }); namespaces.push(namespace);
        return { ...teachingSessionServices(database), database, namespace, resources,
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open(), scenarioId = randomUUID();
      await world.run(async () => {
        const omitted = await world.materials.file(f.teacher, sessionId, f.date, liveId);
        expect(omitted.source_content_omitted).toBe(true); expect(await content(omitted.stream)).not.toContain(liveBytes.toString());
        const captured = await world.sessions.detail(f.teacher, sessionId, f.date);
        expect(captured.materials.find(item => item.id === liveId)).toMatchObject({ source_content_omitted: true });
        const upload = { command_id: randomUUID(), expected_revision: 3, source_fingerprint: captured.session.source_fingerprint,
          material_id: scenarioId, title: "Scenario replacement example", shared: true, replaces_material_id: liveId };
        expect(await world.materials.upload(f.teacher, sessionId, f.date, upload,
          { filename: "scenario-only.txt", mimetype: "text/plain", data: Buffer.from("SCENARIO ONLY TEACHING FILE") })).toMatchObject({ revision: 4 });
        expect(await content((await world.materials.file(f.learner.actor, sessionId, f.date, scenarioId)).stream)).toBe("SCENARIO ONLY TEACHING FILE");
        const command = { command_id: randomUUID(), expected_revision: 4, source_fingerprint: captured.session.source_fingerprint,
          state: "reported", preparation: "Scenario-only private preparation", topic: "Scenario robotics lesson", learner_notes: "Scenario-only practice", reason: "" };
        const saved = await world.sessions.save(f.teacher, sessionId, f.date, command);
        expect(saved).toMatchObject({ revision: 5, state: "reported", replayed: false });
        expect(await world.sessions.save(f.teacher, sessionId, f.date, command)).toMatchObject({ revision: 5, replayed: true });
        const detail = await world.sessions.detail(f.teacher, sessionId, f.date);
        expect(detail.lesson).toMatchObject({ state: "reported", topic: command.topic, revision: 5 });
        expect(detail.materials.find(item => item.id === scenarioId)).toMatchObject({ source_content_omitted: false });
        const association = { command_id: randomUUID(), expected_revision: 5, source_fingerprint: captured.session.source_fingerprint,
          work_kind: "practice", work_id: practice.id };
        expect(await world.work.link(f.teacher, sessionId, f.date, association)).toMatchObject({ revision: 6, replayed: false });
        expect(await world.work.link(f.teacher, sessionId, f.date, association)).toMatchObject({ revision: 6, replayed: true });
        expect((await world.sessions.detail(f.learner.actor, sessionId, f.date)).associated_work).toEqual([
          expect.objectContaining({ work_kind: "practice", work_id: practice.id }),
        ]);
        expect(await world.database.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"])
          .where("correlation_id", "=", command.command_id).execute()).toEqual([{ state: "accepted", environment_namespace_id: world.namespace }]);
        expect((await world.resources.list(1, 10)).counts.artifacts).toBe(1);
      });
      const unchanged = async (sessions: typeof service.sessions) => {
        const detail = await sessions.detail(f.teacher, sessionId, f.date);
        expect(detail.lesson).toMatchObject({ revision: 3, state: "prepared", topic: "" });
        expect(detail.materials).toHaveLength(3); expect(detail.materials.map(item => item.id)).not.toContain(scenarioId);
        expect(detail.history.items).toEqual([]); expect(detail.associated_work).toEqual([]);
      };
      await unchanged(service.sessions); await sibling.run(() => unchanged(sibling.sessions));
      await expect(service.materials.file(f.teacher, sessionId, f.date, scenarioId)).rejects.toThrow("unavailable");
      await sibling.run(() => expect(sibling.materials.file(f.teacher, sessionId, f.date, scenarioId)).rejects.toThrow("unavailable"));
      expect(await content((await service.materials.file(f.teacher, sessionId, f.date, liveId)).stream)).toBe(liveBytes.toString());
      expect((await sibling.resources.list(1, 10)).counts.artifacts).toBe(0);
      expect(await db.selectFrom("teaching_sessions").select("topic").where("id", "=", sessionId).executeTakeFirst()).toEqual({ topic: "" });
    } finally {
      for (const namespace of namespaces) unbindSimulationResources(namespace);
      await Promise.all(opened.map(database => database.destroy())); await store.pool.end();
    }
  }, 120_000);
});
