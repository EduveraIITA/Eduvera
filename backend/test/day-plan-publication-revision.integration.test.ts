import { createHash, randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { DayPlanService } from "../src/day-plans/day-plan.service.js";
import { comparable, type PlanPeriod } from "../src/day-plans/contracts.js";
import { effectiveSchedule } from "../src/day-plans/schedule.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { createAcceptedTeachingCover, createTeachingSessionFixture, teachingRequest, teachingSessionServices } from "./teaching-sessions.test-support.js";
import { resourceLoanServices } from "./resource-loans.test-support.js";
import { classPracticeServices } from "./class-practice.test-support.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { initializeSimulationResources, SimulationResourceStore } from "../src/database/simulation-resources.store.js";
import { bindSimulationResources, unbindSimulationResources } from "../src/common/simulation-resources.js";
import { ExecutionEffectRouter } from "../src/campus-model-core/execution-effects.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/pub_revision_owner_unused_test";
const target = process.env.CAMPUS_PERSONAL_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy());
const hash = (rows: PlanPeriod[]) => createHash("sha256").update(JSON.stringify([...rows].sort((a, b) => a.period_number - b.period_number).map(comparable))).digest("hex");

describe.skipIf(!enabled)("published day-plan identity under accepted teaching cover", () => {
  it("preserves exact accepted cover and baseline through acknowledgement, draft/save/discard in Live and a captured world", async () => {
    const f = await createTeachingSessionFixture(db), topology = resourceLoanServices(db).topology;
    const campus = await topology.createCampus(f.owner, f.schoolId, { name: "Teaching campus", code: "TEACH", campus_type: "main", is_primary: true, timezone: "UTC" }, teachingRequest(f.owner));
    const place = await topology.createSpace(f.owner, f.schoolId, { campus_id: campus.id, name: "Seminar 101", code: "S101", kind: "classroom" }, teachingRequest(f.owner));
    const now = `${f.date}T07:30:00.000Z`;
    const run = <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId,
      clock: { now: () => new Date(now), nowIso: () => now } }), operation);
    const live = teachingSessionServices(db);
    const started = await run(() => f.dayPlans.start(teachingRequest(f.owner), { school_id: f.schoolId, class_section_id: f.classId, date: f.date, idempotency_key: randomUUID() }));
    const saved = await run(() => f.dayPlans.save(teachingRequest(f.owner), started.id, { school_id: f.schoolId, expected_revision: started.revision,
      idempotency_key: randomUUID(), notice: "Teaching room", reason: "Explicit place assignment", periods: [{ period_number: 1, starts_at: "08:00", ends_at: "09:00",
        subject_id: null, title: "Fictional programming class", slot_type: "class", room: "Seminar 101", space_id: place.id,
        teacher_user_id: f.teacher.id, cancelled: false, materials: [] }] }));
    const publication = await run(() => f.dayPlans.publish(teachingRequest(f.owner), started.id, { school_id: f.schoolId, expected_revision: saved.revision, idempotency_key: randomUUID() }));
    const detail = await run(() => f.dayPlans.detail(f.owner, started.id, f.schoolId));
    const period = detail.periods[0]!;
    await run(() => f.dayPlans.respond(teachingRequest(f.teacher), period.id, { school_id: f.schoolId, expected_revision: period.response_revision,
      idempotency_key: randomUUID(), status: "accepted", source: "app", note: "Reviewed the teaching place." }));
    const cover = await run(() => createAcceptedTeachingCover(db, f));
    const expected = { teacher_user_id: f.otherTeacher.id, source_revision: publication.revision, source_version: publication.version,
      coverage_record_id: cover.id, coverage_status: "accepted", space_id: place.id };
    const effective = async (database: DatabaseService) => (await effectiveSchedule(database, f.schoolId, f.date)).filter(row => row.class_section_id === f.classId);
    expect((await run(() => effective(db)))[0]).toMatchObject(expected);
    expect((await run(() => live.context.sources(db, f.learner.actor, f.date))).sources[0]).toMatchObject({ is_cover: true, scheduled_teacher_id: f.otherTeacher.id });
    const draftCycle = async (database: DatabaseService, dayPlans: DayPlanService) => {
      const opened = await dayPlans.start(teachingRequest(f.owner), { school_id: f.schoolId, class_section_id: f.classId, date: f.date, idempotency_key: randomUUID() });
      const read = await dayPlans.detail(f.owner, opened.id, f.schoolId);
      const rows = read.periods.map(row => ({ ...comparable(row), space_id: row.space_id ?? null }));
      expect((await effective(database))[0]).toMatchObject(expected);
      const baseline = (await sql<{ baseline_hash: string }>`SELECT baseline_hash FROM day_plan_versions WHERE plan_id=${opened.id}::uuid AND version=${read.draft_version}`.execute(database)).rows[0]!;
      expect(baseline.baseline_hash).toBe(hash(await effective(database)));
      const change = await dayPlans.save(teachingRequest(f.owner), opened.id, { school_id: f.schoolId, expected_revision: opened.revision,
        idempotency_key: randomUUID(), notice: "Draft only", reason: "Review future route context", periods: rows });
      expect((await effective(database))[0]).toMatchObject(expected);
      expect(baseline.baseline_hash).toBe(hash(await effective(database)));
      await dayPlans.discard(teachingRequest(f.owner), opened.id, { school_id: f.schoolId, expected_revision: change.revision, idempotency_key: randomUUID() });
      expect((await effective(database))[0]).toMatchObject(expected);
      expect((await sql<{ published_revision: number }>`SELECT published_revision FROM day_plan_versions WHERE plan_id=${opened.id}::uuid AND version=${publication.version}`.execute(database)).rows[0]?.published_revision).toBe(publication.revision);
    };
    await run(() => draftCycle(db, f.dayPlans));
    const liveRevision = (await sql<{ revision: number }>`SELECT revision FROM day_plans WHERE id=${started.id}::uuid`.execute(db)).rows[0]!.revision;
    if (!target) return;
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3), opened: DatabaseService[] = [], namespaces: string[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now); await initializeSimulationResources(store.pool);
      expect(snapshot.catalogue.tables.find(table => table.name === "day_plan_versions")?.columns).toContain("published_revision");
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(database); namespaces.push(namespace);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "publication-revision-actual-cow", checked_at: now });
        const resources = new SimulationResourceStore(store.pool, environment), effects = new ExecutionEffectRouter();
        effects.bindSimulationSinks({ environment, sinks: EXECUTION_EFFECT_KINDS.map(kind => resources.sink(kind)) });
        bindSimulationResources({ environment, artifacts: resources, effects, effectReplay: resources });
        const teaching = teachingSessionServices(database);
        return { database, dayPlans: new DayPlanService(database, teaching.events, classPracticeServices(database).school, createStaffCoverageReconciliationTestDouble(), teaching.core),
          run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
      };
      const world = await open(), sibling = await open(); await world.run(() => draftCycle(world.database, world.dayPlans));
      expect((await run(() => effective(db)))[0]).toMatchObject(expected);
      expect((await sibling.run(() => effective(sibling.database)))[0]).toMatchObject(expected);
      expect((await sql<{ revision: number }>`SELECT revision FROM day_plans WHERE id=${started.id}::uuid`.execute(db)).rows[0]?.revision).toBe(liveRevision);
      expect((await sibling.run(() => sql<{ revision: number }>`SELECT revision FROM day_plans WHERE id=${started.id}::uuid`.execute(sibling.database))).rows[0]?.revision).toBe(liveRevision);
    } finally { namespaces.forEach(unbindSimulationResources); await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
