import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { AcademicParticipationBridge } from "../src/attendance/academic-participation-bridge.service.js";
import { AcademicParticipationEffects } from "../src/attendance/academic-participation-effects.service.js";
import { recordAttendanceModelObservations } from "../src/attendance/attendance-model-observation.js";
import { ActivityAttendanceWorkspaceService } from "../src/attendance/activity-attendance-workspace.service.js";
import { ResponsibilityAttendanceRepository } from "../src/attendance/responsibility-attendance.repository.js";
import { AttendanceModelService } from "../src/attendance-model/attendance-model.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage, executionNow } from "../src/campus-model-core/execution-time.runtime.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import type { StaffCoverageReconciliationPort } from "../src/staff-operations/staff-coverage-reconciliation.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, (value) => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const provisioner = new ProgressiveWorkspaceProvisioner(core);
const events = new SchoolEventService(applicationDb, core);
const planning = new ActivityPlanningService(applicationDb, events, core, core, core, new ResponsibilityProjectionService(core));
const service = new ActivityAttendanceService(applicationDb, core, core, core, core, core);
const academic = new AcademicParticipationBridge(applicationDb,service);
const sessions = new AttendanceModelService(applicationDb,events,service,academic,core,core);
const school = new SchoolService(applicationDb,events,{} as StaffCoverageReconciliationPort,core,
  undefined,undefined,undefined,academic);
new AcademicParticipationEffects(service,school,sessions,events);
const workspace = new ActivityAttendanceWorkspaceService(applicationDb, planning, service,
  sessions,new ResponsibilityAttendanceRepository(applicationDb),academic);
const request = (user: AuthUser, key = randomUUID()) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": key } }) as unknown as AuthenticatedRequest;
afterAll(async () => db.destroy());

async function fixture() {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `participation-${suffix}`, email: `participation-${suffix}@example.test`,
    password_hash: "isolated-test-only-hash", first_name: "Participation", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute((tx) => provisioner.createForAccount(tx, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const identity = await db.transaction().execute((tx) => core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() }));
  if (!identity.acting) throw new Error("The fixture's explicit founder endpoint was not active.");
  const people = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name,last_name)
    VALUES(${schoolId}::uuid,'No-account','Operator'),(${schoolId}::uuid,'Visiting','Participant') RETURNING id`.execute(db)).rows.map((row) => row.id);
  const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let now = new Date(`${today}T04:00:00Z`);
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now.toISOString() } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const create = async (title = "Mixed workshop", starts = "09:00", ends = "10:00", offset = 0) => run(async () => {
    const draft = await planning.create(request(user), schoolId, { idempotency_key: randomUUID(), title, purpose: "training",
      timezone: "Asia/Kolkata", starts_on: today, recurrence: "once", starts_at: starts, ends_at: ends, end_day_offset: offset,
      person_ids: people, attendance_mode: "roll_call", recorder_person_id: identity.person_id, reviewer_person_id: identity.person_id });
    await planning.publish(request(user), schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
    const occurrences = await planning.ensureOccurrences(schoolId, today, today);
    const occurrence = occurrences.find((row) => row.plan_version_id === draft.id)!;
    const registerId = await service.ensureRegister(schoolId, occurrence.id);
    return { registerId, occurrence };
  });
  return { schoolId, user, personId: identity.person_id, people, today, run, create, setNow: (value: string) => { now = new Date(value); } };
}

async function academicLessonFixture(){
  const campus=await fixture(),{schoolId,user,run,today}=campus;
  return run(async()=>{
    const configured=await new ProgressiveSetupService(applicationDb,core,core,core).setupAttendance(user,schoolId,
      {group_name:"Session class",participant_names:["Lesson One","Lesson Two"],
        responsible:{kind:"current_user",self_teaches:true,display_name:"Lesson Owner"},
        session:{starts_at:"09:00",ends_at:"10:00",weekdays:[1,2,3,4,5,6,7]}},request(user));
    await sql`UPDATE institution_operating_rules SET attendance_academic_mode='scheduled_session',revision=revision+1,
      updated_by=${user.id}::uuid WHERE school_id=${schoolId}::uuid`.execute(db);
    const subject=await db.insertInto('subjects').values({school_id:schoolId,code:'LESSON',name:'Foundations',short_name:'Foundations'}).returningAll().executeTakeFirstOrThrow();
    await db.transaction().execute(async(tx)=>{
      const section=await tx.selectFrom('class_sections').selectAll().where('id','=',configured.resources.class_section_id).executeTakeFirstOrThrow();
      const term=await tx.selectFrom('academic_terms').selectAll().where('id','=',configured.resources.term_id).executeTakeFirstOrThrow();
      const slots=await tx.selectFrom('timetable_slots').selectAll().where('class_section_id','=',section.id).execute();
      for(const slot of slots){
        await tx.updateTable('timetable_slots').set({slot_type:'class',subject_id:subject.id,title:subject.name,revision:slot.revision+1}).where('id','=',slot.id).execute();
        await core.recordLegacyTimetableSlotChange(tx,{school_id:schoolId,actor_user_id:user.id,action:'updated',source_record_id:slot.id,
          source_revision:slot.revision+1,previous_source_revision:slot.revision,term_id:term.id,starts_on:term.starts_on,ends_on:term.ends_on,
          timezone:'Asia/Kolkata',occurred_at:executionNow().toISOString(),class_section:{kind:'class',domain:'academic_structure',domain_id:section.id,
            label:section.grade,lifecycle_state:'active',source_revision:section.revision,metadata:{}},
          slot:{weekday:slot.weekday,period_number:slot.period_number,starts_at:slot.starts_at,ends_at:slot.ends_at,title:subject.name,slot_type:'class',
            teacher_user_id:user.id,subject:{kind:'subject',domain:'academic_structure',domain_id:subject.id,label:subject.name,lifecycle_state:'active',source_revision:1,metadata:{}},
            space:null,room_snapshot:''},correlation_id:randomUUID()});
      }
    });
    const queue=await sessions.workspace(user,today);
    const sessionId=queue.registers.find((row)=>row.class_section_id===configured.resources.class_section_id)!.session_id as string;
    return {...campus,configured,sessionId,initial:await sessions.screen(user,sessionId)};
  });
}

describe.skipIf(!enabled)("one person-based participation lifecycle with real PostgreSQL and DT evidence", () => {
  it("resolves accepted observation state at the recorded cutoff after a later attendance correction", async () => {
    const f = await fixture(), { registerId } = await f.create();
    await f.run(async () => {
      const t1 = `${f.today}T04:00:00.000Z`, t2 = `${f.today}T04:01:00.000Z`;
      await service.marks(f.user, f.schoolId, registerId, { expected_revision: 0,
        records: [{ person_id: f.people[0], status: "present" }] }, request(f.user));
      const query = { school_id: f.schoolId, at: t1, recorded_as_of: t1,
        subject: { type: "entity" as const, domain: "people", domain_id: f.people[0]! } };
      const before = await core.resolveAt(query);
      expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ dimension: "accepted",
        observation: expect.objectContaining({ state: "accepted", payload: expect.objectContaining({ attendance_status: "present" }), state_basis: "ingress" }) })]));
      f.setNow(t2);
      await service.marks(f.user, f.schoolId, registerId, { expected_revision: 1, reason: "Corrected the signed register",
        records: [{ person_id: f.people[0], status: "absent" }] }, request(f.user));
      expect(await core.resolveAt(query)).toEqual(before);
      const current = await core.resolveAt({ ...query, at: t2, recorded_as_of: t2 });
      expect(current).toEqual(expect.arrayContaining([expect.objectContaining({ observation:
        expect.objectContaining({ payload: expect.objectContaining({ attendance_status: "absent" }) }) })]));
      expect(current.filter(item => item.assertion_type === "direct_observation"
        && (item.observation.payload as { attendance_status?: string }).attendance_status === "present")).toHaveLength(0);
      const history = (await sql<{ state: string }>`SELECT history.state FROM campus_model_observation_states history
        JOIN campus_model_observations observation ON observation.id=history.observation_id
        JOIN campus_model_entities person ON person.id=observation.subject_entity_id
        WHERE history.school_id=${f.schoolId}::uuid AND person.domain_id=${f.people[0]}
        ORDER BY history.sequence`.execute(db)).rows;
      expect(history.map(row => row.state)).toEqual(["accepted", "superseded", "accepted"]);
      // Model the shape of retained evidence whose first known state starts
      // later than its receipt. No earlier state is invented for this fixture.
      const retained = (await sql<{ id: string }>`INSERT INTO campus_model_observations(school_id,realm_id,environment_namespace_id,
          kind,subject_entity_id,context_entity_id,captured_by_agent_id,source_type,source_ref,source_record_id,
          observed_at,received_at,state,state_recorded_at,idempotency_key,request_hash,payload)
        SELECT school_id,realm_id,environment_namespace_id,'test.history_boundary',subject_entity_id,context_entity_id,captured_by_agent_id,
          'test.history_boundary',${randomUUID()},${randomUUID()},${t1}::timestamptz,${t1}::timestamptz,'accepted',${t2}::timestamptz,
          ${randomUUID()},${"a".repeat(64)},'{}'::jsonb FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid AND kind='attendance.participation_observed' LIMIT 1 RETURNING id`.execute(db)).rows[0]!;
      const earlier = (await core.resolveAt(query)).find(item => item.assertion_id === retained.id);
      expect(earlier).toMatchObject({ dimension: "observed", certainty: "unverified",
        observation: { state: "unknown", state_recorded_at: null, state_basis: "history_unavailable" } });
    });
  }, 60000);

  it.runIf(Boolean(process.env.SIMULATION_MODEL_HISTORY_TEST_TARGET_URL))("keeps observation transitions and current identity isolated in two captured worlds", async () => {
    const f = await fixture(), { registerId } = await f.create();
    await f.run(() => service.marks(f.user, f.schoolId, registerId, { expected_revision: 0,
      records: [{ person_id: f.people[0], status: "present" }] }, request(f.user)));
    const t1 = `${f.today}T04:00:00.000Z`, t2 = `${f.today}T04:01:00.000Z`;
    const store = new SimulationSnapshotStore(requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),
      requireIsolatedTestDatabaseUrl(process.env.SIMULATION_MODEL_HISTORY_TEST_TARGET_URL), 3);
    const opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, t1);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID(), branch = await createSimulationBranch(store.pool, snapshot,
          { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const connection = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: candidate => compiler.createIntrospector(candidate) } });
        opened.push(connection);
        const branchCore = new CampusModelCoreService(connection as DatabaseService, new ExecutionDataPlaneScope());
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId,
          virtual_now: t2, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "model-history-isolation", checked_at: t2 });
        return { connection, core: branchCore, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      const observation = await db.selectFrom("campus_model_observations").select(["id", "source_ref"]).where("school_id", "=", f.schoolId)
        .where("kind", "=", "attendance.participation_observed").executeTakeFirstOrThrow();
      await branch.run(async () => {
        expect(await branch.connection.transaction().execute(tx => branch.core.resolveAccountEndpoint(tx,
          { school_id: f.schoolId, user_id: f.user.id, at: t2 }))).toMatchObject({ acting: true, person_id: f.personId });
        await branch.connection.transaction().execute(tx => branch.core.transitionObservations(tx,
          { school_id: f.schoolId, source_type: "attendance.participation", source_ref: observation.source_ref!, state: "superseded" }));
        const query = { school_id: f.schoolId, at: t2, recorded_as_of: t2,
          subject: { type: "entity" as const, domain: "people", domain_id: f.people[0]! } };
        expect((await branch.core.resolveAt(query)).some(item => item.assertion_id === observation.id)).toBe(false);
        expect((await branch.core.resolveAt({ ...query, at: t1, recorded_as_of: t1 })).some(item => item.assertion_id === observation.id)).toBe(true);
        await sql`UPDATE school_people SET retired_at=${t2}::timestamptz WHERE id=${f.personId}::uuid`.execute(branch.connection);
        expect(await branch.connection.transaction().execute(tx => branch.core.resolveAccountEndpoint(tx,
          { school_id: f.schoolId, user_id: f.user.id, at: t2 }))).toMatchObject({ acting: false });
      });
      for (const current of [sibling]) await current.run(async () => {
        expect(await current.connection.selectFrom("campus_model_observations").select("state").where("id", "=", observation.id).executeTakeFirstOrThrow()).toEqual({ state: "accepted" });
        expect(await current.connection.transaction().execute(tx => current.core.resolveAccountEndpoint(tx,
          { school_id: f.schoolId, user_id: f.user.id, at: t2 }))).toMatchObject({ acting: true });
      });
      expect(await db.selectFrom("campus_model_observations").select("state").where("id", "=", observation.id).executeTakeFirstOrThrow()).toEqual({ state: "accepted" });
      expect(await db.transaction().execute(tx => core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.user.id, at: t2 }))).toMatchObject({ acting: true });
    } finally { await Promise.all(opened.map(connection => connection.destroy())); await store.pool.end(); }
  }, 120000);

  it("connects unified scheduled attendance to an exact lesson after a retained student gate exit", async () => {
    const f = await academicLessonFixture();
    await f.run(async () => {
      const learner = f.initial.roster[0]!;
      const person = await db.selectFrom("students").innerJoin("school_people as person", "person.id", "students.person_id")
        .select(["students.person_id", "person.first_name", "person.last_name", "person.revision"])
        .where("students.id", "=", learner.id).executeTakeFirstOrThrow();
      const gateId = randomUUID();
      await db.transaction().execute(tx => core.recordObservations(tx, [{ school_id: f.schoolId, actor_user_id: f.user.id,
        kind: "movement.gate_observed", subject: { kind: "student", domain: "people", domain_id: learner.id,
          label: `${person.first_name} ${person.last_name}`, lifecycle_state: "active", source_revision: person.revision, metadata: {} },
        context: null, source_type: "gate.movement", source_ref: gateId, source_record_id: gateId,
        observed_at: `${f.today}T03:45:00Z`, received_at: `${f.today}T03:45:00Z`, state: "accepted",
        payload: { direction: "out", gate: "Synthetic test gate", evidence_scope: "campus_boundary" },
        evidence_refs: [`synthetic-test-gate:${gateId}`], schema_version: 1, idempotency_key: gateId, domain_event_id: null }]));
      expect((await core.operationalSignals(f.schoolId, `${f.today}T04:00:00Z`)).find(row => row.student_id === learner.id))
        .toMatchObject({ kind: "expected_after_exit", attendance_status: null });
      await sessions.save(f.user, f.sessionId, { expected_revision: f.initial.register.revision,
        records: f.initial.roster.map((row: { id: string }) => ({ student_id: row.id, status: "present" })) }, request(f.user));
      expect((await core.operationalSignals(f.schoolId, `${f.today}T04:00:00Z`)).find(row => row.student_id === learner.id))
        .toMatchObject({ kind: "attendance_after_exit", attendance_status: "present" });
      // A different period cannot borrow the accepted record merely because the
      // person and class are the same. The domain's frozen lineage is required.
      const common = (await sql<{ occurrence_id: string }>`SELECT register.occurrence_id FROM activity_attendance_source_contexts link
        JOIN activity_attendance_registers register ON register.id=link.register_id
        WHERE link.school_id=${f.schoolId}::uuid AND link.source_kind='scheduled_session' AND link.source_id=${f.sessionId}`.execute(db)).rows[0]!;
      await sql`UPDATE schedule_activity_occurrences SET period_id=${randomUUID()}::uuid WHERE id=${common.occurrence_id}::uuid`.execute(db);
      expect((await core.operationalSignals(f.schoolId, `${f.today}T04:00:00Z`)).find(row => row.student_id === learner.id))
        .toMatchObject({ kind: "expected_after_exit", attendance_status: null });
    });
  }, 60000);

  it.runIf(Boolean(process.env.SIMULATION_ATTENDANCE_QUEUE_TEST_TARGET_URL))("keeps complete ten-register facets and search isolated while materializing only visible pages", async () => {
    const f = await fixture();
    // This operator has a current staff endpoint and an explicit attendance
    // assignment. Removing that grant must not remove their person or mandates.
    const operator = await f.run(async () => {
      const suffix = randomUUID();
      const account = await db.insertInto("users").values({ username: `queue-${suffix}`, email: `queue-${suffix}@example.test`,
        password_hash: "isolated-test-only-hash", first_name: "Queue", last_name: "Recorder", role: "staff" })
        .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: account.id, role: "staff", is_active: true }).execute();
      const identity = await linkFixtureStaffIdentity(applicationDb, { school_id: f.schoolId, user_id: account.id, owner_user_id: f.user.id });
      const profile = await db.selectFrom("staff_profiles").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", account.id).executeTakeFirstOrThrow();
      const role = (await sql<{ id: string }>`INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,
        capability_permissions,workflow_family,source_kind,context_kind,requires_acceptance,updated_by)
        VALUES(${f.schoolId}::uuid,${`queue_${suffix.slice(0, 8)}`},'Attendance recorder','operations','school',
          ARRAY['attendance.view','attendance.record'],'queue_recording','institute','institution',false,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!;
      const assignment = (await sql<{ id: string }>`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,
        staff_profile_id,scope_label,starts_on,status,assigned_by)
        VALUES(${f.schoolId}::uuid,${role.id}::uuid,${profile.id}::uuid,'Institution attendance',current_date-1,'active',${f.user.id}::uuid)
        RETURNING id`.execute(db)).rows[0]!;
      return { user: { ...account, active_school_id: f.schoolId }, personId: identity.person_id, assignmentId: assignment.id };
    });
    const publish = (title: string, start: string, end: string) => f.run(async () => {
      const draft = await planning.create(request(f.user), f.schoolId, { idempotency_key: randomUUID(), title, purpose: "training",
        timezone: "Asia/Kolkata", starts_on: f.today, recurrence: "once", starts_at: start, ends_at: end,
        person_ids: f.people, lead_person_id: f.personId, attendance_mode: "roll_call", recorder_person_id: operator.personId, reviewer_person_id: f.personId });
      await planning.publish(request(f.user), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
    });
    for (let index = 0; index < 10; index++) {
      const minutes = 8 * 60 + index * 30;
      const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
      await publish(`Queue ${String(index).padStart(2, "0")}`, time(minutes), time(minutes + 15));
    }
    const count = async (connection: Kysely<Database>) => Number((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_registers WHERE school_id=${f.schoolId}::uuid`.execute(connection)).rows[0]!.count);
    expect(await count(db)).toBe(0);
    const store = new SimulationSnapshotStore(requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), requireIsolatedTestDatabaseUrl(process.env.SIMULATION_ATTENDANCE_QUEUE_TEST_TARGET_URL), 4);
    const opened: Kysely<Database>[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, `${f.today}T04:00:00.000Z`);
      const open = async (virtualNow: string) => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
        const connection = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } });
        opened.push(connection);
        const database = connection as DatabaseService, branchCore = new CampusModelCoreService(database, new ExecutionDataPlaneScope()), branchEvents = new SchoolEventService(database, branchCore);
        const attendance = new ActivityAttendanceService(database, branchCore, branchCore, branchCore, branchCore, branchCore);
        const academic = new AcademicParticipationBridge(database, attendance);
        const planning = new ActivityPlanningService(database, branchEvents, branchCore, branchCore, branchCore, new ResponsibilityProjectionService(branchCore));
        const legacy = new AttendanceModelService(database, branchEvents, attendance, academic, branchCore, branchCore);
        const workspace = new ActivityAttendanceWorkspaceService(database, planning, attendance, legacy, new ResponsibilityAttendanceRepository(database), academic);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: virtualNow, source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: "attendance-queue-test", checked_at: virtualNow });
        return { connection, workspace, attendance, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(`${f.today}T09:00:00.000Z`), sibling = await open(`${f.today}T04:00:00.000Z`);
      const live = await f.run(() => workspace.list(f.user, f.schoolId, { date: f.today, page_size: 8 }));
      expect(live).toMatchObject({ total: 10, total_pages: 2, counts: { all: 10, needs_recording: 4, upcoming: 6 } });
      expect(live.registers).toHaveLength(8);
      expect(live.registers.every(item => item.participant_count === 2)).toBe(true);
      expect(await count(db)).toBe(8);
      await publish("Live only activity", "14:00", "14:15");
      const filtered = await branch.run(() => branch.workspace.list(f.user, f.schoolId, { date: f.today, search: "Queue 09", page_size: 8 }));
      expect(filtered).toMatchObject({ total: 1, counts: { all: 1, needs_recording: 1, upcoming: 0 } });
      expect(filtered.registers[0]).toMatchObject({ title: "Queue 09", participant_count: 2 }); expect(await count(branch.connection)).toBe(1);
      const branched = await branch.run(() => branch.workspace.list(f.user, f.schoolId, { date: f.today, page_size: 8 }));
      expect(branched).toMatchObject({ total: 10, counts: { all: 10, needs_recording: 10, upcoming: 0 } });
      expect(await count(branch.connection)).toBe(9); expect(await count(db)).toBe(8); expect(await count(sibling.connection)).toBe(0);
      expect(await sibling.run(() => sibling.workspace.list(f.user, f.schoolId, { date: f.today, search: "Queue 09", page_size: 8 }))).toMatchObject({ total: 1, counts: { all: 1, upcoming: 1 } });
      expect(await count(sibling.connection)).toBe(1);
      expect(await branch.run(() => branch.workspace.list(f.user, f.schoolId, { date: f.today, search: "Live only", page_size: 8 }))).toMatchObject({ total: 0, counts: { all: 0 } });
      expect((await f.run(() => workspace.list(f.user, f.schoolId, { date: f.today, search: "Live only", page_size: 8 }))).total).toBe(1);
      const permitted = async (connection: Kysely<Database>) => (await sql<{ allowed: boolean }>`SELECT staff_has_resource_permission(
        ${f.schoolId}::uuid,${operator.user.id}::uuid,'attendance.record','institution',${f.schoolId}::uuid,${f.today}::date) AS allowed`.execute(connection)).rows[0]!.allowed;
      expect(await permitted(branch.connection)).toBe(true);
      expect((await branch.run(() => branch.workspace.list(operator.user, f.schoolId, { date: f.today, search: "Queue 09", page_size: 8 }))).total).toBe(1);
      await sql`UPDATE staff_responsibility_assignments SET status='revoked',revoked_by=${f.user.id}::uuid,revoked_at=now(),
        revocation_reason='Queue authority regression' WHERE school_id=${f.schoolId}::uuid AND id=${operator.assignmentId}::uuid`.execute(branch.connection);
      expect(await permitted(branch.connection)).toBe(false);
      expect(await branch.run(() => branch.attendance.readerContext(operator.user, f.schoolId))).toEqual({ person_id: operator.personId, administrator: false });
      expect(Number((await sql<{ count: number }>`SELECT count(*)::int AS count FROM schedule_activity_occurrence_recorders WHERE school_id=${f.schoolId}::uuid AND person_id=${operator.personId}::uuid`.execute(branch.connection)).rows[0]!.count)).toBeGreaterThan(0);
      expect(await branch.run(() => branch.workspace.list(operator.user, f.schoolId, { date: f.today, search: "Queue 08", page_size: 8 }))).toMatchObject({ total: 0, counts: { all: 0 }, available_kinds: [], registers: [] });
      expect(await count(branch.connection)).toBe(9);
      await expect(branch.run(() => branch.workspace.openOccurrence(operator.user, f.schoolId, branched.registers[0]!.occurrence_id))).rejects.toThrow("outside your current responsibilities");
      expect(await permitted(db)).toBe(true); expect(await permitted(sibling.connection)).toBe(true);
      expect((await sibling.run(() => sibling.workspace.list(operator.user, f.schoolId, { date: f.today, search: "Queue 09", page_size: 8 }))).total).toBe(1);
    } finally { await Promise.all(opened.map(connection => connection.destroy())); await store.pool.end(); }
  }, 120_000);

  it("filters and counts the full authorized dated queue before materializing a short page", async () => {
    const f = await fixture();
    await f.create("Earlier training", "08:00", "09:00");
    await f.create("Later training", "11:00", "12:00");
    await f.run(async () => {
      const all = await workspace.list(f.user, f.schoolId, { date: f.today, page_size: 1 });
      expect(all).toMatchObject({ total: 2, total_pages: 2, counts: { all: 2, needs_recording: 1, upcoming: 1, completed: 0, cancelled: 0 } });
      expect(all.registers).toHaveLength(1);
      expect(all.registers[0]!.title).toBe("Earlier training");
      const upcoming = await workspace.list(f.user, f.schoolId, { date: f.today, page_size: 1, view: "upcoming" });
      expect(upcoming).toMatchObject({ total: 1, total_pages: 1, counts: { all: 2, upcoming: 1 } });
      expect(upcoming.registers[0]!.title).toBe("Later training");
      const search = await workspace.list(f.user, f.schoolId, { date: f.today, search: "Later", kind: "training", page_size: 1 });
      expect(search).toMatchObject({ total: 1, counts: { all: 1, upcoming: 1 }, available_kinds: [{ kind: "training", count: 1 }] });
      f.setNow(`${f.today}T07:00:00Z`);
      expect((await workspace.list(f.user, f.schoolId, { date: f.today, page_size: 1 })).counts.needs_recording).toBe(2);
      await expect(workspace.list({ ...f.user, active_school_id: randomUUID() }, f.schoolId, { date: f.today })).rejects.toThrow("Choose this institution");
    });
  });

  it("retains an original pending QR report and reviews it without inventing its missing signer",async()=>{
    const {schoolId,user,run,today,sessionId,initial}=await academicLessonFixture();
    await run(async()=>{
      await expect(db.transaction().execute(async(tx)=>{
        // Seed only the historical source fixture, restoring its immutable
        // guard before invoking the application. Final rejection rolls back.
        await sql`ALTER TABLE attendance_session_evidence_legacy_source DISABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        const metadata={operating_rule_revision:1,self_check_in_mode:'staff_review',retained_provider_detail:'source retained unchanged'};
        const retained=(await sql<{id:string}>`INSERT INTO attendance_session_evidence_legacy_source(school_id,session_id,student_id,
          capture_channel,state,observed_at,submitted_by,provider_reference,metadata,created_at,updated_at)
          VALUES(${schoolId}::uuid,${sessionId}::uuid,${initial.roster[0]!.id}::uuid,'student_qr','pending',
            ${new Date(`${today}T03:45:00Z`)},NULL,'Retained expired challenge',${JSON.stringify(metadata)}::jsonb,
            ${new Date(`${today}T03:46:00Z`)},${new Date(`${today}T03:46:00Z`)}) RETURNING id`.execute(tx)).rows[0]!;
        await sql`ALTER TABLE attendance_session_evidence_legacy_source ENABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        const prepared=await academic.prepareSessionInTransaction(tx,user,schoolId,sessionId,true);
        const before=await service.detail(user,schoolId,prepared.register_id,tx);
        expect(before.counts).toMatchObject({recorded:0,unrecorded:2,absent:0});
        expect(before.pending_evidence).toHaveLength(1);
        expect(before.pending_evidence[0]).toMatchObject({id:retained.id,capture_channel:'self_check_in',observed_at:`${today}T03:45:00.000Z`});
        const source=(await sql<{submitted_by:string|null;legacy_snapshot:{metadata:unknown};observation_id:string|null}>`SELECT submitted_by,legacy_snapshot,observation_id
          FROM activity_attendance_evidence WHERE id=${retained.id}::uuid`.execute(tx)).rows[0]!;
        expect(source.submitted_by).toBeNull();
        expect(source.observation_id).toBeNull();
        expect(source.legacy_snapshot.metadata).toEqual(metadata);
        expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_observations WHERE school_id=${schoolId}::uuid`.execute(tx)).rows[0]!.count).toBe(0);
        const reviewed=await service.decideEvidence(user,schoolId,prepared.register_id,retained.id,
          {expected_revision:0,decision:'accepted',reason:'Reviewed the retained source and confirmed this participant'},request(user),tx) as typeof before;
        expect(reviewed.counts).toMatchObject({present:1,recorded:1,unrecorded:1,absent:0});
        expect(reviewed.pending_evidence).toHaveLength(0);
        const view=(await sql<{state:string;submitted_by:string|null;decided_by:string;observed_at:Date}>`SELECT state,submitted_by,decided_by,observed_at
          FROM attendance_session_evidence WHERE id=${retained.id}::uuid`.execute(tx)).rows[0]!;
        expect(view).toEqual({state:'accepted',submitted_by:null,decided_by:user.id,observed_at:new Date(`${today}T03:45:00Z`)});
        expect((await sql<{state:string}>`SELECT state FROM attendance_session_evidence_legacy_source WHERE id=${retained.id}::uuid`.execute(tx)).rows[0]!.state).toBe('pending');
        const observations=(await sql<{state:string;observed_at:Date;kind:string}>`SELECT state,observed_at,kind FROM campus_model_observations
          WHERE school_id=${schoolId}::uuid`.execute(tx)).rows;
        expect(observations).toEqual([{state:'accepted',observed_at:new Date(`${today}T03:45:00Z`),kind:'attendance.participation_observed'}]);
        const receipt=(await sql<{counts:{evidence:number}}>`SELECT counts FROM activity_attendance_import_receipts
          WHERE register_id=${prepared.register_id}::uuid`.execute(tx)).rows[0]!;
        expect(receipt.counts.evidence).toBe(1);
        await sql`UPDATE attendance_session_evidence_legacy_source SET state='accepted' WHERE id=${retained.id}::uuid`.execute(tx);
      })).rejects.toThrow('append-only');
    });
  },60000);

  it("imports historical identity, unknown observation time and receipts without manufacturing observations",async() => {
    const fixtureData=await fixture(),{schoolId,user,run,today}=fixtureData;
    await run(async() => {
      const configured=await new ProgressiveSetupService(applicationDb,core,core,core).setupAttendance(user,schoolId,
        {group_name:"History class",participant_names:["Retained One","Retained Two"],
          responsible:{kind:"current_user",self_teaches:true,display_name:"History Owner"},
          session:{starts_at:"09:00",ends_at:"10:00",weekdays:[1,2,3,4,5,6,7]}},request(user));
      const classId=configured.resources.class_section_id,initial=await school.teacherAttendanceScreen(user,classId,today);
      // Controlled PRE-cutover source fixture, entirely inside a transaction.
      // Restore archive guards before exercising any application service. The
      // deliberately rejected final write rolls this fixture back in full.
      await expect(db.transaction().execute(async(tx) => {
        const legacyRegister=(await sql<{id:string}>`INSERT INTO attendance_registers(school_id,class_section_id,term_id,date,state,revision,submitted_by,submitted_at)
          VALUES(${schoolId}::uuid,${classId}::uuid,${initial.class.term_id}::uuid,${today}::date,'submitted',2,${user.id}::uuid,${executionNow()}) RETURNING id`.execute(tx)).rows[0]!;
        await sql`ALTER TABLE attendance_records_legacy_source DISABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        const original=(await sql<{id:string}>`INSERT INTO attendance_records_legacy_source(student_id,class_section_id,date,status,remarks,marked_by,revision)
          VALUES(${initial.roster[0]!.id}::uuid,${classId}::uuid,${today}::date,'late','Retained signed source',NULL,2) RETURNING id`.execute(tx)).rows[0]!;
        await sql`ALTER TABLE attendance_records_legacy_source ENABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        await sql`ALTER TABLE attendance_submissions_legacy_source DISABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        const legacySubmission=(await sql<{id:string}>`INSERT INTO attendance_submissions_legacy_source(school_id,class_section_id,term_id,date,submitted_by,idempotency_key,request_hash,request_id,register_revision,records_count,changed_count)
          VALUES(${schoolId}::uuid,${classId}::uuid,${initial.class.term_id}::uuid,${today}::date,${user.id}::uuid,${randomUUID()},${'0'.repeat(64)},${randomUUID()}::uuid,2,1,1) RETURNING id`.execute(tx)).rows[0]!;
        await sql`ALTER TABLE attendance_submissions_legacy_source ENABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        await sql`ALTER TABLE attendance_record_revisions_legacy_source DISABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        const originalRevision=(await sql<{id:string}>`INSERT INTO attendance_record_revisions_legacy_source(attendance_record_id,attendance_submission_id,attendance_register_id,
          school_id,student_id,class_section_id,date,previous_status,new_status,new_remarks,reason,changed_by,request_id,register_revision)
          VALUES(${original.id}::uuid,${legacySubmission.id}::uuid,${legacyRegister.id}::uuid,${schoolId}::uuid,${initial.roster[0]!.id}::uuid,
            ${classId}::uuid,${today}::date,NULL,'late','Retained signed source','Original signed source',${user.id}::uuid,${randomUUID()}::uuid,2) RETURNING id::text`.execute(tx)).rows[0]!;
        await sql`ALTER TABLE attendance_record_revisions_legacy_source ENABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        await recordAttendanceModelObservations({ingress:core,transaction:tx,schoolId,classSectionId:classId,date:today,actorUserId:user.id,
          sourceType:'attendance.daily',sourceRef:legacySubmission.id,state:'accepted',receivedAt:executionNow(),participationScope:'daily_class',records:[
            {studentId:initial.roster[0]!.id,sourceRecordId:originalRevision.id,status:'late',observedAt:executionNow(),captureSource:'staff_roll_call',
              evidenceRefs:[`attendance_record_revision:${originalRevision.id}`],domainEventId:null,decisionProvenance:'retained_fixture_source'}]});
        const transactionalDb=new Proxy(tx,{get(target,key){if(key==='transaction') return()=>({execute:<T>(callback:(transaction:Transaction<Database>)=>Promise<T>)=>callback(target)});
          const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}) as unknown as DatabaseService;
        const kernel=new ActivityAttendanceService(transactionalDb,core,core,core,core,core),bridge=new AcademicParticipationBridge(transactionalDb,kernel);
        const ownSchool=new SchoolService(transactionalDb,events,{}as StaffCoverageReconciliationPort,core,undefined,undefined,undefined,bridge);
        const ownSessions=new AttendanceModelService(transactionalDb,events,kernel,bridge,core,core);
        new AcademicParticipationEffects(kernel,ownSchool,ownSessions,events);
        const prepared=await bridge.prepareDailyInTransaction(tx,user,schoolId,classId,today,true);
        const retained=await kernel.detail(user,schoolId,prepared.register_id,tx);
        expect(retained.register).toMatchObject({state:'submitted',revision:2});
        expect(retained.counts).toMatchObject({late:1,unrecorded:1,absent:0});
        const sourceEntry=(await sql<{id:string;observed_at:Date|null;recorded_by:string|null}>`SELECT id,observed_at,recorded_by FROM activity_attendance_entries
          WHERE register_id=${prepared.register_id}::uuid`.execute(tx)).rows[0]!;
        expect(sourceEntry).toEqual({id:original.id,observed_at:null,recorded_by:null});
        const observationCount=async()=>(await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_observations
          WHERE school_id=${schoolId}::uuid`.execute(tx)).rows[0]!.count;
        expect(await observationCount()).toBe(1);
        await kernel.marksInTransaction(tx,user,schoolId,prepared.register_id,{expected_revision:2,reason:'Checked the corrected signed source',
          records:[{person_id:retained.roster.find((person)=>person.status==='late')!.person_id,status:'present'}]},request(user));
        expect(await observationCount()).toBe(2);
        expect((await sql<{state:string}>`SELECT state FROM campus_model_observations WHERE school_id=${schoolId}::uuid
          AND source_type='attendance.daily' AND source_ref=${legacySubmission.id}`.execute(tx)).rows[0]!.state).toBe('superseded');
        expect((await sql<{status:string}>`SELECT status FROM attendance_records_legacy_source WHERE id=${original.id}::uuid`.execute(tx)).rows[0]!.status).toBe('late');
        expect((await sql<{status:string}>`SELECT status FROM attendance_records WHERE id=${original.id}::uuid`.execute(tx)).rows[0]!.status).toBe('present');
        const receipt=(await sql<{counts:{entries:number;revisions:number;submissions:number}}>`SELECT counts FROM activity_attendance_import_receipts
          WHERE register_id=${prepared.register_id}::uuid`.execute(tx)).rows[0]!;
        expect(receipt.counts).toMatchObject({entries:1,revisions:1,submissions:1});
        await sql`UPDATE attendance_records_legacy_source SET status='absent' WHERE id=${original.id}::uuid`.execute(tx);
      })).rejects.toThrow('append-only');
    });
  },60000);

  it("submits a fresh academic class through the same accepted writer and legacy UI contract", async () => {
    const fixtureData = await fixture(), {schoolId,user,run,today} = fixtureData;
    const setup = new ProgressiveSetupService(applicationDb,core,core,core);
    await run(async() => {
      const configured = await setup.setupAttendance(user,schoolId,{group_name:"Common class",participant_names:["Academic One","Academic Two"],
        responsible:{kind:"current_user",self_teaches:true,display_name:"Participation Owner"},
        session:{starts_at:"09:00",ends_at:"10:00",weekdays:[1,2,3,4,5,6,7]}},request(user));
      const classId = configured.resources.class_section_id;
      const initial = await school.teacherAttendanceScreen(user,classId,today);
      expect(initial.roster).toHaveLength(2);
      const queue = await workspace.list(user,schoolId,{date:today,page_size:1});
      expect(queue.registers[0]).toMatchObject({source_kind:'daily_class',entry_mode:'participation',recorded_count:0});
      expect(queue.registers[0]!.id).not.toMatch(/^legacy:/);
      const saveRequest = request(user);
      const input = {class_section_id:classId,date:today,expected_revision:0,
        records:initial.roster.map((person) => ({student_id:person.id,status:"present"}))};
      const submitted = await school.saveTeacherAttendance(user,input,saveRequest) as typeof initial;
      expect(submitted.register).toMatchObject({state:"submitted",revision:1});
      expect(submitted.roster.every((person) => person.status==='present')).toBe(true);
      expect(await school.saveTeacherAttendance(user,input,saveRequest)).toEqual(JSON.parse(JSON.stringify(submitted)));
      const source = (await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts
        WHERE school_id=${schoolId}::uuid AND source_kind='daily_class' AND state='active'`.execute(db)).rows[0]!;
      expect((await service.detail(user,schoolId,source.register_id)).register.source_kind).toBe('daily_class');
      const counts = (await sql<{current:number;archive:number;commands:number;receipts:number}>`SELECT
        (SELECT count(*)::int FROM attendance_records WHERE class_section_id=${classId}::uuid) AS current,
        (SELECT count(*)::int FROM attendance_records_legacy_source WHERE class_section_id=${classId}::uuid) AS archive,
        (SELECT count(*)::int FROM activity_attendance_commands WHERE register_id=${source.register_id}::uuid) AS commands,
        (SELECT count(*)::int FROM activity_attendance_context_receipts WHERE school_id=${schoolId}::uuid) AS receipts`.execute(db)).rows[0]!;
      expect(counts).toEqual({current:2,archive:0,commands:1,receipts:1});
      await school.setAttendanceRegisterLock(user,classId,true,{date:today},request(user));
      expect((await service.detail(user,schoolId,source.register_id)).register.state).toBe('locked');
      await expect(school.saveTeacherAttendance(user,{...input,expected_revision:2},request(user))).rejects.toThrow('final');
      await school.setAttendanceRegisterLock(user,classId,false,{date:today,reason:"Recheck the signed source"},request(user));
      expect((await service.detail(user,schoolId,source.register_id)).register).toMatchObject({state:'submitted',revision:3});
      const history = await school.attendanceRegisterHistory(user,classId,today);
      expect(history.submissions).toHaveLength(1);
      expect(history.revisions).toHaveLength(2);
      await service.marks(user,schoolId,source.register_id,{expected_revision:3,reason:"Rechecked the first person's source",
        records:[{person_id:(await sql<{person_id:string}>`SELECT person_id FROM activity_attendance_academic_roster
          WHERE register_id=${source.register_id}::uuid AND student_id=${initial.roster[0]!.id}::uuid`.execute(db)).rows[0]!.person_id,status:'late'}]},request(user));
      expect((await school.teacherAttendanceScreen(user,classId,today)).roster.find((person) => person.id===initial.roster[0]!.id)!.status).toBe('late');
      const eventsForCorrection = (await sql<{count:number}>`SELECT count(*)::int AS count FROM event_outbox
        WHERE school_id=${schoolId}::uuid AND event_type='attendance.updated'`.execute(db)).rows[0]!.count;
      expect(eventsForCorrection).toBeGreaterThan(0);
      // A COW transaction can own an exclusive store lease. Any nested base
      // connection would wait for that same lease forever. Reject acquiring
      // one here, proving screen composition and all accepted effects use tx.
      const baseConnectionForbidden=new Proxy(applicationDb,{get(target,key){
        if(['selectFrom','insertInto','updateTable','deleteFrom','transaction','getExecutor'].includes(String(key))) {
          return()=>{throw new Error('A nested base connection escaped the attendance transaction');};
        }
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const singleConnectionKernel=new ActivityAttendanceService(baseConnectionForbidden,core,core,core,core,core);
      const singleConnectionBridge=new AcademicParticipationBridge(baseConnectionForbidden,singleConnectionKernel);
      const singleConnectionSchool=new SchoolService(baseConnectionForbidden,events,{}as StaffCoverageReconciliationPort,core,
        undefined,undefined,undefined,singleConnectionBridge);
      const singleConnectionSessions=new AttendanceModelService(baseConnectionForbidden,events,singleConnectionKernel,singleConnectionBridge,core,core);
      new AcademicParticipationEffects(singleConnectionKernel,singleConnectionSchool,singleConnectionSessions,events);
      const withinTransaction=await db.transaction().execute((tx)=>singleConnectionSchool.saveTeacherAttendanceInTransaction(tx,user,
        {...input,expected_revision:4,reason:'Checked the final signed source'},request(user)));
      expect(withinTransaction.register.revision).toBe(5);
    });
  },60000);

  it("converges scheduled lesson submission, corrections and final review onto the same kernel",async() => {
    const {schoolId,user,run,sessionId,initial}=await academicLessonFixture();
    await run(async()=>{
      expect(initial.availability.can_mark).toBe(true);
      const saveRequest=request(user),input={expected_revision:0,records:initial.roster.map((person:{id:string})=>({student_id:person.id,status:'present'}))};
      const submitted=await sessions.save(user,sessionId,input,saveRequest);
      expect(submitted.register).toMatchObject({state:'submitted',revision:1,id:sessionId});
      expect(await sessions.save(user,sessionId,input,saveRequest)).toEqual(JSON.parse(JSON.stringify(submitted)));
      const source=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts WHERE school_id=${schoolId}::uuid
        AND source_kind='scheduled_session' AND source_id=${sessionId} AND state='active'`.execute(db)).rows[0]!;
      const common=await service.detail(user,schoolId,source.register_id);
      expect(common.counts).toMatchObject({recorded:2,unrecorded:0,present:2});
      await sessions.setLock(user,sessionId,true,{},request(user));
      expect((await service.detail(user,schoolId,source.register_id)).register.state).toBe('locked');
      await sessions.setLock(user,sessionId,false,{reason:'Review the lesson source'},request(user));
      const corrected=await sessions.save(user,sessionId,{expected_revision:3,reason:'Checked the corrected lesson source',
        records:initial.roster.map((person:{id:string},index:number)=>({student_id:person.id,status:index===0?'late':'present'}))},request(user));
      expect(corrected.register).toMatchObject({state:'submitted',revision:4});
      expect((await sessions.history(user,sessionId)).submissions).toHaveLength(2);
      const counts=(await sql<{archive:number;current:number;common:number}>`SELECT
        (SELECT count(*)::int FROM attendance_session_entries_legacy_source WHERE session_id=${sessionId}::uuid) AS archive,
        (SELECT count(*)::int FROM attendance_session_entries WHERE session_id=${sessionId}::uuid) AS current,
        (SELECT count(*)::int FROM activity_attendance_entries WHERE register_id=${source.register_id}::uuid) AS common`.execute(db)).rows[0]!;
      expect(counts).toEqual({archive:0,current:2,common:2});
    });
  },60000);

  it("supersedes every earlier correction and withdraws a draft observation without inventing absence", async () => {
    const fixtureData = await fixture(), { schoolId, user, people, run } = fixtureData;
    const { registerId } = await fixtureData.create();
    await run(async () => {
      for (const [revision, status] of (["present", "late", "excused"] as const).entries()) {
        await service.marks(user, schoolId, registerId, { expected_revision: revision,
          ...(revision ? { reason: "Checked the corrected source" } : {}),
          records: [{ person_id: people[0], status }] }, request(user));
      }
      const observed = async () => (await sql<{ state: string; source_ref: string }>`SELECT state,source_ref
        FROM campus_model_observations WHERE school_id=${schoolId}::uuid AND kind='attendance.participation_observed'
        ORDER BY created_at,id`.execute(db)).rows;
      expect((await observed()).map((row) => row.state).sort()).toEqual(["accepted", "superseded", "superseded"]);
      const cleared = await service.marks(user, schoolId, registerId, { expected_revision: 3,
        reason: "Withdrawn pending source verification", records: [{ person_id: people[0], status: null }] }, request(user)) as Awaited<ReturnType<typeof service.detail>>;
      expect(cleared.counts).toMatchObject({ recorded: 0, absent: 0, unrecorded: 2 });
      expect((await observed()).map((row) => row.state)).toEqual(["superseded", "superseded", "superseded"]);
    });
  }, 60000);

  it("keeps reviewed capture acceptance inside the caller transaction and rejects a fabricated camera absence", async () => {
    const fixtureData = await fixture(), { schoolId, user, people, run, today } = fixtureData;
    const { registerId } = await fixtureData.create();
    await run(async () => {
      await expect(db.transaction().execute(async (tx) => {
        await service.marksInTransaction(tx, user, schoolId, registerId,
          { expected_revision: 0, records: [{ person_id: people[0], status: "present" }] }, request(user),
          { [people[0]!]: { capture_channel: "offline_paper", observed_at: new Date(`${today}T03:45:00Z`), evidence_refs: ["paper_capture:reviewed-source"] } });
        throw new Error("Capture receipt could not be retained");
      })).rejects.toThrow("receipt");
      expect((await service.detail(user, schoolId, registerId)).register.revision).toBe(0);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM activity_attendance_commands
        WHERE register_id=${registerId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      await expect(db.transaction().execute((tx) => service.marksInTransaction(tx, user, schoolId, registerId,
        { expected_revision: 0, records: [{ person_id: people[0], status: "absent" }] }, request(user),
        { [people[0]!]: { capture_channel: "camera_assisted", observed_at: new Date(`${today}T03:45:00Z`), evidence_refs: ["photo_attendance_session:reviewed-source"] } }))).rejects.toThrow("Camera");
      expect((await service.detail(user, schoolId, registerId)).counts.recorded).toBe(0);
    });
  }, 60000);

  it("records no-account mixed people, requires complete submission, corrects with history and retains exact idempotency", async () => {
    const fixtureData = await fixture(), { schoolId, user, people, run } = fixtureData;
    const { registerId } = await fixtureData.create();
    await run(async () => {
      const initial = await service.detail(user, schoolId, registerId);
      expect(initial.counts).toMatchObject({ participants: 2, recorded: 0, unrecorded: 2, absent: 0 });
      expect(initial.register.policy).toMatchObject({ finalization_mode: "principal_review", configuration_state: "manual_fallback" });
      const firstRequest = request(user);
      const firstInput = { expected_revision: 0, records: [{ person_id: people[0], status: "present" }] };
      const saved = await service.marks(user, schoolId, registerId, firstInput, firstRequest) as typeof initial;
      expect(saved.counts).toMatchObject({ recorded: 1, unrecorded: 1, absent: 0 });
      expect(await service.marks(user, schoolId, registerId, firstInput, firstRequest)).toEqual(saved);
      await expect(service.marks(user, schoolId, registerId, { ...firstInput, records: [{ person_id: people[0], status: "absent" }] }, firstRequest)).rejects.toThrow("different attendance");
      await expect(service.transition(user, schoolId, registerId, "submit", { expected_revision: 1 }, request(user))).rejects.toThrow("required participant");
      await expect(service.marks(user, schoolId, registerId, { expected_revision: 0, records: [{ person_id: people[1], status: "late" }] }, request(user))).rejects.toThrow("changed");
      await service.marks(user, schoolId, registerId, { expected_revision: 1, records: [{ person_id: people[1], status: "late" }] }, request(user));
      const submitted = await service.transition(user, schoolId, registerId, "submit", { expected_revision: 2 }, request(user)) as typeof initial;
      expect(submitted.register).toMatchObject({ state: "submitted", revision: 3, auto_finalize_at: null });
      await expect(service.marks(user, schoolId, registerId, { expected_revision: 3, records: [{ person_id: people[0], status: "absent" }] }, request(user))).rejects.toThrow("reason");
      const corrected = await service.marks(user, schoolId, registerId, { expected_revision: 3, reason: "Corrected the signed register", records: [{ person_id: people[0], status: "absent" }] }, request(user)) as typeof initial;
      expect(corrected.register.revision).toBe(4);
      await service.transition(user, schoolId, registerId, "finalize", { expected_revision: 4 }, request(user));
      await expect(service.marks(user, schoolId, registerId, { expected_revision: 5, reason: "Correction needs review", records: [{ person_id: people[0], status: "present" }] }, request(user))).rejects.toThrow("final");
      await expect(service.transition(user, schoolId, registerId, "reopen", { expected_revision: 5 }, request(user))).rejects.toThrow("reason");
      await service.transition(user, schoolId, registerId, "reopen", { expected_revision: 5, reason: "Review the reported discrepancy" }, request(user));
      const history = await service.history(user, schoolId, registerId, { page: 1, page_size: 2 });
      expect(history.history).toHaveLength(2);
      expect(history.total).toBeGreaterThan(2);
      const thread = (await sql<{ commands: number; observations: number; revisions: number; students: number }>`SELECT
        (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid AND command_type LIKE 'attendance.participation.%') AS commands,
        (SELECT count(*)::int FROM campus_model_observations WHERE school_id=${schoolId}::uuid AND kind='attendance.participation_observed') AS observations,
        (SELECT count(*)::int FROM activity_attendance_entry_revisions WHERE register_id=${registerId}::uuid) AS revisions,
        (SELECT count(*)::int FROM students WHERE school_id=${schoolId}::uuid) AS students`.execute(db)).rows[0]!;
      expect(thread).toEqual({ commands: 6, observations: 3, revisions: 3, students: 0 });
    });
  }, 60000);

  it("keeps one overnight register across midnight and does not infer authority from administrator membership", async () => {
    const fixtureData = await fixture(), { schoolId, user, run, today, setNow } = fixtureData;
    setNow(`${today}T17:30:00Z`);
    const { registerId, occurrence } = await fixtureData.create("Night activity", "22:00", "06:00", 1);
    await run(async () => {
      expect((await workspace.list(user, schoolId, { date: today })).registers.map((row) => row.id)).toContain(registerId);
      const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
      setNow(`${today}T20:00:00Z`);
      const nextDay = await workspace.list(user, schoolId, { date: tomorrow });
      expect(nextDay.registers.map((row) => row.id)).toContain(registerId);
      expect(nextDay.registers.find((row) => row.id === registerId)!.ends_at).toBe(occurrence.ends_at);
      await sql`DELETE FROM schedule_activity_occurrence_recorders WHERE school_id=${schoolId}::uuid AND occurrence_id=${occurrence.id}::uuid AND action='record'`.execute(db);
      const visible = await service.detail(user, schoolId, registerId);
      expect(visible.capabilities.can_record).toBe(false);
      await expect(service.marks(user, schoolId, registerId, { expected_revision: 0, records: [{ person_id: fixtureData.people[0], status: "present" }] }, request(user))).rejects.toThrow("current appointment");
    });
  }, 60000);

  it("retains pending paper evidence, requires an explicit review and rejects tenant/roster/future claims", async () => {
    const fixtureData = await fixture(), { schoolId, user, run, people, today } = fixtureData;
    const { registerId } = await fixtureData.create();
    await run(async () => {
      const pending = await service.evidence(user, schoolId, registerId, { expected_revision: 0, person_id: people[0],
        claimed_status: "present", capture_channel: "offline_paper", observed_at: `${today}T03:45:00Z`, source_reference: "Signed paper A", note: "Transcribed for review" }, request(user)) as Awaited<ReturnType<typeof service.detail>>;
      expect(pending.counts.recorded).toBe(0);
      expect(pending.pending_evidence).toHaveLength(1);
      const accepted = await service.decideEvidence(user, schoolId, registerId, pending.pending_evidence[0]!.id,
        { expected_revision: 1, decision: "accepted", reason: "Checked the signed source" }, request(user)) as typeof pending;
      expect(accepted.counts).toMatchObject({ present: 1, recorded: 1 });
      expect(accepted.pending_evidence).toHaveLength(0);
      await expect(service.evidence(user, schoolId, registerId, { expected_revision: 2, person_id: people[1],
        claimed_status: "present", capture_channel: "offline_paper", observed_at: `${today}T05:00:00Z`, note: "Future claim" }, request(user))).rejects.toThrow("future");
      const other = await executionEnvironmentStorage.exit(() => fixture());
      await expect(service.detail(other.user, schoolId, registerId)).rejects.toThrow("Choose this institution");
      await expect(service.marks(user, schoolId, registerId, { expected_revision: 2, records: [{ person_id: other.people[0], status: "present" }] }, request(user))).rejects.toThrow("reviewed participants");
    });
  }, 60000);

  it("atomically submits a reviewed roster and never finalizes unresolved evidence", async () => {
    const fixtureData = await fixture(), { schoolId, user, people, run, today } = fixtureData;
    const { registerId } = await fixtureData.create();
    await run(async () => {
      await expect(service.submitRecords(user, schoolId, registerId, { expected_revision: 0,
        records: [{ person_id: people[0], status: "present" }] }, request(user))).rejects.toThrow("required participant");
      const unchanged = await service.detail(user, schoolId, registerId);
      expect(unchanged.register.revision).toBe(0);
      expect(unchanged.counts.recorded).toBe(0);
      const submitted = await service.submitRecords(user, schoolId, registerId, { expected_revision: 0,
        records: people.map((person_id) => ({ person_id, status: "present" })) }, request(user)) as typeof unchanged;
      expect(submitted.register).toMatchObject({ state: "submitted", revision: 1 });
      const pending = await service.evidence(user, schoolId, registerId, { expected_revision: 1, person_id: people[0],
        claimed_status: "late", capture_channel: "offline_paper", observed_at: `${today}T03:45:00Z`, note: "Conflicting signed source" }, request(user)) as typeof unchanged;
      expect(pending.capabilities.can_finalize).toBe(false);
      await expect(service.transition(user, schoolId, registerId, "finalize", { expected_revision: 2 }, request(user))).rejects.toThrow("pending participation evidence");
      await service.decideEvidence(user, schoolId, registerId, pending.pending_evidence[0]!.id,
        { expected_revision: 2, decision: "rejected", reason: "The source referred to another day" }, request(user));
      const final = await service.transition(user, schoolId, registerId, "finalize", { expected_revision: 3 }, request(user)) as typeof unchanged;
      expect(final.register.state).toBe("locked");
    });
  }, 60000);

  it("runs only explicit automatic policy as a software actor without inventing a human review", async () => {
    const fixtureData = await fixture(), { schoolId, user, people, run, today, setNow } = fixtureData;
    await sql`INSERT INTO institution_operating_rules(school_id,updated_by,attendance_finalization_mode,attendance_auto_finalize_minutes)
      VALUES(${schoolId}::uuid,${user.id}::uuid,'automatic',10)`.execute(db);
    const { registerId } = await fixtureData.create();
    await run(async () => {
      const initial = await service.detail(user, schoolId, registerId);
      expect(initial.register.policy.configuration_state).toBe('configured');
      const submitted = await service.submitRecords(user, schoolId, registerId, { expected_revision: 0,
        records: people.map((person_id) => ({ person_id, status: "present" })) }, request(user)) as typeof initial;
      expect(submitted.register.auto_finalize_at).toBe(`${today}T04:10:00.000Z`);
      expect(await service.finalizeDue(schoolId)).toBe(0);
      setNow(`${today}T04:11:00Z`);
      expect(await service.finalizeDue(schoolId)).toBe(1);
      expect(await service.finalizeDue(schoolId)).toBe(0);
      expect((await service.detail(user, schoolId, registerId)).register).toMatchObject({ state: "locked", revision: 2 });
      const trace = (await sql<{ agent_kind: string; command_type: string; state: string; actor_id: string | null; locked_by: string | null }>`
        SELECT agent.agent_kind,command.command_type,command.state,audit.actor_id,register.locked_by
        FROM campus_model_commands command JOIN campus_model_agents agent ON agent.id=command.actor_agent_id AND agent.school_id=command.school_id
        JOIN activity_attendance_audits audit ON audit.school_id=command.school_id AND audit.register_id=${registerId}::uuid AND audit.action='automatic_finalize'
        JOIN activity_attendance_registers register ON register.id=audit.register_id
        WHERE command.school_id=${schoolId}::uuid AND command.command_type='attendance.participation.automatic_finalize'`.execute(db)).rows[0]!;
      expect(trace).toEqual({ agent_kind: "software", command_type: "attendance.participation.automatic_finalize", state: "accepted", actor_id: null, locked_by: null });
    });
  }, 60000);
});
