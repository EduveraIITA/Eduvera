import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "../src/chat/chat.service.js";
import { ChatModelBridgeService } from "../src/chat/chat-model-bridge.service.js";
import { MatrixTransportService } from "../src/chat/matrix/matrix-transport.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { OperatingRulesController } from "../src/operating-rules/operating-rules.module.js";
import { DEFAULT_CHAT_POLICY, readChatPolicy, type ChatPolicy } from "../src/chat/chat-policy.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const suite = process.env.TEST_DATABASE_ISOLATED === "true" ? describe : describe.skip;
const request = (user: AuthUser, body?: unknown) => ({ authUser: user, body, requestId: randomUUID() }) as AuthenticatedRequest;
const services = (db: DatabaseService) => {
  const core = new CampusModelCoreService(db);
  return { chat: new ChatService(db, new SchoolEventService(db, core), new ChatModelBridgeService(core)), rules: new OperatingRulesController(db) };
};

suite("current institution messaging policy", () => {
  let database: DatabaseService;
  let chat: ChatService;
  let rules: OperatingRulesController;
  let uploadDirectory: string;
  const priorUploadDirectory = process.env.UPLOAD_DIR;
  const schoolA = randomUUID(), schoolB = randomUUID(), classId = randomUUID(), termId = randomUUID();
  const users: Record<string, AuthUser> = {};

  beforeAll(async () => {
    requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    uploadDirectory = await mkdtemp(join(tmpdir(), "thatcampus-chat-policy-test-"));
    process.env.UPLOAD_DIR = uploadDirectory;
    database = new DatabaseService();
    ({ chat, rules } = services(database));
    await sql`INSERT INTO institution_capability_packs(code,label,description,institution_kinds,cohort_label,learner_label,default_subject_names,requires_staff)
      VALUES('india_school_core','School','Test',ARRAY['school'],'Class','Learner',ARRAY['English'],true) ON CONFLICT DO NOTHING`.execute(database);
    await sql`INSERT INTO schools(id,name,code,timezone) VALUES
      (${schoolA}::uuid,'Policy school A',${`policy-a-${schoolA.slice(0,8)}`},'Asia/Kolkata'),
      (${schoolB}::uuid,'Policy school B',${`policy-b-${schoolB.slice(0,8)}`},'America/New_York')`.execute(database);
    for (const name of ["admin", "teacher", "learner", "guardian"]) {
      const id = randomUUID();
      users[name] = (await sql<AuthUser>`INSERT INTO users(id,username,email,password_hash,first_name,last_name,role)
        VALUES(${id}::uuid,${`policy-${id}`},${`${id}@example.test`},'test',${name},'Policy','admin') RETURNING *`.execute(database)).rows[0]!;
      users[name].active_school_id = schoolA;
    }
    const admin = users.admin!, teacher = users.teacher!, learner = users.learner!, guardian = users.guardian!;
    await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES
      (${schoolA}::uuid,${admin.id}::uuid,'admin'),(${schoolB}::uuid,${admin.id}::uuid,'student'),
      (${schoolA}::uuid,${teacher.id}::uuid,'staff'),(${schoolA}::uuid,${learner.id}::uuid,'student'),
      (${schoolA}::uuid,${guardian.id}::uuid,'guardian')`.execute(database);
    const adminPerson = randomUUID(), adminProfile = randomUUID();
    await sql`INSERT INTO school_people(id,school_id,first_name,last_name)
      VALUES(${adminPerson}::uuid,${schoolA}::uuid,'Admin','Policy')`.execute(database);
    await sql`INSERT INTO staff_profiles(id,school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id)
      VALUES(${adminProfile}::uuid,${schoolA}::uuid,${admin.id}::uuid,${`ADM-${adminProfile.slice(0,8)}`},'non_teaching','Administrator','full_time',current_date-30,'active',${admin.id}::uuid,${admin.id}::uuid,${adminPerson}::uuid)`.execute(database);
    await sql`INSERT INTO academic_terms(id,school_id,academic_year,name,starts_on,ends_on)
      VALUES(${termId}::uuid,${schoolA}::uuid,'2026-27','Term',current_date-30,current_date+30)`.execute(database);
    await sql`INSERT INTO class_sections(id,school_id,academic_year,grade,section)
      VALUES(${classId}::uuid,${schoolA}::uuid,'2026-27','7','Policy')`.execute(database);
    const person = randomUUID(), student = randomUUID(), guardianPerson = randomUUID(), parent = randomUUID();
    await sql`INSERT INTO school_people(id,school_id,first_name,last_name) VALUES
      (${person}::uuid,${schoolA}::uuid,'Learner','Policy'),(${guardianPerson}::uuid,${schoolA}::uuid,'Guardian','Policy')`.execute(database);
    await sql`INSERT INTO students(id,school_id,person_id,user_id,admission_number)
      VALUES(${student}::uuid,${schoolA}::uuid,${person}::uuid,${learner.id}::uuid,${student})`.execute(database);
    await sql`INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on)
      VALUES(${student}::uuid,${classId}::uuid,${termId}::uuid,1,current_date-30)`.execute(database);
    await sql`INSERT INTO parents(id,user_id) VALUES(${parent}::uuid,${guardian.id}::uuid)`.execute(database);
    await sql`INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id)
      VALUES(${schoolA}::uuid,${parent}::uuid,${guardianPerson}::uuid)`.execute(database);
    await sql`INSERT INTO guardian_relationships(school_id,guardian_id,student_id,relationship)
      VALUES(${schoolA}::uuid,${parent}::uuid,${student}::uuid,'guardian')`.execute(database);
    const staffPerson = randomUUID(), profile = randomUUID();
    await sql`INSERT INTO school_people(id,school_id,first_name,last_name) VALUES(${staffPerson}::uuid,${schoolA}::uuid,'Teacher','Policy')`.execute(database);
    await sql`INSERT INTO staff_profiles(id,school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id)
      VALUES(${profile}::uuid,${schoolA}::uuid,${teacher.id}::uuid,${`POL-${profile.slice(0,8)}`},'teaching','Teacher','full_time',current_date-30,'active',${admin.id}::uuid,${admin.id}::uuid,${staffPerson}::uuid)`.execute(database);
    // Group discovery requires a real configured capability, not merely a staff
    // label. Copy the built-in role rather than weakening an immutable template.
    await sql`INSERT INTO staff_responsibility_types(school_id,code,name,category,scope_kind,context_kind,description,requires_acceptance,source_kind,cloned_from_type_id,capability_permissions,workflow_family)
      SELECT school_id,'policy_class_teacher','Policy class teacher',category,scope_kind,context_kind,description,false,'institute',id,
        array_append(capability_permissions,'groups.create'),workflow_family
      FROM staff_responsibility_types WHERE school_id=${schoolA}::uuid AND code='class_teacher'`.execute(database);
    await sql`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by)
      SELECT ${schoolA}::uuid,type.id,${profile}::uuid,${classId}::uuid,current_date-30,'active',${admin.id}::uuid
      FROM staff_responsibility_types type WHERE type.school_id=${schoolA}::uuid AND type.code='policy_class_teacher'`.execute(database);
  });
  afterAll(async () => {
    await database?.destroy();
    if (uploadDirectory?.startsWith(join(tmpdir(), "thatcampus-chat-policy-test-"))) await rm(uploadDirectory, { recursive: true });
    if (priorUploadDirectory === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = priorUploadDirectory;
  });

  async function savePolicy(changes: Partial<ChatPolicy>, db = database, admin = users.admin!, limits: { message_edit_minutes?: number; message_attachment_mb?: number } = {}) {
    const controller = db === database ? rules : new OperatingRulesController(db);
    const current = await controller.getCategory(request(admin), schoolA, "messages");
    const domain = { ...current.domain, ...changes } as ChatPolicy;
    return controller.saveCategory(request(admin, {
      expected_workflow_revision: current.workflow.revision, expected_domain_revision: current.domain.revision,
      message_edit_minutes: limits.message_edit_minutes ?? current.workflow.message_edit_minutes, message_attachment_mb: limits.message_attachment_mb ?? current.workflow.message_attachment_mb,
      student_teacher_direct_enabled: domain.student_teacher_direct_enabled, guardian_teacher_direct_enabled: domain.guardian_teacher_direct_enabled,
      student_group_replies: domain.student_group_replies, guardian_group_replies: domain.guardian_group_replies,
      attachments_enabled: domain.attachments_enabled, enforce_communication_hours: domain.enforce_communication_hours,
      communication_start: domain.communication_start, communication_end: domain.communication_end,
    }), schoolA, "messages");
  }
  beforeEach(async () => {
    await savePolicy({ ...DEFAULT_CHAT_POLICY, guardian_group_replies: true }, database, users.admin, { message_edit_minutes: 2, message_attachment_mb: 10 });
    await sql`INSERT INTO chat_matrix_schools(school_id,enabled) VALUES(${schoolA}::uuid,false)
      ON CONFLICT(school_id) DO UPDATE SET enabled=false`.execute(database);
  });

  const group = () => chat.createGroup(users.admin!, { school_id: schoolA, title: `Policy group ${randomUUID()}`, group_type: "activity", member_ids: [users.learner!.id, users.guardian!.id, users.teacher!.id] }, request(users.admin!));
  const direct = () => chat.createConversation(users.learner!, { school_id: schoolA, recipient_id: users.teacher!.id }, request(users.learner!));

  it("reads the selected campus without writing missing policy and rejects absent or inactive selection", async () => {
    expect(await chat.policyForUser(users.admin!)).toMatchObject({ school_id: schoolA, can_manage: true });
    const selectedB = { ...users.admin!, active_school_id: schoolB };
    expect(await chat.policyForUser(selectedB)).toMatchObject({ school_id: schoolB, can_manage: false, timezone: "America/New_York", revision: 0 });
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM chat_policies WHERE school_id=${schoolB}::uuid`.execute(database)).rows[0]?.count).toBe(0);
    await expect(chat.policyForUser({ ...users.admin!, active_school_id: null })).rejects.toThrow("Choose an institution");
    await expect(chat.policyForUser({ ...users.learner!, active_school_id: schoolB })).rejects.toThrow("No active membership");
    await expect(chat.createConversation(users.learner!, { school_id: schoolB, recipient_id: users.admin!.id }, request(users.learner!))).rejects.toThrow("Switch to this institution");
  });

  it("uses current campus roles despite global admin signup and preserves read-only access", async () => {
    const conversation = await group();
    await savePolicy({ student_group_replies: false, guardian_group_replies: false });
    for (const user of [users.learner!, users.guardian!]) {
      await expect(chat.send(user, conversation.id, { body: "Not allowed" }, undefined, request(user))).rejects.toThrow("Replies are disabled");
      expect(await chat.conversation(user, conversation.id)).toMatchObject({ can_post: false, posting_restriction: expect.stringContaining("Replies are disabled") });
      expect((await chat.messages(user, conversation.id)).results.length).toBeGreaterThan(0);
      await expect(chat.markRead(user, conversation.id, request(user))).resolves.toBeDefined();
    }
    await expect(chat.send(users.teacher!, conversation.id, { body: "Staff update" }, undefined, request(users.teacher!))).resolves.toMatchObject({ duplicate: false });
    await sql`UPDATE chat_participants SET participant_role='moderator' WHERE conversation_id=${conversation.id}::uuid AND user_id=${users.learner!.id}::uuid`.execute(database);
    await expect(chat.send(users.learner!, conversation.id, { body: "Authorised moderator update" }, undefined, request(users.learner!))).resolves.toBeDefined();
  });

  it("enforces direct settings in discovery, creation, existing send and edit without hiding group candidates", async () => {
    const conversation = await direct();
    const sent = await chat.send(users.learner!, conversation.id, { body: "Before policy change" }, undefined, request(users.learner!));
    await savePolicy({ student_teacher_direct_enabled: false, guardian_teacher_direct_enabled: false });
    expect((await chat.recipients(users.learner!)).results.map(row => row.id)).not.toContain(users.teacher!.id);
    expect((await chat.recipients(users.teacher!)).results.map(row => row.id)).not.toContain(users.learner!.id);
    expect((await chat.recipients(users.teacher!)).results.map(row => row.id)).not.toContain(users.guardian!.id);
    expect((await chat.recipients(users.teacher!, undefined, "group")).results.map(row => row.id)).toContain(users.learner!.id);
    await expect(chat.recipients(users.learner!, undefined, "group")).rejects.toThrow("groups.create");
    await expect(direct()).rejects.toThrow("not available to message");
    await expect(chat.send(users.learner!, conversation.id, { body: "After policy change" }, undefined, request(users.learner!))).rejects.toThrow("Direct messaging");
    await expect(chat.editMessage(users.learner!, conversation.id, sent.id, { body: "Edit is still a write" }, request(users.learner!))).rejects.toThrow("Direct messaging");
    expect((await chat.messages(users.learner!, conversation.id)).results.some(row => row.id === sent.id)).toBe(true);
  });

  it("requires both central revisions, rejects unsupported retention edits and retains existing retention metadata", async () => {
    await sql`UPDATE chat_policies SET retention_days=777 WHERE school_id=${schoolA}::uuid`.execute(database);
    const current = await rules.getCategory(request(users.admin!), schoolA, "messages");
    const valid = {
      expected_workflow_revision: current.workflow.revision, expected_domain_revision: current.domain.revision,
      message_edit_minutes: 2, message_attachment_mb: 10,
      student_teacher_direct_enabled: true, guardian_teacher_direct_enabled: true, student_group_replies: true, guardian_group_replies: true,
      attachments_enabled: true, enforce_communication_hours: false, communication_start: "06:00", communication_end: "21:00",
    };
    await expect(rules.saveCategory(request(users.admin!, { ...valid, expected_domain_revision: undefined }), schoolA, "messages")).rejects.toThrow();
    await expect(rules.saveCategory(request(users.admin!, { ...valid, retention_days: 30 }), schoolA, "messages")).rejects.toThrow();
    await rules.saveCategory(request(users.admin!, valid), schoolA, "messages");
    await expect(rules.saveCategory(request(users.admin!, valid), schoolA, "messages")).rejects.toThrow("changed");
    expect((await readChatPolicy(database, schoolA)).retention_days).toBe(777);
    await expect(rules.getCategory(request({ ...users.admin!, active_school_id: schoolB }), schoolA, "messages")).rejects.toThrow("Switch to this institution");
  });

  it("rechecks queued provider effects without making a network call after policy closes", async () => {
    const conversation = await direct();
    await sql`INSERT INTO chat_matrix_schools(school_id,enabled) VALUES(${schoolA}::uuid,true)
      ON CONFLICT(school_id) DO UPDATE SET enabled=true`.execute(database);
    const message = await chat.send(users.learner!, conversation.id, { body: "Accepted before the rule changed" }, undefined, request(users.learner!));
    const transport = new MatrixTransportService(database), send = vi.fn();
    Object.defineProperty(transport, "client", { get: () => ({ available: true, userId: (_school: string, id: string) => id, send }) });
    await savePolicy({ student_teacher_direct_enabled: false });
    await transport.flushConversation(conversation.id);
    expect(send).not.toHaveBeenCalled();
    expect((await sql<{ state: string; last_error_code: string }>`SELECT state,last_error_code FROM chat_matrix_outbox WHERE message_id=${message.id}::uuid AND action='send'`.execute(database)).rows[0])
      .toMatchObject({ state: "blocked", last_error_code: "DIRECT_MESSAGES_DISABLED" });
    await sql`UPDATE chat_matrix_schools SET enabled=false WHERE school_id=${schoolA}::uuid`.execute(database);
  });

  it("uses campus time for sends, edits and queued delivery while retaining reads and reports", async () => {
    const conversation = await direct();
    await sql`UPDATE chat_matrix_schools SET enabled=true WHERE school_id=${schoolA}::uuid`.execute(database);
    const sent = await chat.send(users.learner!, conversation.id, { body: "Saved before closing" }, undefined, request(users.learner!));
    const staffMessage = await chat.send(users.teacher!, conversation.id, { body: "A reportable staff update" }, undefined, request(users.teacher!));
    await savePolicy({ enforce_communication_hours: true, communication_start: "09:00", communication_end: "17:00" });
    const transport = new MatrixTransportService(database), send = vi.fn();
    Object.defineProperty(transport, "client", { get: () => ({ available: true, userId: (_school: string, id: string) => id, send }) });
    const environment = { kind: "live", clock: { now: () => new Date("2026-10-27T12:00:00Z") } } as never;
    await executionEnvironmentStorage.run(environment, async () => {
      await expect(chat.send(users.learner!, conversation.id, { body: "Closed" }, undefined, request(users.learner!))).rejects.toThrow("Messaging is available 09:00–17:00 (Asia/Kolkata)");
      await expect(chat.editMessage(users.learner!, conversation.id, sent.id, { body: "Closed edit" }, request(users.learner!))).rejects.toThrow("Messaging is available");
      expect((await chat.messages(users.learner!, conversation.id)).results.length).toBeGreaterThan(0);
      await expect(chat.reportMessage(users.learner!, conversation.id, staffMessage.id, { reason: "A concern that must remain reportable" }, request(users.learner!))).resolves.toBeDefined();
      expect((await chat.recipients(users.learner!)).results.map(row => row.id)).toContain(users.teacher!.id);
      await transport.flushConversation(conversation.id);
    });
    expect(send).not.toHaveBeenCalled();
    expect((await sql<{ state: string; last_error_code: string }>`SELECT state,last_error_code FROM chat_matrix_outbox WHERE message_id=${sent.id}::uuid AND action='send'`.execute(database)).rows[0])
      .toMatchObject({ state: "pending", last_error_code: "COMMUNICATION_HOURS" });
    await sql`UPDATE chat_matrix_schools SET enabled=false WHERE school_id=${schoolA}::uuid`.execute(database);
  });

  it("resynchronizes native recipients between queued provider sends", async () => {
    const conversation = await chat.createConversation(users.admin!, { school_id: schoolA, recipient_id: users.learner!.id }, request(users.admin!));
    expect(conversation.created).toBe(true);
    await sql`UPDATE chat_matrix_schools SET enabled=true WHERE school_id=${schoolA}::uuid`.execute(database);
    const messageIds: string[] = [];
    for (const body of ["First queued update", "Second queued update"]) messageIds.push((await chat.send(users.admin!, conversation.id, { body }, undefined, request(users.admin!))).id);
    const queued = (await sql<{ message_id: string; action: string; state: string }>`SELECT message_id,action,state
      FROM chat_matrix_outbox WHERE conversation_id=${conversation.id}::uuid ORDER BY id`.execute(database)).rows;
    expect(queued).toEqual(messageIds.map(message_id => ({ message_id, action: "send", state: "pending" })));
    const transport = new MatrixTransportService(database), events: string[] = [], joined = new Set(["bot"]);
    // Real Matrix room identities are conversation-qualified. A shared fake room
    // collides with retained test mappings on a repeat run of this disposable DB.
    const roomId = `!policy-${conversation.id}:example.test`;
    let sends = 0;
    const fake = {
      available: true, botId: "bot", userId: (_school: string, user: string) => user,
      ensureRoom: () => Promise.resolve(roomId), joinedMembers: () => Promise.resolve([...joined]),
      request: () => Promise.resolve({}), join: (_room: string, user: string) => { joined.add(user); return Promise.resolve(); },
      kick: (_room: string, user: string) => { events.push(`kick:${user}`); joined.delete(user); return Promise.resolve(); },
      send: async () => {
        events.push(`send:${++sends}`);
        if (sends === 1) await sql`UPDATE chat_participants SET is_active=false
          WHERE conversation_id=${conversation.id}::uuid AND user_id=${users.learner!.id}::uuid`.execute(database);
        return `$${conversation.id}-${sends}`;
      },
    };
    Object.defineProperty(transport, "client", { get: () => fake });
    expect(await transport.flushConversation(conversation.id, 20)).toMatchObject({ delivered: 2 });
    expect(events).toEqual(["send:1", `kick:${users.learner!.id}`, "send:2"]);
    expect(joined.has(users.learner!.id)).toBe(false);
    // This proves rechecking between effects, not an atomic transaction across
    // PostgreSQL and the external provider network.
  });

  it("validates current upload and edit limits after the transaction policy lock", async () => {
    const conversation = await direct();
    const sent = await chat.send(users.learner!, conversation.id, { body: "Original" }, undefined, request(users.learner!));
    const intercepted = (before: () => Promise<unknown>) => new Proxy(database, {
      get(target, property) {
        if (property === "transaction") return () => ({ execute: async (callback: (tx: Transaction<Database>) => Promise<unknown>) => {
          await before();
          return target.transaction().execute(callback);
        } });
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const editService = services(intercepted(() => savePolicy({}, database, users.admin, { message_edit_minutes: 0 }))).chat;
    await expect(editService.editMessage(users.learner!, conversation.id, sent.id, { body: "Must not use the old edit window" }, request(users.learner!))).rejects.toThrow("edited for 0 minutes");
    expect((await sql<{ body: string }>`SELECT body FROM chat_messages WHERE id=${sent.id}::uuid`.execute(database)).rows[0]?.body).toBe("Original");
    await savePolicy({}, database, users.admin, { message_attachment_mb: 2 });
    const uploadService = services(intercepted(() => savePolicy({}, database, users.admin, { message_attachment_mb: 1 }))).chat;
    await expect(uploadService.send(users.learner!, conversation.id, { body: "Too large under current rules" },
      { filename: "sample.pdf", mimetype: "application/pdf", data: Buffer.alloc(1_500_000, 1) }, request(users.learner!))).rejects.toThrow("up to 1 MB");
    expect(await readdir(join(uploadDirectory, "chat", conversation.id))).toEqual([]);
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM chat_attachments attachment
      JOIN chat_messages message ON message.id=attachment.message_id WHERE message.conversation_id=${conversation.id}::uuid`.execute(database)).rows[0]?.count).toBe(0);
  });

  it.runIf(Boolean(process.env.SIMULATION_CHAT_TEST_TARGET_URL))("changes rules and sends through real Core in COW without changing Live or its sibling", async () => {
    const conversation = await group();
    const sourceUrl = requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(process.env.SIMULATION_CHAT_TEST_TARGET_URL), 4);
    const opened: Kysely<Database>[] = [];
    try {
      const virtual = new Date(); virtual.setUTCDate(virtual.getUTCDate()+1); virtual.setUTCHours(4,0,0,0);
      const now = virtual.toISOString(), captured = await store.capture(schoolA, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: schoolA, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const connection = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: db => compiler.createIntrospector(db) } });
        opened.push(connection);
        const environment = simulationRequestEnvironment({ institution_id: schoolA, scenario_id: scenarioId, run_id: runId, virtual_now: now, source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: "chat-policy-test", checked_at: now });
        return { db: connection as DatabaseService, ...services(connection as DatabaseService), run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      await savePolicy({ student_group_replies: false });
      const liveRevision = (await readChatPolicy(database, schoolA)).revision;
      const message = await branch.run(async () => {
        const sent = await branch.chat.send(users.learner!, conversation.id, { body: "Run-local message" }, undefined, request(users.learner!));
        await savePolicy({ student_group_replies: false, enforce_communication_hours: true, communication_start: "09:00", communication_end: "10:00" }, branch.db);
        await expect(branch.chat.send(users.learner!, conversation.id, { body: "Run-local rule now denies" }, undefined, request(users.learner!))).rejects.toThrow("Replies are disabled");
        expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_events WHERE source_record_id=${sent.id} AND event_type='communication.message.sent'`.execute(branch.db)).rows[0]?.count).toBe(1);
        return sent;
      });
      expect((await readChatPolicy(database, schoolA)).revision).toBe(liveRevision);
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM chat_messages WHERE id=${message.id}::uuid`.execute(database)).rows[0]?.count).toBe(0);
      await sibling.run(async () => {
        expect((await sibling.chat.policyForUser(users.learner!)).student_group_replies).toBe(true);
        expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM chat_messages WHERE id=${message.id}::uuid`.execute(sibling.db)).rows[0]?.count).toBe(0);
      });
    } finally {
      await Promise.all(opened.map(connection => connection.destroy()));
      await store.pool.end();
    }
  }, 120_000);
});
