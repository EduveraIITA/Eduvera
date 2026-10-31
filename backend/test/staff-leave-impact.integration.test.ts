import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { StaffOperationsService } from "../src/staff-operations/staff-operations.service.js";
import { StaffCoverageReconciliationService } from "../src/staff-operations/staff-coverage-reconciliation.service.js";
import { StaffCoverageOfferBridgeService } from "../src/staff-operations/staff-coverage-offer-bridge.service.js";
import { StaffLeaveModelBridgeService } from "../src/staff-operations/staff-leave-model-bridge.service.js";
import { StaffLeaveReviewRoutingService } from "../src/staff-operations/staff-leave-review-routing.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { GovernanceService } from "../src/governance/governance.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { rollbackAcademicFixture } from "./academic-participation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
const now = "2030-10-01T09:00:00.000Z";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy());

function services(db: DatabaseService) {
  const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope());
  const authority = new GovernanceService(db, new SchoolEventService(db, core), core), bridge = new StaffLeaveModelBridgeService(authority, core);
  const configuration = new CoordinationConfigurationService(core);
  return { core, routes: new StaffLeaveReviewRoutingService(db, bridge, core, core, core, configuration, configuration),
    staff: new StaffOperationsService(db, bridge, new StaffCoverageOfferBridgeService(core),
    createStaffCoverageReconciliationTestDouble(), core, core, core, core) };
}

async function fixture(db: DatabaseService) {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `impact-admin-${suffix}`, email: `impact-admin-${suffix}@example.test`,
    password_hash: "isolated-only", first_name: "Impact", last_name: "Coordinator", role: "admin" }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "UTC"));
  const admin = { ...account, active_school_id: schoolId } as AuthUser;
  const worker = await db.insertInto("users").values({ username: `impact-staff-${suffix}`, email: `impact-staff-${suffix}@example.test`,
    password_hash: "isolated-only", first_name: "Meera", last_name: "Teacher", role: "staff" }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: worker.id, role: "staff", is_active: true }).execute();
  await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: worker.id, owner_user_id: admin.id, teaching: true });
  const user = { ...worker, active_school_id: schoolId } as AuthUser;
  const profile = await db.selectFrom("staff_profiles").selectAll().where("school_id", "=", schoolId).where("user_id", "=", worker.id).executeTakeFirstOrThrow();
  const term = await db.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "2030-31", name: "Impact period",
    starts_on: "2030-04-01", ends_on: "2031-03-31", attendance_threshold: "75", is_active: true }).returning("id").executeTakeFirstOrThrow();
  const policy = await db.insertInto("staff_leave_policies").values({ school_id: schoolId, academic_year: "2030-31", code: "IMPACT", name: "Impact test leave",
    annual_allowance: "100", updated_by: admin.id }).returning("id").executeTakeFirstOrThrow();
  const section = await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: "2030-31", grade: "7", section: "A", updated_by: admin.id }).returning("id").executeTakeFirstOrThrow();
  const subject = await db.insertInto("subjects").values({ school_id: schoolId, code: "IMPACT", name: "Programming", short_name: "Programming" }).returning("id").executeTakeFirstOrThrow();
  const slots = await db.insertInto("timetable_slots").values([
    { class_section_id: section.id, term_id: term.id, subject_id: subject.id, weekday: 1, period_number: 1, starts_at: "09:00", ends_at: "10:00", teacher_user_id: user.id, title: "Morning programming", room: "Room 1", updated_by: admin.id },
    { class_section_id: section.id, term_id: term.id, subject_id: subject.id, weekday: 1, period_number: 2, starts_at: "14:00", ends_at: "15:00", teacher_user_id: user.id, title: "Afternoon programming", room: "Room 1", updated_by: admin.id },
  ]).returning(["id", "period_number"]).execute();
  const type = await db.selectFrom("staff_responsibility_types").select("id").where("school_id", "=", schoolId).where("code", "=", "school_duty").executeTakeFirstOrThrow();
  const duty = await db.insertInto("staff_responsibility_assignments").values({ school_id: schoolId, responsibility_type_id: type.id,
    staff_profile_id: profile.id, scope_label: "Gate support", location: "Main gate", starts_on: "2030-10-07", starts_at: "13:00", ends_at: "14:00",
    status: "active", assigned_by: admin.id }).returning("id").executeTakeFirstOrThrow();
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const input = { policy_id: policy.id, starts_on: "2030-10-07", ends_on: "2030-10-07", portion: "full_day" };
  const impact = (body: unknown = input, actor = user) => context.staff.leaveImpact(actor, schoolId, body);
  return { ...context, db, schoolId, admin, user, profile, policy, section, subject, term, slots, duty, environment, run, input, impact };
}

describe.skipIf(!enabled)("read-only own staff leave impact", () => {
  it("selects the same classes and dated duties as approval without writing leave, coverage or model evidence", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const counts = async () => (await sql<{ counts: unknown }>`SELECT jsonb_build_object(
          'leave',(SELECT count(*) FROM staff_leave_requests WHERE school_id=${f.schoolId}::uuid),
          'cover',(SELECT count(*) FROM staff_coverage_tasks WHERE school_id=${f.schoolId}::uuid),
          'events',(SELECT count(*) FROM campus_model_events WHERE school_id=${f.schoolId}::uuid),
          'outbox',(SELECT count(*) FROM event_outbox WHERE school_id=${f.schoolId}::uuid)) AS counts`.execute(db)).rows[0]!.counts;
        const before = await counts(), preview = await f.impact();
        expect(preview).toMatchObject({ state: "ready", total: 3, truncated: false, time_zone: "UTC", as_of: now });
        expect(preview.items.map(item => item.kind)).toEqual(["class", "duty", "class"]);
        expect(await counts()).toEqual(before);
        const request = await db.insertInto("staff_leave_requests").values({ school_id: f.schoolId, staff_profile_id: f.profile.id, policy_id: f.policy.id,
          starts_on: f.input.starts_on, ends_on: f.input.ends_on, portion: "full_day", requested_days: "1", reason: "Approved source selection fixture", status: "approved" }).returningAll().executeTakeFirstOrThrow();
        const coverage = new StaffCoverageReconciliationService(f.core, new StaffCoverageOfferBridgeService(f.core));
        await db.transaction().execute(tx => coverage.createTasksForApprovedLeave(tx, { school_id: f.schoolId, actor_user_id: f.admin.id,
          request, absent_teacher_user_id: f.user.id }));
        const tasks = await db.selectFrom("staff_coverage_tasks").select(["title", "duty_date", "starts_at", "ends_at", "location"]).where("school_id", "=", f.schoolId)
          .where("leave_request_id", "=", request.id).orderBy("starts_at").execute();
        expect(tasks.map(task => ({ title: task.title, date: task.duty_date, starts_at: task.starts_at, ends_at: task.ends_at, location: task.location })))
          .toEqual(preview.items.map(item => ({ title: item.title, date: item.date, starts_at: item.starts_at, ends_at: item.ends_at, location: item.location })));
      });
    });
  });

  it("reuses portion, source correction and closure semantics, and keeps empty results bounded to known sources", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const first = await f.impact({ ...f.input, portion: "first_half" });
        expect(first.items.map(item => item.title)).toEqual(["Programming"]);
        expect((await f.impact({ ...f.input, portion: "second_half" })).items).toHaveLength(2);
        await db.updateTable("timetable_slots").set({ room: "Corrected room", revision: 2 }).where("id", "=", f.slots[0]!.id).execute();
        expect((await f.impact()).items[0]).toMatchObject({ location: "Corrected room", source: { revision: 2 } });
        await db.insertInto("school_calendar_days").values({ school_id: f.schoolId, date: f.input.starts_on, is_instructional: false,
          label: "Closed for teaching", kind: "local_holiday", updated_by: f.admin.id }).execute();
        const closed = await f.impact();
        expect(closed.items).toHaveLength(1);
        expect(closed.items[0]).toMatchObject({ kind: "duty", title: "School duty · Gate support" });
        const empty = await f.impact({ ...f.input, portion: "first_half" });
        expect(empty).toMatchObject({ state: "empty", total: 0, items: [], scope: "published_timetable_and_dated_responsibilities" });
        expect(empty.limitations).not.toHaveLength(0);
      });
    });
  });

  it("keeps request-card and rejected-decision counts aligned with half-day, cancelled-class and dated-duty preview", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const identity = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.admin.id, at: now }));
        if (!identity.acting) throw new Error("Current founder fixture identity required.");
        await sql`WITH source AS (
          INSERT INTO institution_authority_sources(school_id,code,title,source_kind,reference,provision,evidence_reference,verification_state,effective_from,verified_by,verified_at,created_by)
          VALUES(${f.schoolId}::uuid,'impact_leave_test','Impact leave fixture','appointment_order','TEST','Leave review','test:impact','verified','2030-01-01',${f.admin.id}::uuid,now(),${f.admin.id}::uuid) RETURNING id
        ), office AS (
          INSERT INTO institution_governance_offices(school_id,code,title,purpose,authority_source_id,status,created_by)
          SELECT ${f.schoolId}::uuid,'impact_reviewer','Impact reviewer','Review test leave',id,'active',${f.admin.id}::uuid FROM source RETURNING id
        ), appointment AS (
          INSERT INTO institution_governance_appointments(school_id,office_id,person_id,linked_user_id,appointment_kind,starts_on,status,authority_source_id,evidence_reference,created_by)
          SELECT ${f.schoolId}::uuid,office.id,${identity.person_id}::uuid,${f.admin.id}::uuid,'appointed','2030-01-01','active',source.id,'test:impact',${f.admin.id}::uuid FROM source,office RETURNING id
        ) INSERT INTO institution_decision_matter_rules(school_id,code,title,category,decision_summary,execution_summary,decision_mode,decision_office_id,authority_source_ids,conditions_summary,material_fields,status,effective_from,created_by)
          SELECT ${f.schoolId}::uuid,'staff_leave_decision','Impact leave review','people','Current holder reviews','Staff records','individual',office.id,ARRAY[source.id]::uuid[],
            'Test fixture',ARRAY['staff_profile','starts_on','ends_on']::text[],'confirmed','2030-01-01',${f.admin.id}::uuid FROM source,office`.execute(db);
        const setup = await f.routes.workspace(f.admin, f.schoolId);
        await f.routes.confirm(f.admin, f.schoolId, { command_id: randomUUID(), confirmed: true, expected: setup.expected });
        const membership = await db.selectFrom("school_memberships").select("id").where("school_id", "=", f.schoolId)
          .where("user_id", "=", f.user.id).where("role", "=", "staff").executeTakeFirstOrThrow();
        const plan = (await sql<{ id: string }>`INSERT INTO day_plans(school_id,class_section_id,term_id,date,owner_id)
          VALUES(${f.schoolId}::uuid,${f.section.id}::uuid,${f.term.id}::uuid,${f.input.starts_on}::date,${f.admin.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
        await sql`INSERT INTO day_plan_versions(school_id,plan_id,version,state,created_by,published_revision) VALUES(${f.schoolId}::uuid,${plan.id}::uuid,1,'published',${f.admin.id}::uuid,1)`.execute(db);
        await sql`INSERT INTO day_plan_periods(school_id,plan_id,version,period_number,starts_at,ends_at,title,slot_type,teacher_membership_id,subject_id,cancelled)
          VALUES(${f.schoolId}::uuid,${plan.id}::uuid,1,1,'09:00','10:00','Morning','class',${membership.id}::uuid,${f.subject.id}::uuid,false),
            (${f.schoolId}::uuid,${plan.id}::uuid,1,2,'14:00','15:00','Cancelled class','class',${membership.id}::uuid,${f.subject.id}::uuid,true),
            (${f.schoolId}::uuid,${plan.id}::uuid,1,3,'16:00','17:00','Afternoon','class',${membership.id}::uuid,${f.subject.id}::uuid,false)`.execute(db);
        await sql`UPDATE day_plans SET published_version=1 WHERE id=${plan.id}::uuid`.execute(db);
        const input = { ...f.input, portion: "second_half" }, preview = await f.impact(input);
        expect(preview.total).toBe(2);
        expect(preview.items.map(item => item.kind)).toEqual(["duty", "class"]);
        const request = await f.staff.requestLeave(f.user, f.schoolId, { ...input, command_id: randomUUID(), reason: "Fixture appointment requiring half-day leave", handover_note: "" });
        if (typeof request.id !== "string" || typeof request.revision !== "number") throw new Error("Expected native leave request identity and revision.");
        const workspace = await f.staff.workspace(f.user, f.schoolId);
        expect(workspace.requests.find(item => item.id === request.id)).toMatchObject({ affected_periods: 2, portion: "second_half" });
        expect(workspace.requests.find(item => item.id === request.id)).not.toHaveProperty("affected_work");
        const beforeRead = (await sql<{ requests: number; events: number; cover: number }>`SELECT
          (SELECT count(*)::int FROM staff_leave_requests WHERE school_id=${f.schoolId}::uuid) AS requests,
          (SELECT count(*)::int FROM campus_model_events WHERE school_id=${f.schoolId}::uuid) AS events,
          (SELECT count(*)::int FROM staff_coverage_tasks WHERE school_id=${f.schoolId}::uuid) AS cover`.execute(db)).rows[0];
        for (const actor of [f.user, f.admin]) {
          const focused = await f.staff.workspace(actor, f.schoolId, request.id);
          expect(focused.requests.find(item => item.id === request.id)).toMatchObject({ affected_work: preview });
        }
        expect((await sql<{ requests: number; events: number; cover: number }>`SELECT
          (SELECT count(*)::int FROM staff_leave_requests WHERE school_id=${f.schoolId}::uuid) AS requests,
          (SELECT count(*)::int FROM campus_model_events WHERE school_id=${f.schoolId}::uuid) AS events,
          (SELECT count(*)::int FROM staff_coverage_tasks WHERE school_id=${f.schoolId}::uuid) AS cover`.execute(db)).rows[0]).toEqual(beforeRead);
        const unrelated = await db.insertInto("users").values({ username: `unrelated-${randomUUID()}`, email: `unrelated-${randomUUID()}@example.test`,
          password_hash: "isolated-only", first_name: "Unrelated", last_name: "Administrator", role: "admin" })
          .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
        await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: unrelated.id, role: "admin", is_active: true }).execute();
        const unrelatedWorkspace = await f.staff.workspace({ ...unrelated, active_school_id: f.schoolId }, f.schoolId, request.id);
        expect(unrelatedWorkspace.requests).not.toContainEqual(expect.objectContaining({ id: request.id }));
        expect((await f.staff.workspace(f.user, f.schoolId, randomUUID())).requests.every(item => !Object.hasOwn(item, "affected_work"))).toBe(true);
        const decision = await f.staff.decideLeave(f.admin, f.schoolId, request.id, { command_id: randomUUID(), expected_revision: request.revision,
          decision: "rejected", note: "Please select another date" });
        expect(decision).toMatchObject({ status: "rejected", affected_periods: preview.total });
        expect((await f.staff.workspace(f.user, f.schoolId, request.id)).requests.find(item => item.id === request.id)).not.toHaveProperty("affected_work");
      });
    });
  });

  it("rejects cross-person/campus, missing policy and invalid windows without administrator private lookup", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        await expect(f.impact(f.input, f.admin)).rejects.toThrow(/staff access/i);
        await expect(f.impact({ ...f.input, staff_profile_id: f.profile.id })).rejects.toThrow();
        await expect(f.impact(f.input, { ...f.user, active_school_id: randomUUID() })).rejects.toThrow(/selected campus/i);
        await expect(f.impact({ ...f.input, policy_id: randomUUID() })).rejects.toThrow(/policy is not available/i);
        await expect(f.impact({ ...f.input, ends_on: "2030-10-06" })).rejects.toThrow(/before/i);
        await expect(f.impact({ ...f.input, portion: "first_half", ends_on: "2030-10-08" })).rejects.toThrow(/one date/i);
        await expect(f.impact({ ...f.input, starts_on: "2031-04-01", ends_on: "2031-04-01" })).rejects.toThrow(/policy academic year/i);
        await expect(f.impact({ ...f.input, starts_on: "2030-04-01", ends_on: "2030-10-07" })).rejects.toThrow(/93 calendar days/i);
      });
    });
  });

  it("caps a valid long-window result at 100 and retains the honest total", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        for (const slot of f.slots) {
          const hour = 7 + slot.period_number;
          await db.updateTable("timetable_slots").set({ starts_at: `${String(hour).padStart(2, "0")}:00`,
            ends_at: `${String(hour + 1).padStart(2, "0")}:00` }).where("id", "=", slot.id).execute();
        }
        await db.insertInto("timetable_slots").values(Array.from({ length: 6 }, (_, index) => ({ class_section_id: f.section.id,
          term_id: f.term.id, subject_id: f.subject.id, weekday: 1, period_number: index + 3,
          starts_at: `${String(index + 10).padStart(2, "0")}:00`, ends_at: `${String(index + 11).padStart(2, "0")}:00`,
          teacher_user_id: f.user.id, room: "Room 1", updated_by: f.admin.id }))).execute();
        const preview = await f.impact({ ...f.input, ends_on: "2031-01-07" });
        expect(preview.items).toHaveLength(100);
        expect(preview).toMatchObject({ total: 113, truncated: true, state: "ready" });
      });
    });
  });

  it.runIf(Boolean(targetUrl))("reads the selected corrected Simulation source without writes or Live/sibling fallback", async () => {
    const f = await fixture(database), store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4);
    const opened: Kysely<Database>[] = [];
    try {
      const request = await database.insertInto("staff_leave_requests").values({ school_id: f.schoolId, staff_profile_id: f.profile.id, policy_id: f.policy.id,
        starts_on: f.input.starts_on, ends_on: f.input.ends_on, portion: "full_day", requested_days: "1", reason: "Selected-world read-only request fixture", status: "submitted" })
        .returning("id").executeTakeFirstOrThrow();
      const original = await f.run(() => f.impact());
      const originalRequest = (await f.run(() => f.staff.workspace(f.user, f.schoolId, request.id))).requests.find(item => item.id === request.id);
      expect(originalRequest).toMatchObject({ affected_work: original });
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(db);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "staff-leave-impact-test", checked_at: now });
        return { db, ...services(db), run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        await branch.db.updateTable("timetable_slots").set({ room: "Scenario-only room", revision: 2 }).where("id", "=", f.slots[0]!.id).execute();
        const preview = await branch.staff.leaveImpact(f.user, f.schoolId, f.input);
        expect(preview.items[0]).toMatchObject({ location: "Scenario-only room", source: { revision: 2 } });
        expect(await branch.staff.leaveImpact(f.user, f.schoolId, f.input)).toEqual(preview);
        const focused = (await branch.staff.workspace(f.user, f.schoolId, request.id)).requests.find(item => item.id === request.id);
        expect(focused).toMatchObject({ affected_work: preview });
        expect((await branch.db.selectFrom("staff_leave_requests").select("id").where("school_id", "=", f.schoolId).execute())).toEqual([{ id: request.id }]);
      });
      expect(await f.run(() => f.impact())).toEqual(original);
      expect(await sibling.run(() => sibling.staff.leaveImpact(f.user, f.schoolId, f.input))).toEqual(original);
      expect((await f.run(() => f.staff.workspace(f.user, f.schoolId, request.id))).requests.find(item => item.id === request.id)).toEqual(originalRequest);
      expect((await sibling.run(() => sibling.staff.workspace(f.user, f.schoolId, request.id))).requests.find(item => item.id === request.id)).toEqual(originalRequest);
    } finally { await Promise.all(opened.map(db => db.destroy())); await store.pool.end(); }
  }, 120_000);
});
