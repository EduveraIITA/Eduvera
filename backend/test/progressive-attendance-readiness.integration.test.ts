import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage, executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { rollbackAcademicFixture } from "./academic-participation.test-support.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const pool = new Pool({ connectionString: sourceUrl, max: 3 });
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }) as DatabaseService;
afterAll(() => database.destroy());
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

function services(db: DatabaseService) {
  const core = new CampusModelCoreService(db);
  const planning = new ActivityPlanningService(db, new SchoolEventService(db, core), core, core, core, new ResponsibilityProjectionService(core));
  return { core, planning, attendance: new ActivityAttendanceService(db, core, core, core, core, core),
    setup: new ProgressiveSetupService(db, core, core, core) };
}

async function fixture(db: DatabaseService) {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `readiness-${suffix}`, email: `readiness-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: "Campus", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "UTC"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const day = addDays(new Date().toISOString().slice(0, 10), 1);
  let now = `${day}T09:30:00.000Z`;
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const owner = await run(() => db.transaction().execute(tx => context.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() })));
  if (!owner.acting) throw new Error("An explicit founder endpoint is required.");
  const participant = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Passive participant", last_name: "" }).returning("id").executeTakeFirstOrThrow();
  const addAdministrator = async () => {
    const key = randomUUID();
    const account = await db.insertInto("users").values({ username: `reviewer-${key}`, email: `reviewer-${key}@example.test`,
      password_hash: "isolated-test-only", first_name: "Another", last_name: "Operator", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: account.id, role: "admin", is_active: true }).execute();
    const identity = await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: account.id, owner_user_id: user.id });
    return { user: { ...account, active_school_id: schoolId } as AuthUser, personId: identity.person_id };
  };
  const publish = async (options: { start?: string; end?: string; reviewer?: string; recorder?: string; timezone?: string; day?: string } = {}) => {
    const draft = await context.planning.create(request(user), schoolId, { idempotency_key: randomUUID(), title: "A bounded attendance activity",
      purpose: "training", timezone: options.timezone ?? "UTC", starts_on: options.day ?? day, ends_on: options.day ?? day,
      recurrence: "once", starts_at: options.start ?? "09:00", ends_at: options.end ?? "10:00", person_ids: [participant.id], attendance_mode: "roll_call",
      recorder_person_id: options.recorder ?? owner.person_id, reviewer_person_id: options.reviewer ?? owner.person_id });
    await context.planning.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
    const occurrence = (await context.planning.ensureOccurrences(schoolId, options.day ?? day, options.day ?? day)).find(row => row.plan_version_id === draft.id)!;
    return { plan: draft, occurrence, registerId: await context.attendance.ensureRegister(schoolId, occurrence.id) };
  };
  return { ...context, db, schoolId, user, owner, day, participant: participant.id, run, publish, addAdministrator,
    setNow: (value: string) => { now = value; } };
}

async function attendanceCard(f: Awaited<ReturnType<typeof fixture>>, user = f.user) {
  const workspace = await f.setup.workspace(user, f.schoolId);
  return [...workspace.working_now, ...workspace.useful_next, ...workspace.available_anytime].find(item => item.capability === "attendance")!;
}

async function automaticReviewFixture(db: DatabaseService) {
  const f = await fixture(db);
  return f.run(async () => {
    const reviewer = await f.addAdministrator();
    await sql`INSERT INTO institution_operating_rules(school_id,updated_by,attendance_finalization_mode,attendance_auto_finalize_minutes)
      VALUES(${f.schoolId}::uuid,${f.user.id}::uuid,'automatic',10)`.execute(db);
    const saved = await f.publish({ reviewer: reviewer.personId });
    await f.attendance.submitRecords(f.user, f.schoolId, saved.registerId,
      { expected_revision: 0, records: [{ person_id: f.participant, status: "present" }] }, request(f.user));
    return { f, reviewer, saved };
  });
}

describe.skipIf(!enabled)("actor and occurrence qualified progressive Attendance", () => {
  it("keeps an empty private campus at the first activity without materializing records or requiring other subsystems", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        expect(await attendanceCard(f)).toMatchObject({ status: "needs_setup", missing: [{ key: "activity", label: "First activity",
          destination: "/areas/timetable/planning?create=attendance" }] });
        const records = (await sql<{ plans: number; registers: number; classes: number; gates: number }>`SELECT
          (SELECT count(*)::int FROM schedule_versions WHERE school_id=${f.schoolId}::uuid) AS plans,
          (SELECT count(*)::int FROM activity_attendance_registers WHERE school_id=${f.schoolId}::uuid) AS registers,
          (SELECT count(*)::int FROM class_sections WHERE school_id=${f.schoolId}::uuid) AS classes,
          (SELECT count(*)::int FROM campus_spaces WHERE school_id=${f.schoolId}::uuid AND kind='gate') AS gates`.execute(db)).rows[0];
        expect(records).toEqual({ plans: 0, registers: 0, classes: 0, gates: 0 });
      });
    });
  });

  it("does not infer an administrator's operating responsibility from someone else's published plan", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const unassigned = await f.addAdministrator(), saved = await f.publish();
        expect(await attendanceCard(f)).toMatchObject({ status: "working",
          destination: `/areas/attendance/registers?date=${f.day}&occurrence_id=${saved.occurrence.id}`,
          operation: { actor_user_id: f.user.id, action: "record", state: "ready", scope: { kind: "occurrence", id: saved.occurrence.id, date: f.day }, requires_recheck: true } });
        const unrelated = await attendanceCard(f, unassigned.user);
        expect(unrelated).toMatchObject({ status: "needs_setup", missing: [{ key: "activity", label: "Your attendance responsibility" }] });
        expect(unrelated.operation).toBeUndefined();
        expect((await f.setup.workspace(f.user, f.schoolId)).working_now.map(item => item.capability)).toContain("timetable");
        const cards = await f.setup.workspace(f.user, f.schoolId);
        expect([...cards.working_now, ...cards.useful_next, ...cards.available_anytime].map(item => item.capability).sort())
          .toEqual(["accommodation", "assignments", "attendance", "examinations", "facilities", "fees", "gate", "messages", "performance", "resources", "staff", "timetable"]);
      });
    });
  });

  it("keeps an ended plan's submitted review exact and separate from the recorder's waiting state", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const reviewer = await f.addAdministrator(), saved = await f.publish({ reviewer: reviewer.personId });
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ status: "working", operation: { action: "view", state: "waiting_for_recorder" } });
        await f.attendance.submitRecords(f.user, f.schoolId, saved.registerId,
          { expected_revision: 0, records: [{ person_id: f.participant, status: "present" }] }, request(f.user));
        f.setNow(`${addDays(f.day, 3)}T12:00:00.000Z`);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ status: "working",
          destination: `/areas/attendance/registers?date=${f.day}&occurrence_id=${saved.occurrence.id}`,
          operation: { action: "review", state: "ready", register_revision: 1 } });
        expect(await attendanceCard(f)).toMatchObject({ status: "working", operation: { action: "view", state: "waiting_for_review" } });
        await f.attendance.transition(reviewer.user, f.schoolId, saved.registerId, "finalize", { expected_revision: 1 }, request(reviewer.user));
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "view", state: "complete", register_revision: 2 } });
      });
    });
  });

  it("keeps healthy future automatic finalization out of human review until the exact deadline, without claiming Final", async () => {
    await rollbackAcademicFixture(database, async db => {
      const { f, reviewer, saved } = await automaticReviewFixture(db);
      await f.run(async () => {
        f.setNow(`${f.day}T09:39:59.999Z`);
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", revision: 1, auto_finalize_at: `${f.day}T09:40:00.000Z`,
          finalization: { state: "automatic_pending", reason: "scheduled", scheduled_at: `${f.day}T09:40:00.000Z` },
        });
        expect(await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).toEqual([]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "view", state: "automatic_pending", register_revision: 1 } });
        expect(await attendanceCard(f)).toMatchObject({ operation: { action: "view", state: "automatic_pending", register_revision: 1 } });

        f.setNow(`${f.day}T09:40:00.000Z`);
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", revision: 1, finalization: { state: "review_required", reason: "overdue" },
        });
        expect(await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).toEqual([
          expect.objectContaining({ register_id: saved.registerId, finalization: { state: "review_required", reason: "overdue", scheduled_at: `${f.day}T09:40:00.000Z` } }),
        ]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "review", state: "ready", register_revision: 1 } });
        expect(await attendanceCard(f)).toMatchObject({ operation: { action: "view", state: "waiting_for_review", register_revision: 1 } });

        expect(await f.attendance.finalizeDue(f.schoolId)).toBe(1);
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({ state: "locked", revision: 2 });
        expect(await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).toEqual([]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "view", state: "complete", register_revision: 2 } });
      });
    });
  });

  it("restores the exact reviewer before the deadline when the accepted automatic policy revision changes", async () => {
    await rollbackAcademicFixture(database, async db => {
      const { f, reviewer, saved } = await automaticReviewFixture(db);
      await f.run(async () => {
        await sql`UPDATE institution_operating_rules SET revision=revision+1 WHERE school_id=${f.schoolId}::uuid`.execute(db);
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", revision: 1, finalization: { state: "review_required", reason: "policy_changed" },
        });
        expect((await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).map(item => item.register_id)).toEqual([saved.registerId]);
        expect(await f.attendance.pendingActivityReviews(f.user, f.schoolId)).toEqual([]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "review", state: "ready", register_revision: 1 } });
        f.setNow(`${f.day}T09:41:00.000Z`);
        expect(await f.attendance.finalizeDue(f.schoolId)).toBe(0);
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register.state).toBe("submitted");
      });
    });
  });

  it("restores human review for conflicting evidence even while the automatic deadline is in the future", async () => {
    await rollbackAcademicFixture(database, async db => {
      const { f, reviewer, saved } = await automaticReviewFixture(db);
      await f.run(async () => {
        await f.attendance.evidence(f.user, f.schoolId, saved.registerId, { expected_revision: 1, person_id: f.participant,
          claimed_status: "late", capture_channel: "offline_paper", observed_at: `${f.day}T09:15:00.000Z`,
          note: "A signed paper source conflicts with the submitted mark." }, request(f.user));
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", revision: 2, finalization: { state: "review_required", reason: "evidence_pending" },
        });
        expect((await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).map(item => item.register_id)).toEqual([saved.registerId]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "review", state: "ready", register_revision: 2 } });
        f.setNow(`${f.day}T09:41:00.000Z`);
        expect(await f.attendance.finalizeDue(f.schoolId)).toBe(0);
      });
    });
  });

  it("does not repair an inactive policy approver from a read and leaves the active appointed reviewer responsible", async () => {
    await rollbackAcademicFixture(database, async db => {
      const { f, reviewer, saved } = await automaticReviewFixture(db);
      await f.run(async () => {
        await db.updateTable("users").set({ is_active: false }).where("id", "=", f.user.id).execute();
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", revision: 1, finalization: { state: "review_required", reason: "approver_unavailable" },
        });
        expect((await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).map(item => item.register_id)).toEqual([saved.registerId]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "review", state: "ready", register_revision: 1 } });
        expect((await db.selectFrom("users").select("is_active").where("id", "=", f.user.id).executeTakeFirstOrThrow()).is_active).toBe(false);
        f.setNow(`${f.day}T09:41:00.000Z`);
        await expect(f.attendance.finalizeDue(f.schoolId)).rejects.toThrow("The linked account is inactive.");
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register.state).toBe("submitted");
      });
    });
  });

  it("retains deliberate manual override and returns a reopened final register to human review, not automatic completion", async () => {
    await rollbackAcademicFixture(database, async db => {
      const { f, reviewer, saved } = await automaticReviewFixture(db);
      await f.run(async () => {
        const pending = await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId);
        expect(pending.capabilities.can_finalize).toBe(true);
        expect(await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).toEqual([]);
        await f.attendance.transition(reviewer.user, f.schoolId, saved.registerId, "finalize", { expected_revision: 1 }, request(reviewer.user));
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "view", state: "complete", register_revision: 2 } });
        await f.attendance.transition(reviewer.user, f.schoolId, saved.registerId, "reopen", { expected_revision: 2,
          reason: "Review a reported correction before finalizing again." }, request(reviewer.user));
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", revision: 3, auto_finalize_at: null,
          finalization: { state: "review_required", reason: "manual", scheduled_at: null },
        });
        expect((await f.attendance.pendingActivityReviews(reviewer.user, f.schoolId)).map(item => item.register_id)).toEqual([saved.registerId]);
        expect(await attendanceCard(f, reviewer.user)).toMatchObject({ operation: { action: "review", state: "ready", register_revision: 3 } });
        f.setNow(`${f.day}T09:41:00.000Z`);
        expect(await f.attendance.finalizeDue(f.schoolId)).toBe(0);
        expect((await f.attendance.detail(reviewer.user, f.schoolId, saved.registerId)).register.state).toBe("submitted");
      });
    });
  });

  it("discovers the occurrence's own local date without claiming a future register is open", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        // Stay after the fixture account's real creation time while exercising
        // a different occurrence-local date. No identity may act before it exists.
        const localDay = addDays(f.day, 1);
        f.setNow(`${addDays(localDay, -1)}T18:30:00.000Z`);
        const saved = await f.publish({ day: localDay, timezone: "Asia/Kolkata", start: "01:00", end: "02:00" });
        expect(await attendanceCard(f)).toMatchObject({ destination: `/areas/attendance/registers?date=${localDay}&occurrence_id=${saved.occurrence.id}`,
          operation: { state: "opens_later", starts_at: `${addDays(localDay, -1)}T19:30:00.000Z`, scope: { date: localDay } } });
        expect((await f.attendance.detail(f.user, f.schoolId, saved.registerId)).capabilities.can_record).toBe(false);
        f.setNow(`${addDays(localDay, -1)}T19:45:00.000Z`);
        expect(await attendanceCard(f)).toMatchObject({ operation: { state: "ready" } });
      });
    });
  });

  it("drops revoked technical permission while retaining the published person appointment", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const key = randomUUID();
        const account = await db.insertInto("users").values({ username: `staff-readiness-${key}`, email: `staff-readiness-${key}@example.test`,
          password_hash: "isolated-test-only", first_name: "Assigned", last_name: "Recorder", role: "staff" })
          .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
        await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: account.id, role: "staff", is_active: true }).execute();
        const identity = await linkFixtureStaffIdentity(db, { school_id: f.schoolId, user_id: account.id, owner_user_id: f.user.id });
        const user: AuthUser = { ...account, active_school_id: f.schoolId };
        await sql`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,valid_from,valid_until,review_due_on,created_by)
          VALUES(${f.schoolId}::uuid,${user.id}::uuid,'sis.manage','Isolated scoped setup inspection','manual',current_date-1,current_date+30,current_date+10,${f.user.id}::uuid)`.execute(db);
        const profile = await db.selectFrom("staff_profiles").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", user.id).executeTakeFirstOrThrow();
        const role = (await sql<{ id: string }>`INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,
          capability_permissions,workflow_family,source_kind,context_kind,requires_acceptance,updated_by)
          VALUES(${f.schoolId}::uuid,${`readiness_${key.slice(0, 8)}`},'Explicit attendance recorder','operations','school',
            ARRAY['attendance.view','attendance.record'],'readiness_recording','institute','institution',false,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
        const assignment = (await sql<{ id: string }>`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,
          staff_profile_id,scope_label,starts_on,status,assigned_by)
          VALUES(${f.schoolId}::uuid,${role.id}::uuid,${profile.id}::uuid,'Institution attendance',current_date-1,'active',${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
        const saved = await f.publish({ recorder: identity.person_id });
        expect(await attendanceCard(f, user)).toMatchObject({ status: "working", operation: { action: "record" } });
        await sql`UPDATE staff_responsibility_assignments SET status='revoked',revoked_at=now(),revoked_by=${f.user.id}::uuid,
          revocation_reason='Isolated permission revocation' WHERE school_id=${f.schoolId}::uuid AND id=${assignment.id}::uuid`.execute(db);
        expect(await attendanceCard(f, user)).toMatchObject({ status: "needs_setup" });
        expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM schedule_activity_occurrence_recorders
          WHERE occurrence_id=${saved.occurrence.id}::uuid AND person_id=${identity.person_id}::uuid`.execute(db)).rows[0]!.count).toBe(1);
      });
    });
  });

  it.runIf(Boolean(targetUrl))("re-evaluates source state in one Simulation and leaves Live and its sibling unchanged", async () => {
    const f = await fixture(database), saved = await f.run(() => f.publish());
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4);
    const opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, `${f.day}T09:30:00.000Z`);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(db);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: `${f.day}T09:45:00.000Z`,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "attendance-readiness-test", checked_at: `${f.day}T09:30:00.000Z` });
        return { ...f, ...services(db), db, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect(await attendanceCard(branch)).toMatchObject({ operation: { action: "record", state: "ready", register_revision: 0 } });
        await sql`INSERT INTO institution_operating_rules(school_id,updated_by,attendance_finalization_mode,attendance_auto_finalize_minutes)
          VALUES(${f.schoolId}::uuid,${f.user.id}::uuid,'automatic',10)`.execute(branch.db);
        await branch.attendance.submitRecords(f.user, f.schoolId, saved.registerId,
          { expected_revision: 0, records: [{ person_id: f.participant, status: "late" }] }, request(f.user));
        expect((await branch.attendance.detail(f.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", finalization: { state: "automatic_pending", reason: "scheduled", scheduled_at: `${f.day}T09:55:00.000Z` },
        });
        expect(await attendanceCard(branch)).toMatchObject({ operation: { action: "view", state: "automatic_pending", register_revision: 1 } });
        expect(await branch.attendance.pendingActivityReviews(f.user, f.schoolId)).toEqual([]);
        await sql`UPDATE institution_operating_rules SET revision=revision+1 WHERE school_id=${f.schoolId}::uuid`.execute(branch.db);
        expect((await branch.attendance.detail(f.user, f.schoolId, saved.registerId)).register).toMatchObject({
          state: "submitted", finalization: { state: "review_required", reason: "policy_changed" },
        });
        expect(await attendanceCard(branch)).toMatchObject({ operation: { action: "review", state: "ready", register_revision: 1 } });
        expect((await branch.attendance.pendingActivityReviews(f.user, f.schoolId)).map(item => item.register_id)).toEqual([saved.registerId]);
      });
      expect(await f.run(() => attendanceCard(f))).toMatchObject({ operation: { action: "record", register_revision: 0 } });
      expect(await sibling.run(() => attendanceCard(sibling))).toMatchObject({ operation: { action: "record", register_revision: 0 } });
      expect((await f.run(() => sql`SELECT school_id FROM institution_operating_rules WHERE school_id=${f.schoolId}::uuid`.execute(f.db))).rows).toEqual([]);
      expect((await sibling.run(() => sql`SELECT school_id FROM institution_operating_rules WHERE school_id=${f.schoolId}::uuid`.execute(sibling.db))).rows).toEqual([]);
    } finally {
      await Promise.all(opened.map(db => db.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
