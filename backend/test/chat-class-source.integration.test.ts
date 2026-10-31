import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { ChatService } from '../src/chat/chat.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { PeopleService } from '../src/people/people.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { academicParticipationTestServices, fixtureTransactionDatabase } from './academic-participation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';

const suite = process.env.TEST_DATABASE_ISOLATED === 'true' ? describe : describe.skip;
const request = (authUser: AuthUser) => ({ authUser, requestId: randomUUID(), protocol: 'http', headers: { host: 'localhost' }, ip: '127.0.0.1' }) as AuthenticatedRequest;
const chat = (database: DatabaseService) => {
  const shared = academicParticipationTestServices(database);
  return new ChatService(database, shared.events, { record: () => Promise.resolve({ event_id: randomUUID(), actor_agent_id: randomUUID(), audience_agent_ids: [], replayed: false }) } as never);
};
const people = (database: DatabaseService) => {
  const shared = academicParticipationTestServices(database);
  return new PeopleService(database, shared.events, shared.core, shared.core, shared.core, shared.bridge);
};

suite('source-owned class chat access', () => {
  let database: DatabaseService;
  beforeAll(() => { requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL); database = new DatabaseService(); });
  // Retain source and immutable model evidence together in this exact disposable
  // database. The owning runner retires it after the bounded acceptance run.
  afterAll(async () => { await database?.destroy(); });

  async function fixture(options: { passive?: boolean; future?: boolean } = {}) {
    const suffix = randomUUID();
    const admin = await database.insertInto('users').values({ username: `class-owner-${suffix}`, email: `class-owner-${suffix}@example.test`, password_hash: 'isolated-fixture-only', first_name: 'Class', last_name: 'Owner', role: 'admin' }).returningAll().executeTakeFirstOrThrow();
    const core = academicParticipationTestServices(database).core;
    const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, admin, 'Asia/Kolkata'));
    const owner = { ...admin, active_school_id: schoolId } as AuthUser;
    const today = (await sql<{ today: string }>`SELECT campus_permission_date(${schoolId}::uuid)::text AS today`.execute(database)).rows[0]!.today;
    const term = await database.insertInto('academic_terms').values({ school_id: schoolId, academic_year: '2026-27', name: 'Chat test term', starts_on: `${today}`, ends_on: (await sql<{ end: string }>`SELECT (${today}::date+90)::text AS end`.execute(database)).rows[0]!.end, attendance_threshold: '85', is_active: true }).returningAll().executeTakeFirstOrThrow();
    const classes = await database.insertInto('class_sections').values(['A', 'B'].map(section => ({ school_id: schoolId, academic_year: '2026-27', grade: '7', section }))).returningAll().execute();
    const classA = classes.find(row => row.section === 'A')!.id, classB = classes.find(row => row.section === 'B')!.id;
    // Account role is deliberately different from its campus student relationship.
    const account = await database.insertInto('users').values({ username: `class-learner-${suffix}`, email: `class-learner-${suffix}@example.test`, password_hash: 'isolated-fixture-only', first_name: 'Learner', last_name: 'Scope', role: 'admin' }).returningAll().executeTakeFirstOrThrow();
    const learner = { ...account, active_school_id: schoolId } as AuthUser;
    if (!options.passive) await database.insertInto('school_memberships').values({ school_id: schoolId, user_id: learner.id, role: 'student' }).execute();
    const person = await database.insertInto('school_people').values({ school_id: schoolId, first_name: 'Learner', last_name: 'Scope' }).returningAll().executeTakeFirstOrThrow();
    const student = await database.insertInto('students').values({ school_id: schoolId, person_id: person.id, user_id: options.passive ? null : learner.id, admission_number: `CHAT-${suffix.slice(0, 10)}` }).returningAll().executeTakeFirstOrThrow();
    const enrollment = (await sql<{ id: string }>`INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on)
      VALUES(${student.id}::uuid,${classA}::uuid,${term.id}::uuid,1,${today}::date+${options.future ? 1 : 0}::int) RETURNING id`.execute(database)).rows[0]!;
    const groups = (await sql<{ id: string; class_section_id: string; created_by: string | null }>`SELECT id,class_section_id,created_by FROM chat_conversations
      WHERE school_id=${schoolId}::uuid AND class_section_id IN (${classA}::uuid,${classB}::uuid) ORDER BY class_section_id`.execute(database)).rows;
    return { schoolId, owner, learner, student, enrollment, term, today, classA, classB, groupA: groups.find(row => row.class_section_id === classA)!, groupB: groups.find(row => row.class_section_id === classB)!, service: chat(database) };
  }

  async function move(db: DatabaseService, f: Awaited<ReturnType<typeof fixture>>, action: 'move_class' | 'withdraw' | 'transfer_out' = 'move_class') {
    const service = people(db), current = (await service.lifecycle(f.owner, f.student.id, f.schoolId)).current as { id: string; revision: number };
    const preview = await service.previewLifecycle(request(f.owner), f.student.id, { school_id: f.schoolId, action, expected_enrollment_id: current.id,
      expected_revision: current.revision, effective_on: f.today, reason: 'Reviewed class access transition', ...(action === 'move_class' ? { target_class_section_id: f.classB, target_term_id: f.term.id, roll_number: 1 } : {}) });
    const accepted = await service.commitLifecycle(request(f.owner), preview.id);
    expect(await service.commitLifecycle(request(f.owner), preview.id)).toEqual(accepted);
    return preview.id;
  }

  async function allowed(db: DatabaseService, f: Awaited<ReturnType<typeof fixture>>, threadId = f.groupA.id) {
    return (await sql<{ allowed: boolean; realtime: boolean }>`SELECT
      chat_actor_is_current_participant(${f.schoolId}::uuid,${f.learner.id}::uuid,'messages.view',${threadId}::uuid) AS allowed,
      event_user_is_authorized(${f.schoolId}::uuid,'chat.updated',${JSON.stringify({ conversation_id: threadId })}::jsonb,${f.learner.id}::uuid) AS realtime`.execute(db)).rows[0]!;
  }

  it('creates source-derived class groups without a directory visit or invented human actor', async () => {
    const f = await fixture();
    expect(f.groupA.created_by).toBeNull(); expect(f.groupB.created_by).toBeNull();
    expect(await allowed(database, f)).toEqual({ allowed: true, realtime: true });
    expect((await f.service.conversations(f.learner)).results.map(row => row.id)).toEqual([f.groupA.id]);
    await expect(sql`INSERT INTO chat_conversations(school_id,kind,title,created_by) VALUES(${f.schoolId}::uuid,'direct','Not a source group',NULL)`.execute(database)).rejects.toThrow('chat_conversation_creator_source');
    await expect(sql`INSERT INTO chat_conversations(school_id,class_section_id,kind,group_type,title,created_by) VALUES(${f.schoolId}::uuid,${f.classA}::uuid,'group',NULL,'Not a canonical class group',NULL)`.execute(database)).rejects.toThrow('chat_conversation_creator_source');
  });

  it('revokes read/send/attachment/replay after the actual People move and retains history', async () => {
    const f = await fixture();
    await sql`INSERT INTO chat_messages(conversation_id,sender_id,body) VALUES(${f.groupA.id}::uuid,${f.owner.id}::uuid,'Retained class history')`.execute(database);
    await f.service.conversation(f.learner, f.groupA.id);
    const reviewId = await move(database, f);
    expect(await allowed(database, f)).toEqual({ allowed: false, realtime: false });
    expect(await allowed(database, f, f.groupB.id)).toEqual({ allowed: true, realtime: true });
    expect((await f.service.conversations(f.learner, { pagination: 'cursor', q: 'Grade' })).results.map(row => row.id)).toEqual([f.groupB.id]);
    expect((await f.service.attentionConversations(f.learner)).results).toEqual([]);
    await expect(f.service.conversation(f.learner, f.groupA.id)).rejects.toThrow('Conversation not found');
    await expect(f.service.messages(f.learner, f.groupA.id)).rejects.toThrow('Conversation not found');
    await expect(f.service.markRead(f.learner, f.groupA.id, request(f.learner))).rejects.toThrow('Conversation not found');
    await expect(f.service.send(f.learner, f.groupA.id, { body: 'No old-class access' }, undefined, request(f.learner))).rejects.toThrow('Conversation not found');
    await expect(f.service.attachment(f.learner, f.groupA.id, randomUUID())).rejects.toThrow('Conversation not found');
    expect((await sql<{ body: string }>`SELECT body FROM chat_messages WHERE conversation_id=${f.groupA.id}::uuid`.execute(database)).rows).toEqual([{ body: 'Retained class history' }]);
    expect((await sql<{ state: string }>`SELECT state FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND idempotency_key=${`enrollment-lifecycle:${reviewId}`}`.execute(database)).rows[0]!.state).toBe('accepted');
  });

  it.each(['withdraw', 'transfer_out'] as const)('revokes a %s through the same native authority even with a stale active participant', async action => {
    const f = await fixture(); await move(database, f, action);
    // Deliberately simulate a delayed/stale projection: authorization must not trust it.
    await sql`UPDATE chat_participants SET is_active=true WHERE conversation_id=${f.groupA.id}::uuid AND user_id=${f.learner.id}::uuid`.execute(database);
    expect(await allowed(database, f)).toEqual({ allowed: false, realtime: false });
    await expect(f.service.messages(f.learner, f.groupA.id)).rejects.toThrow('Conversation not found');
    expect((await sql`SELECT id FROM enrollments WHERE student_id=${f.student.id}::uuid`.execute(database)).rows).toHaveLength(1);
  });

  it('rolls the projection back atomically if the owning enrollment command fails', async () => {
    const f = await fixture(); const marker = new Error('Rollback source and derived access');
    await expect(database.transaction().execute(async tx => {
      await sql`UPDATE enrollments SET is_active=false,inactive_from=${f.today}::date,exit_kind='withdrawn',exit_reason='Rollback test',ended_by=${f.owner.id}::uuid,ended_at=now(),revision=revision+1 WHERE id=${f.enrollment.id}::uuid`.execute(tx);
      expect((await sql<{ active: boolean }>`SELECT is_active AS active FROM chat_participants WHERE conversation_id=${f.groupA.id}::uuid AND user_id=${f.learner.id}::uuid`.execute(tx)).rows[0]!.active).toBe(false);
      throw marker;
    })).rejects.toThrow(marker.message);
    expect(await allowed(database, f)).toEqual({ allowed: true, realtime: true });
  });

  it('projects a later explicit student-account attachment and revokes/reactivates campus membership', async () => {
    const f = await fixture({ passive: true });
    expect(await allowed(database, f)).toEqual({ allowed: false, realtime: false });
    await sql`UPDATE students SET user_id=${f.learner.id}::uuid WHERE id=${f.student.id}::uuid`.execute(database);
    await database.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: f.learner.id, role: 'student' }).execute();
    expect(await allowed(database, f)).toEqual({ allowed: true, realtime: true });
    await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${f.schoolId}::uuid AND user_id=${f.learner.id}::uuid`.execute(database);
    expect(await allowed(database, f)).toEqual({ allowed: false, realtime: false });
    await sql`UPDATE school_memberships SET is_active=true WHERE school_id=${f.schoolId}::uuid AND user_id=${f.learner.id}::uuid`.execute(database);
    expect(await allowed(database, f)).toEqual({ allowed: true, realtime: true });
    await sql`UPDATE users SET is_active=false WHERE id=${f.learner.id}::uuid`.execute(database);
    expect(await allowed(database, f)).toEqual({ allowed: false, realtime: false });
  });

  it('keeps directory, search, exact detail and attention genuinely read-only', async () => {
    const f = await fixture();
    const before = (await sql`SELECT conversation_id,user_id,xmin::text AS revision FROM chat_participants WHERE conversation_id IN (${f.groupA.id}::uuid,${f.groupB.id}::uuid) ORDER BY 1,2`.execute(database)).rows;
    await database.transaction().execute(async tx => {
      await sql`SET TRANSACTION READ ONLY`.execute(tx);
      const service = chat(fixtureTransactionDatabase(tx));
      await service.conversations(f.owner);
      await service.conversations(f.owner, { pagination: 'cursor', q: 'Grade' });
      await service.conversation(f.learner, f.groupA.id);
      await service.attentionConversations(f.owner);
    });
    expect((await sql`SELECT conversation_id,user_id,xmin::text AS revision FROM chat_participants WHERE conversation_id IN (${f.groupA.id}::uuid,${f.groupB.id}::uuid) ORDER BY 1,2`.execute(database)).rows).toEqual(before);
  });

  it('keeps future enrollment indexed but does not grant early class access', async () => {
    const f = await fixture({ future: true });
    expect((await sql<{ active: boolean }>`SELECT is_active AS active FROM chat_participants WHERE conversation_id=${f.groupA.id}::uuid AND user_id=${f.learner.id}::uuid`.execute(database)).rows[0]!.active).toBe(true);
    expect(await allowed(database, f)).toEqual({ allowed: false, realtime: false });
  });

  it('binds public lists and exact conversation actions to the selected active campus, not any campus membership', async () => {
    const a = await fixture(), b = await fixture();
    // One real account has explicit administrative membership in both campuses.
    await database.insertInto('school_memberships').values({ school_id: b.schoolId, user_id: a.owner.id, role: 'admin' }).execute();
    const switched = { ...a.owner, active_school_id: b.schoolId };
    await sql`INSERT INTO chat_messages(conversation_id,sender_id,body) VALUES(${b.groupA.id}::uuid,${b.owner.id}::uuid,'Campus B only')`.execute(database);
    for (const input of [undefined, { pagination: 'cursor', q: 'Grade' }]) {
      expect((await a.service.conversations(a.owner, input)).results.every(row => row.school_id === a.schoolId)).toBe(true);
      const selectedB = await a.service.conversations(switched, input);
      expect(selectedB.results.length).toBeGreaterThan(0);
      expect(selectedB.results.every(row => row.school_id === b.schoolId)).toBe(true);
    }
    await expect(a.service.conversation(a.owner, b.groupA.id)).rejects.toThrow('Conversation not found');
    await expect(a.service.messages(a.owner, b.groupA.id)).rejects.toThrow('Conversation not found');
    await expect(a.service.markRead(a.owner, b.groupA.id, request(a.owner))).rejects.toThrow('Conversation not found');
    await expect(a.service.send(a.owner, b.groupA.id, { body: 'Wrong selected campus' }, undefined, request(a.owner))).rejects.toThrow('Conversation not found');
    await expect(a.service.conversation(switched, b.groupA.id)).resolves.toMatchObject({ id: b.groupA.id, school_id: b.schoolId });
    expect((await a.service.messages(switched, b.groupA.id)).results.map(row => row.body)).toContain('Campus B only');
    // An internal attention caller still owns its explicit institution filter;
    // the public selected-campus guard must not silently narrow that projection.
    expect((await a.service.attentionConversations(a.owner)).results.some(row => row.school_id === b.schoolId)).toBe(true);
    for (const missing of [null, randomUUID()]) {
      const invalid = { ...a.owner, active_school_id: missing };
      await expect(a.service.conversations(invalid)).rejects.toThrow(missing ? 'No active membership' : 'Choose an institution');
      await expect(a.service.conversation(invalid, a.groupA.id)).rejects.toThrow(missing ? 'No active membership' : 'Choose an institution');
      await expect(a.service.messages(invalid, a.groupA.id)).rejects.toThrow(missing ? 'No active membership' : 'Choose an institution');
    }
    await sql`UPDATE school_memberships SET is_active=false WHERE school_id=${b.schoolId}::uuid AND user_id=${a.owner.id}::uuid`.execute(database);
    await expect(a.service.conversations(switched)).rejects.toThrow('No active membership');
    await expect(a.service.conversation(switched, b.groupA.id)).rejects.toThrow('No active membership');
  });

  it('projects an exact later teaching assignment without granting other classes and revokes its ended scope', async () => {
    const f = await fixture(), suffix = randomUUID();
    const teacher = await database.insertInto('users').values({ username: `class-teacher-${suffix}`, email: `class-teacher-${suffix}@example.test`, password_hash: 'isolated-fixture-only', first_name: 'Class', last_name: 'Teacher', role: 'staff' }).returningAll().executeTakeFirstOrThrow();
    await database.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: teacher.id, role: 'staff' }).execute();
    const assignment = (await sql<{ id: string }>`INSERT INTO class_section_staff_assignments(school_id,class_section_id,user_id,role,valid_from,assigned_by)
      VALUES(${f.schoolId}::uuid,${f.classA}::uuid,${teacher.id}::uuid,'class_teacher',${f.today}::date,${f.owner.id}::uuid) RETURNING id`.execute(database)).rows[0]!;
    const actor = { ...teacher, active_school_id: f.schoolId } as AuthUser;
    await expect(f.service.conversation(actor, f.groupA.id)).resolves.toMatchObject({ id: f.groupA.id });
    await expect(f.service.conversation(actor, f.groupB.id)).rejects.toThrow('Conversation not found');
    await sql`UPDATE class_section_staff_assignments SET ended_at=now(),access_revision=access_revision+1 WHERE id=${assignment.id}::uuid`.execute(database);
    await expect(f.service.conversation(actor, f.groupA.id)).rejects.toThrow('Conversation not found');
  });

  it('serializes simultaneous source admissions without duplicate groups, deadlock or resetting read state', async () => {
    const f = await fixture();
    await sql`DELETE FROM chat_conversations WHERE id=${f.groupA.id}::uuid`.execute(database);
    const learners = await Promise.all([2, 3].map(async roll => {
      const suffix = randomUUID();
      const account = await database.insertInto('users').values({ username: `concurrent-${suffix}`, email: `concurrent-${suffix}@example.test`, password_hash: 'isolated-fixture-only', first_name: `Concurrent ${roll}`, last_name: '', role: 'student' }).returning('id').executeTakeFirstOrThrow();
      await database.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: account.id, role: 'student' }).execute();
      const person = await database.insertInto('school_people').values({ school_id: f.schoolId, first_name: `Concurrent ${roll}` }).returning('id').executeTakeFirstOrThrow();
      return database.insertInto('students').values({ school_id: f.schoolId, person_id: person.id, user_id: account.id, admission_number: `CONCURRENT-${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow();
    }));
    await Promise.all(learners.map((learner, index) => database.transaction().execute(async tx => {
      await sql`INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on)
        VALUES(${learner.id}::uuid,${f.classA}::uuid,${f.term.id}::uuid,${index + 2}::smallint,${f.today}::date)`.execute(tx);
    })));
    const groups = (await sql<{ id: string }>`SELECT id FROM chat_conversations WHERE school_id=${f.schoolId}::uuid AND class_section_id=${f.classA}::uuid`.execute(database)).rows;
    expect(groups).toHaveLength(1);
    const id = groups[0]!.id;
    await sql`UPDATE chat_participants SET last_read_at=now(),is_muted=true WHERE conversation_id=${id}::uuid AND user_id=${f.learner.id}::uuid`.execute(database);
    const before = (await sql`SELECT xmin::text,last_read_at,is_muted FROM chat_participants WHERE conversation_id=${id}::uuid AND user_id=${f.learner.id}::uuid`.execute(database)).rows[0];
    await sql`SELECT chat_reconcile_class_group(${f.classA}::uuid,${f.learner.id}::uuid)`.execute(database);
    expect((await sql`SELECT xmin::text,last_read_at,is_muted FROM chat_participants WHERE conversation_id=${id}::uuid AND user_id=${f.learner.id}::uuid`.execute(database)).rows[0]).toEqual(before);
  });

  it('does not recreate a deleted thread during source cleanup or turn a missing explicit actor into an arbitrary creator', async () => {
    const f = await fixture();
    await sql`DELETE FROM chat_conversations WHERE school_id=${f.schoolId}::uuid`.execute(database);
    await sql`DELETE FROM enrollments WHERE id=${f.enrollment.id}::uuid`.execute(database);
    expect((await sql`SELECT id FROM chat_conversations WHERE school_id=${f.schoolId}::uuid`.execute(database)).rows).toEqual([]);
  });

  it.runIf(Boolean(process.env.SIMULATION_CHAT_CLASS_TEST_TARGET_URL))('uses the same source trigger and People command inside actual COW with unchanged Live and sibling', async () => {
    const f = await fixture();
    const target = requireIsolatedTestDatabaseUrl(process.env.SIMULATION_CHAT_CLASS_TEST_TARGET_URL);
    const store = new SimulationSnapshotStore(requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL), target, 4);
    const opened: Kysely<Database>[] = [];
    try {
      const now = new Date().toISOString(); const captured = await store.capture(f.schoolId, now);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const connection = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: db => compiler.createIntrospector(db) } });
        opened.push(connection);
        const runAt = <T>(instant: string, action: () => Promise<T>) => executionEnvironmentStorage.run(simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: instant, source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: 'chat-class-source-test', checked_at: now }), action);
        return { database: connection as DatabaseService, run: <T>(action: () => Promise<T>) => runAt(now, action), runAt };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect(await allowed(branch.database, f)).toEqual({ allowed: true, realtime: true });
        await move(branch.database, f);
        expect(await allowed(branch.database, f)).toEqual({ allowed: false, realtime: false });
        expect(await allowed(branch.database, f, f.groupB.id)).toEqual({ allowed: true, realtime: true });
        await expect(chat(branch.database).messages(f.learner, f.groupA.id)).rejects.toThrow('Conversation not found');
        await sql`UPDATE enrollments SET enrolled_on=${f.today}::date+1 WHERE student_id=${f.student.id}::uuid AND is_active`.execute(branch.database);
        expect(await allowed(branch.database, f, f.groupB.id)).toEqual({ allowed: false, realtime: false });
      });
      await branch.runAt(new Date(new Date(now).getTime() + 2 * 86_400_000).toISOString(), async () => {
        // The source-indexed participant becomes usable at the selected world's
        // campus-local date, without a source write or borrowing the Live clock.
        expect(await allowed(branch.database, f, f.groupB.id)).toEqual({ allowed: true, realtime: true });
      });
      expect(await allowed(database, f)).toEqual({ allowed: true, realtime: true });
      expect(await sibling.run(() => allowed(sibling.database, f))).toEqual({ allowed: true, realtime: true });
      expect((await sql<{ class_section_id: string }>`SELECT class_section_id FROM enrollments WHERE student_id=${f.student.id}::uuid AND is_active`.execute(database)).rows[0]!.class_section_id).toBe(f.classA);
      expect((await store.pool.query('SELECT count(*)::int AS count FROM dt_simulation.materialized_tables WHERE table_name IN ($1,$2)', ['chat_participants', 'chat_conversations'])).rows[0].count).toBeGreaterThanOrEqual(2);
    } finally { await Promise.all(opened.map(connection => connection.destroy())); await store.pool.end(); }
  }, 180_000);
});
