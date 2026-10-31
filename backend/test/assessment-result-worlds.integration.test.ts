import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true" && Boolean(process.env.SIMULATION_MARKS_TEST_TARGET_URL);
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.SIMULATION_MARKS_TEST_TARGET_URL) : "postgresql://invalid.invalid/unused_world_test";
types.setTypeParser(1082, value => value);
const pool = new Pool({ connectionString: sourceUrl, max: 4 });
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const connection = database as DatabaseService;
const services = (db: Kysely<Database>) => {
  const serviceDb = db as DatabaseService;
  const core = new CampusModelCoreService(serviceDb);
  // This is a non-physical assignment: it uses the real result service/outbox,
  // with no invigilation/physical-exam adapter or bridge stub involved.
  return new AssessmentsService(serviceDb, new SchoolEventService(serviceDb, core), undefined, core, core);
};
afterAll(() => database.destroy());

describe.runIf(enabled)("assessment score truth in Live and isolated copy-on-write worlds", () => {
  it("keeps blank, zero and absence distinct, rejects stale writes and leaves Live/sibling unchanged", async () => {
    const suffix = randomUUID();
    const account = await database.insertInto("users").values({ username: `marks-owner-${suffix}`, email: `marks-owner-${suffix}@example.test`,
      password_hash: "isolated-test-only", first_name: "Marks", last_name: "Owner", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const core = new CampusModelCoreService(connection);
    const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, "UTC"));
    const owner: AuthUser = { ...account, active_school_id: schoolId };
    const moderator = await database.insertInto("users").values({ username: `marks-reviewer-${suffix}`, email: `marks-reviewer-${suffix}@example.test`,
      password_hash: "isolated-test-only", first_name: "Independent", last_name: "Reviewer", role: "staff" }).returning("id").executeTakeFirstOrThrow();
    await database.insertInto("school_memberships").values({ user_id: moderator.id, school_id: schoolId, role: "staff" }).execute();
    const now = new Date().toISOString();
    const day = (offset: number) => new Date(Date.parse(now) + offset * 86_400_000).toISOString().slice(0, 10);
    const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
    const liveRun = <T>(work: () => Promise<T>) => executionEnvironmentStorage.run(environment, work);
    const term = await database.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "QA marks", name: "Test term", starts_on: day(-1), ends_on: day(30), attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
    const section = await database.insertInto("class_sections").values({ school_id: schoolId, academic_year: "QA marks", grade: "BCA", section: "QA" }).returning("id").executeTakeFirstOrThrow();
    const subject = await database.insertInto("subjects").values({ school_id: schoolId, code: "QA-MARKS", name: "Score truth", short_name: "Score truth" }).returning("id").executeTakeFirstOrThrow();
    for (let index = 0; index < 4; index += 1) {
      const person = await database.insertInto("school_people").values({ school_id: schoolId, first_name: `Learner ${index + 1}`, last_name: "Synthetic" }).returning("id").executeTakeFirstOrThrow();
      const student = await database.insertInto("students").values({ school_id: schoolId, person_id: person.id, admission_number: `QA-${index + 1}` }).returning("id").executeTakeFirstOrThrow();
      await database.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: index + 1, enrolled_on: day(-1) }).execute();
    }
    const live = services(database);
    const assessmentId = await liveRun(async () => {
      const cycle = await live.createCycle(owner, schoolId, { term_id: term.id, name: "Score truth cycle", code: "QA-MARKS", starts_on: day(-1), ends_on: day(30) });
      let assessment = await live.createAssessment(owner, schoolId, { cycle_id: cycle.id, class_section_id: section.id, subject_id: subject.id,
        title: "Synthetic score truth assignment", assessment_kind: "assignment", maximum_marks: 20, scheduled_at: `${day(1)}T09:00:00.000Z`,
        evidence_requirement: "none", examiner_user_id: owner.id, moderator_user_id: moderator.id });
      assessment = await live.action(owner, schoolId, assessment.id, "schedule", { expected_revision: assessment.revision }) as typeof assessment;
      await live.action(owner, schoolId, assessment.id, "open-marking", { expected_revision: assessment.revision });
      return assessment.id;
    });
    const read = (db: Kysely<Database>) => db.selectFrom("assessment_results").select(["id", "outcome", "marks", "revision"]).where("assessment_id", "=", assessmentId).orderBy("student_id").execute();
    const original = await read(database);
    expect(original).toHaveLength(4);
    const assess = () => database.selectFrom("assessments").select("revision").where("id", "=", assessmentId).executeTakeFirstOrThrow();
    const write = (service: AssessmentsService, assessmentRevision: number, row: typeof original[number], outcome: "scored" | "absent", marks: unknown) =>
      service.recordResults(owner, schoolId, assessmentId, { expected_assessment_revision: assessmentRevision,
        results: [{ result_id: row.id, outcome, marks, expected_revision: row.revision, reason: "Synthetic regression verification" }] });
    await liveRun(async () => {
      const revision = (await assess()).revision;
      await expect(write(live, revision, original[0]!, "scored", "")).rejects.toThrow();
      await expect(write(live, revision, original[0]!, "scored", null)).rejects.toThrow(/Marks must be between/);
      expect(await read(database)).toEqual(original);
      let accepted = await write(live, revision, original[0]!, "scored", 0);
      await write(live, accepted.revision, original[1]!, "absent", null);
      accepted = await database.selectFrom("assessments").selectAll().where("id", "=", assessmentId).executeTakeFirstOrThrow();
      await expect(write(live, accepted.revision, original[0]!, "scored", 4)).rejects.toThrow(/learner result changed/i);
    });
    const captured = await read(database);
    expect(captured[0]).toMatchObject({ outcome: "scored", marks: "0.00" });
    expect(captured[1]).toMatchObject({ outcome: "absent", marks: null });
    expect(captured[2]).toMatchObject({ outcome: "unrecorded", marks: null });
    const store = new SimulationSnapshotStore(sourceUrl, targetUrl, 4);
    const opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: value => compiler.createIntrospector(value) } });
        opened.push(db);
        const selected = simulationRequestEnvironment({ institution_id: schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: `${day(1)}T10:00:00.000Z`,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "marks-truth-regression", checked_at: now });
        return { db, service: services(db), run: <T>(work: () => Promise<T>) => executionEnvironmentStorage.run(selected, work) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect(await read(branch.db)).toEqual(captured);
        let revision = (await branch.db.selectFrom("assessments").select("revision").where("id", "=", assessmentId).executeTakeFirstOrThrow()).revision;
        await expect(write(branch.service, revision, captured[2]!, "scored", "")).rejects.toThrow();
        await expect(write(branch.service, revision, captured[2]!, "scored", null)).rejects.toThrow(/Marks must be between/);
        expect(await read(branch.db)).toEqual(captured);
        const scored = await write(branch.service, revision, captured[2]!, "scored", 0);
        const absent = await write(branch.service, scored.revision, captured[3]!, "absent", null);
        revision = absent.revision;
        await expect(write(branch.service, revision - 1, captured[0]!, "scored", 7)).rejects.toThrow(/assessment changed/i);
        await write(branch.service, revision, captured[0]!, "scored", 7);
        const changed = await read(branch.db);
        expect(changed[0]).toMatchObject({ outcome: "scored", marks: "7.00" });
        expect(changed[1]).toMatchObject({ outcome: "absent", marks: null });
        expect(changed[2]).toMatchObject({ outcome: "scored", marks: "0.00" });
        expect(changed[3]).toMatchObject({ outcome: "absent", marks: null });
        const history = await branch.db.selectFrom("assessment_result_revisions").select(["outcome", "marks"]).where("result_id", "=", captured[2]!.id).execute();
        expect(history).toEqual([{ outcome: "scored", marks: "0.00" }]);
        const events = await sql<{ count: number }>`SELECT count(*)::int AS count FROM event_outbox WHERE school_id=${schoolId}::uuid AND aggregate_id=${assessmentId}`.execute(branch.db);
        expect(events.rows[0]!.count).toBe(7);
      });
      expect(await liveRun(() => read(database))).toEqual(captured);
      expect(await sibling.run(() => read(sibling.db))).toEqual(captured);
    } finally {
      await Promise.all(opened.map(db => db.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
