import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, types } from "pg";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { simulationFunctionDefinition } from "../src/database/simulation-branch.driver.js";
import type { SimulationBranch } from "../src/database/simulation-branch.driver.js";
import { completeParticipationCapture, completeParticipationPhoto, findAcademicAttendanceDecision,
  findAcademicParticipationRegister, findParticipationAcceptance, validateParticipationPhoto } from "../src/attendance/participation-continuity.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { CoordinationService } from "../src/coordination/coordination.service.js";
import { FollowupModelBridgeService } from "../src/coordination/followup-model-bridge.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import type { AuthenticatedRequest } from "../src/common/request.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
types.setTypeParser(1082, (value) => value);
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused", max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const core = new CampusModelCoreService(db as DatabaseService);
const provisioner = new ProgressiveWorkspaceProvisioner(core);
afterAll(async () => db.destroy());

async function fixture(tx: Transaction<Database>) {
  const suffix = randomUUID();
  const actor = await tx.insertInto("users").values({ username: `continuity-${suffix}`, email: `continuity-${suffix}@example.test`,
    password_hash: "isolated-test-only", first_name: "Continuity", last_name: "Owner", role: "admin" })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await provisioner.createForAccount(tx, actor, "UTC");
  const person = (await sql<{ id: string }>`INSERT INTO school_people(school_id,first_name) VALUES(${schoolId}::uuid,'Passive participant') RETURNING id`.execute(tx)).rows[0]!;
  const student = (await sql<{ id: string }>`INSERT INTO students(school_id,person_id,admission_number)
    VALUES(${schoolId}::uuid,${person.id}::uuid,'ISOLATED-PARTICIPANT') RETURNING id`.execute(tx)).rows[0]!;
  const term = (await sql<{ id: string }>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on)
    VALUES(${schoolId}::uuid,'2026-2027','Fixture term','2026-01-01','2026-12-31') RETURNING id`.execute(tx)).rows[0]!;
  const section = (await sql<{ id: string }>`INSERT INTO class_sections(school_id,academic_year,grade,section)
    VALUES(${schoolId}::uuid,'2026-2027','Fixture','A') RETURNING id`.execute(tx)).rows[0]!;
  const enrollment = (await sql<{ id: string }>`INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on)
    VALUES(${student.id}::uuid,${section.id}::uuid,${term.id}::uuid,1,'2026-01-01') RETURNING id`.execute(tx)).rows[0]!;
  const date = new Date().toISOString().slice(0, 10), occurrenceId = randomUUID(), registerId = randomUUID();
  await sql`INSERT INTO schedule_activity_occurrences(id,school_id,activity_id,period_id,source,source_ref,source_revision,title,
    purpose,local_date,starts_at,ends_at,timezone,attendance_mode,context_kind,context_ref,term_id)
    VALUES(${occurrenceId}::uuid,${schoolId}::uuid,${section.id}::uuid,NULL,'academic',${`daily:${section.id}:${term.id}`},1,
      'Daily fixture','teaching',${date}::date,${`${date}T00:00:00Z`}::timestamptz,${`${date}T23:59:00Z`}::timestamptz,
      'UTC','roll_call','academic_class',${section.id}::uuid,${term.id}::uuid)`.execute(tx);
  await sql`INSERT INTO activity_attendance_registers(id,school_id,occurrence_id,roster_fingerprint,roster_source_revision,
    policy_revision,policy_snapshot) VALUES(${registerId}::uuid,${schoolId}::uuid,${occurrenceId}::uuid,${"a".repeat(64)},1,1,'{}'::jsonb)`.execute(tx);
  await sql`INSERT INTO activity_attendance_roster(school_id,register_id,person_id,label,participation_role,requirement,source_kind,source_ref,source_revision)
    VALUES(${schoolId}::uuid,${registerId}::uuid,${person.id}::uuid,'Passive participant','participant','required','class',${enrollment.id},1)`.execute(tx);
  await sql`UPDATE activity_attendance_roster SET academic_student_id=${student.id}::uuid,
    academic_enrollment_id=${enrollment.id}::uuid,academic_source_revision=1
    WHERE register_id=${registerId}::uuid AND person_id=${person.id}::uuid`.execute(tx);
  // A local adapter fixture, not evidence that a production context was cut over.
  await sql`UPDATE activity_attendance_registers SET context_source_kind='daily_class',context_source_id=${`${section.id}:${term.id}:${date}`},
    context_imported_revision=0,context_imported_at=now(),context_state='active',context_activated_at=now(),
    context_snapshot=${JSON.stringify({ context: { class_id: section.id, term_id: term.id, date, legacy_register_id: null } })}::jsonb
    WHERE id=${registerId}::uuid AND school_id=${schoolId}::uuid`.execute(tx);
  const photoId = randomUUID();
  await sql`INSERT INTO photo_attendance_sessions(id,school_id,class_section_id,term_id,date,period,provider_session_id,captured_by,
    capture_authorization_reference,roster_count,model_id,analysis_summary,observed_at,expires_at)
    VALUES(${photoId}::uuid,${schoolId}::uuid,${section.id}::uuid,${term.id}::uuid,${date}::date,'Daily',${`fixture-${photoId}`},
      ${actor.id}::uuid,'Isolated authorized fixture',1,'fixture-only',${JSON.stringify({ matched_student_ids: [student.id] })}::jsonb,
      now()-interval '1 minute',now()+interval '1 day')`.execute(tx);
  const commandId = randomUUID(), key = randomUUID();
  await sql`INSERT INTO activity_attendance_commands(id,school_id,register_id,actor_id,operation,idempotency_key,request_hash,request_id,register_revision,result_body)
    VALUES(${commandId}::uuid,${schoolId}::uuid,${registerId}::uuid,${actor.id}::uuid,'submit',${key},${"b".repeat(64)},
      ${randomUUID()}::uuid,1,'{"fixture":"immutable-command-result"}'::jsonb)`.execute(tx);
  return { actor, schoolId, personId: person.id, studentId: student.id, termId: term.id, classId: section.id, date, registerId, photoId, commandId, key };
}

async function rollbackFixture(action: (tx: Transaction<Database>, value: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const done = new Error("rollback isolated fixture");
  try { await db.transaction().execute(async (tx) => { await action(tx, await fixture(tx)); throw done; }); }
  catch (error) { if (error !== done) throw error; }
}

describe.skipIf(!enabled)("participation continuity references with real PostgreSQL", () => {
  it("binds reviewed photo and capture to one neutral command, retaining its immutable result and no fake archive row", async () => {
    await rollbackFixture(async (tx, value) => {
      const { schoolId, classId, termId, date, registerId, actor, photoId, commandId, key } = value;
      expect(await findAcademicParticipationRegister(tx, { school_id: schoolId, class_section_id: classId, term_id: termId, date })).toEqual({ register_id: registerId });
      const photo = await validateParticipationPhoto(tx, { school_id: schoolId, class_section_id: classId, date,
        photo_session_id: photoId, actor_id: actor.id, register_id: registerId });
      expect(photo.matched_student_ids).toEqual([value.studentId]);
      expect(photo.evidence_ref).toBe(`photo_attendance_session:${photoId}`);
      await completeParticipationPhoto(tx, photoId, commandId, registerId);
      expect((await sql`SELECT state,applied_submission_id,applied_session_submission_id,applied_participation_command_id
        FROM photo_attendance_sessions WHERE id=${photoId}::uuid`.execute(tx)).rows[0]).toEqual({ state: "applied",
        applied_submission_id: null, applied_session_submission_id: null, applied_participation_command_id: commandId });
      const acceptance = await findParticipationAcceptance(tx, schoolId, actor.id, key);
      expect(acceptance?.id).toBe(commandId);
      const batch = (await sql<{ id: string }>`INSERT INTO attendance_capture_batches(school_id,class_section_id,term_id,date,source,
        source_reference,recorded_by,idempotency_key,request_hash,roster_fingerprint,roster_count,expected_register_revision,
        observed_at,roster_captured_at,roster_expires_at) VALUES(${schoolId}::uuid,${classId}::uuid,${termId}::uuid,${date}::date,'paper',
          'Signed fixture',${actor.id}::uuid,${key},${"c".repeat(64)},${"d".repeat(64)},1,0,now()-interval '1 minute',now()-interval '2 minutes',now()+interval '1 day') RETURNING id`.execute(tx)).rows[0]!;
      await completeParticipationCapture(tx, { batch_id: batch.id, command_id: commandId, register_id: registerId,
        result_body: { legacy_screen: "retained at acceptance" }, resolved_by: actor.id, resolution_note: "Checked the signed paper" });
      expect((await sql`SELECT status,accepted_submission_id,accepted_participation_command_id,accepted_result_body
        FROM attendance_capture_batches WHERE id=${batch.id}::uuid`.execute(tx)).rows[0]).toEqual({ status: "accepted",
        accepted_submission_id: null, accepted_participation_command_id: commandId, accepted_result_body: { legacy_screen: "retained at acceptance" } });
      expect((await findParticipationAcceptance(tx, schoolId, actor.id, key))?.result_body).toEqual({ fixture: "immutable-command-result" });
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM attendance_submissions_legacy_source WHERE school_id=${schoolId}::uuid`.execute(tx)).rows[0]?.count).toBe(0);
    });
  }, 30000);

  it("rechecks photo expiry, exact context and current authority instead of reusing an earlier screen grant", async () => {
    await rollbackFixture(async (tx, value) => {
      const input = { school_id: value.schoolId, class_section_id: value.classId, date: value.date,
        photo_session_id: value.photoId, actor_id: value.actor.id, register_id: value.registerId };
      await expect(validateParticipationPhoto(tx, { ...input, register_id: randomUUID() })).rejects.toThrow("exact attendance register");
      await sql`UPDATE photo_attendance_sessions SET expires_at=now()-interval '1 second' WHERE id=${value.photoId}::uuid`.execute(tx);
      await expect(validateParticipationPhoto(tx, input)).rejects.toThrow("expired");
      await sql`UPDATE photo_attendance_sessions SET expires_at=now()+interval '1 day' WHERE id=${value.photoId}::uuid`.execute(tx);
      await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${value.schoolId}::uuid AND user_id=${value.actor.id}::uuid`.execute(tx);
      await expect(validateParticipationPhoto(tx, input)).rejects.toThrow("current assignment");
      expect((await sql<{ state: string }>`SELECT state FROM photo_attendance_sessions WHERE id=${value.photoId}::uuid`.execute(tx)).rows[0]?.state).toBe("analyzed");
    });
  }, 30000);

  it("rejects a valid command from another institution at the evidence foreign-key boundary", async () => {
    await rollbackFixture(async (tx, value) => {
      const other = await fixture(tx);
      await sql`SAVEPOINT invalid_photo_reference`.execute(tx);
      await expect(completeParticipationPhoto(tx, value.photoId, other.commandId, value.registerId))
        .rejects.toThrow("does not match its school and register");
      await sql`ROLLBACK TO SAVEPOINT invalid_photo_reference`.execute(tx);
      expect((await sql<{ state: string }>`SELECT state FROM photo_attendance_sessions WHERE id=${value.photoId}::uuid`.execute(tx)).rows[0]?.state).toBe("analyzed");
      expect(await findParticipationAcceptance(tx, value.schoolId, value.actor.id, other.key)).toBeNull();
    });
  }, 30000);

  it("resolves a common academic decision and its withdrawal without borrowing archived absence", async () => {
    await rollbackFixture(async (tx, value) => {
      const entry = (await sql<{ id: string }>`INSERT INTO activity_attendance_entries(school_id,register_id,person_id,status,
        remarks,capture_channel,observed_at,recorded_by,revision) VALUES(${value.schoolId}::uuid,${value.registerId}::uuid,
          ${value.personId}::uuid,'absent','','human_roll_call',now(),${value.actor.id}::uuid,1) RETURNING id`.execute(tx)).rows[0]!;
      const input = { school_id: value.schoolId, student_id: value.studentId, date: value.date };
      expect(await findAcademicAttendanceDecision(tx, input)).toMatchObject({ id: entry.id, status: "absent", store: "participation" });
      await sql`UPDATE activity_attendance_entries SET status=NULL,revision=2 WHERE id=${entry.id}::uuid`.execute(tx);
      expect(await findAcademicAttendanceDecision(tx, input)).toMatchObject({ id: entry.id, status: null, revision: 2 });
    });
  }, 30000);

  it("opens and resolves an academic follow-up through its existing service using only the neutral accepted entry", async () => {
    await rollbackFixture(async (tx, value) => {
      const entry = (await sql<{ id: string }>`INSERT INTO activity_attendance_entries(school_id,register_id,person_id,status,
        remarks,capture_channel,observed_at,recorded_by,revision) VALUES(${value.schoolId}::uuid,${value.registerId}::uuid,
          ${value.personId}::uuid,'absent','','human_roll_call',now(),${value.actor.id}::uuid,1) RETURNING id`.execute(tx)).rows[0]!;
      // Keep the ordinary service's transaction boundary inside this test's
      // rollback-only transaction, without changing its queries or rules.
      const scoped = new Proxy(tx, { get(target, property) {
        if (property === "transaction") return () => ({ execute: (action: (db: Transaction<Database>) => Promise<unknown>) => action(tx) });
        const result = Reflect.get(target, property, target);
        return typeof result === "function" ? result.bind(target) : result;
      } }) as unknown as DatabaseService;
      const coordination = new CoordinationService(scoped, new SchoolEventService(scoped, core), new FollowupModelBridgeService(core, core, core));
      const req = { authUser: { ...value.actor, active_school_id: value.schoolId }, requestId: randomUUID() } as AuthenticatedRequest;
      const body = { student_id: value.studentId, attendance_date: value.date, question: "Please clarify the recorded absence.",
        due_at: new Date(Date.now() + 86400000).toISOString(), idempotency_key: randomUUID() };
      const opened = await coordination.create(req, body);
      expect(await coordination.create(req, body)).toEqual(opened);
      expect((await sql`SELECT attendance_record_id,participation_entry_id,source_revision FROM attendance_followups
        WHERE id=${opened.id}::uuid`.execute(tx)).rows[0]).toEqual({ attendance_record_id: null, participation_entry_id: entry.id, source_revision: 1 });
      await sql`UPDATE activity_attendance_entries SET status='present',revision=2 WHERE id=${entry.id}::uuid`.execute(tx);
      await coordination.respond(req, opened.id, { context: "staff", kind: "resolved", body: "Attendance correction reviewed.",
        outcome: "record_corrected", expected_revision: opened.revision, idempotency_key: randomUUID() });
      expect((await coordination.detail(req.authUser, opened.id, "staff")).state).toBe("resolved");
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM attendance_records_legacy_source WHERE student_id=${value.studentId}::uuid`.execute(tx)).rows[0]?.count).toBe(0);
    });
  }, 30000);

  for (const archived of [false, true]) it(`executes the actual Simulation function rewrite with branch-only legacy IDs (${archived ? "archive" : "pre-cutover"})`, async () => {
    const client = await pool.connect(), schema = `dt_followup_reference_test_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".students(id uuid,school_id uuid);
        CREATE TABLE "${schema}".school_memberships(school_id uuid,user_id uuid,role text);
        CREATE TABLE "${schema}".attendance_records(id uuid,student_id uuid,date date);
        CREATE TABLE "${schema}".attendance_followups(school_id uuid,student_id uuid,attendance_record_id uuid,participation_entry_id uuid,attendance_date date,owner_user_id uuid);
        CREATE TABLE "${schema}".activity_attendance_entries(id uuid,register_id uuid,person_id uuid,school_id uuid);
        CREATE TABLE "${schema}".activity_attendance_source_contexts(register_id uuid,school_id uuid,state text,source_kind text,context_snapshot jsonb);
        CREATE TABLE "${schema}".activity_attendance_academic_roster(register_id uuid,person_id uuid,student_id uuid);`);
      if (archived) await client.query(`CREATE TABLE "${schema}".attendance_records_legacy_source(LIKE "${schema}".attendance_records)`);
      const source = (await client.query<{ definition: string }>("SELECT pg_get_functiondef('public.validate_followup_links'::regproc) AS definition")).rows[0]!.definition;
      expect(source).toContain("store_schema");
      const rewritten = simulationFunctionDefinition(source, { schema_name: schema } as SimulationBranch);
      expect(rewritten).not.toContain("FROM public.");
      await client.query(rewritten);
      await client.query(`CREATE TRIGGER attendance_followup_links BEFORE INSERT OR UPDATE ON "${schema}".attendance_followups
        FOR EACH ROW EXECUTE FUNCTION "${schema}".validate_followup_links()`);
      const schoolId = randomUUID(), studentId = randomUUID(), recordId = randomUUID(), actorId = randomUUID();
      await client.query(`INSERT INTO "${schema}".students VALUES($1,$2)`, [studentId, schoolId]);
      await client.query(`INSERT INTO "${schema}".school_memberships VALUES($1,$2,'admin')`, [schoolId, actorId]);
      await client.query(`INSERT INTO "${schema}".${archived ? "attendance_records_legacy_source" : "attendance_records"} VALUES($1,$2,'2026-10-20')`, [recordId, studentId]);
      await client.query(`INSERT INTO "${schema}".attendance_followups VALUES($1,$2,$3,NULL,'2026-10-20',$4)`, [schoolId, studentId, recordId, actorId]);
      expect((await client.query(`SELECT count(*)::int AS count FROM "${schema}".attendance_followups`)).rows[0].count).toBe(1);
      await expect(client.query(`INSERT INTO "${schema}".attendance_followups VALUES($1,$2,$3,NULL,'2026-10-20',$4)`, [randomUUID(), studentId, recordId, actorId])).rejects.toThrow("scope mismatch");
    } finally { await client.query("ROLLBACK"); client.release(); }
  }, 30000);

  it("registers forward-only source references without removing archival foreign keys", async () => {
    const source = await readFile(new URL("../migrations/164_participation_continuity_references.sql", import.meta.url), "utf8");
    expect(source).toContain("accepted_participation_command_id uuid REFERENCES activity_attendance_commands");
    expect(source).toContain("participation_entry_id uuid REFERENCES activity_attendance_entries");
    expect(source).not.toContain("DROP COLUMN attendance_record_id");
    expect(source).not.toContain("DROP COLUMN accepted_submission_id");
  });

  it("correlates multi-guardian replies and assisted capture without impersonating recipients", async () => {
    await rollbackFixture(async (tx, value) => {
      await sql`INSERT INTO activity_attendance_entries(school_id,register_id,person_id,status,remarks,capture_channel,observed_at,recorded_by,revision)
        VALUES(${value.schoolId}::uuid,${value.registerId}::uuid,${value.personId}::uuid,'absent','','human_roll_call',now(),${value.actor.id}::uuid,1)`.execute(tx);
      const suffix = randomUUID(), user = await tx.insertInto("users").values({ username: `followup-guardian-${suffix}`, email: `followup-guardian-${suffix}@example.test`,
        password_hash: "isolated-test-only", first_name: "Guardian", last_name: "Recipient", role: "parent" })
        .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      await tx.insertInto("school_memberships").values({ school_id: value.schoolId, user_id: user.id, role: "guardian", is_active: true }).execute();
      const person = await tx.insertInto("school_people").values({ school_id: value.schoolId, first_name: user.first_name, last_name: user.last_name }).returning("id").executeTakeFirstOrThrow();
      const guardian = await tx.insertInto("parents").values({ user_id: user.id }).returning("id").executeTakeFirstOrThrow();
      await tx.insertInto("guardian_school_profiles").values({ school_id: value.schoolId, person_id: person.id, guardian_id: guardian.id }).execute();
      await tx.insertInto("guardian_relationships").values({ school_id: value.schoolId, guardian_id: guardian.id, student_id: value.studentId, relationship: "guardian" }).execute();
      const endpoint = await core.linkAccountEndpoint(tx, { school_id: value.schoolId, person_id: person.id, user_id: user.id, actor_user_id: value.actor.id,
        effective_from: new Date().toISOString(), effective_until: null, source_domain: "people", source_record_id: guardian.id, source_revision: 1,
        metadata: { fixture: "explicit_guardian_endpoint" } });
      const secondUser = await tx.insertInto("users").values({ username: `followup-second-${suffix}`, email: `followup-second-${suffix}@example.test`,
        password_hash: "isolated-test-only", first_name: "Second", last_name: "Guardian", role: "parent" })
        .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
      await tx.insertInto("school_memberships").values({ school_id: value.schoolId, user_id: secondUser.id, role: "guardian", is_active: true }).execute();
      const secondPerson = await tx.insertInto("school_people").values({ school_id: value.schoolId, first_name: secondUser.first_name, last_name: secondUser.last_name }).returning("id").executeTakeFirstOrThrow();
      const secondGuardian = await tx.insertInto("parents").values({ user_id: secondUser.id }).returning("id").executeTakeFirstOrThrow();
      await tx.insertInto("guardian_school_profiles").values({ school_id: value.schoolId, person_id: secondPerson.id, guardian_id: secondGuardian.id }).execute();
      await tx.insertInto("guardian_relationships").values({ school_id: value.schoolId, guardian_id: secondGuardian.id, student_id: value.studentId, relationship: "guardian" }).execute();
      const secondEndpoint = await core.linkAccountEndpoint(tx, { school_id: value.schoolId, person_id: secondPerson.id, user_id: secondUser.id, actor_user_id: value.actor.id,
        effective_from: new Date().toISOString(), effective_until: null, source_domain: "people", source_record_id: secondGuardian.id, source_revision: 1,
        metadata: { fixture: "explicit_second_guardian_endpoint" } });
      const owner = await core.resolveAccountEndpoint(tx, { school_id: value.schoolId, user_id: value.actor.id, at: new Date().toISOString() });
      if (!owner.acting) throw new Error("The configured fixture owner must have a current canonical identity.");
      for (const [action, selector] of [["opened", "attendance_followup_guardians"], ["guardian_reply", "attendance_followup_owner"], ["assisted_reply", "attendance_followup_owner"]]) {
        const behaviour = (await sql<{ id: string }>`INSERT INTO campus_model_behaviour_versions(school_id,behaviour_key,version,status,effective_from,
          configuration,configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at)
          VALUES(${value.schoolId}::uuid,${`configured_followup_${action}`},1,'approved',now()-interval '1 minute','{"workflow":"attendance_followup","fixture":true}',
            1,${owner.agent_id}::uuid,${owner.agent_id}::uuid,now()) RETURNING id`.execute(tx)).rows[0]!;
        await sql`INSERT INTO campus_model_event_subscriptions(school_id,behaviour_version_id,subscription_key,source_domain,event_type,reaction_kind,message_kind,
          message_schema_version,recipient_selector,response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority)
          VALUES(${value.schoolId}::uuid,${behaviour.id}::uuid,${`followup_${action}`},'coordination',${`coordination.followup.${action}`},'attendance_followup','request',1,
            ${JSON.stringify({ mode: "explicit_authorized_agents", selector_key: selector, required_capability: "coordination.followup.respond", scope_mode: "event_scope",
              min_recipients: 1, max_recipients: 2 })}::jsonb,NULL,NULL,1,NULL,3)`.execute(tx);
      }
      for (const agent of [owner.agent_id, endpoint.agent_id, secondEndpoint.agent_id]) await sql`INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,effective_from,
        grant_source,grant_reference_id,approved_by) VALUES(${value.schoolId}::uuid,${agent}::uuid,'coordination.followup.respond',now()-interval '1 minute',
          'manual',${`isolated-fixture:${suffix}`},${value.actor.id}::uuid)`.execute(tx);
      const transactional = new Proxy(tx, { get(target, property) {
        if (property === "transaction") return () => ({ execute: (action: (inner: Transaction<Database>) => Promise<unknown>) => action(tx) });
        const result = Reflect.get(target, property, target); return typeof result === "function" ? result.bind(target) : result;
      } }) as unknown as DatabaseService;
      const service = new CoordinationService(transactional, new SchoolEventService(transactional, core), new FollowupModelBridgeService(core, core, core));
      const ownerReq = { authUser: { ...value.actor, active_school_id: value.schoolId }, requestId: randomUUID() } as AuthenticatedRequest;
      const guardianReq = { authUser: { ...user, active_school_id: value.schoolId }, requestId: randomUUID() } as AuthenticatedRequest;
      const input = { student_id: value.studentId, attendance_date: value.date, question: "Please clarify this recorded absence.",
        due_at: new Date(Date.now() + 86400000).toISOString(), idempotency_key: randomUUID() };
      const opened = await service.create(ownerReq, input);
      expect(opened.coordination.status).toBe("routed"); expect(await service.create(ownerReq, input)).toEqual(opened);
      const reply = { context: "guardian", kind: "guardian_reply", body: "Private family explanation.", expected_revision: 1, idempotency_key: randomUUID() };
      const reviewed = await service.respond(guardianReq, opened.id, reply);
      expect(reviewed.coordination.status).toBe("routed"); expect(await service.respond(guardianReq, opened.id, reply)).toEqual(reviewed);
      expect((await service.respond(ownerReq, opened.id, { context: "staff", kind: "resolved", body: "Explanation reviewed without changing attendance.",
        outcome: "absence_explained", expected_revision: 2, idempotency_key: randomUUID() })).coordination.status).toBe("closed");
      const messages = (await sql<{ source_revision: number; state: string }>`SELECT event.source_revision,message.state FROM campus_model_events event
        JOIN campus_model_reactions reaction ON reaction.trigger_event_id=event.id JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
        WHERE event.school_id=${value.schoolId}::uuid AND event.source_domain='coordination' AND event.source_record_id=${opened.id} ORDER BY event.source_revision`.execute(tx)).rows;
      expect(messages.filter(message => message.source_revision === 1).map(message => message.state).sort()).toEqual(["cancelled", "responded"]);
      expect(messages.filter(message => message.source_revision === 2)).toEqual([{ source_revision: 2, state: "responded" }]);
      const guardianOutcomes = (await sql<{ state: string; actor_agent_id: string; response: unknown }>`SELECT outcome.state,outcome.actor_agent_id,outcome.response
        FROM campus_model_events event JOIN campus_model_reactions reaction ON reaction.trigger_event_id=event.id
        JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
        JOIN campus_model_operational_message_outcomes outcome ON outcome.message_id=message.id
        WHERE event.school_id=${value.schoolId}::uuid AND event.source_domain='coordination' AND event.source_record_id=${opened.id}
          AND event.source_revision=1 AND outcome.state IN('responded','cancelled')`.execute(tx)).rows;
      expect(guardianOutcomes).toHaveLength(2);
      expect(guardianOutcomes.every(outcome => outcome.actor_agent_id === endpoint.agent_id)).toBe(true);
      expect(guardianOutcomes.find(outcome => outcome.state === "cancelled")?.response).toBeNull();
      const commands = (await sql<{ expected_revision: number; state: string; status: string }>`SELECT command.expected_revision,command.state,outcome.status
        FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
        WHERE command.school_id=${value.schoolId}::uuid AND command.correlation_id=${opened.id}::uuid ORDER BY command.expected_revision`.execute(tx)).rows;
      expect(commands).toEqual([0, 1, 2].map(expected_revision => ({ expected_revision, state: "accepted", status: "accepted" })));
      expect(JSON.stringify((await sql`SELECT payload FROM campus_model_events WHERE correlation_id=${opened.id}::uuid`.execute(tx)).rows)).not.toContain(reply.body);

      const assistedOpened = await service.create(ownerReq, { ...input, idempotency_key: randomUUID() });
      const assistedInput = { context: "staff", kind: "assisted_reply", body: "Private explanation received by phone.", guardian_id: guardian.id, channel: "phone",
        observed_at: new Date().toISOString(), expected_revision: 1, idempotency_key: randomUUID() };
      const assisted = await service.respond(ownerReq, assistedOpened.id, assistedInput);
      expect(assisted.coordination.status).toBe("routed"); expect(await service.respond(ownerReq, assistedOpened.id, assistedInput)).toEqual(assisted);
      expect((await sql`SELECT kind,actor_id,guardian_id,channel FROM attendance_followup_entries
        WHERE followup_id=${assistedOpened.id}::uuid AND revision=2`.execute(tx)).rows[0])
        .toEqual({ kind: "assisted_reply", actor_id: value.actor.id, guardian_id: guardian.id, channel: "phone" });
      const superseded = (await sql<{ state: string }>`SELECT message.state FROM campus_model_events event
        JOIN campus_model_reactions reaction ON reaction.trigger_event_id=event.id JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
        WHERE event.school_id=${value.schoolId}::uuid AND event.source_domain='coordination' AND event.source_record_id=${assistedOpened.id} AND event.source_revision=1`.execute(tx)).rows;
      expect(superseded).toEqual([{ state: "cancelled" }, { state: "cancelled" }]);
      const staffOutcomes = (await sql<{ state: string; actor_agent_id: string; response: unknown; source_outbox_event_id: string }>`
        SELECT outcome.state,outcome.actor_agent_id,outcome.response,outcome.source_outbox_event_id
        FROM campus_model_events event JOIN campus_model_reactions reaction ON reaction.trigger_event_id=event.id
        JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
        JOIN campus_model_operational_message_outcomes outcome ON outcome.message_id=message.id
        WHERE event.school_id=${value.schoolId}::uuid AND event.source_domain='coordination'
          AND event.source_record_id=${assistedOpened.id} AND event.source_revision=1 AND outcome.state='cancelled'`.execute(tx)).rows;
      expect(staffOutcomes).toHaveLength(2);
      expect(staffOutcomes.every(outcome => outcome.state === "cancelled" && outcome.actor_agent_id === owner.agent_id
        && outcome.response === null && Boolean(outcome.source_outbox_event_id))).toBe(true);
      const assistedEvent = (await sql<{ payload: { capture: unknown } }>`SELECT payload FROM campus_model_events WHERE school_id=${value.schoolId}::uuid
        AND source_domain='coordination' AND source_record_id=${assistedOpened.id} AND source_revision=2`.execute(tx)).rows[0]!;
      expect(assistedEvent.payload.capture).toEqual({ channel: "phone", observed_at: assistedInput.observed_at, assisted_capture: true });
      expect((await service.respond(ownerReq, assistedOpened.id, { context: "staff", kind: "resolved", body: "Staff reviewed the attributed phone response.",
        outcome: "absence_explained", expected_revision: 2, idempotency_key: randomUUID() })).coordination.status).toBe("closed");
    });
  });
});
