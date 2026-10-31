import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoordinationService } from "../src/coordination/coordination.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { FollowupModelBridgeService } from "../src/coordination/followup-model-bridge.service.js";
import { sql, type Transaction } from "kysely";
import type { Database } from "../src/database/types.js";
import { academicParticipationTestServices } from "./academic-participation.test-support.js";

const pool = new Pool({ connectionString: requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), max: 2 });
let db: DatabaseService;
let service: CoordinationService;
let teacher: AuthenticatedRequest;
let guardian: AuthenticatedRequest;
let student: AuthenticatedRequest;
let stranger: AuthenticatedRequest;
let record: { student_id: string; date: string; school_id: string; id: string };
const created: string[] = [];
async function account(username: string) {
  const user = (await pool.query<AuthUser>("SELECT * FROM users WHERE username=$1", [username])).rows[0]!;
  return { authUser: user, requestId: randomUUID(), ip: "127.0.0.1" } as AuthenticatedRequest;
}
const requestInput = () => ({ student_id: record.student_id, attendance_date: record.date, question: "Please clarify this recorded absence.", due_at: new Date(Date.now() + 86400000).toISOString(), idempotency_key: randomUUID() });
const create = async () => {
  const result = await service.create(teacher, requestInput());
  created.push(result.id);
  return result;
};
const response = (revision: number) => ({ context: "guardian", kind: "guardian_reply", body: "The absence was for a family appointment.", expected_revision: revision, idempotency_key: randomUUID() });
async function withdraw(id: string, revision: number) {
  return service.respond(teacher, id, { context: "staff", kind: "resolved", body: "Duplicate query reviewed and withdrawn.", outcome: "query_withdrawn", expected_revision: revision, idempotency_key: randomUUID() });
}

beforeAll(async () => {
  db = new DatabaseService();
  const core = new CampusModelCoreService(db);
  service = new CoordinationService(db, new SchoolEventService(db, core), new FollowupModelBridgeService(core, core, core));
  teacher = await account("kavita.staff"); guardian = await account("pooja.parent"); student = await account("aarav.student");
  record = (await pool.query("SELECT a.id,a.student_id,a.date::text,s.school_id FROM attendance_records a JOIN students s ON s.id=a.student_id WHERE s.user_id=$1 AND a.status='absent' ORDER BY a.date DESC LIMIT 1", [student.authUser.id])).rows[0];
  if (!record) {
    // Fresh fixtures deliberately contain no invented historical attendance.
    // Record one explicit absence through the same owning academic services as
    // the application, never by inserting the retired view/archive underneath.
    const learner = (await pool.query<{ id: string; school_id: string; class_section_id: string; today: string }>(`SELECT student.id,student.school_id,enrollment.class_section_id,
      (now() AT TIME ZONE school.timezone)::date::text AS today FROM students student JOIN schools school ON school.id=student.school_id
      JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active
      WHERE student.user_id=$1 ORDER BY enrollment.enrolled_on DESC LIMIT 1`, [student.authUser.id])).rows[0];
    if (!learner) throw new Error("Seed the isolated Aarav learner/enrollment fixture before coordination tests.");
    teacher.authUser = { ...teacher.authUser, active_school_id: learner.school_id };
    const scheduled = (await pool.query<{ date: string }>(`SELECT day::date::text AS date FROM generate_series($1::date-14,$1::date,interval '1 day') day
      WHERE EXISTS(SELECT 1 FROM effective_school_schedule_v4($2::uuid,day::date) slot WHERE slot.class_section_id=$3::uuid
        AND slot.teacher_user_id=$4::uuid AND NOT slot.cancelled AND slot.slot_type IN('class','activity')) ORDER BY day DESC LIMIT 1`,
    [learner.today, learner.school_id, learner.class_section_id, teacher.authUser.id])).rows[0];
    if (!scheduled) throw new Error("The isolated learner fixture needs a recent lesson assigned to the follow-up teacher.");
    const academic = academicParticipationTestServices(db);
    const current = await academic.school.teacherAttendanceScreen(teacher.authUser, learner.class_section_id, scheduled.date);
    await academic.school.saveStudentAttendance(teacher.authUser, { class_section_id: learner.class_section_id, date: scheduled.date, student_id: learner.id,
      status: "absent", expected_revision: current.register.revision, reason: "Explicit synthetic absence for the isolated follow-up regression." },
    { ...teacher, headers: { "idempotency-key": randomUUID() } });
    record = (await pool.query("SELECT a.id,a.student_id,a.date::text,s.school_id FROM attendance_records a JOIN students s ON s.id=a.student_id WHERE s.user_id=$1 AND a.status='absent' ORDER BY a.date DESC LIMIT 1", [student.authUser.id])).rows[0];
    if (!record) throw new Error("The canonical academic service did not retain the isolated absence.");
  }
  teacher.authUser = { ...teacher.authUser, active_school_id: record.school_id };
  guardian.authUser = { ...guardian.authUser, active_school_id: record.school_id };
  student.authUser = { ...student.authUser, active_school_id: record.school_id };
  const other = (await pool.query("SELECT u.username FROM users u JOIN parents p ON p.user_id=u.id WHERE NOT EXISTS(SELECT 1 FROM guardian_relationships g WHERE g.guardian_id=p.id AND g.student_id=$1) LIMIT 1", [record.student_id])).rows[0];
  stranger = await account(other.username);
});

afterAll(async () => {
  // Accepted Core command/event/outcome evidence is immutable. These unique,
  // terminal fixture records remain only in the explicitly disposable database.
  await db?.destroy(); await pool.end();
});

describe("Attendance coordination loop", () => {
  it("retains one configured actor-command, guardian-response, owner-review and terminal closure trace", async () => {
    const rollback = new Error("rollback configured coordination fixture");
    try {
      await db.transaction().execute(async tx => {
        const transactional = new Proxy(tx, { get(target, property) {
          if (property === "transaction") return () => ({ execute: (action: (inner: Transaction<Database>) => Promise<unknown>) => action(tx) });
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        } }) as unknown as DatabaseService;
        const core = new CampusModelCoreService(transactional), model = new FollowupModelBridgeService(core, core, core);
        const current = new CoordinationService(transactional, new SchoolEventService(transactional, core), model);
        const guardianIds = (await sql<{ user_id: string }>`SELECT DISTINCT parent.user_id FROM guardian_relationships relationship
          JOIN parents parent ON parent.id=relationship.guardian_id JOIN users account ON account.id=parent.user_id
          WHERE relationship.student_id=${record.student_id}::uuid AND account.is_active
            AND coordination_actor_authorized(${record.school_id}::uuid,${record.student_id}::uuid,parent.user_id,'guardian')`.execute(tx)).rows.map(row => row.user_id);
        expect(guardianIds).toContain(guardian.authUser.id);
        const owner = await core.resolveAccountEndpoint(tx, { school_id: record.school_id, user_id: teacher.authUser.id, at: new Date().toISOString() });
        if (!owner.acting) throw new Error("Configured coordination fixture requires the teacher's canonical human identity.");
        const recipients = new Map<string, string>();
        for (const userId of [...guardianIds, teacher.authUser.id]) {
          const identity = await core.resolveAccountEndpoint(tx, { school_id: record.school_id, user_id: userId, at: new Date().toISOString() });
          if (!identity.acting) throw new Error("Configured coordination fixture requires each recipient's canonical human identity.");
          recipients.set(userId, identity.agent_id);
        }
        for (const [action, selector] of [["opened", "attendance_followup_guardians"], ["guardian_reply", "attendance_followup_owner"]]) {
          const behaviour = (await sql<{ id: string }>`INSERT INTO campus_model_behaviour_versions(school_id,behaviour_key,version,status,effective_from,
            configuration,configuration_schema_version,created_by_agent_id,approved_by_agent_id,approved_at)
            VALUES(${record.school_id}::uuid,${`followup_test_${randomUUID().replaceAll("-", "")}`},1,'approved',now()-interval '1 minute',
              '{"workflow":"attendance_followup","fixture":true}'::jsonb,1,${owner.agent_id}::uuid,${owner.agent_id}::uuid,now()) RETURNING id`.execute(tx)).rows[0]!;
          await sql`INSERT INTO campus_model_event_subscriptions(school_id,behaviour_version_id,subscription_key,source_domain,event_type,
            reaction_kind,message_kind,message_schema_version,recipient_selector,response_due_after_seconds,expires_after_seconds,max_attempts,retry_after_seconds,priority)
            VALUES(${record.school_id}::uuid,${behaviour.id}::uuid,${`followup_test_${action}`},'coordination',${`coordination.followup.${action}`},
              'attendance_followup','request',1,${JSON.stringify({ mode: "explicit_authorized_agents", selector_key: selector,
                required_capability: "coordination.followup.respond", scope_mode: "event_scope", min_recipients: 1, max_recipients: 100 })}::jsonb,NULL,NULL,1,NULL,3)`.execute(tx);
        }
        for (const agentId of new Set(recipients.values())) await sql`INSERT INTO campus_model_agent_authorities(school_id,agent_id,capability,effective_from,
          grant_source,grant_reference_id,approved_by) VALUES(${record.school_id}::uuid,${agentId}::uuid,'coordination.followup.respond',now()-interval '1 minute',
            'manual',${`isolated-coordination-fixture:${randomUUID()}`},${teacher.authUser.id}::uuid)`.execute(tx);
        const body = requestInput(), opened = await current.create(teacher, body);
        expect(opened.coordination.status).toBe("routed");
        expect(await current.create(teacher, body)).toEqual(opened);
        const reply = response(1), replied = await current.respond(guardian, opened.id, reply);
        expect(replied.coordination.status).toBe("routed");
        expect(await current.respond(guardian, opened.id, reply)).toEqual(replied);
        const closed = await current.respond(teacher, opened.id, { context: "staff", kind: "resolved", body: "Guardian explanation reviewed without changing attendance.",
          outcome: "absence_explained", expected_revision: 2, idempotency_key: randomUUID() });
        expect(closed.coordination.status).toBe("closed");
        const commands = (await sql<{ state: string; expected_revision: number; result: string }>`SELECT command.state,command.expected_revision,outcome.status AS result
          FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
          WHERE command.school_id=${record.school_id}::uuid AND command.correlation_id=${opened.id}::uuid ORDER BY command.expected_revision`.execute(tx)).rows;
        expect(commands).toEqual([0, 1, 2].map(expected_revision => ({ state: "accepted", expected_revision, result: "accepted" })));
        const traces = (await sql<{ source_revision: number; messages: number; responded: number; cancelled: number }>`SELECT event.source_revision,
          count(message.id)::int AS messages,count(message.id) FILTER(WHERE message.state='responded')::int AS responded,
          count(message.id) FILTER(WHERE message.state='cancelled')::int AS cancelled
          FROM campus_model_events event LEFT JOIN campus_model_reactions reaction ON reaction.trigger_event_id=event.id
          LEFT JOIN campus_model_operational_messages message ON message.reaction_id=reaction.id
          WHERE event.school_id=${record.school_id}::uuid AND event.source_domain='coordination' AND event.source_record_id=${opened.id}
          GROUP BY event.source_revision ORDER BY event.source_revision`.execute(tx)).rows;
        expect(traces).toEqual([{ source_revision: 1, messages: guardianIds.length, responded: 1, cancelled: guardianIds.length - 1 },
          { source_revision: 2, messages: 1, responded: 1, cancelled: 0 }, { source_revision: 3, messages: 0, responded: 0, cancelled: 0 }]);
        const prose = JSON.stringify((await sql`SELECT payload FROM campus_model_events WHERE correlation_id=${opened.id}::uuid`.execute(tx)).rows);
        expect(prose).not.toContain("family appointment");
        expect(prose).not.toContain(body.question);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  it("keeps school review separate from a guardian reply and preserves attendance", async () => {
    const before = (await pool.query("SELECT status,revision FROM attendance_records WHERE id=$1", [record.id])).rows[0];
    const item = await create();
    expect((await service.list(guardian.authUser, { context: "guardian", student_id: record.student_id })).results.some((row) => row.id === item.id)).toBe(true);
    const replied = await service.respond(guardian, item.id, response(item.revision));
    expect((await service.detail(teacher.authUser, item.id, "staff")).state).toBe("in_review");
    await service.respond(teacher, item.id, { context: "staff", kind: "resolved", body: "Guardian explanation reviewed; attendance retained.", outcome: "absence_explained", expected_revision: replied.revision, idempotency_key: randomUUID() });
    expect((await service.detail(guardian.authUser, item.id, "guardian")).state).toBe("resolved");
    expect((await pool.query("SELECT status,revision FROM attendance_records WHERE id=$1", [record.id])).rows[0]).toEqual(before);
    expect(Number((await pool.query("SELECT count(*) FROM event_outbox WHERE aggregate_id=$1 AND event_type='coordination.updated'", [item.id])).rows[0].count)).toBe(3);
  });

  it("deduplicates retries and rejects changed payloads and duplicate open cases", async () => {
    const input = requestInput();
    const item = await service.create(teacher, input); created.push(item.id);
    expect(await service.create(teacher, input)).toEqual(item);
    await expect(service.create(teacher, { ...input, question: "Different payload" })).rejects.toThrow("different details");
    await expect(service.create(teacher, requestInput())).rejects.toThrow("already exists");
    const reply = response(item.revision);
    const next = await service.respond(guardian, item.id, reply);
    expect(await service.respond(guardian, item.id, reply)).toEqual(next);
    expect((await service.detail(guardian.authUser, item.id, "guardian")).entries).toHaveLength(2);
    await withdraw(item.id, next.revision);
  });

  it("denies unrelated guardians, student accounts, and use of teacher authority in guardian context", async () => {
    const item = await create();
    await expect(service.detail(stranger.authUser, item.id, "guardian")).rejects.toThrow("accessible");
    await expect(service.respond(stranger, item.id, response(item.revision))).rejects.toThrow("accessible");
    await expect(service.detail(student.authUser, item.id, "guardian")).rejects.toThrow("accessible");
    await expect(service.detail(teacher.authUser, item.id, "guardian")).rejects.toThrow("accessible");
    await expect(service.create(guardian, requestInput())).rejects.toThrow("accessible");
    expect((await service.list(stranger.authUser, { context: "guardian" })).results).not.toContainEqual(expect.objectContaining({ id: item.id }));
    await withdraw(item.id, item.revision);
  });

  it("attributes an assisted response to staff and records effective time separately", async () => {
    const item = await create();
    const detail = await service.detail(teacher.authUser, item.id, "staff");
    const parent = detail.guardians[0] as { id: string };
    const next = await service.respond(teacher, item.id, { context: "staff", kind: "assisted_reply", channel: "phone", guardian_id: parent.id,
      observed_at: new Date().toISOString(), body: "Guardian confirmed the absence during a phone call.", expected_revision: item.revision, idempotency_key: randomUUID() });
    const entries = (await service.detail(teacher.authUser, item.id, "staff")).entries as Array<{ actor_name: string; channel: string; guardian_name: string }>;
    expect(entries[1]).toMatchObject({ actor_name: "Kavita Mehta", channel: "phone" });
    expect(entries[1]?.guardian_name).toBeTruthy();
    await withdraw(item.id, next.revision);
  });

  it("rejects stale revisions, invalid resolution, future observed time, and post-closure replies", async () => {
    const item = await create();
    const linkedGuardian = (await service.detail(teacher.authUser, item.id, "staff")).guardians[0] as { id: string };
    await expect(service.respond(teacher, item.id, { context: "staff", kind: "assisted_reply", channel: "phone", guardian_id: linkedGuardian.id,
      observed_at: new Date(Date.now() + 3600000).toISOString(), body: "A response with an invalid future timestamp.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("Response time");
    await expect(service.respond(teacher, item.id, { context: "staff", kind: "resolved", outcome: "record_corrected", body: "Correction claimed without a record change.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("Correct the attendance register first");
    await expect(service.respond(teacher, item.id, { context: "staff", kind: "resolved", outcome: "absence_explained", body: "Explained without receiving a response.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("Record a guardian response");
    const next = await service.respond(guardian, item.id, response(item.revision));
    await expect(service.respond(guardian, item.id, response(item.revision))).rejects.toThrow("has changed");
    const done = await withdraw(item.id, next.revision);
    await expect(service.respond(guardian, item.id, response(done.revision))).rejects.toThrow("already resolved");
  });

  it("rechecks revoked membership on a previously opened case", async () => {
    const item = await create();
    await pool.query("UPDATE school_memberships SET is_active=false WHERE user_id=$1 AND school_id=$2 AND role='guardian'", [guardian.authUser.id, record.school_id]);
    try { await expect(service.respond(guardian, item.id, response(item.revision))).rejects.toThrow("accessible"); }
    finally { await pool.query("UPDATE school_memberships SET is_active=true WHERE user_id=$1 AND school_id=$2 AND role='guardian'", [guardian.authUser.id, record.school_id]); }
    await withdraw(item.id, item.revision);
  });

  it("rejects missing attendance instead of treating it as absence", async () => {
    await expect(service.create(teacher, { ...requestInput(), attendance_date: "2000-01-01" })).rejects.toThrow("unmarked register is not absence");
  });

  it("serializes concurrent replies and keeps event envelopes free of response content", async () => {
    const item = await create();
    const results = await Promise.allSettled([
      service.respond(guardian, item.id, response(item.revision)),
      service.respond(guardian, item.id, response(item.revision)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const events = (await pool.query("SELECT payload FROM event_outbox WHERE aggregate_id=$1", [item.id])).rows;
    expect(events).toHaveLength(4);
    expect(JSON.stringify(events)).not.toContain("family appointment");
    await withdraw(item.id, item.revision + 1);
  });

  it("enforces tenant/attendance links and guardian association in the database", async () => {
    const item = await create();
    const otherSchool = randomUUID();
    await pool.query("INSERT INTO schools(id,name,code) VALUES($1,'Coordination isolation fixture',$2)", [otherSchool, `test-${otherSchool.slice(0,8)}`]);
    try {
      await expect(pool.query("UPDATE attendance_followups SET school_id=$2 WHERE id=$1", [item.id, otherSchool])).rejects.toThrow();
      const wrongGuardian = (await pool.query("SELECT id FROM parents WHERE user_id=$1", [stranger.authUser.id])).rows[0];
      await expect(service.respond(teacher, item.id, { context: "staff", kind: "assisted_reply", channel: "phone", guardian_id: wrongGuardian.id,
        observed_at: new Date().toISOString(), body: "Attempt to attach an unrelated guardian.", expected_revision: item.revision, idempotency_key: randomUUID() })).rejects.toThrow("linked to this student");
    } finally { await pool.query("DELETE FROM schools WHERE id=$1", [otherSchool]); }
    await withdraw(item.id, item.revision);
  });
});
