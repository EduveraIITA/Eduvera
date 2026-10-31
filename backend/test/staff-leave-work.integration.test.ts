import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ScopedExecutionClock, SystemWallClock } from "../src/database/execution-clock.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { GovernanceService } from "../src/governance/governance.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { RequestsService } from "../src/requests/requests.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { StaffCoverageOfferBridgeService } from "../src/staff-operations/staff-coverage-offer-bridge.service.js";
import { StaffLeaveModelBridgeService } from "../src/staff-operations/staff-leave-model-bridge.service.js";
import { StaffOperationsService } from "../src/staff-operations/staff-operations.service.js";
import { StaffLeaveWorkProjection } from "../src/staff-operations/staff-leave-work.projection.js";
import { StaffLeaveReviewRoutingService } from "../src/staff-operations/staff-leave-review-routing.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { WorkspaceRepository } from "../src/workspace/workspace.repository.js";
import { WorkspaceService } from "../src/workspace/workspace.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { rollbackAcademicFixture } from "./academic-participation.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy());
const now = "2030-10-01T09:00:00.000Z";

function services(db: DatabaseService) {
  const scope = new ExecutionDataPlaneScope(), core = new CampusModelCoreService(db, scope), events = new SchoolEventService(db, core);
  const authority = new GovernanceService(db, events), projection = new ResponsibilityProjectionService(core, scope);
  const waiting = new StaffLeaveWorkProjection(db, core, authority);
  const bridge = new StaffLeaveModelBridgeService(authority, core);
  const configuration = new CoordinationConfigurationService(core);
  return { core, waiting, projection, workspace: new WorkspaceService(new WorkspaceRepository(db, projection), new ScopedExecutionClock(scope, new SystemWallClock()),
    new RequestsService(db, authority, scope), undefined, undefined, waiting),
    routes: new StaffLeaveReviewRoutingService(db, bridge, core, core, core, configuration, configuration),
  staff: new StaffOperationsService(db, bridge, new StaffCoverageOfferBridgeService(core),
    createStaffCoverageReconciliationTestDouble(), core, core, core, core) };
}

async function fixture(db: DatabaseService) {
  const context = services(db), suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `work-owner-${suffix}`, email: `work-owner-${suffix}@example.test`, password_hash: "isolated-only",
    first_name: "Neha", last_name: "Reviewer", role: "admin" }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, account, "UTC"));
  const reviewer = { ...account, active_school_id: schoolId } as AuthUser;
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: reviewer.id, role: "staff", is_active: true }).execute();
  const reviewerIdentity = await db.transaction().execute(tx => context.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: reviewer.id, at: now }));
  if (!reviewerIdentity.acting) throw new Error("The founder's explicit canonical identity is required.");
  const createStaff = async (name: string) => {
    const key = randomUUID();
    const account = await db.insertInto("users").values({ username: `work-staff-${key}`, email: `work-staff-${key}@example.test`, password_hash: "isolated-only",
      first_name: name, last_name: "Staff", role: "staff" }).returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: account.id, role: "staff", is_active: true }).execute();
    await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: account.id, owner_user_id: reviewer.id });
    return { ...account, active_school_id: schoolId } as AuthUser;
  };
  const requester = await createStaff("Meera"), unrelated = await createStaff("Unrelated");
  const authority = (await sql<{ rule: string; appointment: string; source: string }>`WITH source AS (
    INSERT INTO institution_authority_sources(school_id,code,title,source_kind,reference,provision,evidence_reference,verification_state,effective_from,verified_by,verified_at,created_by)
    VALUES(${schoolId}::uuid,'work_leave_authority','Test leave authority','appointment_order','TEST','Staff leave','test:work','verified','2030-01-01',${reviewer.id}::uuid,now(),${reviewer.id}::uuid) RETURNING id
    ), office AS (
    INSERT INTO institution_governance_offices(school_id,code,title,purpose,authority_source_id,status,created_by)
    SELECT ${schoolId}::uuid,'work_leave_reviewer','Leave reviewer','Decide staff leave',source.id,'active',${reviewer.id}::uuid FROM source RETURNING id
    ), appointment AS (
    INSERT INTO institution_governance_appointments(school_id,office_id,person_id,linked_user_id,appointment_kind,starts_on,status,authority_source_id,evidence_reference,created_by)
    SELECT ${schoolId}::uuid,office.id,${reviewerIdentity.person_id}::uuid,${reviewer.id}::uuid,'appointed','2030-01-01','active',source.id,'test:work',${reviewer.id}::uuid FROM office,source RETURNING id
    ), rule AS (
    INSERT INTO institution_decision_matter_rules(school_id,code,title,category,decision_summary,execution_summary,decision_mode,decision_office_id,authority_source_ids,conditions_summary,material_fields,status,effective_from,created_by)
    SELECT ${schoolId}::uuid,'staff_leave_decision','Leave decision','people','Current reviewer decides','Staff records','individual',office.id,ARRAY[source.id]::uuid[],
    'Current officeholder only',ARRAY['staff_profile','starts_on','ends_on']::text[],'confirmed','2030-01-01',${reviewer.id}::uuid FROM office,source RETURNING id
    ) SELECT rule.id AS rule,appointment.id AS appointment,source.id AS source FROM rule,appointment,source`.execute(db)).rows[0]!;
  await sql`INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,effective_from,grant_source,grant_reference_id,approved_by,operating_rule_version_ref)
    VALUES(${schoolId}::uuid,${reviewerIdentity.agent_id}::uuid,'staff_leave:decide','2030-01-01','governance_decision_rule',${authority.rule}::uuid,${reviewer.id}::uuid,'test:work')`.execute(db);
  const behaviour = (await sql<{ id: string }>`INSERT INTO campus_model_behaviour_versions(school_id,behaviour_key,version,status,effective_from,configuration,configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at)
    VALUES(${schoolId}::uuid,'staff_leave_decision_routing',1,'approved','2030-01-01','{"matter_code":"staff_leave_decision","selector_key":"leave_decision_owner"}'::jsonb,1,
      ${reviewerIdentity.agent_id}::uuid,${reviewerIdentity.agent_id}::uuid,'2030-01-01') RETURNING id`.execute(db)).rows[0]!;
  await sql`INSERT INTO campus_model_event_subscriptions(school_id,behaviour_version_id,subscription_key,source_domain,event_type,reaction_kind,message_kind,message_schema_version,recipient_selector,response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority)
    VALUES(${schoolId}::uuid,${behaviour.id}::uuid,'staff_leave_submitted_to_decision_owner','staff_operations','staff.leave.submitted','staff_leave_decision_review','request',1,
      '{"mode":"explicit_authorized_agents","selector_key":"leave_decision_owner","required_capability":"staff_leave:decide","scope_mode":"institution","min_recipients":1,"max_recipients":1}'::jsonb,172800,604800,3,3600,7)`.execute(db);
  await sql`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,is_active) VALUES(${schoolId}::uuid,'2030-31','Test period','2030-04-01','2031-03-31',true)`.execute(db);
  const policy = (await sql<{ id: string }>`INSERT INTO staff_leave_policies(school_id,academic_year,code,name,annual_allowance,updated_by)
    VALUES(${schoolId}::uuid,'2030-31','TEST','Personal leave',150,${reviewer.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const submit = async (day = "2030-10-07") => await context.staff.requestLeave(requester, schoolId, { command_id: randomUUID(), policy_id: policy.id,
    starts_on: day, ends_on: day, portion: "full_day", reason: "Private explanation must stay in leave", handover_note: "Private handover details" }) as { id: string; revision: number };
  const manifest = (actor = requester) => context.workspace.manifest(actor, environment, { mode: "live", institution_id: schoolId, namespace_id: `live:${schoolId}` });
  await run(async () => {
    const setup = await context.routes.workspace(reviewer, schoolId);
    if (setup.state !== "ready") await context.routes.confirm(reviewer, schoolId, { command_id: randomUUID(), confirmed: true, expected: setup.expected });
  });
  return { ...context, db, schoolId, reviewer, requester, unrelated, authority, environment, run, submit, manifest };
}

async function installSuccessor(db: DatabaseService, f: Pick<Awaited<ReturnType<typeof fixture>>, "schoolId" | "authority" | "unrelated" | "core">) {
  await sql`UPDATE institution_governance_appointments SET status='ended',ends_on='2030-09-30' WHERE id=${f.authority.appointment}::uuid`.execute(db);
  const successor = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.unrelated.id, at: now }));
  if (!successor.acting) throw new Error("Explicit successor identity required.");
  await sql`INSERT INTO institution_governance_appointments(school_id,office_id,person_id,linked_user_id,appointment_kind,starts_on,status,authority_source_id,evidence_reference,created_by)
    SELECT school_id,office_id,${successor.person_id}::uuid,${f.unrelated.id}::uuid,'appointed','2030-10-01','active',authority_source_id,'test:successor',created_by
    FROM institution_governance_appointments WHERE id=${f.authority.appointment}::uuid`.execute(db);
}

describe.skipIf(!enabled)("source-owned leave tracking and complete Work", () => {
  it("discovers personal staff work without teaching duties and only the exact existing reviewer before delivery setup", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const personal = await f.manifest();
        const ownArea = personal.areas.find(area => area.key === "responsibilities");
        expect(ownArea?.surfaces.map(surface => surface.key).sort()).toEqual(["leave", "mine"]);
        expect(ownArea?.surfaces.find(surface => surface.key === "leave")).toMatchObject({ label: "My leave", href: "/areas/responsibilities/leave" });
        expect((await db.transaction().execute(tx => f.projection.loadEffectiveAgentWork(tx, { school_id: f.schoolId,
          user_id: f.requester.id, at: new Date(now), execution_environment: f.environment }))).assignments).toHaveLength(0);
        // This holder has only an administrator application membership and no
        // staff profile. Institutional leave authority remains a separate fact.
        await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId)
          .where("user_id", "=", f.reviewer.id).where("role", "=", "staff").execute();
        await sql`UPDATE campus_model_behaviour_versions SET status='retired',retired_at=${now}::timestamptz,
          effective_until=GREATEST(${now}::timestamptz,effective_from+interval '1 microsecond')
          WHERE school_id=${f.schoolId}::uuid AND status='approved'`.execute(db);
        expect(await f.routes.workspace(f.reviewer, f.schoolId)).toMatchObject({ state: "needs_configuration", can_configure: true });
        const configurationRows = async () => (await sql<{ records: unknown }>`SELECT coalesce(jsonb_agg(to_jsonb(configuration) ORDER BY configuration.id),'[]'::jsonb) AS records
          FROM campus_model_coordination_configurations configuration WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows;
        const beforeConfig = await configurationRows();
        const reviewer = await f.manifest(f.reviewer);
        expect(reviewer.areas.find(area => area.key === "responsibilities")?.surfaces.map(surface => surface.key)).toEqual(["leave"]);
        expect(await configurationRows()).toEqual(beforeConfig);
        await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId)
          .where("user_id", "=", f.unrelated.id).where("role", "=", "staff").execute();
        await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: f.unrelated.id, role: "admin", is_active: true }).execute();
        expect((await f.manifest(f.unrelated)).areas.some(area => area.key === "responsibilities")).toBe(false);
        await expect(f.waiting.discovery({ ...f.requester, active_school_id: randomUUID() }, f.schoolId, new Date(now))).rejects.toThrow(/selected campus/i);
        await sql`UPDATE institution_governance_appointments SET status='ended',ends_on='2030-09-30' WHERE id=${f.authority.appointment}::uuid`.execute(db);
        const revoked = await f.manifest(f.reviewer);
        expect(revoked.areas.some(area => area.key === "responsibilities")).toBe(false);
        expect(revoked.revision).not.toBe(reviewer.revision);
        await db.updateTable("staff_profiles").set({ status: "inactive" }).where("school_id", "=", f.schoolId).where("user_id", "=", f.requester.id).execute();
        expect((await f.manifest()).areas.some(area => area.key === "responsibilities")).toBe(false);
      });
    });
  }, 60_000);

  it("discovers Coverage only from already-readable native records, retains history and removes revoked access", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const surfaces = async (actor: AuthUser) => (await f.manifest(actor)).areas.find(area => area.key === "responsibilities")?.surfaces.map(surface => surface.key).sort() ?? [];
        expect(await surfaces(f.reviewer)).toEqual(["leave"]);
        expect(await surfaces(f.requester)).toEqual(["leave", "mine"]);
        expect(await surfaces(f.unrelated)).toEqual(["leave", "mine"]);
        const submitted = await f.submit();
        await f.staff.decideLeave(f.reviewer, f.schoolId, submitted.id, { command_id: randomUUID(), expected_revision: 1, decision: "approved", note: "Approved fixture leave" });
        const absent = await db.selectFrom("staff_profiles").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", f.requester.id).executeTakeFirstOrThrow();
        const replacement = await db.selectFrom("staff_profiles").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", f.unrelated.id).executeTakeFirstOrThrow();
        const task = await db.insertInto("staff_coverage_tasks").values({ school_id: f.schoolId, leave_request_id: submitted.id,
          absent_staff_profile_id: absent.id, replacement_staff_profile_id: replacement.id, duty_date: "2030-10-07", title: "Fixture operational cover", status: "open" }).returning("id").executeTakeFirstOrThrow();
        expect(await surfaces(f.reviewer)).toEqual(["coverage", "leave"]);
        expect(await surfaces(f.requester)).toEqual(["coverage", "leave", "mine"]);
        expect(await surfaces(f.unrelated)).toEqual(["coverage", "leave", "mine"]);
        expect((await f.staff.workspace(f.reviewer, f.schoolId)).coverage_tasks).toContainEqual(expect.objectContaining({ id: task.id }));
        await db.updateTable("staff_coverage_tasks").set({ status: "cancelled" }).where("id", "=", task.id).execute();
        expect(await surfaces(f.reviewer)).toEqual(["coverage", "leave"]);
        await db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId)
          .where("user_id", "=", f.reviewer.id).where("role", "=", "admin").execute();
        expect(await surfaces(f.reviewer)).not.toContain("coverage");
        await db.updateTable("staff_profiles").set({ status: "inactive" }).where("id", "=", replacement.id).execute();
        expect(await surfaces(f.unrelated)).toEqual([]);
      });
    });
  }, 60_000);

  it("keeps requester waiting separate from exact reviewer attention, and closes both on a real decision or withdrawal", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const submitted = await f.submit();
        const sender = await f.manifest(), reviewer = await f.manifest(f.reviewer);
        expect(sender.work.counts).toEqual({ needs_me: 0, waiting: 1 });
        expect(sender.today.attention.total).toBe(0);
        expect(sender.work.items[0]).toMatchObject({ direction: "waiting", state: "waiting_for_review", owner: { user_id: f.reviewer.id, label: "Neha Reviewer" },
          source: { id: submitted.id, revision: 1 }, due_at: null });
        expect(JSON.stringify(sender.work)).not.toContain("Private");
        expect(reviewer.work.counts).toEqual({ needs_me: 1, waiting: 0 });
        expect(reviewer.work.items[0]?.core_trace?.message_ids).toHaveLength(1);
        expect((await f.manifest(f.unrelated)).work.total).toBe(0);
        const decision = { command_id: randomUUID(), decision: "rejected", note: "Dates need review", expected_revision: 1 };
        await f.staff.decideLeave(f.reviewer, f.schoolId, submitted.id, decision);
        await f.staff.decideLeave(f.reviewer, f.schoolId, submitted.id, decision);
        expect((await f.manifest()).work.total).toBe(0);
        expect((await f.manifest(f.reviewer)).today.attention.total).toBe(0);
        const another = await f.submit("2030-10-08");
        await f.staff.withdrawLeave(f.requester, f.schoolId, another.id, { command_id: randomUUID(), expected_revision: 1 });
        expect((await f.manifest()).work.total).toBe(0);
        expect((await f.manifest(f.reviewer)).work.total).toBe(0);
        const approved = await f.submit("2030-10-09");
        await f.staff.decideLeave(f.reviewer, f.schoolId, approved.id, { command_id: randomUUID(), expected_revision: 1, decision: "approved", note: "Approved within current authority" });
        expect((await f.manifest()).work.total).toBe(0);
        expect((await f.manifest(f.reviewer)).work.total).toBe(0);
      });
    });
  }, 60_000);

  it("explicitly transfers pending review without changing its submission, and supports requester withdrawal after reviewer takeover", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const first = await f.submit(), second = await f.submit("2030-10-08");
        const original = await db.selectFrom("staff_leave_commands").selectAll().where("target_request_id", "=", first.id).where("command_type", "=", "submit").executeTakeFirstOrThrow();
        const originalRequest = await db.selectFrom("staff_leave_requests").select("submitted_at").where("id", "=", first.id).executeTakeFirstOrThrow();
        await installSuccessor(db, f);
        expect((await f.manifest(f.unrelated)).work.counts?.needs_me).toBe(0);
        const setup = await f.routes.workspace(f.unrelated, f.schoolId);
        expect(setup).toMatchObject({ state: "needs_configuration", can_configure: true });
        const confirmation = { command_id: randomUUID(), confirmed: true, expected: setup.expected };
        await expect(f.routes.confirm(f.requester, f.schoolId, confirmation)).rejects.toThrow(/current officeholder/i);
        await expect(f.routes.confirm(f.unrelated, f.schoolId, { ...confirmation, expected: { ...setup.expected, rule: { ...setup.expected!.rule, revision: setup.expected!.rule.revision + 1 } } })).rejects.toThrow(/authority changed/i);
        await expect(f.routes.confirm(f.unrelated, f.schoolId, confirmation)).resolves.toMatchObject({ confirmed: true, replayed: false });
        await expect(f.routes.confirm(f.unrelated, f.schoolId, confirmation)).resolves.toMatchObject({ confirmed: true, replayed: true });
        const requesterWorkspace = await f.staff.workspace(f.requester, f.schoolId);
        expect(requesterWorkspace.leave_review_readiness).toMatchObject({ state: "ready", reviewer: { user_id: f.unrelated.id } });
        expect(requesterWorkspace.requests.find(item => item.id === first.id)).toMatchObject({ review_route: { state: "needs_reassignment", can_reroute: true } });
        const transfer = { command_id: randomUUID(), expected_revision: 1 };
        await expect(f.staff.rerouteLeave(f.reviewer, f.schoolId, first.id, transfer)).rejects.toThrow(/only the requester or current leave reviewer/i);
        await expect(f.staff.rerouteLeave({ ...f.requester, active_school_id: randomUUID() }, f.schoolId, first.id, transfer)).rejects.toThrow(/selected campus/i);
        await expect(f.staff.rerouteLeave(f.requester, f.schoolId, first.id, { ...transfer, expected_revision: 2 })).rejects.toThrow(/latest pending/i);
        const rerouted = await f.staff.rerouteLeave(f.requester, f.schoolId, first.id, transfer);
        expect(rerouted).toMatchObject({ id: first.id, status: "submitted", revision: 2 });
        expect(await f.staff.rerouteLeave(f.requester, f.schoolId, first.id, transfer)).toEqual(JSON.parse(JSON.stringify(rerouted)));
        await expect(f.staff.rerouteLeave(f.requester, f.schoolId, first.id, { ...transfer, expected_revision: 2 })).rejects.toThrow(/different leave details/i);
        expect((await db.selectFrom("staff_leave_commands").selectAll().where("id", "=", original.id).executeTakeFirstOrThrow())).toEqual(original);
        expect((await db.selectFrom("staff_leave_requests").select("submitted_at").where("id", "=", first.id).executeTakeFirstOrThrow())).toEqual(originalRequest);
        expect((await f.manifest(f.reviewer)).work.counts?.needs_me).toBe(0);
        expect((await f.manifest(f.unrelated)).work.counts?.needs_me).toBe(1);
        expect((await f.manifest()).work.items.find(item => item.source?.id === first.id)).toMatchObject({ state: "waiting_for_review", source: { revision: 2 }, owner: { user_id: f.unrelated.id } });
        await f.staff.decideLeave(f.unrelated, f.schoolId, first.id, { command_id: randomUUID(), expected_revision: 2, decision: "approved", note: "Approved" });
        await f.staff.rerouteLeave(f.unrelated, f.schoolId, second.id, { command_id: randomUUID(), expected_revision: 1 });
        const withdrawal = { command_id: randomUUID(), expected_revision: 2 };
        await f.staff.withdrawLeave(f.requester, f.schoolId, second.id, withdrawal);
        await f.staff.withdrawLeave(f.requester, f.schoolId, second.id, withdrawal);
        expect((await f.manifest()).work.total).toBe(0);
        expect((await f.manifest(f.unrelated)).work.total).toBe(0);
      });
    });
  }, 60_000);

  it("retains changed-route waiting without adopting another officeholder or leaking across campus/revocation", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const submitted = await f.submit();
        await sql`UPDATE institution_governance_appointments SET status='ended',ends_on='2030-09-30' WHERE id=${f.authority.appointment}::uuid`.execute(db);
        const successor = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.unrelated.id, at: now }));
        if (!successor.acting) throw new Error("Explicit successor identity required.");
        await sql`INSERT INTO institution_governance_appointments(school_id,office_id,person_id,linked_user_id,appointment_kind,starts_on,status,authority_source_id,evidence_reference,created_by)
          SELECT school_id,office_id,${successor.person_id}::uuid,${f.unrelated.id}::uuid,'appointed','2030-10-01','active',authority_source_id,'test:successor',created_by
          FROM institution_governance_appointments WHERE id=${f.authority.appointment}::uuid`.execute(db);
        expect((await f.manifest()).work.items[0]).toMatchObject({ state: "needs_reassignment", status_label: "Review route changed — needs reassignment", owner: { user_id: f.reviewer.id } });
        expect((await f.manifest(f.reviewer)).today.attention.total).toBe(0);
        expect((await f.manifest(f.unrelated)).today.attention.total).toBe(0);
        await expect(f.waiting.waiting({ ...f.requester, active_school_id: randomUUID() }, f.schoolId, new Date(now))).rejects.toThrow("selected campus");
        await sql`UPDATE users SET is_active=false WHERE id=${f.requester.id}::uuid`.execute(db);
        expect(await f.waiting.waiting(f.requester, f.schoolId, new Date(now))).toEqual([]);
        expect((await db.selectFrom("staff_leave_requests").select("status").where("id", "=", submitted.id).executeTakeFirstOrThrow()).status).toBe("submitted");
      });
    });
  }, 60_000);

  it("does not invent a reviewer deadline or repair malformed retained route evidence on read", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        const submitted = await f.submit();
        await sql`UPDATE staff_leave_commands SET coordination_receipt=jsonb_set(coordination_receipt,'{route_snapshot}','{"response_due_at":"0"}'::jsonb)
          WHERE school_id=${f.schoolId}::uuid AND target_request_id=${submitted.id}::uuid AND command_type='submit'`.execute(db);
        expect((await f.manifest()).work.items[0]).toMatchObject({ state: "waiting_for_review", due_at: null });
        await sql`UPDATE staff_leave_commands SET coordination_receipt=jsonb_set(coordination_receipt,'{message_ids}','{}'::jsonb)
          WHERE school_id=${f.schoolId}::uuid AND target_request_id=${submitted.id}::uuid AND command_type='submit'`.execute(db);
        expect((await f.manifest()).work.items[0]).toMatchObject({ state: "route_unavailable", due_at: null });
        expect((await f.manifest(f.reviewer)).work.total).toBe(0);
        expect((await sql<{ value: unknown }>`SELECT coordination_receipt->'message_ids' AS value FROM staff_leave_commands
          WHERE school_id=${f.schoolId}::uuid AND target_request_id=${submitted.id}::uuid AND command_type='submit'`.execute(db)).rows[0]!.value).toEqual({});
      });
    });
  }, 60_000);

  it("keeps all 101 exact obligations discoverable without Core/native duplicate counting", async () => {
    await rollbackAcademicFixture(database, async db => {
      const f = await fixture(db);
      await f.run(async () => {
        let day = new Date("2030-10-07T12:00:00Z");
        for (let index = 0; index < 101; index += 1) {
          while (day.getUTCDay() === 0) day = new Date(day.getTime() + 86_400_000);
          await f.submit(day.toISOString().slice(0, 10));
          day = new Date(day.getTime() + 86_400_000);
        }
        const mailbox = await db.transaction().execute(tx => f.projection.loadEffectiveAgentWork(tx, { school_id: f.schoolId, user_id: f.reviewer.id, at: new Date(now), execution_environment: f.environment }));
        expect(mailbox.messages).toHaveLength(101);
        const reviewer = await f.manifest(f.reviewer);
        expect(reviewer.work.counts).toEqual({ needs_me: 101, waiting: 0 });
        expect(new Set(reviewer.work.items.map(item => item.source?.id)).size).toBe(101);
        expect(reviewer.work.items.every(item => item.core_trace?.message_ids.length === 1)).toBe(true);
        expect((await f.manifest()).work.counts).toEqual({ needs_me: 0, waiting: 101 });
      });
    });
  }, 120_000);

  it.runIf(Boolean(targetUrl))("confirms the successor route, reroutes and withdraws in one COW world with unchanged Live/sibling work", async () => {
    const f = await fixture(database), submitted = await f.run(() => f.submit());
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4);
    const opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(db);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: now,
          source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "work-tracking-test", checked_at: now });
        const context = services(db);
        return { ...context, db, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action),
          manifest: (actor = f.requester) => context.workspace.manifest(actor, environment, { mode: "simulation", institution_id: f.schoolId,
            scenario_id: scenarioId, run_id: runId, namespace_id: environment.namespace_id, virtual_clock: { now, time_zone: "UTC" },
            source_snapshot_at: now, expires_at: environment.expires_at, capabilities: environment.capabilities, source: "test" } as never) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect((await branch.manifest()).work.counts?.waiting).toBe(1);
        expect((await branch.manifest(f.reviewer)).areas.find(area => area.key === "responsibilities")?.surfaces.map(surface => surface.key)).toEqual(["leave"]);
        await installSuccessor(branch.db, { ...f, core: branch.core });
        expect((await branch.manifest(f.reviewer)).areas.some(area => area.key === "responsibilities")).toBe(false);
        const setup = await branch.routes.workspace(f.unrelated, f.schoolId);
        expect(setup).toMatchObject({ state: "needs_configuration", can_configure: true });
        const confirmation = { command_id: randomUUID(), confirmed: true, expected: setup.expected };
        await branch.routes.confirm(f.unrelated, f.schoolId, confirmation);
        await branch.routes.confirm(f.unrelated, f.schoolId, confirmation);
        const reroute = { command_id: randomUUID(), expected_revision: 1 };
        await branch.staff.rerouteLeave(f.unrelated, f.schoolId, submitted.id, reroute);
        await branch.staff.rerouteLeave(f.unrelated, f.schoolId, submitted.id, reroute);
        expect((await branch.manifest(f.reviewer)).work.counts?.needs_me).toBe(0);
        expect((await branch.manifest(f.unrelated)).work.counts?.needs_me).toBe(1);
        expect((await branch.manifest()).work.items[0]).toMatchObject({ state: "waiting_for_review", source: { revision: 2 }, owner: { user_id: f.unrelated.id } });
        const withdrawal = { command_id: randomUUID(), expected_revision: 2 };
        await branch.staff.withdrawLeave(f.requester, f.schoolId, submitted.id, withdrawal);
        await branch.staff.withdrawLeave(f.requester, f.schoolId, submitted.id, withdrawal);
        expect((await branch.manifest()).work.total).toBe(0);
        expect((await branch.manifest(f.reviewer)).work.total).toBe(0);
        expect((await branch.manifest(f.unrelated)).work.total).toBe(0);
        const source = await branch.db.selectFrom("staff_leave_requests").select(["policy_id", "staff_profile_id"]).where("id", "=", submitted.id).executeTakeFirstOrThrow();
        const next = await branch.staff.requestLeave(f.requester, f.schoolId, { command_id: randomUUID(), policy_id: source.policy_id,
          starts_on: "2030-10-08", ends_on: "2030-10-08", portion: "full_day", reason: "Another fictional staff leave appointment", handover_note: "" });
        if (typeof next.id !== "string" || typeof next.revision !== "number") throw new Error("Expected native leave identity.");
        await branch.staff.decideLeave(f.unrelated, f.schoolId, next.id, { command_id: randomUUID(), expected_revision: next.revision,
          decision: "approved", note: "Approved test arrangement" });
        await branch.db.insertInto("staff_coverage_tasks").values({ school_id: f.schoolId, leave_request_id: next.id,
          absent_staff_profile_id: source.staff_profile_id, duty_date: "2030-10-08", title: "Scenario-only cover", status: "open" }).execute();
        expect((await branch.manifest(f.reviewer)).areas.find(area => area.key === "responsibilities")?.surfaces.map(surface => surface.key)).toEqual(["coverage"]);
      });
      expect((await f.run(() => f.manifest())).work.counts?.waiting).toBe(1);
      expect((await sibling.run(() => sibling.manifest())).work.counts?.waiting).toBe(1);
      expect((await f.run(() => f.manifest(f.reviewer))).work.counts?.needs_me).toBe(1);
      expect((await sibling.run(() => sibling.manifest(f.reviewer))).work.counts?.needs_me).toBe(1);
      expect((await f.run(() => f.manifest(f.unrelated))).work.counts?.needs_me).toBe(0);
      expect((await sibling.run(() => sibling.manifest(f.unrelated))).work.counts?.needs_me).toBe(0);
      expect((await f.run(() => f.manifest(f.reviewer))).areas.find(area => area.key === "responsibilities")?.surfaces.map(surface => surface.key)).toEqual(["leave"]);
      expect((await sibling.run(() => sibling.manifest(f.reviewer))).areas.find(area => area.key === "responsibilities")?.surfaces.map(surface => surface.key)).toEqual(["leave"]);
    } finally { await Promise.all(opened.map(db => db.destroy())); await store.pool.end(); }
  }, 120_000);
});
