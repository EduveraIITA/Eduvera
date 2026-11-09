import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { SchoolService } from '../src/school/school.service.js';
import type { SchoolEventService } from '../src/school/school-event.service.js';
import type { StaffCoverageReconciliationPort } from '../src/staff-operations/staff-coverage-reconciliation.service.js';
import { createExternalRepairFixture } from './facilities-external-work.test-support.js';
import { acceptWithRecipientProof } from './invitation-recipient-proof.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/notification_bell_unused_test';
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 3 }) }) }) as DatabaseService;
const school = new SchoolService(db, {} as SchoolEventService, {} as StaffCoverageReconciliationPort);
// Unique fixtures remain in the disposable database; never bypass retained
// source/history protections to clean up another test's records.
afterAll(() => db.destroy());

type Bell = Awaited<ReturnType<SchoolService['notifications']>>;
type BellRow = Bell['results'][number];
type Cursor = { created_at: string; id: string };
const cursorFor = (row: { created_at: Date | string; id: string }) => Buffer.from(JSON.stringify({
  created_at: new Date(row.created_at).toISOString(), id: row.id,
}), 'utf8').toString('base64url');

/** Frozen pre-optimization SQL: independently execute the former list and
 * count against the real migrated predicates, without a replacement function. */
async function oldBell(user: AuthUser, limit: number, cursor?: string): Promise<Bell> {
  if (user.active_school_id) {
    const scope = (await sql<{ limited: boolean }>`SELECT campus_membership_is_work_only(${user.active_school_id}::uuid,${user.id}::uuid) AS limited`.execute(db)).rows[0];
    if (scope?.limited) return { results: [], unread_count: 0, next_cursor: null };
  }
  const after = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor : null;
  const keyset = after ? sql`AND (created_at<${after.created_at}::timestamptz OR (created_at=${after.created_at}::timestamptz AND id<${after.id}::uuid))` : sql``;
  const [list, count] = await Promise.all([
    sql<BellRow>`SELECT id,kind,title,body,link,metadata,read_at,created_at,attention_eligible
      FROM notifications WHERE recipient_id=${user.id}::uuid
        AND notification_is_currently_visible(id,${user.id}::uuid) ${keyset}
      ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`.execute(db),
    sql<{ count: string }>`SELECT count(*)::text AS count FROM notifications
      WHERE recipient_id=${user.id}::uuid AND read_at IS NULL
        AND notification_is_currently_visible(id,${user.id}::uuid)`.execute(db),
  ]);
  const results = list.rows.slice(0, limit);
  return { results, unread_count: Number(count.rows[0]?.count ?? 0),
    next_cursor: list.rows.length > limit && results.length ? cursorFor(results[results.length - 1]!) : null };
}

async function parity(user: AuthUser, limit = 100, cursor?: string) {
  const expected = await oldBell(user, limit, cursor);
  const actual = await school.notifications(user, { limit: String(limit), ...(cursor ? { cursor } : {}) });
  expect(actual).toEqual(expected);
  return actual;
}
async function pages(user: AuthUser, limit: number) {
  const rows: BellRow[] = []; let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await parity(user, limit, cursor); rows.push(...result.results);
    if (!result.next_cursor) return rows;
    cursor = result.next_cursor;
  }
  throw new Error('Notification keyset pagination did not terminate');
}

async function account(role: AuthUser['role'], schoolId: string): Promise<AuthUser> {
  const suffix = randomUUID();
  const row = await db.insertInto('users').values({ username: `bell-${suffix}`, email: `bell-${suffix}@example.test`,
    password_hash: 'isolated-notification-fixture', first_name: 'Notification', last_name: 'Fixture', role, email_verified_at: new Date() })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  return { ...row, active_school_id: schoolId };
}
async function person(schoolId: string, name: string) {
  return db.insertInto('school_people').values({ school_id: schoolId, first_name: name, last_name: 'Bell fixture' }).returning('id').executeTakeFirstOrThrow();
}
async function fixture() {
  const suffix = randomUUID().slice(0, 12);
  const home = await db.insertInto('schools').values({ name: 'Notification bell native parity fixture', code: `BELL-${suffix}`, timezone: 'UTC' }).returning('id').executeTakeFirstOrThrow();
  const other = await db.insertInto('schools').values({ name: 'Notification bell other institution fixture', code: `BELLO-${suffix}`, timezone: 'UTC' }).returning('id').executeTakeFirstOrThrow();
  const guardian = await account('parent', home.id), learner = await account('student', home.id), stranger = await account('parent', other.id);
  await db.insertInto('school_memberships').values([
    { school_id: home.id, user_id: guardian.id, role: 'guardian' },
    { school_id: home.id, user_id: learner.id, role: 'student' },
    { school_id: other.id, user_id: stranger.id, role: 'guardian' },
  ]).execute();
  const childPerson = await person(home.id, 'Learner'), foreignPerson = await person(other.id, 'Other learner'), guardianPerson = await person(home.id, 'Guardian');
  const child = await db.insertInto('students').values({ school_id: home.id, person_id: childPerson.id, user_id: learner.id, admission_number: 'BELL-CHILD' }).returning('id').executeTakeFirstOrThrow();
  const foreign = await db.insertInto('students').values({ school_id: other.id, person_id: foreignPerson.id, user_id: null, admission_number: 'BELL-OTHER' }).returning('id').executeTakeFirstOrThrow();
  const parent = await db.insertInto('parents').values({ user_id: guardian.id }).returning('id').executeTakeFirstOrThrow();
  await db.insertInto('guardian_school_profiles').values({ school_id: home.id, guardian_id: parent.id, person_id: guardianPerson.id }).execute();
  const relationship = await db.insertInto('guardian_relationships').values({ school_id: home.id, guardian_id: parent.id, student_id: child.id, relationship: 'guardian' }).returning('id').executeTakeFirstOrThrow();
  return { schoolId: home.id, otherSchoolId: other.id, guardian, learner, stranger, childId: child.id, foreignChildId: foreign.id, parentId: parent.id, relationshipId: relationship.id };
}

async function notification(user: AuthUser, input: {
  createdAt?: string; read?: boolean; metadata?: Record<string, unknown>; title?: string;
} = {}) {
  return db.insertInto('notifications').values({ recipient_id: user.id, kind: 'general', title: input.title ?? 'Native bell parity', body: 'Preserved source facts',
    link: '/more/account?section=security', metadata: input.metadata ?? {}, created_at: input.createdAt ?? '2026-10-31T10:00:00.000Z',
    read_at: input.read ? '2026-10-31T10:01:00.000Z' : null }).returningAll().executeTakeFirstOrThrow();
}
async function calendarTopic(schoolId: string) {
  const sourceId = randomUUID();
  await sql`INSERT INTO calendar_attention_topics(school_id,date,revision,source_id,change_kind,record_revision)
    VALUES(${schoolId}::uuid,date '2026-10-31',1,${sourceId}::uuid,'created',1)`.execute(db);
  return sourceId;
}
async function calendarNotification(user: AuthUser, schoolId: string, sourceId: string, revision = 1, read = false) {
  return db.insertInto('notifications').values({ recipient_id: user.id, kind: 'general', title: 'Calendar source changed', body: 'Durable calendar revision',
    link: `/areas/calendar?date=2026-10-31&calendar_change=${sourceId}&calendar_revision=${revision}`,
    metadata: { date: '2026-10-31', calendar_change_kind: 'created', nested: { revision, preserved: true } },
    created_at: new Date(Date.parse('2026-10-31T10:00:00.000Z') + revision * 1_000), read_at: read ? '2026-10-31T10:01:00.000Z' : null,
    // Typed current-source authorization must outrank this absent legacy event.
    dedupe_key: `event:${randomUUID()}`, attention_eligible: true, attention_school_id: schoolId, attention_portal: 'parent',
    attention_module: 'calendar', attention_source_kind: 'calendar_change', attention_source_id: sourceId,
    attention_source_revision: revision, attention_topic_key: 'calendar:2026-10-31' }).returningAll().executeTakeFirstOrThrow();
}

describe.skipIf(!enabled)('Notification bell real PostgreSQL list/count parity', () => {
  it('matches every keyset page with timestamp ties, interspersed invisible rows, read history and a global unread count after the final row', async () => {
    const f = await fixture(), visible: Array<{ id: string; created_at: Date; read_at: Date | null }> = [];
    for (let index = 0; index < 16; index++) {
      const createdAt = index === 15 ? '2001-01-01T00:00:00.000Z' : `2026-10-31T10:00:0${index % 3}.000Z`;
      visible.push(await notification(f.guardian, { createdAt, read: index % 4 === 0,
        metadata: index % 2 ? { student_id: f.childId, revision: index, labels: ['preserved', 'native'] } : {}, title: `Visible ${index}` }));
      await notification(f.guardian, { createdAt, metadata: { student_id: index % 2 ? f.foreignChildId : randomUUID() }, read: index % 3 === 0, title: `Invisible ${index}` });
      await notification(f.stranger, { createdAt, title: `Another actor ${index}` });
    }
    visible.push(await calendarNotification(f.guardian, f.schoolId, await calendarTopic(f.schoolId)));
    visible.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id));
    const expectedIds = visible.map(row => row.id), unread = visible.filter(row => !row.read_at).length;
    for (const limit of [1, 3, 100]) {
      const result = await pages(f.guardian, limit);
      expect(result.map(row => row.id)).toEqual(expectedIds); expect(new Set(result.map(row => row.id)).size).toBe(visible.length);
    }
    const empty = await parity(f.guardian, 1, cursorFor(visible[visible.length - 1]!));
    expect(empty).toEqual({ results: [], unread_count: unread, next_cursor: null });
    const invisible = await db.selectFrom('notifications').select(['id', 'created_at']).where('recipient_id', '=', f.guardian.id).where('title', '=', 'Invisible 7').executeTakeFirstOrThrow();
    expect((await parity(f.guardian, 3, cursorFor(invisible))).unread_count).toBe(unread);
  });

  it('returns an empty bell without source rows and includes read history without counting invisible unread rows', async () => {
    const f = await fixture(); expect(await parity(f.guardian, 1)).toEqual({ results: [], unread_count: 0, next_cursor: null });
    const history = await notification(f.guardian, { read: true, metadata: { student_id: f.childId } });
    await notification(f.guardian, { metadata: { student_id: randomUUID() } });
    const page = await parity(f.guardian, 100); expect(page.results.map(row => row.id)).toEqual([history.id]); expect(page.unread_count).toBe(0);
    await notification(f.guardian); expect((await parity(f.guardian)).unread_count).toBe(1);
    await db.updateTable('notifications').set({ read_at: new Date() }).where('recipient_id', '=', f.guardian.id).execute();
    const read = await parity(f.guardian); expect(read.results).toHaveLength(2); expect(read.unread_count).toBe(0);
  });

  it('rechecks the current account even when the caller retains a previously active identity', async () => {
    const f = await fixture(); await notification(f.guardian); await notification(f.guardian, { metadata: { student_id: f.childId } });
    await calendarNotification(f.guardian, f.schoolId, await calendarTopic(f.schoolId));
    expect((await parity(f.guardian)).unread_count).toBe(3);
    await db.updateTable('users').set({ is_active: false }).where('id', '=', f.guardian.id).execute();
    expect(f.guardian.is_active).toBe(true);
    expect(await parity(f.guardian, 1)).toEqual({ results: [], unread_count: 0, next_cursor: null });
  });

  it('rechecks membership by source institution, preserves authorized other-campus notifications and never borrows another actor or child', async () => {
    const f = await fixture(), personal = await notification(f.guardian);
    const ownChild = await notification(f.guardian, { metadata: { student_id: f.childId } });
    const ownCalendar = await calendarNotification(f.guardian, f.schoolId, await calendarTopic(f.schoolId));
    const otherCalendar = await calendarNotification(f.guardian, f.otherSchoolId, await calendarTopic(f.otherSchoolId));
    await notification(f.guardian, { metadata: { student_id: f.foreignChildId } }); await notification(f.stranger);
    expect(new Set((await parity(f.guardian)).results.map(row => row.id))).toEqual(new Set([personal.id, ownChild.id, ownCalendar.id]));
    await db.insertInto('school_memberships').values({ school_id: f.otherSchoolId, user_id: f.guardian.id, role: 'guardian' }).execute();
    expect(new Set((await parity(f.guardian)).results.map(row => row.id))).toEqual(new Set([personal.id, ownChild.id, ownCalendar.id, otherCalendar.id]));
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.guardian.id).execute();
    const revoked = await parity(f.guardian, 1); expect(revoked.unread_count).toBe(2);
    expect(new Set((await pages(f.guardian, 1)).map(row => row.id))).toEqual(new Set([personal.id, otherCalendar.id]));
    expect((await parity(f.stranger)).results.every(row => row.title !== 'Calendar source changed')).toBe(true);
  });

  it('revokes guardian and learner source scope immediately without deleting their personal notification history', async () => {
    const f = await fixture(), guardianHistory = await notification(f.guardian, { read: true }), learnerHistory = await notification(f.learner, { read: true });
    await notification(f.guardian, { metadata: { student_id: f.childId } }); await notification(f.learner, { metadata: { student_id: f.childId } });
    expect((await parity(f.guardian)).unread_count).toBe(1); expect((await parity(f.learner)).unread_count).toBe(1);
    await db.deleteFrom('guardian_relationships').where('id', '=', f.relationshipId).execute();
    expect((await parity(f.guardian)).results.map(row => row.id)).toEqual([guardianHistory.id]); expect((await parity(f.guardian)).unread_count).toBe(0);
    expect((await parity(f.learner)).unread_count).toBe(1);
    await db.updateTable('students').set({ user_id: null }).where('id', '=', f.childId).execute();
    const learner = await parity(f.learner); expect(learner.results.map(row => row.id)).toEqual([learnerHistory.id]); expect(learner.unread_count).toBe(0);
  });

  it('preserves exact legacy chat visibility and higher-priority source checks', async () => {
    const f = await fixture();
    const chat = await db.insertInto('chat_conversations').values({ school_id: f.schoolId, kind: 'direct', title: 'Learner support',
      context_student_id: f.childId, created_by: f.learner.id }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('chat_participants').values({ conversation_id: chat.id, user_id: f.guardian.id }).execute();
    const metadata = { conversation_id: chat.id, student_id: f.childId };
    const current = await notification(f.guardian, { metadata });
    const malformed = await notification(f.guardian, { metadata: { ...metadata, conversation_id: 'bad-uuid' } });
    const wrongRecipient = await notification(f.learner, { metadata });
    const notice = await notification(f.guardian, { metadata: { ...metadata, notice_recipient_id: randomUUID() } });
    const review = await notification(f.guardian, { metadata: { ...metadata, notification_scope: 'chat_report_review', report_id: randomUUID() } });
    async function visibility(id: string, actor: AuthUser) {
      return (await sql<{ actual: boolean; prior: boolean }>`SELECT
        notification_is_currently_visible(${id}::uuid,${actor.id}::uuid) AS actual,
        notification_is_currently_visible_before_event_optimization(${id}::uuid,${actor.id}::uuid) AS prior`.execute(db)).rows[0];
    }
    expect(await visibility(current.id, f.guardian)).toEqual({ actual: true, prior: true });
    for (const row of [malformed, notice, review]) {
      expect(await visibility(row.id, f.guardian)).toEqual({ actual: false, prior: false });
    }
    expect(await visibility(wrongRecipient.id, f.learner)).toEqual({ actual: false, prior: false });
    const page = await school.notifications(f.guardian, { limit: '1' });
    expect(page.results.map(row => row.id)).toEqual([current.id]);
    expect(page.unread_count).toBe(1);
    await db.deleteFrom('guardian_relationships').where('id', '=', f.relationshipId).execute();
    expect(await visibility(current.id, f.guardian)).toEqual({ actual: false, prior: false });
    expect(await school.notifications(f.guardian, { limit: '1' })).toEqual({ results: [], unread_count: 0, next_cursor: null });
  });

  it('uses the durable current revision before read filtering, so a read replacement never restores an older unread alert', async () => {
    const f = await fixture(), sourceId = await calendarTopic(f.schoolId), first = await calendarNotification(f.guardian, f.schoolId, sourceId);
    expect((await parity(f.guardian)).results.map(row => row.id)).toEqual([first.id]);
    await sql`UPDATE calendar_attention_topics SET revision=2,record_revision=2 WHERE school_id=${f.schoolId}::uuid AND date=date '2026-10-31'`.execute(db);
    expect(await parity(f.guardian)).toEqual({ results: [], unread_count: 0, next_cursor: null });
    const current = await calendarNotification(f.guardian, f.schoolId, sourceId, 2, true);
    const page = await parity(f.guardian, 1); expect(page.results.map(row => row.id)).toEqual([current.id]); expect(page.unread_count).toBe(0);
    expect((await db.selectFrom('notifications').select('read_at').where('id', '=', first.id).executeTakeFirstOrThrow()).read_at).toBeNull();
    expect(await parity(f.guardian, 1, cursorFor(current))).toEqual({ results: [], unread_count: 0, next_cursor: null });
  });

  it('keeps the assigned-work-only bell gate after ordinary exact-source invitation acceptance', async () => {
    const f = await createExternalRepairFixture(db, { pending: true });
    await f.run(async () => {
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      const invitation = await f.invitations.create(f.user, f.schoolId, { role: 'member', person_id: f.person.id,
        email: f.email, idempotency_key: randomUUID(), work_context: { kind: 'facility_repair', source_id: f.repair.id, access_id: grant.external_access!.id } });
      if (invitation.delivery !== 'manual' || !invitation.token) throw new Error('The isolated notification fixture needs its normal manual invitation');
      await acceptWithRecipientProof(f.operations, { email: f.email, token: invitation.token, password: f.password, first_name: 'Bell technician', last_name: '' });
      const row = await db.selectFrom('users').select(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).where('email', '=', f.email).executeTakeFirstOrThrow();
      const technician: AuthUser = { ...row, active_school_id: f.schoolId }, personal = await notification(technician);
      expect((await sql<{ visible: boolean }>`SELECT notification_is_currently_visible(${personal.id}::uuid,${technician.id}::uuid) AS visible`.execute(db)).rows[0]?.visible).toBe(true);
      expect(await db.selectFrom('school_memberships').select(['role', 'access_scope']).where('user_id', '=', technician.id).execute()).toEqual([{ role: 'member', access_scope: 'assigned_work' }]);
      expect(await parity(technician, 1)).toEqual({ results: [], unread_count: 0, next_cursor: null });
    });
  }, 60_000);
});
