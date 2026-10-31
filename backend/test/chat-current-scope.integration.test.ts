import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatService } from "../src/chat/chat.service.js";
import { MatrixChatService } from "../src/chat/matrix/matrix-chat.service.js";
import type { MatrixTransportService } from "../src/chat/matrix/matrix-transport.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { decodeChatMessageCursor, encodeChatMessageCursor } from "../src/chat/chat-message-cursor.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import type { Database } from "../src/database/types.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { executionRealtimeBinding } from "../src/school/execution-realtime.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
const simulationTargetUrl = process.env.SIMULATION_CHAT_TEST_TARGET_URL;
// ChatModule always binds ChatService to this wrapper, even when Matrix is off.
// Exercise that production path without contacting an external transport.
const disabledTransport = { deliveryForMessages: () => Promise.resolve(new Map<string, string>()) } as unknown as MatrixTransportService;

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
    const service = new MatrixChatService(
      database,
      new SchoolEventService(database),
      { record: () => Promise.resolve({ event_id: randomUUID(), actor_agent_id: randomUUID(), audience_agent_ids: [], replayed: false }) } as any,
      disabledTransport,
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
    await sql`INSERT INTO parents(id,user_id)
      VALUES(${parentRecord}::uuid,${parent.id}::uuid)`.execute(database);
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
    await sql`WITH staff_fixture_input(id,school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) AS (VALUES (${staffProfile}::uuid,${schoolA}::uuid,${teacher.id}::uuid,${`CHAT-${suffix.slice(0, 8)}`},'Teacher','Scope',${teacher.email},'teaching','Class teacher','full_time',current_date-30,'active',${admin.id}::uuid,${admin.id}::uuid,gen_random_uuid())), canonical_fixture_person AS (INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) SELECT input.person_id::uuid,input.school_id::uuid,input.first_name,input.last_name,input.email,'' FROM staff_fixture_input input RETURNING id) INSERT INTO staff_profiles(id,school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) SELECT input.id::uuid,input.school_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid,input.person_id::uuid FROM staff_fixture_input input JOIN canonical_fixture_person person ON person.id=input.person_id::uuid`.execute(database);
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

  async function paginationFixture(f: Fixture, count = 111) {
    const group = await f.service.createGroup(f.admin, { school_id: f.schoolA, title: "Pagination support", group_type: "child_support", member_ids: [f.parent.id, f.teacher.id], student_id: f.studentA }, request(f.admin));
    const prefix = randomUUID().slice(0,24);
    await sql`INSERT INTO chat_messages(id,conversation_id,sender_id,body,created_at,updated_at)
      SELECT (${prefix} || lpad(series::text,12,'0'))::uuid,${group.id}::uuid,${f.admin.id}::uuid,
        'Captured message ' || series,
        '2026-10-20T10:00:00.123456Z'::timestamptz + (CASE WHEN series<=105 THEN 0 ELSE series-108 END)*interval '1 microsecond',
        '2026-10-20T10:00:00.123456Z'::timestamptz
      FROM generate_series(1,${count}) AS series`.execute(database);
    return group;
  }

  async function directoryFixture(f: Fixture) {
    const prefix = `Directory ${randomUUID()}`, idPrefix = randomUUID().slice(0,24);
    const rows = (await sql<{id:string;title:string}>`INSERT INTO chat_conversations(id,school_id,kind,title,context_student_id,created_by,group_type,created_at)
      SELECT (${idPrefix}||lpad(series::text,12,'0'))::uuid,${f.schoolA}::uuid,'group',${prefix}||CASE WHEN series=1 THEN ' unique-old-target' ELSE ' thread '||series END,
        ${f.studentA}::uuid,${f.admin.id}::uuid,'child_support','2026-10-18T10:00:00.123456Z'::timestamptz
      FROM generate_series(1,105) AS series RETURNING id,title`.execute(database)).rows;
    await sql`INSERT INTO chat_participants(conversation_id,user_id) SELECT id,${f.parent.id}::uuid FROM chat_conversations WHERE id=ANY(${rows.map(row=>row.id)}::uuid[])`.execute(database);
    return {prefix,rows};
  }

  it("searches beyond the legacy100 cap and pages tied activity in current authorized scope", async () => isolated(async f => {
    const directory = await directoryFixture(f), options={pagination:"cursor",q:directory.prefix,student_id:f.studentA};
    expect((await f.service.conversations(f.parent)).results).toHaveLength(100);
    const found = await f.service.conversations(f.parent,{...options,q:"unique-old-target"});
    expect(found.results.map((row:{id:string})=>row.id)).toEqual([directory.rows[0]!.id]);
    const expected = directory.rows.map(row=>row.id).sort().reverse(), seen:string[]=[];
    let cursor: string | undefined;
    do {
      const page = await f.service.conversations(f.parent,{...options,cursor});
      expect(page.results.length).toBeLessThanOrEqual(20);
      seen.push(...page.results.map((row:{id:string})=>row.id));
      cursor = page.next_cursor ?? undefined;
    } while(cursor);
    expect(seen).toEqual(expected); expect(new Set(seen).size).toBe(105);
    const first=await f.service.conversations(f.parent,options);
    for (const input of [{...options,cursor:"bad"},{...options,cursor:first.next_cursor,q:"different"},{...options,cursor:first.next_cursor,student_id:f.studentB},{...options,pagination:"other"},{...options,q:"a".repeat(121)},{...options,q:"invalid\u0000search"}]) await expect(f.service.conversations(f.parent,input)).rejects.toThrow();
    await expect(f.service.conversations(f.admin,{...options,cursor:first.next_cursor})).rejects.toThrow("Invalid conversation cursor");
    expect((await f.service.conversations(f.learnerB,options)).results).toEqual([]);
    await sql`DELETE FROM guardian_relationships WHERE id=${f.guardianRelationshipA}::uuid`.execute(database);
    expect((await f.service.conversations(f.parent,{...options,cursor:first.next_cursor})).results).toEqual([]);
  }));

  it("pages same-timestamp messages without omission, preserves microseconds/order and retains legacy timestamps", async () => isolated(async f => {
    const group = await paginationFixture(f);
    const expected = (await sql<{ id: string }>`SELECT id FROM chat_messages WHERE conversation_id=${group.id}::uuid ORDER BY created_at,id`.execute(database)).rows.map(row => row.id);
    const pages: string[] = [];
    let cursor: string | undefined;
    let requests = 0;
    do {
      const response = await f.service.messages(f.parent,group.id,undefined,cursor);
      expect(response.results.length).toBeLessThanOrEqual(50);
      pages.unshift(...response.results.map((row: { id: string }) => row.id));
      cursor = response.next_cursor ?? undefined;
      expect(response.has_more).toBe(Boolean(cursor));
      if (cursor) expect(decodeChatMessageCursor(cursor,{conversation_id:group.id,namespace_id:`live:${f.schoolA}`}).created_at).toMatch(/\.\d{6}Z$/);
      requests++;
      if (requests>4) throw new Error("Pagination did not terminate");
    } while(cursor);
    expect(requests).toBe(3);
    expect(pages).toEqual(expected);
    expect(new Set(pages).size).toBe(expected.length);
    expect(expected.length).toBeGreaterThanOrEqual(111);
    expect((await f.service.messages(f.parent,group.id,"2026-10-20T10:00:00.124Z")).results).toHaveLength(50);
    const first = await f.service.messages(f.parent,group.id);
    await expect(f.service.messages(f.parent,group.id,"2026-10-20T10:00:00Z",first.next_cursor!)).rejects.toThrow("either before or cursor");
    await expect(f.service.messages(f.parent,group.id,undefined,"invalid-cursor")).rejects.toThrow("Invalid message cursor");
    await expect(f.service.messages(f.parent,group.id,"not-a-date")).rejects.toThrow("ISO timestamp");
    const differentConversation = encodeChatMessageCursor({conversation_id:randomUUID(),namespace_id:`live:${f.schoolA}`,id:randomUUID(),created_at:"2026-10-20T10:00:00.123456Z"});
    await expect(f.service.messages(f.parent,group.id,undefined,differentConversation)).rejects.toThrow("Invalid message cursor");
    await expect(f.service.messages(f.learnerB,group.id,undefined,first.next_cursor!)).rejects.toThrow("Conversation not found");
    await sql`DELETE FROM chat_messages WHERE conversation_id=${group.id}::uuid AND id<>ALL(${expected.slice(0,50)}::uuid[])`.execute(database);
    expect(await f.service.messages(f.parent,group.id)).toMatchObject({has_more:false,next_cursor:null});
    await sql`DELETE FROM guardian_relationships WHERE id=${f.guardianRelationshipA}::uuid`.execute(database);
    await expect(f.service.messages(f.parent,group.id,undefined,first.next_cursor!)).rejects.toThrow("Conversation not found");
  }));

  it.runIf(Boolean(simulationTargetUrl))("keeps cursor pages in their captured world and rechecks run-local participant scope", async () => isolated(async f => {
    const group = await paginationFixture(f,60);
    const directory = await directoryFixture(f), directoryOptions={pagination:"cursor",q:directory.prefix,student_id:f.studentA};
    const liveDirectory = await f.service.conversations(f.parent,directoryOptions);
    const liveFirst = await f.service.messages(f.parent,group.id);
    const capturedBodies = new Map((await sql<{id:string;body:string}>`SELECT id,body FROM chat_messages WHERE conversation_id=${group.id}::uuid`.execute(database)).rows.map(row=>[row.id,row.body]));
    const sourceUrl = requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    const store = new SimulationSnapshotStore(sourceUrl,requireIsolatedTestDatabaseUrl(simulationTargetUrl),4);
    const opened: Kysely<Database>[] = [];
    try {
      const now = "2026-10-20T10:30:00.000Z", captured = await store.capture(f.schoolA,now);
      const open = async () => {
        const runId=randomUUID(),scenarioId=randomUUID();
        const branch = await createSimulationBranch(store.pool,captured,{run_id:runId,school_id:f.schoolA,scenario_id:scenarioId,namespace_id:`scenario:${scenarioId}:run:${runId}`});
        const driver = new SimulationBranchDriver(store.pool,branch,captured), compiler=new PostgresDialect({pool:store.pool});
        const connection = new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:db=>compiler.createIntrospector(db)}});
        opened.push(connection);
        const environment = simulationRequestEnvironment({institution_id:f.schoolA,scenario_id:scenarioId,run_id:runId,virtual_now:now,source_snapshot_ref:`sha256:${captured.content_hash}`,manifest_ref:"chat-pagination-test",checked_at:now});
        return { connection, environment, service:new MatrixChatService(connection as DatabaseService,new SchoolEventService(connection as DatabaseService),{} as never,disabledTransport), run:<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,action) };
      };
      const branch=await open(),sibling=await open();
      const runEventId = randomUUID(), frames: string[] = [];
      await branch.run(async () => {
        const before = Number((await sql<{ sequence: string }>`SELECT last_sequence AS sequence FROM event_delivery_cursor WHERE singleton`.execute(branch.connection)).rows[0]!.sequence);
        await sql`INSERT INTO event_outbox(id,school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,published_at)
          VALUES(${runEventId}::uuid,${f.schoolA}::uuid,'timetable.updated','school',${f.schoolA}::uuid,ARRAY[${f.parent.id}::uuid],
            '{"refresh":["messages"]}'::jsonb,${`run-replay-${runEventId}`},now())`.execute(branch.connection);
        const events = new SchoolEventService(branch.connection as DatabaseService,undefined,undefined,new ExecutionDataPlaneScope());
        const client = { id: runEventId, userId: f.parent.id, binding: executionRealtimeBinding(branch.environment),
          reply: { raw: { destroyed: false, writableEnded: false, write: (frame: string) => { frames.push(frame); return true; } } },
          closed: false, lastSequence: before, replaying: false, pendingEvents: new Map(), replayOverflow: false };
        await (events as any).replay(client,before);
        expect(frames.join("")).toContain(`"id":"${runEventId}"`);
        expect(frames.join("")).toContain(`"namespace_id":"${branch.environment.namespace_id}"`);
        expect(frames.join("")).not.toContain(sibling.environment.namespace_id);
        expect(frames.join("")).toContain('id: v3-');
      });
      expect((await sql`SELECT id FROM event_outbox WHERE id=${runEventId}::uuid`.execute(database)).rows).toEqual([]);
      expect((await sibling.run(() => sql`SELECT id FROM event_outbox WHERE id=${runEventId}::uuid`.execute(sibling.connection))).rows).toEqual([]);
      await sql`UPDATE chat_messages SET body='Live changed after capture' WHERE conversation_id=${group.id}::uuid`.execute(database);
      await sql`UPDATE chat_conversations SET title=title||' Live changed' WHERE id=ANY(${directory.rows.map(row=>row.id)}::uuid[])`.execute(database);
      await branch.run(async()=>{
        const directoryPage=await branch.service.conversations(f.parent,directoryOptions);
        expect(directoryPage.results).toHaveLength(20);
        expect(directoryPage.results.every((row:{title:string})=>!row.title.includes('Live changed'))).toBe(true);
        await expect(branch.service.conversations(f.parent,{...directoryOptions,cursor:liveDirectory.next_cursor})).rejects.toThrow("Invalid conversation cursor");
        await expect(sibling.run(()=>sibling.service.conversations(f.parent,{...directoryOptions,cursor:directoryPage.next_cursor}))).rejects.toThrow("Invalid conversation cursor");
        expect((await branch.service.conversations(f.parent,{...directoryOptions,cursor:directoryPage.next_cursor})).results).toHaveLength(20);
        const first = await branch.service.messages(f.parent,group.id);
        expect(first.results).toHaveLength(50);
        expect(first.results.every((row:{id:string;body:string})=>capturedBodies.get(row.id)===row.body)).toBe(true);
        expect((await branch.service.messages(f.parent,group.id,undefined,first.next_cursor!)).results).toHaveLength(capturedBodies.size-50);
        await expect(branch.service.messages(f.parent,group.id,undefined,liveFirst.next_cursor!)).rejects.toThrow("Invalid message cursor");
        await expect(branch.service.messages(f.parent,group.id,undefined,undefined,liveFirst.boundary_cursor!)).rejects.toThrow("Invalid message cursor");
        expect((await branch.service.messages(f.parent,group.id,undefined,undefined,first.boundary_cursor!)).results.map((row:{id:string})=>row.id)).toEqual(first.results.map((row:{id:string})=>row.id));
        await expect(sibling.run(()=>sibling.service.messages(f.parent,group.id,undefined,first.next_cursor!))).rejects.toThrow("Invalid message cursor");
        await sql`UPDATE chat_participants SET is_active=false WHERE conversation_id=${group.id}::uuid AND user_id=${f.parent.id}::uuid`.execute(branch.connection);
        await expect(branch.service.messages(f.parent,group.id,undefined,first.next_cursor!)).rejects.toThrow("Conversation not found");
      });
      expect((await sibling.run(()=>sibling.service.messages(f.parent,group.id))).results.every((row:{id:string;body:string})=>capturedBodies.get(row.id)===row.body)).toBe(true);
      expect((await f.service.messages(f.parent,group.id)).results.every((row:{body:string})=>row.body==="Live changed after capture")).toBe(true);
    } finally { await Promise.all(opened.map(connection=>connection.destroy())); await store.pool.end(); }
  }),120000);

  it("refreshes a retained frontier exactly across new rows, edits and a physically removed boundary", async () => isolated(async f => {
    const group = await paginationFixture(f,120);
    const first = await f.service.messages(f.parent,group.id);
    const previousIds = first.results.map((row:{id:string})=>row.id);
    const lower = decodeChatMessageCursor(first.boundary_cursor!,{conversation_id:group.id,namespace_id:`live:${f.schoolA}`});
    await sql`UPDATE chat_messages SET body='Edited authoritative body' WHERE id=${previousIds[1]}::uuid`.execute(database);
    const newId = randomUUID();
    await sql`INSERT INTO chat_messages(id,conversation_id,sender_id,body,created_at,updated_at)
      SELECT ${newId}::uuid,${group.id}::uuid,${f.admin.id}::uuid,'New head',
        max(created_at)+interval '1 microsecond',max(created_at)+interval '1 microsecond'
      FROM chat_messages WHERE conversation_id=${group.id}::uuid`.execute(database);
    const head = await f.service.messages(f.parent,group.id,undefined,undefined,first.boundary_cursor!);
    expect(head.results).toHaveLength(50); expect(head.reached_through).toBe(false);
    const remainder = await f.service.messages(f.parent,group.id,undefined,head.next_cursor!,first.boundary_cursor!);
    expect(remainder.reached_through).toBe(true); expect(remainder.boundary_cursor).toBe(first.boundary_cursor);
    expect([...remainder.results,...head.results].map((row:{id:string})=>row.id)).toEqual([...previousIds,newId]);
    expect([...remainder.results,...head.results].find((row:{id:string})=>row.id===previousIds[1])?.body).toBe('Edited authoritative body');
    await sql`DELETE FROM chat_messages WHERE id=${lower.id}::uuid`.execute(database);
    const removed = await f.service.messages(f.parent,group.id,undefined,head.next_cursor!,first.boundary_cursor!);
    expect(removed).toMatchObject({results:[],reached_through:true,has_more:true,next_cursor:first.boundary_cursor,boundary_cursor:first.boundary_cursor});
    await expect(f.service.messages(f.parent,group.id,undefined,undefined,"bad-frontier")).rejects.toThrow("Invalid message cursor");
    await expect(f.service.messages(f.parent,group.id,undefined,first.boundary_cursor!,first.boundary_cursor!)).rejects.toThrow("must be older");
    await expect(f.service.messages(f.parent,group.id,"2026-10-20T10:00:00Z",undefined,first.boundary_cursor!)).rejects.toThrow("either before or through_cursor");
    await expect(f.service.messages(f.learnerB,group.id,undefined,undefined,first.boundary_cursor!)).rejects.toThrow("Conversation not found");
  }));

  it("revokes every contextual conversation surface while preserving current school roles", async () => isolated(async (f) => {
    // This case tests identity revocation after a permitted guardian reply.
    // Current Operating rules default those replies off; opt in explicitly.
    await sql`INSERT INTO chat_policies(school_id,guardian_group_replies)
      VALUES(${f.schoolA}::uuid,true)`.execute(database);
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

    const schoolBParent = { ...f.parent, active_school_id: f.schoolB };
    const direct = await f.service.createConversation(schoolBParent, {
      school_id: f.schoolB,
      recipient_id: f.admin.id,
      student_id: f.studentB,
      title: "School B learner support",
    }, request(schoolBParent));
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
