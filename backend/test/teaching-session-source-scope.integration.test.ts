import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { createTeachingSessionFixture, teachingDay, teachingRequest, teachingSessionServices } from "./teaching-sessions.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_teaching_scope_test";
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => db.destroy());

describe.runIf(enabled && Boolean(targetUrl))("teaching source composition without unrelated roster expansion", () => {
  it("retains academic identity and authority, materializes native lessons in the selected world and leaves Live and a sibling unchanged", async () => {
    const f = await createTeachingSessionFixture(db), date = teachingDay(f.date, 14);
    await f.allowClass(); await f.allowCampus();
    const service = teachingSessionServices(db, f.core);
    const academicFacts = async (database: DatabaseService) => (await sql<{ occurrences: number; people: number }>`SELECT
      (SELECT count(*)::int FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND source='academic' AND local_date=${date}::date) AS occurrences,
      (SELECT count(*)::int FROM schedule_activity_occurrence_people person JOIN schedule_activity_occurrences occurrence ON occurrence.id=person.occurrence_id
        AND occurrence.school_id=person.school_id WHERE occurrence.school_id=${f.schoolId}::uuid AND occurrence.source='academic'
        AND occurrence.local_date=${date}::date) AS people`.execute(database)).rows[0]!;
    const before = await academicFacts(db);
    expect(before).toEqual({ occurrences: 0, people: 0 });
    const live = await service.context.sources(db, f.teacher, date);
    const academic = live.sources.filter(item => item.source_kind === "academic");
    expect(academic).toHaveLength(1);
    expect(academic[0]).toMatchObject({ class_section_id: f.classId, period_number: 1, title: "Fictional programming class", scheduled_teacher_id: f.teacher.id });
    expect(await service.context.openExpected(f.teacher, date, { class_section_id: f.classId, period_number: "1" })).toMatchObject({ id: academic[0]!.id });
    await expect(service.context.openExpected(f.otherTeacher, date, { class_section_id: f.classId, period_number: "1" })).rejects.toThrow();
    expect(await academicFacts(db)).toEqual(before);
    // The exact caller's transaction remains authoritative: no second client or
    // committed-store fallback may hide its uncommitted effective schedule.
    await expect(db.transaction().execute(async tx => {
      await tx.updateTable("timetable_slots").set({ title: "Uncommitted scoped title" }).where("id", "=", f.slotId).execute();
      const scoped = await service.context.sources(tx, f.teacher, date);
      expect(scoped.sources.find(item => item.id === academic[0]!.id)?.title).toBe("Uncommitted scoped title");
      throw new Error("Roll back only this test's uncommitted title");
    })).rejects.toThrow("Roll back only this test's uncommitted title");
    const now = `${date}T07:00:00.000Z`, store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 3);
    const opened: DatabaseService[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "teaching-source-scope-test", checked_at: now });
        return { database, ...teachingSessionServices(database), run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        const draft = await world.planning.create(teachingRequest(f.owner), f.schoolId, { idempotency_key: randomUUID(), title: "Run-local robotics lesson",
          purpose: "teaching", timezone: "UTC", starts_on: date, recurrence: "once", starts_at: "12:00", ends_at: "13:00",
          attendance_mode: "none", person_ids: [f.learner.personId], lead_person_id: f.teacherProfile.person_id });
        await world.planning.publish(teachingRequest(f.owner), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
        const sources = await world.context.sources(world.database, f.teacher, date);
        expect(sources.sources.filter(item => item.source_kind === "academic")).toEqual(academic);
        const native = sources.sources.find(item => item.source_kind === "activity");
        expect(native).toMatchObject({ title: "Run-local robotics lesson", class_section_id: null, lead_person_id: f.teacherProfile.person_id, state: "expected" });
        expect(native?.occurrence_id).toBeTruthy();
        expect(await world.context.openExpected(f.teacher, date, { occurrence_id: native!.occurrence_id! })).toMatchObject({ id: native!.id });
        await expect(world.context.openExpected(f.otherTeacher, date, { occurrence_id: native!.occurrence_id! })).rejects.toThrow();
        expect(await academicFacts(world.database)).toEqual(before);
        await world.database.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.teacher.id).execute();
        await expect(world.context.openExpected(f.teacher, date, { class_section_id: f.classId, period_number: "1" })).rejects.toThrow();
      });
      expect((await service.context.sources(db, f.teacher, date)).sources).toEqual(live.sources);
      expect(await academicFacts(db)).toEqual(before);
      await sibling.run(async () => {
        expect((await sibling.context.sources(sibling.database, f.teacher, date)).sources).toEqual(live.sources);
        expect(await academicFacts(sibling.database)).toEqual(before);
        expect(await sibling.context.openExpected(f.teacher, date, { class_section_id: f.classId, period_number: "1" })).toMatchObject({ id: academic[0]!.id });
      });
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
