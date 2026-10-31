import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ParticipationPeopleService } from "../src/people/participation-people.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { GovernanceService } from "../src/governance/governance.service.js";
import { StaffOperationsService } from "../src/staff-operations/staff-operations.service.js";
import { StaffLeaveModelBridgeService } from "../src/staff-operations/staff-leave-model-bridge.service.js";
import { StaffCoverageOfferBridgeService } from "../src/staff-operations/staff-coverage-offer-bridge.service.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, (value) => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const provisioner = new ProgressiveWorkspaceProvisioner(core);
const service = new ParticipationPeopleService(applicationDb, new SchoolEventService(applicationDb, core), core, core, core, core);
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
afterAll(async () => db.destroy());

async function fixture() {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `people-participation-${suffix}`, email: `people-participation-${suffix}@example.test`,
    password_hash: "isolated-test-only-hash", first_name: "People", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute((tx) => provisioner.createForAccount(tx, account, "Pacific/Auckland"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  let now = new Date("2037-06-15T20:00:00Z"); // 16 June in the institution, independent of the host's day.
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const person = (first_name: string, affiliation?: "learner" | "worker" | "contractor" | "visitor" | "other") => service.create(request(user), schoolId,
    { first_name, ...(affiliation ? { affiliation } : {}), idempotency_key: randomUUID() });
  return { schoolId, user, run, person, setNow: (instant: string) => { now = new Date(instant); } };
}

describe.skipIf(!enabled)("canonical participation people with real PostgreSQL and DT lineage", () => {
  it("requires institution scope to read or mutate canonical campus People", async () => {
    const f = await fixture();
    await f.run(async () => {
      const suffix = randomUUID();
      const account = await db.insertInto("users").values({ username: `scoped-people-${suffix}`, email: `scoped-people-${suffix}@example.test`,
        password_hash: "isolated-test-only", first_name: "Scoped", last_name: "Operator", role: "staff" })
        .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: account.id, role: "staff", is_active: true }).execute();
      await linkFixtureStaffIdentity(applicationDb, { school_id: f.schoolId, user_id: account.id, owner_user_id: f.user.id });
      const user: AuthUser = { ...account, active_school_id: f.schoolId };
      const exception = (await sql<{ id: string }>`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,scope_kind,
          valid_from,valid_until,review_due_on,created_by) VALUES(${f.schoolId}::uuid,${user.id}::uuid,'sis.manage','Isolated scope regression',
          'manual','assigned_resources','2037-06-16','2037-06-18','2037-06-17',${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
      await expect(service.list(user, f.schoolId, {})).rejects.toThrow("Institution-scoped school permission");
      await expect(service.create(request(user), f.schoolId, { first_name: "Not authorized", idempotency_key: randomUUID() }))
        .rejects.toThrow("Institution-scoped school permission");
      await sql`UPDATE school_access_exceptions SET scope_kind='institution',revision=revision+1 WHERE id=${exception.id}::uuid`.execute(db);
      const created = await service.create(request(user), f.schoolId, { first_name: "Authorized passive person", idempotency_key: randomUUID() });
      expect(created).toMatchObject({ label: "Authorized passive person", has_account: false });
      expect((await service.list(user, f.schoolId, {})).results.some(row => row.id === created.id)).toBe(true);
    });
  }, 30000);
  it("corrects one campus person's name with reviewed lineage, not accounts or captured activity facts", async () => {
    const { schoolId, user, run, person } = await fixture();
    const foreign = await fixture();
    await run(async () => {
      const created = await person("Original", "worker");
      expect(await service.detail(user, schoolId, created.id)).toMatchObject({ first_name: "Original", last_name: "", revision: 1,
        affiliation_sources: [{ affiliation: "worker", source: "recorded" }] });
      const planning = new ActivityPlanningService(applicationDb, new SchoolEventService(applicationDb, core), core, core, core, new ResponsibilityProjectionService(core));
      const draft = await planning.create(request(user), schoolId, { idempotency_key: randomUUID(), title: "Captured name", purpose: "meeting",
        starts_on: "2037-06-17", recurrence: "once", timezone: "Pacific/Auckland", starts_at: "13:00", ends_at: "14:00",
        person_ids: [created.id], attendance_mode: "none" });
      await planning.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: 1 });
      const correction = { first_name: "Corrected", last_name: "Name", expected_revision: 1,
        reason: "Verified spelling with the campus record", idempotency_key: randomUUID() };
      const saved = await service.correctName(request(user), schoolId, created.id, correction);
      expect(saved).toMatchObject({ id: created.id, label: "Corrected Name", revision: 2 });
      expect(await service.correctName(request(user), schoolId, created.id, correction)).toEqual(saved);
      await expect(service.correctName(request(user), schoolId, created.id, { ...correction, first_name: "Different" })).rejects.toThrow("different people data");
      await expect(service.correctName(request(user), schoolId, created.id, { ...correction, idempotency_key: randomUUID() })).rejects.toThrow("changed");
      expect(() => service.correctName(request(user), schoolId, created.id, { ...correction, expected_revision: 2, affiliation: "learner", idempotency_key: randomUUID() })).toThrow();
      const current = await planning.listOccurrences(user, schoolId, { from: "2037-06-17", until: "2037-06-17" });
      expect(current.items[0]?.participants).toEqual([expect.objectContaining({ person_id: created.id, label: "Original" })]);
      const audit = (await sql<{ metadata: Record<string, unknown> }>`SELECT metadata FROM audit_events WHERE school_id=${schoolId}::uuid
        AND target_id=${created.id} AND metadata->>'change_kind'='name_correction'`.execute(db)).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ reason: correction.reason, previous_name: { first_name: "Original", last_name: "" },
        corrected_name: { first_name: "Corrected", last_name: "Name" }, revision: 2, account_created: false });
      const staffAccount = await db.insertInto("users").values({ username: `name-projection-${randomUUID()}`, email: `name-projection-${randomUUID()}@example.test`,
        first_name: "Unchanged account", last_name: "Identity", password_hash: "isolated-test-only-hash", role: "staff" })
        .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: staffAccount.id, role: "staff", is_active: true }).execute();
      const profile = await db.insertInto("staff_profiles").values({ school_id: schoolId, person_id: created.id, user_id: staffAccount.id,
        staff_code: `N-${randomUUID().slice(0, 8)}`,   
        staff_kind: "non_teaching", designation: "Safety operator", department: "Campus", employment_type: "contract",
        status: "active", created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
      await db.transaction().execute(tx => core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: created.id, user_id: staffAccount.id,
        actor_user_id: user.id, effective_from: "2037-06-15T19:00:00Z", effective_until: null, source_domain: "staff_operations",
        source_record_id: profile.id, source_revision: 1, metadata: { fixture: true } }));
      const staffEvents = new SchoolEventService(applicationDb, core);
      const staffOperations = new StaffOperationsService(applicationDb,
        new StaffLeaveModelBridgeService(new GovernanceService(applicationDb, staffEvents), core), new StaffCoverageOfferBridgeService(core),
        createStaffCoverageReconciliationTestDouble(), core, core);
      const adminWorkspace = await staffOperations.workspace(user, schoolId);
      if (!("profiles" in adminWorkspace)) throw new Error("The fixture owner should read the administrator staff directory.");
      expect(adminWorkspace.profiles).toEqual(expect.arrayContaining([expect.objectContaining({ id: profile.id, first_name: "Corrected", last_name: "Name",
        designation: "Safety operator", department: "Campus", employment_type: "contract", staff_code: profile.staff_code })]));
      const personalWorkspace = await staffOperations.workspace({ ...staffAccount, active_school_id: schoolId }, schoolId);
      expect(personalWorkspace).toMatchObject({ mode: "staff", profile: { id: profile.id, first_name: "Corrected", last_name: "Name", employment_type: "contract" } });
      expect(await db.selectFrom("staff_profiles").select(["person_id", "designation", "employment_type"]).where("id", "=", profile.id).executeTakeFirstOrThrow())
        .toEqual({ person_id:created.id, designation: "Safety operator", employment_type: "contract" });
      expect(await db.selectFrom("users").select(["first_name", "last_name"]).where("id", "=", staffAccount.id).executeTakeFirstOrThrow())
        .toEqual({ first_name: "Unchanged account", last_name: "Identity" });
      const identity = await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: "2037-06-15T20:00:00Z" }));
      if (!identity.acting) throw new Error("The fixture owner must retain their explicit active account endpoint.");
      const ownerDetail = await service.detail(user, schoolId, identity.person_id);
      await service.correctName(request(user), schoolId, identity.person_id, { first_name: "Campus", last_name: "Owner",
        expected_revision: ownerDetail.revision, reason: "Campus display spelling correction", idempotency_key: randomUUID() });
      expect(await db.selectFrom("users").select(["first_name", "last_name"]).where("id", "=", user.id).executeTakeFirstOrThrow()).toEqual({ first_name: user.first_name, last_name: user.last_name });
      expect(await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: "2037-06-15T20:00:00Z" })))
        .toMatchObject({ person_id: identity.person_id, agent_id: identity.agent_id, acting: true });
      await expect(service.detail(foreign.user, schoolId, created.id)).rejects.toThrow("Select this institution");
      const foreignPerson = await foreign.run(() => foreign.person("Private other campus"));
      await expect(service.detail(user, schoolId, foreignPerson.id)).rejects.toThrow("not found");
      await expect(service.correctName(request(user), schoolId, foreignPerson.id, { ...correction, idempotency_key: randomUUID() })).rejects.toThrow("not found");
      await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${schoolId}::uuid AND user_id=${user.id}::uuid`.execute(db);
      await expect(service.correctName(request(user), schoolId, created.id, correction)).rejects.toThrow();
    });
  }, 60000);
  it("creates a name-only passive person once without accounts, enrollment, invitations or acting authority", async () => {
    const { schoolId, user, run } = await fixture();
    await run(async () => {
      const name = `Passive-${randomUUID()}`;
      const input = { first_name: name, idempotency_key: randomUUID() };
      const created = await service.create(request(user), schoolId, input);
      expect(created).toMatchObject({ label: name, affiliations: [], has_account: false });
      expect(await service.create(request(user), schoolId, input)).toEqual(created);
      const absence = (await sql<{ people: number; users: number; students: number; staff: number; invitations: number; agents: number; memberships: number }>`SELECT
        (SELECT count(*)::int FROM school_people WHERE school_id=${schoolId}::uuid AND id=${created.id}::uuid) AS people,
        (SELECT count(*)::int FROM users WHERE first_name=${name}) AS users,
        (SELECT count(*)::int FROM students WHERE person_id=${created.id}::uuid) AS students,
        (SELECT count(*)::int FROM staff_profiles WHERE person_id=${created.id}::uuid) AS staff,
        (SELECT count(*)::int FROM school_invitations WHERE school_id=${schoolId}::uuid) AS invitations,
        (SELECT count(*)::int FROM campus_model_agents WHERE school_id=${schoolId}::uuid AND person_id=${created.id}::uuid) AS agents,
        (SELECT count(*)::int FROM school_memberships WHERE school_id=${schoolId}::uuid) AS memberships`.execute(db)).rows[0]!;
      expect(absence).toEqual({ people: 1, users: 0, students: 0, staff: 0, invitations: 0, agents: 0, memberships: 1 });
      const trace = (await sql<{ command_count: number; accepted: boolean; namespace: string; outcomes: number; outbox: number; audits: number }>`SELECT
        count(*)::int AS command_count,bool_and(command.state='accepted') AS accepted,min(command.environment_namespace_id) AS namespace,
        (SELECT count(*)::int FROM campus_model_command_outcomes outcome JOIN campus_model_commands accepted ON accepted.id=outcome.command_id
          JOIN campus_model_entities target ON target.id=accepted.target_entity_id WHERE target.school_id=${schoolId}::uuid AND target.domain_id=${created.id}) AS outcomes,
        (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid AND aggregate_id=${created.id}) AS outbox,
        (SELECT count(*)::int FROM audit_events WHERE school_id=${schoolId}::uuid AND target_id=${created.id}) AS audits
        FROM campus_model_commands command JOIN campus_model_entities entity ON entity.id=command.target_entity_id
        WHERE command.school_id=${schoolId}::uuid AND entity.domain_id=${created.id}`.execute(db)).rows[0]!;
      expect(trace).toEqual({ command_count: 1, accepted: true, namespace: `live:${schoolId}`, outcomes: 1, outbox: 1, audits: 1 });
      await expect(service.create(request(user), schoolId, { ...input, first_name: `${name}-changed` })).rejects.toThrow("different people data");
    });
  }, 30000);

  it("reuses learner and employee identities in one dated group without changing enrollment or login access", async () => {
    const { schoolId, user, run, person } = await fixture();
    await run(async () => {
      const learner = await person("Existing learner", "learner"), worker = await person("No-account guard", "worker");
      await sql`INSERT INTO students(school_id,person_id,admission_number) VALUES(${schoolId}::uuid,${learner.id}::uuid,${`P-${randomUUID().slice(0, 8)}`})`.execute(db);
      const profile = (await sql<{ id: string }>`WITH staff_fixture_input(school_id,person_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,status,created_by,updated_by) AS (VALUES (${schoolId}::uuid,${worker.id}::uuid,${`G-${randomUUID().slice(0, 8)}`},'No-account','Guard','','non_teaching','Guard','contract','active',${user.id}::uuid,${user.id}::uuid)) INSERT INTO staff_profiles(school_id,person_id,staff_code,staff_kind,designation,employment_type,status,created_by,updated_by) SELECT input.school_id::uuid,input.person_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.status,input.created_by::uuid,input.updated_by::uuid FROM staff_fixture_input input RETURNING id`.execute(db)).rows[0]!;
      const input = { idempotency_key: randomUUID(), name: "Safety training", person_ids: [learner.id, worker.id], starts_on: "2037-06-16", ends_on: null };
      const group = await service.createGroup(request(user), schoolId, input);
      expect(await service.createGroup(request(user), schoolId, input)).toEqual(group);
      const listed = await service.groups(user, schoolId, {});
      expect(listed.total).toBe(1);
      expect(listed.results[0]?.members).toEqual(expect.arrayContaining([expect.objectContaining({ person_id: learner.id }), expect.objectContaining({ person_id: worker.id })]));
      const facts = (await sql<{ students: number; enrollments: number; accounts: number; profile: string }>`SELECT
        (SELECT count(*)::int FROM students WHERE school_id=${schoolId}::uuid) AS students,
        (SELECT count(*)::int FROM enrollments enrollment JOIN students learner ON learner.id=enrollment.student_id WHERE learner.school_id=${schoolId}::uuid) AS enrollments,
        (SELECT count(*)::int FROM staff_profiles WHERE school_id=${schoolId}::uuid AND user_id IS NOT NULL) AS accounts,
        (SELECT id FROM staff_profiles WHERE person_id=${worker.id}::uuid) AS profile`.execute(db)).rows[0]!;
      expect(facts).toEqual({ students: 1, enrollments: 0, accounts: 0, profile: profile.id });
      await expect(service.createGroup(request(user), schoolId, { ...input, name: "Changed payload" })).rejects.toThrow("different people data");
    });
  }, 30000);

  it("pages people and groups with true totals, stable ordering and literal search characters", async () => {
    const { schoolId, user, run } = await fixture();
    await run(async () => {
      const prefix = `Page-${randomUUID().slice(0, 8)}`;
      await sql`INSERT INTO school_people(school_id,first_name,last_name)
        SELECT ${schoolId}::uuid,${prefix}||'-'||lpad(number::text,2,'0'),'' FROM generate_series(1,26) number`.execute(db);
      const first = await service.list(user, schoolId, { search: prefix, page: 1 });
      const second = await service.list(user, schoolId, { search: prefix, page: 2 });
      expect(first).toMatchObject({ page_size: 25, total: 26 }); expect(first.results).toHaveLength(25);
      expect(second).toMatchObject({ total: 26 }); expect(second.results).toHaveLength(1);
      expect(new Set([...first.results, ...second.results].map((item) => item.id)).size).toBe(26);
      expect((await service.list(user, schoolId, { search: prefix, page: 3 })).total).toBe(26);
      await sql`INSERT INTO participation_groups(school_id,name,created_by)
        SELECT ${schoolId}::uuid,${prefix}||'-'||lpad(number::text,2,'0'),${user.id}::uuid FROM generate_series(1,26) number`.execute(db);
      expect((await service.groups(user, schoolId, { search: prefix, page: 1 })).results).toHaveLength(25);
      expect(await service.groups(user, schoolId, { search: prefix, page: 2 })).toMatchObject({ total: 26, results: [expect.objectContaining({ name: `${prefix}-26` })] });
      expect((await service.groups(user, schoolId, { search: prefix, page: 3 })).total).toBe(26);
      const literal = await service.create(request(user), schoolId, { first_name: "Literal_%", idempotency_key: randomUUID() });
      expect((await service.list(user, schoolId, { search: "_%" })).results.map((item) => item.id)).toEqual([literal.id]);
    });
  }, 30000);

  it("uses the bound campus clock for affiliations and effective membership without rewriting earlier groups", async () => {
    const { schoolId, user, run, person, setNow } = await fixture();
    await run(async () => {
      const worker = await person("Bound-clock worker", "worker"), learner = await person("Future member", "learner");
      const affiliation = (await sql<{ starts_on: string }>`SELECT starts_on::text FROM person_affiliations WHERE person_id=${worker.id}::uuid`.execute(db)).rows[0]!;
      expect(affiliation.starts_on).toBe("2037-06-16");
      const group = await service.createGroup(request(user), schoolId, { name: "Dated group", person_ids: [worker.id], starts_on: "2037-06-16", idempotency_key: randomUUID() });
      expect((await service.groups(user, schoolId, {})).results[0]?.members).toEqual([expect.objectContaining({ person_id: worker.id })]);
      await expect(service.replaceMembers(request(user), schoolId, group.id, { person_ids: [learner.id], effective_on: "2037-06-16", expected_revision: 1, idempotency_key: randomUUID() })).rejects.toThrow("after 2037-06-16");
      await service.replaceMembers(request(user), schoolId, group.id, { person_ids: [learner.id], effective_on: "2037-06-17", expected_revision: 1, idempotency_key: randomUUID() });
      expect((await service.groups(user, schoolId, {})).results[0]?.members).toEqual([expect.objectContaining({ person_id: worker.id })]);
      setNow("2037-06-16T20:00:00Z");
      expect((await service.groups(user, schoolId, {})).results[0]?.members).toEqual([expect.objectContaining({ person_id: learner.id })]);
      await expect(service.replaceMembers(request(user), schoolId, group.id, { person_ids: [worker.id], effective_on: "2037-06-18", expected_revision: 1, idempotency_key: randomUUID() })).rejects.toThrow("changed");
      const history = (await sql<{ person_id: string; starts_on: string; ends_on: string | null }>`SELECT person_id,starts_on::text,ends_on::text FROM participation_group_members WHERE group_id=${group.id}::uuid ORDER BY starts_on`.execute(db)).rows;
      expect(history).toEqual([{ person_id: worker.id, starts_on: "2037-06-16", ends_on: "2037-06-16" }, { person_id: learner.id, starts_on: "2037-06-17", ends_on: null }]);
    });
  }, 30000);

  it("rechecks revoked membership even for retained retries and exposes no cross-institution records", async () => {
    const left = await fixture(), right = await fixture();
    await left.run(async () => {
      const input = { first_name: "Owned person", idempotency_key: randomUUID() };
      const person = await service.create(request(left.user), left.schoolId, input);
      await expect(service.list(right.user, left.schoolId, {})).rejects.toThrow("Select this institution");
      await expect(service.list({ ...right.user, active_school_id: left.schoolId }, left.schoolId, {})).rejects.toThrow();
      await expect(service.createGroup(request(left.user), left.schoolId, { name: "Forbidden cross-tenant roster", person_ids: [(await right.run(() => right.person("Private person"))).id], starts_on: "2037-06-16", idempotency_key: randomUUID() })).rejects.toThrow("this institution");
      expect((await service.list(left.user, left.schoolId, { search: "Private person" })).total).toBe(0);
      await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${left.schoolId}::uuid AND user_id=${left.user.id}::uuid`.execute(db);
      await expect(service.create(request(left.user), left.schoolId, input)).rejects.toThrow();
      await expect(service.list(left.user, left.schoolId, {})).rejects.toThrow();
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM school_people WHERE id=${person.id}::uuid AND school_id=${left.schoolId}::uuid`.execute(db)).rows[0]?.count).toBe(1);
    });
  }, 30000);
});
