import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import { ClassPracticeService } from "../src/school/class-practice.service.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/homework_unused_test";
const targetUrl = process.env.HOMEWORK_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 2 }) }) });
afterAll(() => db.destroy());

function services(database: Kysely<Database>) {
  const connection = database as DatabaseService;
  const core = new CampusModelCoreService(connection, new ExecutionDataPlaneScope());
  const events = new SchoolEventService(connection, core);
  const practice = new ClassPracticeService(connection, events, core, core, core);
  return { core, events, school: new SchoolService(connection, events, createStaffCoverageReconciliationTestDouble(), undefined, undefined, undefined, undefined, undefined, practice) };
}

async function fixture() {
  const context = services(db), suffix = randomUUID(), date = new Date().toISOString().slice(0, 10);
  const account = async (firstName: string, role: "admin" | "student" | "parent" | "staff") => db.insertInto("users").values({
    username: `homework-${firstName}-${suffix}`, email: `homework-${firstName}-${suffix}@example.test`, password_hash: "isolated-test-only",
    first_name: firstName, last_name: "Fixture", role,
  }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const owner = await account("Owner", "admin");
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, owner, "UTC"));
  const term = (await sql<{ id: string }>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active)
    VALUES(${schoolId}::uuid,'2026-27','Homework test term',${date}::date-30,${date}::date+90,85,true) RETURNING id`.execute(db)).rows[0]!;
  const section = (await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: "2026-27", grade: "6", section: "A" }).returning("id").executeTakeFirstOrThrow()).id;
  const asActor = (value: typeof owner): AuthUser => ({ ...value, active_school_id: schoolId });
  const makeLearner = async (name: string, roll: number) => {
    const value = await account(name, "student");
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: value.id, role: "student" }).execute();
    const person = await db.insertInto("school_people").values({ school_id: schoolId, first_name: name }).returning("id").executeTakeFirstOrThrow();
    const learner = await db.insertInto("students").values({ school_id: schoolId, user_id: value.id, person_id: person.id,
      admission_number: `HW-${roll}`, date_of_birth: null, blood_group: null, emergency_contact: null }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("enrollments").values({ student_id: learner.id, class_section_id: section, term_id: term.id, roll_number: roll, enrolled_on: date }).execute();
    await db.transaction().execute(tx=>context.core.linkAccountEndpoint(tx,{school_id:schoolId,person_id:person.id,user_id:value.id,actor_user_id:owner.id,
      effective_from:new Date(Date.now()-86_400_000).toISOString(),effective_until:null,source_domain:"people",source_record_id:learner.id,source_revision:1,metadata:{fixture:"homework_completion"}}));
    return { id: learner.id, actor: asActor(value) };
  };
  const learner = await makeLearner("Learner", 1), sibling = await makeLearner("Sibling", 2);
  const parent = await account("Guardian", "parent");
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: parent.id, role: "guardian" }).execute();
  const parentRecord = await db.insertInto("parents").values({ user_id: parent.id }).returning("id").executeTakeFirstOrThrow();
  const parentPerson = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Guardian" }).returning("id").executeTakeFirstOrThrow();
  await db.insertInto("guardian_school_profiles").values({ school_id: schoolId, guardian_id: parentRecord.id, person_id: parentPerson.id }).execute();
  await db.insertInto("guardian_relationships").values([{ school_id: schoolId, student_id: learner.id, guardian_id: parentRecord.id, relationship: "guardian" },
    { school_id: schoolId, student_id: sibling.id, guardian_id: parentRecord.id, relationship: "guardian" }]).execute();
  await db.transaction().execute(tx=>context.core.linkAccountEndpoint(tx,{school_id:schoolId,person_id:parentPerson.id,user_id:parent.id,actor_user_id:owner.id,
    effective_from:new Date(Date.now()-86_400_000).toISOString(),effective_until:null,source_domain:"people",source_record_id:parentRecord.id,source_revision:1,metadata:{fixture:"homework_completion"}}));
  const staff = await account("Teacher", "staff");
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: staff.id, role: "staff" }).execute();
  const item = async (title: string, type: "homework" | "announcement" = "homework", requiresAcknowledgement = true, publishedAt = new Date(Date.now() - 60_000)) =>
    db.insertInto("diary_items").values({ school_id: schoolId, class_section_id: section, term_id: term.id, date,
      item_type: type, title, body: "Synthetic exercise", author_id: owner.id, subject_id: null, due_at: null,
      requires_acknowledgement: requiresAcknowledgement, published_at: publishedAt }).returning("id").executeTakeFirstOrThrow();
  const homework = await item("Independent homework completion");
  const read = async (school = context.school, id = learner.id) => school.diaryItems(id, await school.enrollment(id), date, date);
  return { ...context, schoolId, date, owner: asActor(owner), guardian: asActor(parent), teacher: asActor(staff), learner, sibling, homework, item, read };
}

describe.runIf(enabled)("homework completion is separate learner evidence", () => {
  it("preserves independent acknowledgement/completion through learner and guardian changes, retries and reopen", async () => {
    const f = await fixture();
    expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: false, completed: false, completed_at: null });
    await f.school.acknowledgeDiary(f.guardian, f.homework.id, f.learner.id);
    expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: true, completed: false, completed_at: null });
    await f.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, true);
    await f.school.setHomeworkCompleted(f.guardian, f.homework.id, f.learner.id, true);
    expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: true, completed: true, completed_at: expect.any(Date) });
    expect((await f.read(f.school, f.sibling.id)).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: false, completed: false });
    await f.school.setHomeworkCompleted(f.guardian, f.homework.id, f.learner.id, false);
    await f.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, false);
    expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: true, completed: false, completed_at: null });
    const events = await db.selectFrom("event_outbox").select(["payload", "audience_user_ids"]).where("school_id", "=", f.schoolId)
      .where("aggregate_type", "=", "homework_completion").orderBy("sequence").execute();
    expect(events.map(event => event.payload)).toMatchObject([{ action: "completed" }, { action: "reopened" }]);
    for (const event of events) expect(new Set(event.audience_user_ids)).toEqual(new Set([f.learner.actor.id, f.guardian.id]));
    const noAck = await f.item("No acknowledgement needed", "homework", false);
    await f.school.setHomeworkCompleted(f.guardian, noAck.id, f.learner.id, true);
    expect((await f.read()).find(item => item.id === noAck.id)).toMatchObject({ acknowledged: false, completed: true });
  });

  it("does not let administrative/teacher access, another learner, revoked relationships or foreign campuses report completion", async () => {
    const f = await fixture(), foreign = await fixture();
    for (const actor of [f.owner, f.teacher, f.sibling.actor, foreign.guardian]) {
      await expect(f.school.setHomeworkCompleted(actor, f.homework.id, f.learner.id, true)).rejects.toThrow();
    }
    expect(await f.school.studentForUser(f.owner, f.learner.id)).toMatchObject({ id: f.learner.id });
    await expect(f.school.setHomeworkCompleted(f.learner.actor, foreign.homework.id, f.learner.id, true)).rejects.toThrow("Homework not found");
    const announcement = await f.item("Read only update", "announcement");
    await expect(f.school.setHomeworkCompleted(f.learner.actor, announcement.id, f.learner.id, true)).rejects.toThrow("Homework not found");
    const unpublished = await f.item("Not published yet", "homework", true, new Date(Date.now() + 3_600_000));
    await expect(f.school.setHomeworkCompleted(f.guardian, unpublished.id, f.learner.id, true)).rejects.toThrow("Homework not found");
    await db.deleteFrom("guardian_relationships").where("school_id", "=", f.schoolId).where("student_id", "=", f.learner.id).execute();
    await expect(f.school.setHomeworkCompleted(f.guardian, f.homework.id, f.learner.id, true)).rejects.toThrow();
    await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.guardian.id).execute();
    await expect(f.school.setHomeworkCompleted(f.guardian, f.homework.id, f.learner.id, true)).rejects.toThrow();
    expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: false, completed: false });
  });

  it("rolls back completion when its update event fails and permits a clean retry", async () => {
    const f = await fixture();
    const failure = vi.spyOn(f.events, "enqueueUserEvent").mockRejectedValueOnce(new Error("Injected event failure"));
    try {
      await expect(f.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, true)).rejects.toThrow("Injected event failure");
      expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: false, completed: false });
      await f.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, true);
      expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ acknowledged: false, completed: true });
      expect(await db.selectFrom("event_outbox").select("id").where("school_id", "=", f.schoolId).where("aggregate_type", "=", "homework_completion").execute()).toHaveLength(1);
    } finally { failure.mockRestore(); }
  });

  it.runIf(Boolean(targetUrl))("completes and reopens in one captured COW world without changing Live, sibling or acknowledgement", async () => {
    const f = await fixture();
    const now = new Date().toISOString();
    await f.school.acknowledgeDiary(f.guardian, f.homework.id, f.learner.id);
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 2);
    const opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId,
          namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } });
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "homework-completion-test", checked_at: now });
        return { ...services(database), database, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const world = await open(), sibling = await open();
      await world.run(async () => {
        await expect(world.school.setHomeworkCompleted(f.owner, f.homework.id, f.learner.id, true)).rejects.toThrow();
        await expect(world.school.setHomeworkCompleted(f.sibling.actor, f.homework.id, f.learner.id, true)).rejects.toThrow();
        await world.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, true);
        await world.school.setHomeworkCompleted(f.guardian, f.homework.id, f.learner.id, true);
        expect((await f.read(world.school)).find(item => item.id === f.homework.id)).toMatchObject({ completed: true, acknowledged: true });
        expect((await world.database.selectFrom("event_outbox").select("id").where("aggregate_type", "=", "homework_completion").execute())).toHaveLength(1);
      });
      const liveEnvironment = createLiveExecutionEnvironment({ institution_id: f.schoolId,
        clock: { now: () => new Date(now), nowIso: () => now } });
      await executionEnvironmentStorage.run(liveEnvironment, async () => {
        expect((await f.read()).find(item => item.id === f.homework.id)).toMatchObject({ completed: false, acknowledged: true });
        expect(await db.selectFrom("event_outbox").select("id").where("school_id", "=", f.schoolId).where("aggregate_type", "=", "homework_completion").execute()).toHaveLength(0);
      });
      await sibling.run(async () => {
        expect((await f.read(sibling.school)).find(item => item.id === f.homework.id)).toMatchObject({ completed: false, acknowledged: true });
      });
      await world.run(async () => {
        await world.school.setHomeworkCompleted(f.guardian, f.homework.id, f.learner.id, false);
        expect((await f.read(world.school)).find(item => item.id === f.homework.id)).toMatchObject({ completed: false, acknowledged: true });
        await world.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, true);
        await world.school.setHomeworkCompleted(f.learner.actor, f.homework.id, f.learner.id, true);
        expect((await world.database.selectFrom("event_outbox").select("payload").where("aggregate_type", "=", "homework_completion").orderBy("sequence").execute())
          .map(event => event.payload)).toMatchObject([{ action: "completed" }, { action: "reopened" }, { action: "completed" }]);
      });
    } finally {
      await Promise.all(opened.map(database => database.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
