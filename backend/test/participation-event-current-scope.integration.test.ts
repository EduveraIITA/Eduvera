import { randomUUID } from "node:crypto";
import { Pool, types } from "pg";
import { Kysely, PostgresDialect, sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { AccessRolesService } from "../src/roles/access-roles.service.js";
import { simulationFunctionDefinition, type SimulationBranch } from "../src/database/simulation-branch.driver.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, (value) => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb), provisioner = new ProgressiveWorkspaceProvisioner(core);
const planning = new ActivityPlanningService(applicationDb, new SchoolEventService(applicationDb, core), core, core, core, new ResponsibilityProjectionService(core));
const attendance = new ActivityAttendanceService(applicationDb, core, core, core, core, core);
const roles = new AccessRolesService(applicationDb);
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() } }) as unknown as AuthenticatedRequest;
afterAll(async () => db.destroy());

async function account(label: string, role: "admin" | "staff") {
  const suffix = randomUUID();
  return db.insertInto("users").values({ username: `event-scope-${suffix}`, email: `event-scope-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: label, last_name: "Fixture", role })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
}

async function fixture() {
  const adminAccount = await account("Administrator", "admin");
  const schoolId = await db.transaction().execute((tx) => provisioner.createForAccount(tx, adminAccount, "UTC"));
  const admin: AuthUser = { ...adminAccount, active_school_id: schoolId };
  const adminIdentity = await db.transaction().execute((tx) => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: admin.id, at: new Date().toISOString() }));
  if (!adminIdentity.acting) throw new Error("Explicit fixture founder identity was not active.");
  const worker = await account("Recorder", "staff");
  const person = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name) VALUES(${schoolId}::uuid,'Recorder') RETURNING id`.execute(db)).rows[0]!;
  await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES(${schoolId}::uuid,${worker.id}::uuid,'staff')`.execute(db);
  const profile = (await sql<{ id: string }>`WITH staff_fixture_input(school_id,user_id,person_id,staff_code,first_name,email,staff_kind,designation,employment_type,status,created_by,updated_by) AS (VALUES (${schoolId}::uuid,${worker.id}::uuid,${person.id}::uuid,${`REC-${randomUUID().slice(0, 8)}`},'Recorder',${worker.email},'non_teaching','Campus operator','full_time','active',${admin.id}::uuid,${admin.id}::uuid)) INSERT INTO staff_profiles(school_id,user_id,person_id,staff_code,staff_kind,designation,employment_type,status,created_by,updated_by) SELECT input.school_id::uuid,input.user_id::uuid,input.person_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.status,input.created_by::uuid,input.updated_by::uuid FROM staff_fixture_input input RETURNING id`.execute(db)).rows[0]!;
  const endpoint = await db.transaction().execute((tx) => core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: person.id,
    user_id: worker.id, actor_user_id: admin.id, effective_from: new Date(Date.now() - 10000).toISOString(), effective_until: null,
    source_domain: "staff_operations", source_record_id: profile.id, source_revision: 1, metadata: { fixture: true } }));
  const operator: AuthUser = { ...worker, active_school_id: schoolId };
  const today = new Date().toISOString().slice(0, 10), tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const role = await roles.save(admin, schoolId, { name: "Campus attendance recorder", context_kind: "institution", permissions: ["attendance.record"] });
  return { schoolId, admin, adminPersonId: adminIdentity.person_id, operator, personId: person.id, profileId: profile.id, endpoint, role, today, tomorrow };
}

async function publish(value: Awaited<ReturnType<typeof fixture>>) {
  const plan = await planning.create(request(value.admin), value.schoolId, { idempotency_key: randomUUID(), title: "Campus training",
    purpose: "training", timezone: "UTC", starts_on: value.tomorrow, recurrence: "once", starts_at: "09:00", ends_at: "10:00",
    person_ids: [value.personId], recorder_person_id: value.personId, reviewer_person_id: value.adminPersonId, attendance_mode: "roll_call" });
  await planning.publish(request(value.admin), value.schoolId, plan.id, { expected_revision: 1, idempotency_key: randomUUID() });
  const occurrence = (await planning.ensureOccurrences(value.schoolId, value.tomorrow, value.tomorrow)).find((item) => item.plan_version_id === plan.id)!;
  const registerId = await attendance.ensureRegister(value.schoolId, occurrence.id);
  return { registerId, occurrenceId: occurrence.id, payload: { register_id: registerId, occurrence_id: occurrence.id, refresh: ["attendance", "activities", "workspace", "today"] } };
}

const allowed = async (school: string, user: string, payload: unknown, event = "attendance.participation.updated") =>
  (await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${school}::uuid,${event},${JSON.stringify(payload)}::jsonb,${user}::uuid) AS allowed`.execute(db)).rows[0]!.allowed;

describe.skipIf(!enabled)("current-scope participation delivery and explicit campus attendance roles", () => {
  it("uses the same current human predicate for resolution, candidate lists and delivery", async () => {
    const value = await fixture();
    const check = async () => {
      const at = new Date().toISOString();
      const resolved = await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: value.schoolId, user_id: value.operator.id, at }));
      const candidates = await db.transaction().execute(tx => core.listActingPeople(tx, { school_id: value.schoolId, at }));
      const delivery = (await sql<{ active: boolean }>`SELECT campus_model_account_person_is_active(${value.schoolId}::uuid,
        ${value.operator.id}::uuid,${value.personId}::uuid,${at}::timestamptz) AS active`.execute(db)).rows[0]!.active;
      return { resolved: resolved.acting, listed: candidates.some(person => person.person_id === value.personId), delivery };
    };
    expect(await check()).toEqual({ resolved: true, listed: true, delivery: true });
    await sql`UPDATE staff_profiles SET status='inactive' WHERE id=${value.profileId}::uuid`.execute(db);
    expect(await check()).toEqual({ resolved: false, listed: false, delivery: false });
    await sql`UPDATE staff_profiles SET status='active' WHERE id=${value.profileId}::uuid`.execute(db);
    await sql`UPDATE school_people SET retired_at=now() WHERE id=${value.personId}::uuid`.execute(db);
    expect(await check()).toEqual({ resolved: false, listed: false, delivery: false });
    await sql`UPDATE school_people SET retired_at=NULL WHERE id=${value.personId}::uuid`.execute(db);
    const conflicting = await db.insertInto("school_people").values({ school_id: value.schoolId, first_name: "Explicit conflicting fixture" }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("students").values({ school_id: value.schoolId, person_id: conflicting.id, user_id: value.operator.id, admission_number: `AMB-${randomUUID()}` }).execute();
    expect(await check()).toEqual({ resolved: false, listed: false, delivery: false });
  }, 60000);
  it("keeps an explicitly assigned campus reviewer independent from recording authority", async () => {
    const value = await fixture();
    const reviewer = await roles.save(value.admin, value.schoolId, { name: "Campus attendance reviewer", context_kind: "institution", permissions: ["attendance.review"] });
    expect(reviewer.permissions).toEqual(["attendance.review", "attendance.view"]);
    await roles.assign(value.admin, value.schoolId, { role_id: reviewer.id, staff_profile_id: value.profileId, starts_on: value.today });
    const catalogue = await planning.catalogue(value.admin, value.schoolId);
    expect(catalogue.reviewers.map(person => person.id)).toContain(value.personId);
    expect(catalogue.recorders.map(person => person.id)).not.toContain(value.personId);
    const plan = await planning.create(request(value.admin), value.schoolId, { idempotency_key: randomUUID(), title: "Reviewed campus training",
      purpose: "training", timezone: "UTC", starts_on: value.tomorrow, recurrence: "once", starts_at: "09:00", ends_at: "10:00",
      person_ids: [value.personId], recorder_person_id: value.adminPersonId, reviewer_person_id: value.personId, attendance_mode: "roll_call" });
    await planning.publish(request(value.admin), value.schoolId, plan.id, { expected_revision: 1, idempotency_key: randomUUID() });
    const occurrence = (await planning.ensureOccurrences(value.schoolId, value.tomorrow, value.tomorrow)).find(item => item.plan_version_id === plan.id)!;
    const registerId = await attendance.ensureRegister(value.schoolId, occurrence.id);
    const detail = await attendance.detail(value.operator, value.schoolId, registerId);
    expect(detail.capabilities.can_record).toBe(false); expect(detail.capabilities.can_review_evidence).toBe(true);
    expect(await allowed(value.schoolId, value.operator.id, { register_id: registerId, occurrence_id: occurrence.id })).toBe(true);
    await expect(attendance.marks(value.operator, value.schoolId, registerId, { expected_revision: 0,
      records: [{ person_id: value.personId, status: "present" }] }, request(value.operator))).rejects.toThrow(/appointment|record/);
  }, 60000);

  it("creates a supported role without an automatic grant, then requires both explicit assignment and occurrence appointment", async () => {
    const value = await fixture();
    expect(value.role.permissions).toEqual(["attendance.record", "attendance.view"]);
    expect((await planning.catalogue(value.admin, value.schoolId)).recorders.map((item) => item.id)).not.toContain(value.personId);
    await expect(publish(value)).rejects.toThrow("Scheduling an activity cannot grant this permission");
    await roles.assign(value.admin, value.schoolId, { role_id: value.role.id, staff_profile_id: value.profileId, starts_on: value.today });
    expect((await planning.catalogue(value.admin, value.schoolId)).recorders.map((item) => item.id)).toContain(value.personId);
    const published = await publish(value);
    expect(await allowed(value.schoolId, value.operator.id, published.payload)).toBe(true);
    const detail = await attendance.detail(value.operator, value.schoolId, published.registerId);
    // The future register is not open yet; recording authority is still exact.
    expect(detail.capabilities.can_finalize).toBe(false);
    await sql`DELETE FROM schedule_activity_occurrence_recorders WHERE occurrence_id=${published.occurrenceId}::uuid
      AND person_id=${value.personId}::uuid AND action='record'`.execute(db);
    expect(await allowed(value.schoolId, value.operator.id, published.payload)).toBe(false);
  }, 60000);

  it("rechecks role revocation, endpoint revocation and spoofed or cross-campus event identities", async () => {
    const value = await fixture();
    await roles.assign(value.admin, value.schoolId, { role_id: value.role.id, staff_profile_id: value.profileId, starts_on: value.today });
    const published = await publish(value);
    expect(await allowed(value.schoolId, value.operator.id, published.payload)).toBe(true);
    expect(await allowed(value.schoolId, value.operator.id, { ...published.payload, occurrence_id: randomUUID() })).toBe(false);
    expect(await allowed(value.schoolId, value.operator.id, { register_id: "not-a-uuid", occurrence_id: "not-a-uuid" })).toBe(false);
    expect(await allowed(randomUUID(), value.operator.id, published.payload)).toBe(false);
    await expect(sql`INSERT INTO event_outbox(school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key)
      VALUES(${value.schoolId}::uuid,'attendance.participation.updated','attendance_register',${published.registerId}::uuid,
        ${[value.operator.id]}::uuid[],${JSON.stringify({ ...published.payload, register_id: randomUUID() })}::jsonb,${`spoof-${randomUUID()}`})`.execute(db))
      .rejects.toThrow("authoritative register");
    await roles.save(value.admin, value.schoolId, { name: value.role.name, context_kind: "institution", permissions: ["messages.view"],
      expected_revision: value.role.revision, expected_assignment_count: 1 }, value.role.id);
    expect(await allowed(value.schoolId, value.operator.id, published.payload)).toBe(false);
    expect((await planning.catalogue(value.admin, value.schoolId)).recorders.map((item) => item.id)).not.toContain(value.personId);
    await db.transaction().execute((tx) => core.closeAccountEndpoint(tx, { school_id: value.schoolId, endpoint_id: value.endpoint.endpoint_id,
      actor_user_id: value.admin.id, expected_revision: 1, effective_at: new Date().toISOString(), disposition: "revoked",
      reason: "Isolated endpoint revocation test", source_domain: "staff_operations", source_record_id: value.profileId,
      source_revision: 2, idempotency_key: randomUUID() }));
    expect((await sql<{ active: boolean }>`SELECT campus_model_account_person_is_active(${value.schoolId}::uuid,
      ${value.operator.id}::uuid,${value.personId}::uuid,now()) AS active`.execute(db)).rows[0]!.active).toBe(false);
    expect(await allowed(value.schoolId, value.operator.id, published.payload)).toBe(false);
    expect(await allowed(value.schoolId, value.admin.id, published.payload)).toBe(true); // Addressed read oversight, not a write grant.
  }, 60000);

  it("keeps People hints private to current management authority and rejects a foreign execution namespace", async () => {
    const value = await fixture();
    const payload = { refresh: ["people.participants", "activities.catalogue"] };
    expect(await allowed(value.schoolId, value.admin.id, payload, "people.updated")).toBe(true);
    expect(await allowed(value.schoolId, value.operator.id, payload, "people.updated")).toBe(false);
    await db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('thatcampus.namespace_id',${`scenario:${randomUUID()}:run:${randomUUID()}`},true)`.execute(tx);
      expect((await sql<{ active: boolean }>`SELECT campus_model_account_person_is_active(${value.schoolId}::uuid,
        ${value.admin.id}::uuid,NULL,now()) AS active`.execute(tx)).rows[0]!.active).toBe(false);
    });
  }, 60000);

  it("rebinds the reviewed Core identity adapter to an isolated schema and rejects another run or the source Live namespace", async () => {
    const value = await fixture(), client = await pool.connect();
    const schema = `dt_identity_delivery_test_${randomUUID().replaceAll("-", "")}`;
    const namespace = `scenario:${randomUUID()}:run:${randomUUID()}`;
    const tables = ["users", "school_people", "school_memberships", "students", "parents", "guardian_school_profiles", "staff_profiles",
      "institution_governance_appointments", "campus_model_agent_endpoints", "campus_model_agents", "campus_model_agent_endpoint_transitions",
      "operational_realms", "execution_environment_namespaces"];
    try {
      await client.query("BEGIN"); await client.query(`CREATE SCHEMA "${schema}"`);
      for (const table of tables) {
        await client.query(`CREATE TABLE "${schema}"."${table}" AS SELECT * FROM public."${table}" WHERE false`);
        if (table === "users") await client.query(`INSERT INTO "${schema}"."${table}" SELECT * FROM public."${table}" WHERE id=$1`, [value.admin.id]);
        else if (table === "parents") continue;
        else if (table === "operational_realms") await client.query(`INSERT INTO "${schema}"."${table}" SELECT * FROM public."${table}" WHERE legacy_school_id=$1`, [value.schoolId]);
        else if (table === "execution_environment_namespaces") await client.query(`INSERT INTO "${schema}"."${table}" SELECT * FROM public."${table}" WHERE realm_id IN (SELECT id FROM "${schema}".operational_realms)`);
        else await client.query(`INSERT INTO "${schema}"."${table}" SELECT * FROM public."${table}" WHERE school_id=$1`, [value.schoolId]);
      }
      await client.query(`INSERT INTO "${schema}".execution_environment_namespaces(namespace_id,realm_id,environment_kind,source_namespace_id,status,expires_at)
        SELECT $1,id,'simulation',$2,'active',now()+interval '1 day' FROM "${schema}".operational_realms`, [namespace, `live:${value.schoolId}`]);
      for (const name of ["campus_model_current_account_endpoints", "campus_model_account_person_is_active"]) {
        const source = (await client.query<{ definition: string }>("SELECT pg_get_functiondef(('public.'||$1)::regproc) AS definition", [name])).rows[0]!.definition;
        await client.query(simulationFunctionDefinition(source, { schema_name: schema } as SimulationBranch));
      }
      await client.query("SELECT set_config('thatcampus.namespace_id',$1,true)", [namespace]);
      const isActive = async () => (await client.query<{ active: boolean }>(`SELECT "${schema}".campus_model_account_person_is_active($1,$2,NULL,now()) AS active`, [value.schoolId, value.admin.id])).rows[0]!.active;
      expect(await isActive()).toBe(true);
      await client.query("SELECT set_config('thatcampus.namespace_id',$1,true)", [`scenario:${randomUUID()}:run:${randomUUID()}`]);
      expect(await isActive()).toBe(false);
      await client.query("SELECT set_config('thatcampus.namespace_id',$1,true)", [`live:${value.schoolId}`]);
      expect(await isActive()).toBe(false);
    } finally { await client.query("ROLLBACK"); client.release(); }
  }, 60000);
});
