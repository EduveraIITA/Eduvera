import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatService } from "../src/chat/chat.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;

interface Fixture {
  service: ChatService;
  schoolA: string;
  schoolB: string;
  studentA: string;
  studentB: string;
  guardianRelationshipA: string;
  admin: AuthUser;
  teacher: AuthUser;
  parent: AuthUser;
  learner: AuthUser;
  learnerB: AuthUser;
  userIds: string[];
}

function request(user: AuthUser): AuthenticatedRequest {
  return {
    authUser: user,
    requestId: randomUUID(),
    ip: "127.0.0.1",
  } as AuthenticatedRequest;
}

suite("chat current relationship authorization", () => {
  let database: DatabaseService;

  beforeAll(() => {
    requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    database = new DatabaseService();
  });

  afterAll(async () => {
    await database?.destroy();
  });

  async function fixture(): Promise<Fixture> {
    const service = new ChatService(
      database,
      new SchoolEventService(database),
      { record: () => Promise.resolve({ event_id: randomUUID(), actor_agent_id: randomUUID(), audience_agent_ids: [], replayed: false }) } as any,
    );
    const schoolA = randomUUID();
    const schoolB = randomUUID();
    const termA = randomUUID();
    const classA = randomUUID();
    const suffix = randomUUID();

    await sql`INSERT INTO institution_capability_packs(
      code,label,description,institution_kinds,cohort_label,learner_label,default_subject_names,requires_staff
    ) VALUES(
      'india_school_core','Indian school core','Test capability pack',ARRAY['school'],
      'Class','Student',ARRAY['English'],true
    ) ON CONFLICT DO NOTHING`.execute(database);
    await sql`INSERT INTO schools(id,name,code) VALUES
      (${schoolA}::uuid,'Chat scope school A',${`chat-a-${suffix.slice(0, 8)}`}),
      (${schoolB}::uuid,'Chat scope school B',${`chat-b-${suffix.slice(0, 8)}`})`.execute(database);

    const users: Record<string, AuthUser> = {};
    for (const [name, accountRole] of [
      ["admin", "admin"],
      ["teacher", "staff"],
      ["parent", "parent"],
      ["learner", "student"],
      ["learnerB", "student"],
    ] as const) {
      const id = randomUUID();
      const created = (await sql<AuthUser>`INSERT INTO users(
        id,username,email,password_hash,first_name,last_name,role
      ) VALUES(
        ${id}::uuid,${`chat-${name}-${suffix}`},${`chat-${name}-${suffix}@example.test`},
        'test',${name},'Scope',${accountRole}
      ) RETURNING *`.execute(database)).rows[0]!;
      users[name] = { ...created, active_school_id: schoolA };
    }
    const admin = users.admin!;
    const teacher = users.teacher!;
    const parent = users.parent!;
    const learner = users.learner!;
    const learnerB = { ...users.learnerB!, active_school_id: schoolB };

    await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES
      (${schoolA}::uuid,${admin.id}::uuid,'admin'),
      (${schoolA}::uuid,${teacher.id}::uuid,'staff'),
      (${schoolA}::uuid,${parent.id}::uuid,'guardian'),
      (${schoolA}::uuid,${learner.id}::uuid,'student'),
      (${schoolB}::uuid,${admin.id}::uuid,'admin'),
      (${schoolB}::uuid,${parent.id}::uuid,'guardian'),
      (${schoolB}::uuid,${learnerB.id}::uuid,'student')`.execute(database);

    await sql`INSERT INTO academic_terms(
      id,school_id,academic_year,name,starts_on,ends_on
    ) VALUES(
      ${termA}::uuid,${schoolA}::uuid,'2026-27','Current term',current_date-30,current_date+30
    )`.execute(database);
    await sql`INSERT INTO class_sections(
      id,school_id,academic_year,grade,section
    ) VALUES(
      ${classA}::uuid,${schoolA}::uuid,'2026-27','7','A'
    )`.execute(database);

    const studentA = randomUUID();
    const studentB = randomUUID();
    const studentPersonA = randomUUID();
    const studentPersonB = randomUUID();
    await sql`INSERT INTO school_people(id,school_id,first_name,last_name) VALUES
      (${studentPersonA}::uuid,${schoolA}::uuid,'Learner','A'),
      (${studentPersonB}::uuid,${schoolB}::uuid,'Learner','B')`.execute(database);
    await sql`INSERT INTO students(
      id,school_id,person_id,user_id,admission_number
    ) VALUES
      (${studentA}::uuid,${schoolA}::uuid,${studentPersonA}::uuid,${learner.id}::uuid,${`A-${suffix.slice(0, 10)}`}),
      (${studentB}::uuid,${schoolB}::uuid,${studentPersonB}::uuid,${learnerB.id}::uuid,${`B-${suffix.slice(0, 10)}`})`.execute(database);
    await sql`INSERT INTO enrollments(
      student_id,class_section_id,term_id,roll_number,enrolled_on
    ) VALUES(
      ${studentA}::uuid,${classA}::uuid,${termA}::uuid,1,current_date-30
    )`.execute(database);

    const parentRecord = randomUUID();
    const parentPersonA = randomUUID();
    const parentPersonB = randomUUID();
    await sql`INSERT INTO parents(id,user_id,phone)
      VALUES(${parentRecord}::uuid,${parent.id}::uuid,'9000000000')`.execute(database);
    await sql`INSERT INTO school_people(id,school_id,first_name,last_name) VALUES
      (${parentPersonA}::uuid,${schoolA}::uuid,'Parent','Scope'),
      (${parentPersonB}::uuid,${schoolB}::uuid,'Parent','Scope')`.execute(database);
    await sql`INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES
      (${schoolA}::uuid,${parentRecord}::uuid,${parentPersonA}::uuid),
      (${schoolB}::uuid,${parentRecord}::uuid,${parentPersonB}::uuid)`.execute(database);
    const guardianRelationshipA = (await sql<{ id: string }>`INSERT INTO guardian_relationships(
      school_id,guardian_id,student_id,relationship,is_primary
    ) VALUES(
      ${schoolA}::uuid,${parentRecord}::uuid,${studentA}::uuid,'guardian',true
    ) RETURNING id`.execute(database)).rows[0]!.id;
    await sql`INSERT INTO guardian_relationships(
      school_id,guardian_id,student_id,relationship,is_primary
    ) VALUES(
      ${schoolB}::uuid,${parentRecord}::uuid,${studentB}::uuid,'guardian',true
    )`.execute(database);

    const staffProfile = randomUUID();
    await sql`INSERT INTO staff_profiles(
      id,school_id,user_id,staff_code,first_name,last_name,email,staff_kind,
      designation,employment_type,joined_on,status,created_by,updated_by
    ) VALUES(
      ${staffProfile}::uuid,${schoolA}::uuid,${teacher.id}::uuid,${`CHAT-${suffix.slice(0, 8)}`},
      'Teacher','Scope',${teacher.email},'teaching','Class teacher','full_time',
      current_date-30,'active',${admin.id}::uuid,${admin.id}::uuid
    )`.execute(database);
    await sql`INSERT INTO staff_responsibility_assignments(
      school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by
    ) SELECT
      ${schoolA}::uuid,type.id,${staffProfile}::uuid,${classA}::uuid,current_date-30,'active',${admin.id}::uuid
    FROM staff_responsibility_types type
    WHERE type.school_id=${schoolA}::uuid AND type.code='class_teacher'`.execute(database);

    const staffScope = (await sql<{ allowed: boolean }>`SELECT staff_has_student_permission(
      ${schoolA}::uuid,${teacher.id}::uuid,'messages.view',${studentA}::uuid
    ) AS allowed`.execute(database)).rows[0]?.allowed;
    if (!staffScope) throw new Error("Chat scope fixture did not create a current class assignment.");

    return {
      service,
      schoolA,
      schoolB,
      studentA,
      studentB,
      guardianRelationshipA,
      admin,
      teacher,
      parent,
      learner,
      learnerB,
      userIds: Object.values(users).map((account) => account.id),
    };
  }

  async function cleanup(fixture: Fixture) {
    const schools = [fixture.schoolA, fixture.schoolB];
    await sql`DELETE FROM notifications WHERE recipient_id=ANY(${fixture.userIds}::uuid[])`.execute(database);
    await sql`DELETE FROM event_outbox WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM audit_events WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM chat_conversations WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM guardian_relationships WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM guardian_school_profiles WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM enrollments WHERE student_id IN(
      SELECT id FROM students WHERE school_id=ANY(${schools}::uuid[])
    )`.execute(database);
    await sql`DELETE FROM students WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM staff_responsibility_assignments WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM staff_profiles WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM school_people WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM school_memberships WHERE school_id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM schools WHERE id=ANY(${schools}::uuid[])`.execute(database);
    await sql`DELETE FROM parents WHERE user_id=ANY(${fixture.userIds}::uuid[])`.execute(database);
    await sql`DELETE FROM users WHERE id=ANY(${fixture.userIds}::uuid[])`.execute(database);
  }

  async function isolated(test: (fixture: Fixture) => Promise<void>) {
    const created = await fixture();
    try {
      await test(created);
    } finally {
      await cleanup(created);
    }
  }

  it("revokes every contextual conversation surface while preserving current school roles", async () => isolated(async (f) => {
    const group = await f.service.createGroup(f.admin, {
      school_id: f.schoolA,
      title: "Learner A support",
      group_type: "child_support",
      member_ids: [f.parent.id, f.teacher.id, f.learner.id],
      student_id: f.studentA,
    }, request(f.admin));
    const parentMessage = await f.service.send(f.parent, group.id, {
      body: "I have reviewed the support plan.",
      client_id: randomUUID(),
    }, undefined, request(f.parent));
    const adminMessage = await f.service.send(f.admin, group.id, {
      body: "Thank you. Here is the next update.",
      client_id: randomUUID(),
    }, undefined, request(f.admin));
    await sql`INSERT INTO chat_attachments(
      message_id,storage_key,original_name,content_type,size_bytes
    ) VALUES(
      ${parentMessage.id}::uuid,'scope-test.txt','scope-test.txt','text/plain',5
    )`.execute(database);

    expect((await f.service.conversations(f.parent)).results)
      .toContainEqual(expect.objectContaining({ id: group.id, context_student_id: f.studentA }));
    expect((await f.service.attentionConversations(f.parent)).results)
      .toContainEqual(expect.objectContaining({ id: group.id, unread_count: expect.anything() }));
    await expect(f.service.conversation(f.parent, group.id)).resolves.toMatchObject({ id: group.id });
    await expect(f.service.messages(f.parent, group.id)).resolves.toMatchObject({ results: expect.any(Array) });

    const event = (await sql<{ payload: Record<string, unknown> }>`SELECT payload
      FROM event_outbox
      WHERE aggregate_type='chat_conversation' AND aggregate_id=${group.id}::uuid
        AND payload->>'change_kind'='message_sent'
      ORDER BY created_at DESC LIMIT 1`.execute(database)).rows[0]!;
    expect((await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(
      ${f.schoolA}::uuid,'chat.updated',${JSON.stringify(event.payload)}::jsonb,${f.parent.id}::uuid
    ) AS allowed`.execute(database)).rows[0]?.allowed).toBe(true);

    await sql`DELETE FROM guardian_relationships
      WHERE id=${f.guardianRelationshipA}::uuid`.execute(database);

    expect((await f.service.conversations(f.parent)).results)
      .not.toContainEqual(expect.objectContaining({ id: group.id }));
    expect((await f.service.attentionConversations(f.parent)).results)
      .not.toContainEqual(expect.objectContaining({ id: group.id }));
    await expect(f.service.conversation(f.parent, group.id)).rejects.toThrow("Conversation not found");
    await expect(f.service.messages(f.parent, group.id)).rejects.toThrow("Conversation not found");
    await expect(f.service.markRead(f.parent, group.id, request(f.parent))).rejects.toThrow("Conversation not found");
    await expect(f.service.send(f.parent, group.id, { body: "stale send" }, undefined, request(f.parent)))
      .rejects.toThrow("Conversation not found");
    await expect(f.service.editMessage(f.parent, group.id, parentMessage.id, { body: "stale edit" }))
      .rejects.toThrow("Conversation not found");
    await expect(f.service.reportMessage(f.parent, group.id, adminMessage.id, { reason: "stale report" }, request(f.parent)))
      .rejects.toThrow("Conversation not found");
    await expect(f.service.attachment(f.parent, group.id, parentMessage.id))
      .rejects.toThrow("Conversation not found");
    expect((await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(
      ${f.schoolA}::uuid,'chat.updated',${JSON.stringify(event.payload)}::jsonb,${f.parent.id}::uuid
    ) AS allowed`.execute(database)).rows[0]?.allowed).toBe(false);

    await expect(f.service.conversation(f.admin, group.id)).resolves.toMatchObject({ id: group.id });
    await expect(f.service.conversation(f.teacher, group.id)).resolves.toMatchObject({ id: group.id });
    await expect(f.service.conversation(f.learner, group.id)).resolves.toMatchObject({ id: group.id });

    const parentNotificationsBefore = Number((await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM notifications
      WHERE recipient_id=${f.parent.id}::uuid AND metadata->>'conversation_id'=${group.id}
    `.execute(database)).rows[0]?.count ?? 0);
    await f.service.send(f.admin, group.id, {
      body: "This update must not be delivered to a former guardian.",
      client_id: randomUUID(),
    }, undefined, request(f.admin));
    const parentNotificationsAfter = Number((await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM notifications
      WHERE recipient_id=${f.parent.id}::uuid AND metadata->>'conversation_id'=${group.id}
    `.execute(database)).rows[0]?.count ?? 0);
    expect(parentNotificationsAfter).toBe(parentNotificationsBefore);
  }));

  it("binds direct and group creation to one explicit school", async () => isolated(async (f) => {
    await expect(f.service.createConversation(f.parent, {
      recipient_id: f.admin.id,
      student_id: f.studentB,
    }, request(f.parent))).rejects.toThrow();

    await expect(f.service.createConversation(f.parent, {
      school_id: f.schoolA,
      recipient_id: f.admin.id,
      student_id: f.studentB,
    }, request(f.parent))).rejects.toThrow("outside the current school relationship");

    const direct = await f.service.createConversation(f.parent, {
      school_id: f.schoolB,
      recipient_id: f.admin.id,
      student_id: f.studentB,
      title: "School B learner support",
    }, request(f.parent));
    expect((await sql<{ school_id: string; context_student_id: string }>`SELECT school_id,context_student_id
      FROM chat_conversations WHERE id=${direct.id}::uuid`.execute(database)).rows[0]).toEqual({
      school_id: f.schoolB,
      context_student_id: f.studentB,
    });

    await expect(f.service.createGroup(f.admin, {
      title: "Missing school",
      group_type: "child_support",
      member_ids: [f.parent.id],
      student_id: f.studentA,
    }, request(f.admin))).rejects.toThrow();
    await expect(f.service.createGroup(f.admin, {
      school_id: f.schoolA,
      title: "Cross-school child",
      group_type: "child_support",
      member_ids: [f.parent.id],
      student_id: f.studentB,
    }, request(f.admin))).rejects.toThrow("outside the current school relationship");
    await expect(f.service.createGroup(f.admin, {
      school_id: f.schoolA,
      title: "Cross-school member",
      group_type: "student_group",
      member_ids: [f.learnerB.id],
      student_id: f.studentA,
    }, request(f.admin))).rejects.toThrow("active member of the school");
  }));

  it("loads an authorised exact report beyond the bounded queue and revokes it with current scope", async () => isolated(async (f) => {
    const conversation = (await sql<{ id: string }>`INSERT INTO chat_conversations(
      school_id,kind,title,created_by
    ) VALUES(
      ${f.schoolA}::uuid,'group','Safeguarding projection',${f.admin.id}::uuid
    ) RETURNING id`.execute(database)).rows[0]!;
    const targetMessage = (await sql<{ id: string }>`INSERT INTO chat_messages(
      conversation_id,sender_id,body,created_at,updated_at
    ) VALUES(
      ${conversation.id}::uuid,${f.admin.id}::uuid,'Old exact report target',now()-interval '200 days',now()-interval '200 days'
    ) RETURNING id`.execute(database)).rows[0]!;
    const targetReport = (await sql<{ id: string }>`INSERT INTO chat_message_reports(
      message_id,reported_by,reason,status,assigned_to,created_at,updated_at
    ) VALUES(
      ${targetMessage.id}::uuid,${f.learner.id}::uuid,'Exact report should remain addressable',
      'open',${f.teacher.id}::uuid,now()-interval '200 days',now()-interval '200 days'
    ) RETURNING id`.execute(database)).rows[0]!;
    await sql`WITH inserted_messages AS (
      INSERT INTO chat_messages(conversation_id,sender_id,body,created_at,updated_at)
      SELECT ${conversation.id}::uuid,${f.admin.id}::uuid,'Newer report ' || series,
        now()+(series || ' seconds')::interval,now()+(series || ' seconds')::interval
      FROM generate_series(1,100) AS series
      RETURNING id,created_at
    )
    INSERT INTO chat_message_reports(
      message_id,reported_by,reason,status,assigned_to,created_at,updated_at
    )
    SELECT id,${f.learner.id}::uuid,'Newer assigned report','open',${f.teacher.id}::uuid,created_at,created_at
    FROM inserted_messages`.execute(database);

    const bounded = await f.service.reports(f.teacher);
    expect(bounded.results).toHaveLength(100);
    expect(bounded.results).not.toContainEqual(expect.objectContaining({ id: targetReport.id }));
    await expect(f.service.report(f.teacher, targetReport.id)).resolves.toMatchObject({
      id: targetReport.id,
      message_body: "Old exact report target",
      reviewer_role: "staff",
      can_assign: false,
    });

    await sql`UPDATE chat_message_reports SET assigned_to=NULL WHERE id=${targetReport.id}::uuid`.execute(database);
    await expect(f.service.report(f.teacher, targetReport.id)).rejects.toThrow("Report not found");
    await expect(f.service.report(f.admin, targetReport.id)).resolves.toMatchObject({ id: targetReport.id, can_assign: true });
    await expect(f.service.report(f.parent, targetReport.id)).rejects.toThrow("Only authorised school staff");

    await sql`UPDATE school_memberships SET is_active=false
      WHERE school_id=${f.schoolA}::uuid AND user_id=${f.admin.id}::uuid`.execute(database);
    await expect(f.service.report(f.admin, targetReport.id)).rejects.toThrow("Report not found");
  }));
});
