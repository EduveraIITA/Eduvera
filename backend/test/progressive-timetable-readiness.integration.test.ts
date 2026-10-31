import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { AuditService } from "../src/common/audit.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { InstitutionOnboardingService } from "../src/institution-onboarding/institution-onboarding.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { RolesService } from "../src/roles/roles.service.js";
import { activityPlanDestination, parseActivityPlanContinuation, readTimetablePlanningReadiness, resolveActivityPlanContinuation } from "../src/schedule-planning/activity-planning-readiness.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { rollbackAcademicFixture } from "./academic-participation.test-support.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// No reset, migration, global seed, provider or application-worker startup. All
// fixtures are explicitly synthetic; direct identity setup is not onboarding proof.
const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = process.env.SIMULATION_TIMETABLE_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), ip: "127.0.0.1", headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;
const dayPlus = (value: string, days: number) => new Date(Date.parse(value) + days * 86_400_000).toISOString().slice(0, 10);

function services(db: DatabaseService) {
  const core = new CampusModelCoreService(db), provisioner = new ProgressiveWorkspaceProvisioner(core), audit = new AuditService(db);
  return { core, planning: new ActivityPlanningService(db, new SchoolEventService(db, core), core, core, core, new ResponsibilityProjectionService(core)),
    setup: new ProgressiveSetupService(db, core, core, core), onboarding: new InstitutionOnboardingService(db, audit, provisioner, core, core),
    auth: new AuthService(db, audit, new RolesService(db), provisioner, undefined, undefined, undefined, core) };
}

async function fixture(db: DatabaseService) {
  const context = services(db), key = randomUUID();
  const account = await db.insertInto("users").values({ username: `timetable-owner-${key}`, email: `timetable-owner-${key}@example.test`,
    password_hash: "isolated-test-only", first_name: "Timetable", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "UTC"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const today = dayPlus(new Date().toISOString().slice(0, 10), 1), day = dayPlus(today, 2);
  let now = `${today}T08:00:00.000Z`;
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(work: () => Promise<T>) => executionEnvironmentStorage.run(environment, work);
  const person = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Shared passive", last_name: "Person" }).returning("id").executeTakeFirstOrThrow();
  await run(() => context.onboarding.setGoals(user, { goals: ["timetable", "attendance", "gate"] }, request(user)));
  const input = (overrides: Record<string, unknown> = {}) => ({ idempotency_key: randomUUID(), title: "Welcome planning meeting", purpose: "meeting", timezone: "UTC",
    starts_on: day, ends_on: day, recurrence: "once", starts_at: "09:00", ends_at: "10:00", person_ids: [person.id], attendance_mode: "none", ...overrides });
  const anotherAdmin = async () => {
    const suffix = randomUUID();
    const row = await db.insertInto("users").values({ username: `timetable-admin-${suffix}`, email: `timetable-admin-${suffix}@example.test`,
      password_hash: "isolated-test-only", first_name: "Other", last_name: "Administrator", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: row.id, role: "admin", is_active: true }).execute();
    await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: row.id, owner_user_id: user.id });
    return { ...row, active_school_id: schoolId } as AuthUser;
  };
  return { ...context, db, schoolId, user, day, today, personId: person.id, run, input, anotherAdmin, setNow: (value: string) => { now = value; } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const retained = (f: Fixture) => f.db.selectFrom("progressive_onboarding_workspaces").select(["resume_step", "resume_goal_key", "resume_path", "revision"])
  .where("school_id", "=", f.schoolId).executeTakeFirstOrThrow();
const operation = (f: Fixture, user = f.user) => readTimetablePlanningReadiness(f.db, f.core, user, f.schoolId);

describe.skipIf(!enabled)("actor-qualified Timetable first-use continuation", () => {
  it("starts one non-academic meeting, resumes its exact saved revision, preserves replay and advances only on publication", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        expect(await operation(f)).toMatchObject({ destination: "/areas/timetable/planning?create=activity", operation: { action: "create", state: "ready_to_create", scope: null } });
        const body = f.input(), draft = await f.planning.create(request(f.user), f.schoolId, body), path = activityPlanDestination(draft);
        expect(await retained(f)).toMatchObject({ resume_step: "first_use", resume_goal_key: "timetable", resume_path: path });
        expect(await operation(f)).toMatchObject({ destination: path, operation: { action: "continue", state: "draft", actor_user_id: f.user.id,
          environment_namespace_id: `live:${f.schoolId}`, scope: { kind: "plan", id: draft.id, date: f.day }, source_revision: 1 } });
        const beforeReplay = await retained(f);
        const auditCount = async () => (await sql<{ count: number }>`SELECT count(*)::int AS count FROM progressive_onboarding_audits
          WHERE workspace_id=(SELECT id FROM progressive_onboarding_workspaces WHERE school_id=${f.schoolId}::uuid)`.execute(db)).rows[0]!.count;
        const audits = await auditCount();
        expect((await f.planning.create(request(f.user), f.schoolId, body)).id).toBe(draft.id);
        expect(await retained(f)).toEqual(beforeReplay); expect(await auditCount()).toBe(audits);
        expect((await f.auth.me(f.user)).onboarding.resume).toMatchObject({ step: "first_use", path,
          continuation: { kind: "activity_plan", actor_user_id: f.user.id, school_id: f.schoolId, source_id: draft.id, source_revision: 1, requires_recheck: true } });
        const saved = await f.planning.update(request(f.user), f.schoolId, draft.id, f.input({ expected_revision: draft.revision, title: "Reviewed welcome meeting" }));
        expect(saved.revision).toBe(2);
        expect(await retained(f)).toMatchObject({ resume_step: "first_use", resume_path: activityPlanDestination(saved) });
        await f.onboarding.setResume(f.user, { step: "first_use", goal: "timetable", path: "/more/setup/capabilities?task=timetable" }, request(f.user));
        expect(await retained(f)).toMatchObject({ resume_step: "first_use", resume_path: activityPlanDestination(saved) });
        const published = await f.planning.publish(request(f.user), f.schoolId, saved.id, { idempotency_key: randomUUID(), expected_revision: saved.revision });
        expect(await retained(f)).toMatchObject({ resume_step: "operating", resume_goal_key: "timetable", resume_path: activityPlanDestination(published) });
        await f.onboarding.setResume(f.user, { step: "first_use", goal: "timetable", path: "/more/setup/capabilities?task=timetable" }, request(f.user));
        expect(await retained(f)).toMatchObject({ resume_step: "operating", resume_path: activityPlanDestination(published) });
        expect((await f.auth.me(f.user)).onboarding.resume).not.toHaveProperty("continuation");
        const workspace = await f.setup.workspace(f.user, f.schoolId), cards = [...workspace.working_now, ...workspace.useful_next, ...workspace.available_anytime];
        expect(cards.map(item => item.capability).sort()).toEqual(["accommodation", "assignments", "attendance", "dining", "examinations", "facilities", "fees", "gate", "messages", "performance", "resources", "staff", "timetable"]);
        expect(cards.find(item => item.capability === "timetable")).toMatchObject({ status: "working", timetable_operation: { action: "view", state: "published" } });
        const counts = (await sql<{ people: number; students: number; terms: number; classes: number; registers: number }>`SELECT
          (SELECT count(*)::int FROM school_people WHERE school_id=${f.schoolId}::uuid) AS people,
          (SELECT count(*)::int FROM students WHERE school_id=${f.schoolId}::uuid) AS students,
          (SELECT count(*)::int FROM academic_terms WHERE school_id=${f.schoolId}::uuid) AS terms,
          (SELECT count(*)::int FROM class_sections WHERE school_id=${f.schoolId}::uuid) AS classes,
          (SELECT count(*)::int FROM activity_attendance_registers WHERE school_id=${f.schoolId}::uuid) AS registers`.execute(db)).rows[0];
        expect(counts).toEqual({ people: 2, students: 0, terms: 0, classes: 0, registers: 0 });
        for (const [index, primary] of ["gate", "attendance"].entries()) {
          await f.onboarding.setGoals(f.user, { goals: [primary, "timetable"], primary }, request(f.user));
          const before = await retained(f);
          const other = await f.planning.create(request(f.user), f.schoolId, f.input({ starts_at: `${11 + index}:00`, ends_at: `${12 + index}:00` }));
          await f.planning.publish(request(f.user), f.schoolId, other.id, { idempotency_key: randomUUID(), expected_revision: other.revision });
          expect(await retained(f)).toEqual(before);
        }
      });
    });
  });

  it("keeps manager access separate from personal continuation and rejects forged, revoked or non-activity sources", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db), foreign = await fixture(db);
      await f.run(async () => {
        const other = await f.anotherAdmin(), draft = await f.planning.create(request(f.user), f.schoolId, f.input()), path = activityPlanDestination(draft);
        // Current campus managers can inspect a draft, but do not adopt its owner's first-use work.
        expect((await f.planning.getPlan(other, f.schoolId, draft.id)).id).toBe(draft.id);
        expect(await operation(f, other)).toMatchObject({ operation: { action: "create", scope: null } });
        expect((await f.auth.me(other)).onboarding.resume).toMatchObject({ path: "/more/setup/capabilities?task=timetable" });
        expect((await f.auth.me(other)).onboarding.resume).not.toHaveProperty("continuation");
        expect((await f.onboarding.workspace(other)).resume.path).not.toContain(draft.id);
        const original = await retained(f);
        for (const [goal, target] of [["timetable", path], ["attendance", "/more/setup/capabilities?task=attendance"]]) {
          await expect(f.onboarding.setResume(other, { step: "first_use", goal, path: target }, request(other))).rejects.toThrow(/another administrator/i);
          expect(await retained(f)).toEqual(original);
        }
        await expect(f.planning.getPlan(f.user, f.schoolId, "abc")).rejects.toMatchObject({ status: 400 });
        for (const bad of ["//external.test", "/areas/timetable/planning?plan=abc", path + "&plan=" + draft.id, path + "&redirect=/today", path + "#fragment"]) {
          expect(parseActivityPlanContinuation(bad)).toBeNull();
          await expect(f.onboarding.setResume(f.user, { step: "first_use", goal: "timetable", path: bad }, request(f.user))).rejects.toThrow();
        }
        const foreignDraft = await foreign.run(() => foreign.planning.create(request(foreign.user), foreign.schoolId, foreign.input()));
        await expect(f.onboarding.setResume(f.user, { step: "first_use", goal: "timetable", path: activityPlanDestination(foreignDraft) }, request(f.user))).rejects.toThrow(/accessible activity/i);
        await expect(f.onboarding.setResume(f.user, { step: "operating", goal: "timetable", path }, request(f.user))).rejects.toThrow(/Publish/);
        const term = await db.insertInto("academic_terms").values({ school_id: f.schoolId, academic_year: "QA2026", name: "Only a negative source fixture",
          starts_on: f.today, ends_on: dayPlus(f.day, 30), attendance_threshold: "75" }).returning("id").executeTakeFirstOrThrow();
        const section = await db.insertInto("class_sections").values({ school_id: f.schoolId, academic_year: "QA2026", grade: "QA", section: "A" }).returning("id").executeTakeFirstOrThrow();
        await sql`UPDATE schedule_versions SET planning_origin='academic',class_section_id=${section.id}::uuid,term_id=${term.id}::uuid WHERE id=${draft.id}::uuid`.execute(db);
        expect(await resolveActivityPlanContinuation(db, f.core, f.user, f.schoolId, path)).toBeNull();
        await sql`UPDATE schedule_versions SET planning_origin='activity',class_section_id=NULL,term_id=NULL,state='discarded' WHERE id=${draft.id}::uuid`.execute(db);
        expect(await resolveActivityPlanContinuation(db, f.core, f.user, f.schoolId, path)).toBeNull();
        expect((await f.auth.me(f.user)).onboarding.resume).not.toHaveProperty("continuation");
        await f.planning.create(request(f.user), f.schoolId, f.input());
        await sql`UPDATE school_memberships SET role='staff' WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
        expect(await operation(f)).toMatchObject({ operation: { action: "unavailable", recovery: "authority_changed" } });
        await sql`UPDATE school_memberships SET role='admin' WHERE school_id=${f.schoolId}::uuid AND user_id=${f.user.id}::uuid`.execute(db);
        await sql`UPDATE users SET is_active=false WHERE id=${f.user.id}::uuid`.execute(db);
        expect(await operation(f)).toMatchObject({ operation: { action: "unavailable", recovery: "authority_changed" } });
        expect((await f.onboarding.workspace(f.user)).resume).not.toHaveProperty("continuation");
      });
    });
  });

  it("retains stale and superseded or cancelled sources as truthful read context, never as an editable current publication", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const draft = await f.planning.create(request(f.user), f.schoolId, f.input()), oldPath = activityPlanDestination(draft);
        const saved = await f.planning.update(request(f.user), f.schoolId, draft.id, f.input({ expected_revision: draft.revision }));
        const stale = await f.onboarding.setResume(f.user, { step: "first_use", goal: "timetable", path: oldPath }, request(f.user));
        expect(stale.resume).toMatchObject({ path: oldPath, recovery: "source_changed", continuation: { source_revision: saved.revision } });
        expect(await operation(f)).toMatchObject({ destination: oldPath, operation: { action: "continue", recovery: "source_changed", source_revision: saved.revision } });
        const published = await f.planning.publish(request(f.user), f.schoolId, saved.id, { idempotency_key: randomUUID(), expected_revision: saved.revision });
        const revision = await f.planning.revise(request(f.user), f.schoolId, published.id, { idempotency_key: randomUUID(), expected_revision: published.revision, starts_on: f.day, reason: "Revised welcome plan" });
        await f.planning.update(request(f.user), f.schoolId, revision.id, f.input({ expected_revision: revision.revision, starts_at: "10:00", ends_at: "11:00" }));
        const current = await f.planning.getPlan(f.user, f.schoolId, revision.id);
        await f.planning.publish(request(f.user), f.schoolId, current.id, { idempotency_key: randomUUID(), expected_revision: current.revision });
        f.setNow(`${f.day}T09:30:00.000Z`);
        expect(await operation(f)).toMatchObject({ operation: { action: "view", state: "superseded", scope: { id: published.id } } });
        const replacement = await f.planning.getPlan(f.user, f.schoolId, revision.id);
        await f.onboarding.setResume(f.user, { step: "operating", goal: "timetable", path: activityPlanDestination(replacement) }, request(f.user));
        f.setNow(`${dayPlus(f.day, 1)}T12:00:00.000Z`);
        expect(await operation(f)).toMatchObject({ operation: { action: "view", state: "historical", scope: { id: replacement.id } } });
        await f.planning.cancel(request(f.user), f.schoolId, replacement.id, { idempotency_key: randomUUID(), expected_revision: replacement.revision, reason: "Retained cancellation context" });
        expect(await operation(f)).toMatchObject({ operation: { action: "view", state: "cancelled", recovery: "source_changed" } });
        expect((await f.auth.me(f.user)).onboarding.resume).not.toHaveProperty("continuation");
      });
    });
  });

  it("uses the final scheduled end for overnight and open-ended single occurrences, not a premature date label", async () => {
    for (const legacyUnbounded of [false, true]) await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const draft = await f.planning.create(request(f.user), f.schoolId, f.input({ starts_at: "23:00", ends_at: "01:00", end_day_offset: 1 }));
        // Explicit legacy one-off draft with no ends_on: preserve normal
        // immutable publication while testing its final scheduled instant.
        if (legacyUnbounded) await sql`UPDATE schedule_versions SET ends_on=NULL WHERE id=${draft.id}::uuid`.execute(db);
        await f.planning.publish(request(f.user), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
        f.setNow(`${dayPlus(f.day, 1)}T00:30:00.000Z`);
        expect(await operation(f)).toMatchObject({ operation: { action: "view", state: "published" } });
        f.setNow(`${dayPlus(f.day, 1)}T01:00:00.000Z`);
        expect(await operation(f)).toMatchObject({ operation: { action: "view", state: "historical" } });
      });
    });
  });

  it.runIf(Boolean(targetUrl))("rechecks source revision in a real copy-on-write world without advancing Live onboarding or its sibling", async () => {
    const f = await fixture(database), draft = await f.run(() => f.planning.create(request(f.user), f.schoolId, f.input()));
    const before = await retained(f), store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4), opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, `${f.today}T08:00:00.000Z`);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}`;
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: namespace });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(),
          createIntrospector: value => compiler.createIntrospector(value) } }) as DatabaseService;
        opened.push(db);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: `${f.today}T09:00:00.000Z`,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "timetable-readiness-test", checked_at: `${f.today}T08:00:00.000Z` });
        return { ...f, ...services(db), db, namespace, run: <T>(work: () => Promise<T>) => executionEnvironmentStorage.run(environment, work) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        const changed = await branch.planning.update(request(f.user), f.schoolId, draft.id, f.input({ expected_revision: draft.revision, title: "Simulation-only revision" }));
        expect(await operation(branch)).toMatchObject({ operation: { state: "draft", source_revision: changed.revision, recovery: "source_changed", environment_namespace_id: branch.namespace } });
        const publishCommand = { idempotency_key: randomUUID(), expected_revision: changed.revision };
        const published = await branch.planning.publish(request(f.user), f.schoolId, changed.id, publishCommand);
        const replay = await branch.planning.publish(request(f.user), f.schoolId, changed.id, publishCommand);
        expect(replay.revision).toBe(published.revision);
        const counts = (await sql<{ people: number; occurrences: number }>`SELECT
          (SELECT count(*)::int FROM school_people WHERE school_id=${f.schoolId}::uuid) AS people,
          (SELECT count(*)::int FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid AND plan_version_id=${changed.id}::uuid) AS occurrences`.execute(branch.db)).rows[0];
        expect(counts).toEqual({ people: 2, occurrences: 1 });
        expect(await operation(branch)).toMatchObject({ operation: { action: "view", state: "published", source_revision: published.revision } });
        expect(await retained(branch)).toEqual(before);
        await expect(branch.onboarding.setResume(f.user, { step: "operating", goal: "timetable", path: activityPlanDestination(published) }, request(f.user))).rejects.toThrow(/Live/);
      });
      expect(await retained(f)).toEqual(before); expect(await retained(sibling)).toEqual(before);
      expect(await f.run(() => operation(f))).toMatchObject({ operation: { action: "continue", state: "draft", source_revision: draft.revision } });
      expect(await sibling.run(() => operation(sibling))).toMatchObject({ operation: { action: "continue", state: "draft", source_revision: draft.revision } });
      expect((await f.planning.getPlan(f.user, f.schoolId, draft.id)).title).toBe("Welcome planning meeting");
    } finally {
      await Promise.all(opened.map(db => db.destroy())); await store.pool.end();
    }
  }, 120_000);
});
