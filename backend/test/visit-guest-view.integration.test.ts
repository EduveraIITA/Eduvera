import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { visitSharingHash } from '../src/gate/visit-sharing.model.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import { createVisitGuestFixture, visitGuestCommand, visitGuestLater, visitGuestRunAt } from './visit-guest-view.test-support.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/visit_guest_unused_test';
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = 'false'; });
afterAll(() => db.destroy());

describe.runIf(enabled)('Exact private visitor self-service through the owning Gate services', () => {
  it('minimizes a whole-campus destination without substituting a room or leaking general campus access',async()=>{
    const f=await createVisitGuestFixture(db,{wholeCampus:true}),input=await f.shareInput(0);
    await f.run(()=>f.sharing.share(f.user,f.schoolId,f.visit.id,input));
    const detail=await f.run(()=>f.sharing.sharedDetail(f.joined!.user,f.schoolId,f.visit.id));
    expect(detail.visit.place).toMatchObject({id:f.campusId,kind:'campus'});
    expect(detail.visit).not.toHaveProperty('last_movement');
  },60_000);

  it('joins one canonical organiser through independent recipient proof and continues only the shared visit', async () => {
    const f = await createVisitGuestFixture(db, { pending: true });
    await db.updateTable('schools').set({ timezone: 'Asia/Kolkata' }).where('id', '=', f.schoolId).execute();
    const sharedInput = await f.shareInput(0), sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, sharedInput));
    const access = sharing.current!;
    expect(access.id).toBeTruthy();
    const other = (await f.run(() => f.visits.create(f.user, f.schoolId, f.visitInput({ guest_name: 'Independent pending visit party' })))).visit;
    const otherShare = await f.run(async () => f.sharing.share(f.user, f.schoolId, other.id,
      { ...await f.shareInput(0), expected_visit_revision: other.revision }));
    const otherInvitation = await f.operations.invite(f.user, f.schoolId, { role: 'member', person_id: f.organiser.id,
      email: f.email, idempotency_key: randomUUID(), work_context: { kind: 'visit_arrangement', source_id: other.id, access_id: otherShare.current!.id } });
    const blockedKey = randomUUID();
    await expect(f.operations.invite(f.user, f.schoolId, { role: 'member', person_id: f.organiser.id, email: f.email,
      idempotency_key: blockedKey, work_context: { kind: 'visit_arrangement', source_id: f.visit.id, access_id: access.id } }))
      .rejects.toMatchObject({ response: { code: 'person_invitation_exists', fields: { person_invitation: {
        confirmation: 'not_created', idempotency_key: blockedKey } } } });
    expect((await db.selectFrom('school_invitations').select('revoked_at').where('id', '=', otherInvitation.id).executeTakeFirstOrThrow()).revoked_at).toBeNull();
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
    await expect(f.operations.recipientProof({ email: f.email, token: otherInvitation.token })).rejects.toThrow();
    await db.updateTable('school_memberships').set({ is_active: true }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
    await f.operations.revokeInvitation(f.user, f.schoolId, otherInvitation.id);
    const joined = await f.join({ kind: 'visit_arrangement', source_id: f.visit.id, access_id: access.id });
    expect(joined.acceptance).toMatchObject({ continuation: { kind: 'visit_arrangement', school_id: f.schoolId, source_id: f.visit.id } });
    const membership = await db.selectFrom('school_memberships').select(['role', 'access_scope'])
      .where('school_id', '=', f.schoolId).where('user_id', '=', joined.user.id).executeTakeFirstOrThrow();
    expect(membership).toEqual({ role: 'member', access_scope: 'assigned_work' });
    const identity = await f.run(() => db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, {
      school_id: f.schoolId, user_id: joined.user.id, at: f.now })));
    expect(identity).toMatchObject({ acting: true, person_id: f.organiser.id });
    const continuation = await f.operations.invitationContinuation(joined.user, f.schoolId, joined.invitation.id);
    expect(continuation).toMatchObject({ kind: 'visit_arrangement', source_id: f.visit.id });
    const guest = await f.run(() => f.sharing.sharedDetail(joined.user, f.schoolId, f.visit.id));
    expect(guest.timezone).toBe('Asia/Kolkata');
    expect((await f.run(() => f.sharing.sharedWorkspace(joined.user, f.schoolId))).timezone).toBe(guest.timezone);
    expect(guest.visit).toMatchObject({ id: f.visit.id, state: 'confirmed', party_size: 12 });
    expect(guest.question).toBeNull();
    expect(await db.selectFrom('campus_model_observations').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
    expect(await db.selectFrom('campus_model_operational_messages').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
    await expect(f.run(() => f.visits.detail(joined.user, f.schoolId, f.visit.id))).rejects.toThrow();
    await expect(f.run(() => f.visits.movement(joined.user, f.schoolId, f.visit.id,
      { ...visitGuestCommand(f.visit.revision), direction: 'in', observed_count: 12 }))).rejects.toThrow();
    await db.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: f.borrower.id, role: 'admin' }).execute();
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
    const takeover = await f.run(() => f.sharing.takeover(f.borrower, f.schoolId, f.visit.id, access.id, visitGuestCommand(sharing.share_revision)));
    const personRevision = await f.organiserRevision();
    const renewed = await f.run(() => f.sharing.share(f.borrower, f.schoolId, f.visit.id, { ...sharedInput,
      ...visitGuestCommand(takeover.share_revision), organiser_person_revision: personRevision }));
    expect(renewed.current!.root_id).toBe(access.root_id);
    expect(await f.operations.invitationContinuation(joined.user, f.schoolId, joined.invitation.id))
      .toMatchObject({ kind: 'visit_arrangement', source_id: f.visit.id });
    expect(await f.operations.acceptInvite({ email: f.email, token: joined.invitation.token, password: f.password,
      first_name: 'Fictional Visit Organiser', last_name: '', recover_accepted: true }))
      .toMatchObject({ continuation: { kind: 'visit_arrangement', source_id: f.visit.id } });
    await f.run(() => f.visits.update(f.borrower, f.schoolId, f.visit.id, { ...f.input,
      ...visitGuestCommand(1), guest_name: 'A replacement fictional party' }));
    await expect(f.operations.invitationContinuation(joined.user, f.schoolId, joined.invitation.id)).rejects.toThrow();
    await f.run(() => f.visits.update(f.borrower, f.schoolId, f.visit.id, { ...f.input, ...visitGuestCommand(2) }));
    const replacement = await f.run(() => f.sharing.share(f.borrower, f.schoolId, f.visit.id, { ...sharedInput,
      ...visitGuestCommand(renewed.share_revision), organiser_person_revision: personRevision, expected_visit_revision: 3 }));
    expect(replacement.current!.root_id).not.toBe(access.root_id);
    await expect(f.operations.invitationContinuation(joined.user, f.schoolId, joined.invitation.id)).rejects.toThrow();
  }, 60_000);

  it('shares a minimized current view before arrival, through rescheduling and cancellation, without silently extending access', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    await f.run(() => f.visits.movement(f.user, f.schoolId, f.visit.id,
      { ...visitGuestCommand(1), direction: 'out', observed_count: 3, occurred_at: f.now }));
    const shareInput = await f.shareInput(0), sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, shareInput));
    expect((await db.selectFrom('school_memberships').select('access_scope').where('school_id', '=', f.schoolId)
      .where('user_id', '=', guest.id).executeTakeFirstOrThrow()).access_scope).toBe('campus');
    let detail = await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id));
    expect(detail.share).toMatchObject({ id: sharing.current!.id, ends_at: shareInput.ends_at, directions: shareInput.directions });
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toMatch(/last_movement|observed_count|actor_person_id|actor_user_id|account_user_id|avatar_url|person_revision|contact_revision|last_command_id|last_domain_event_id/u);
    await expect(f.run(() => f.sharing.sharedDetail(f.borrower, f.schoolId, f.visit.id))).rejects.toThrow();
    await expect(f.run(() => f.sharing.management(guest, f.schoolId, f.visit.id))).rejects.toThrow();
    const changed = await f.run(() => f.visits.update(f.user, f.schoolId, f.visit.id, { ...f.input,
      ...visitGuestCommand(2), starts_at: visitGuestLater(f.now, 300), ends_at: visitGuestLater(f.now, 360) }));
    detail = await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id));
    expect(detail.visit).toMatchObject({ starts_at: visitGuestLater(f.now, 300), ends_at: visitGuestLater(f.now, 360) });
    expect(detail.share.ends_at).toBe(shareInput.ends_at);
    await f.run(() => f.visits.cancel(f.user, f.schoolId, f.visit.id, visitGuestCommand(changed.visit.revision)));
    detail = await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id));
    expect(detail.visit.state).toBe('cancelled');
    expect(detail.changes.some(change => change.action === 'cancelled')).toBe(true);
    await expect(visitGuestRunAt(f.schoolId, shareInput.ends_at, () => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).rejects.toThrow();
    const current = await f.run(() => f.visits.detail(f.user, f.schoolId, f.visit.id));
    expect(current.visit).toMatchObject({ state: 'cancelled', last_movement: { direction: 'out', observed_count: 3 } });
    const refresh = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
      .where('event_type', '=', 'gate.visit_shared.updated').orderBy('created_at').executeTakeFirstOrThrow();
    const audience = async (userId: string) => (await sql<{ valid: boolean }>`SELECT event_user_is_authorized(
      ${f.schoolId}::uuid,'gate.visit_shared.updated',${JSON.stringify(refresh.payload)}::jsonb,${userId}::uuid) AS valid`.execute(db)).rows[0]!.valid;
    expect(await f.run(() => audience(guest.id))).toBe(true);
    expect(await f.run(() => audience(f.user.id))).toBe(true);
    expect(await f.run(() => audience(f.borrower.id))).toBe(false);
    await db.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: f.borrower.id, role: 'admin' }).execute();
    expect(await f.run(() => audience(f.borrower.id))).toBe(false);
    const plans = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
      .where('event_type', '=', 'gate.visit_arrangement.updated').execute();
    for (const plan of plans) {
      const envelope = plan.payload as { action: string };
      const valid = (await f.run(() => sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,
        'gate.visit_arrangement.updated',${JSON.stringify(envelope)}::jsonb,${guest.id}::uuid) AS valid`.execute(db))).rows[0]!.valid;
      expect(valid, envelope.action).toBe(['changed', 'cancelled'].includes(envelope.action));
    }
    // Retirement is an explicit adverse identity fixture; it must not break the
    // coordinator's ability to inspect and end retained sharing evidence.
    await sql`UPDATE school_people SET retired_at=now() WHERE school_id=${f.schoolId}::uuid AND id=${f.organiser.id}::uuid`.execute(db);
    const retired = await f.run(() => f.sharing.management(f.user, f.schoolId, f.visit.id));
    expect(retired.current!.organiser).toMatchObject({ id: f.organiser.id, has_app_access: false });
    const ended = await f.run(() => f.sharing.revoke(f.user, f.schoolId, f.visit.id, retired.current!.id, visitGuestCommand(retired.share_revision)));
    const replacement = await db.selectFrom('school_people').select('revision').where('school_id', '=', f.schoolId)
      .where('id', '=', f.borrowerPersonId).executeTakeFirstOrThrow();
    const replaced = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, { ...shareInput,
      ...visitGuestCommand(ended.share_revision), expected_visit_revision: current.visit.revision,
      organiser_person_id: f.borrowerPersonId, organiser_person_revision: replacement.revision }));
    expect(replaced.current!.root_id).not.toBe(sharing.current!.root_id);
    expect((await f.run(() => f.sharing.sharedDetail(f.borrower, f.schoolId, f.visit.id))).question).toBeNull();
  }, 60_000);

  it('invalidates a replaced party permanently instead of resurrecting access when an old name is restored', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    const input = await f.shareInput(0), sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input));
    await f.run(() => f.visits.update(f.user, f.schoolId, f.visit.id, { ...f.input, ...visitGuestCommand(1), guest_name: 'A different fictional party' }));
    await expect(f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).rejects.toThrow();
    await f.run(() => f.visits.update(f.user, f.schoolId, f.visit.id, { ...f.input, ...visitGuestCommand(2) }));
    await expect(f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).rejects.toThrow();
    await expect(f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id,
      { ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'Can the old party still attend?' }))).rejects.toThrow();
    const second = await f.run(() => f.visits.create(f.user, f.schoolId, f.visitInput({ guest_name: 'Independent second visit' })));
    const secondShare = await f.run(() => f.sharing.share(f.user, f.schoolId, second.visit.id,
      { ...input, ...visitGuestCommand(0), expected_visit_revision: second.visit.revision }));
    expect((await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, second.visit.id))).share.id).toBe(secondShare.current!.id);
    expect((await db.selectFrom('users').select('is_active').where('id', '=', guest.id).executeTakeFirstOrThrow()).is_active).toBe(true);
  }, 60_000);

  it('keeps one private question thread and one real request, finishes it on reply and reopens it for a follow-up', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    const sharing = await f.run(async () => f.sharing.share(f.user, f.schoolId, f.visit.id, await f.shareInput(0)));
    const ask = { ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'PRIVATE guest question about a wheelchair-friendly reception route.' };
    let detail = await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask));
    const question = detail.question!;
    expect(question).toMatchObject({ revision: 1, state: 'waiting_for_review' });
    expect((await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask))).question).toEqual(question);
    await expect(f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, { ...ask, note: 'A changed exact retry' }))).rejects.toThrow();
    detail = await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id,
      { ...visitGuestCommand(question.revision), share_id: sharing.current!.id, note: 'PRIVATE additional detail while waiting.' }));
    expect(detail.question).toMatchObject({ id: question.id, revision: 2, state: 'waiting_for_review' });
    const messages = () => db.selectFrom('campus_model_operational_messages').selectAll().where('school_id', '=', f.schoolId)
      .where('state', 'in', ['queued', 'delivered', 'acknowledged']).execute();
    expect(await messages()).toHaveLength(1);
    await db.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: f.borrower.id, role: 'admin' }).execute();
    const questionRefresh = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
      .where('event_type', '=', 'gate.visit_shared.updated').where(sql<boolean>`payload->>'action'='asked'`).executeTakeFirstOrThrow();
    for (const [reader, expected] of [[guest, true], [f.user, true], [f.borrower, false]] as const)
      expect((await f.run(() => sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,
        'gate.visit_shared.updated',${JSON.stringify(questionRefresh.payload)}::jsonb,${reader.id}::uuid) AS valid`.execute(db))).rows[0]!.valid).toBe(expected);
    await expect(f.run(() => f.sharing.reply(f.borrower, f.schoolId, f.visit.id, question.id,
      { ...visitGuestCommand(2), note: 'A selected meeting contact is not automatically the question owner.' }))).rejects.toThrow();
    detail = await f.run(() => f.sharing.reply(f.user, f.schoolId, f.visit.id, question.id,
      { ...visitGuestCommand(2), note: 'Use the reception ramp; the tour coordinator will meet your group there.' }));
    expect(detail.question).toMatchObject({ id: question.id, revision: 3, state: 'answered' });
    expect(detail.question!.entries).toHaveLength(3);
    expect(await messages()).toHaveLength(0);
    detail = await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id,
      { ...visitGuestCommand(3), share_id: sharing.current!.id, note: 'PRIVATE follow-up: is the same entrance open after the time change?' }));
    expect(detail.question).toMatchObject({ id: question.id, revision: 4, state: 'waiting_for_review' });
    expect(await messages()).toHaveLength(1);
    const eventRows = await db.selectFrom('event_outbox').select(['payload', 'notification_payload']).where('school_id', '=', f.schoolId).execute();
    expect(JSON.stringify(eventRows)).not.toContain('PRIVATE');
    const events = await db.selectFrom('campus_model_events').select('payload').where('school_id', '=', f.schoolId).execute();
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    expect(await db.selectFrom('campus_model_observations').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
  }, 60_000);

  it('rechecks current access before retries and atomically orders a question against revocation', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    const input = await f.shareInput(0), sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input));
    const ask = { ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'PRIVATE question racing an explicit access revocation.' };
    const results = await Promise.allSettled([
      f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask)),
      f.run(() => f.sharing.revoke(f.user, f.schoolId, f.visit.id, sharing.current!.id, visitGuestCommand(sharing.share_revision))),
    ]);
    expect(results[1].status).toBe('fulfilled');
    await expect(f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).rejects.toThrow();
    await expect(f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask))).rejects.toThrow();
    if (results[0].status === 'fulfilled') {
      const refresh = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
        .where('event_type', '=', 'gate.visit_shared.updated').where(sql<boolean>`payload->>'action'='asked'`).executeTakeFirstOrThrow();
      expect((await f.run(() => sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,
        'gate.visit_shared.updated',${JSON.stringify(refresh.payload)}::jsonb,${guest.id}::uuid) AS valid`.execute(db))).rows[0]!.valid).toBe(false);
    }
    const outcome = await f.run(() => f.sharing.confirmation(guest, f.schoolId, f.visit.id, ask.command_id));
    expect(outcome.state).toBe(results[0].status === 'fulfilled' ? 'accepted' : 'not_found');
    expect(JSON.stringify(outcome)).not.toContain('PRIVATE');
    const termination = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
      .where('event_type', '=', 'gate.visit_shared.updated').where(sql<boolean>`payload->>'action'='revoked'`).executeTakeFirstOrThrow();
    expect((await f.run(() => sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,
      'gate.visit_shared.updated',${JSON.stringify(termination.payload)}::jsonb,${guest.id}::uuid) AS valid`.execute(db))).rows[0]!.valid).toBe(true);
    expect(Object.keys(termination.payload as object).sort()).toEqual(['action', 'question_id', 'refresh', 'revision',
      'root_id', 'share_id', 'source_command_id', 'visit_id'].sort());
    expect(JSON.stringify(termination.payload)).not.toContain('PRIVATE');
    const source = await f.run(() => f.visits.detail(f.user, f.schoolId, f.visit.id));
    expect(source.visit).toMatchObject({ state: 'confirmed', last_movement: null });
    const account = await db.selectFrom('school_memberships').select(['is_active', 'access_scope'])
      .where('school_id', '=', f.schoolId).where('user_id', '=', guest.id).executeTakeFirstOrThrow();
    expect(account).toEqual({ is_active: true, access_scope: 'campus' });
  }, 60_000);

  it('requires explicit orphan takeover before a different coordinator can read or answer the private thread', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    const sharing = await f.run(async () => f.sharing.share(f.user, f.schoolId, f.visit.id, await f.shareInput(0)));
    const asked = await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, {
      ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'PRIVATE question retained for the original sharing coordinator.',
    }));
    // Explicit synthetic baseline campus authority, not a source handoff or
    // fabricated account acceptance. The recovery account already has its real
    // normally accepted canonical endpoint.
    await db.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: f.borrower.id, role: 'admin' }).execute();
    await expect(f.run(() => f.sharing.sharedDetail(f.borrower, f.schoolId, f.visit.id))).rejects.toThrow();
    await expect(f.run(() => f.sharing.takeover(f.borrower, f.schoolId, f.visit.id, sharing.current!.id,
      visitGuestCommand(sharing.share_revision)))).rejects.toThrow();
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
    await expect(f.run(() => f.sharing.sharedDetail(f.borrower, f.schoolId, f.visit.id))).rejects.toThrow();
    const takeover = await f.run(() => f.sharing.takeover(f.borrower, f.schoolId, f.visit.id, sharing.current!.id,
      visitGuestCommand(sharing.share_revision)));
    expect(takeover.current!.id).not.toBe(sharing.current!.id);
    expect(takeover.current!.root_id).toBe(sharing.current!.root_id);
    const detail = await f.run(() => f.sharing.sharedDetail(f.borrower, f.schoolId, f.visit.id));
    expect(detail.question!.id).toBe(asked.question!.id);
    expect(detail.question!.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ note: 'PRIVATE question retained for the original sharing coordinator.' }),
    ]));
    await expect(f.run(() => f.sharing.reply(f.user, f.schoolId, f.visit.id, detail.question!.id,
      { ...visitGuestCommand(detail.question!.revision), note: 'The previous coordinator cannot keep replying.' }))).rejects.toThrow();
    const answered = await f.run(() => f.sharing.reply(f.borrower, f.schoolId, f.visit.id, detail.question!.id,
      { ...visitGuestCommand(detail.question!.revision), note: 'The replacement coordinator has arranged the reception meeting.' }));
    expect(answered.question!.state).toBe('answered');
    expect((await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).question!.state).toBe('answered');
  }, 60_000);

  it('rolls native sharing, private questions and all DT handoff evidence back together before a safe exact retry', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    const counts = async () => (await sql<Record<string, number>>`SELECT
      (SELECT count(*)::int FROM gate_visit_shares WHERE school_id=${f.schoolId}::uuid) shares,
      (SELECT count(*)::int FROM gate_visit_questions WHERE school_id=${f.schoolId}::uuid) questions,
      (SELECT count(*)::int FROM gate_visit_question_entries WHERE school_id=${f.schoolId}::uuid) entries,
      (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid) commands,
      (SELECT count(*)::int FROM campus_model_events WHERE school_id=${f.schoolId}::uuid) events,
      (SELECT count(*)::int FROM campus_model_operational_messages WHERE school_id=${f.schoolId}::uuid) messages,
      (SELECT count(*)::int FROM event_outbox WHERE school_id=${f.schoolId}::uuid) outbox`.execute(db)).rows[0]!;
    const before = await counts(), input = await f.shareInput(0);
    const shareFailure = vi.spyOn(f.model, 'complete').mockRejectedValueOnce(new Error('Injected owning shared-visit finish failure'));
    try {
      await expect(f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input))).rejects.toThrow('Injected owning shared-visit finish failure');
      expect(await counts()).toEqual(before);
    } finally { shareFailure.mockRestore(); }
    const sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input));
    const afterShare = await counts(), ask = { ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'PRIVATE exact retry after a rolled-back question handoff.' };
    const questionFailure = vi.spyOn(f.model, 'complete').mockRejectedValueOnce(new Error('Injected owning question finish failure'));
    try {
      await expect(f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask))).rejects.toThrow('Injected owning question finish failure');
      expect(await counts()).toEqual(afterShare);
    } finally { questionFailure.mockRestore(); }
    expect((await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask))).question).toMatchObject({ revision: 1, state: 'waiting_for_review' });
  }, 60_000);

  it('refuses owning source records when a faulty adapter omits the actual Request, recipient response or supersession', async () => {
    const f = await createVisitGuestFixture(db), guest = f.joined!.user;
    const sharing = await f.run(async () => f.sharing.share(f.user, f.schoolId, f.visit.id, await f.shareInput(0)));
    const ask = { ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'PRIVATE question requiring a real exact-recipient Request.' };
    const event = f.model.event.bind(f.model);
    const omitRequest = vi.spyOn(f.model, 'event').mockImplementation((tx, user, source, data, command) => event(tx, user, source, data, command));
    try {
      await expect(f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask))).rejects.toThrow();
      expect(await db.selectFrom('gate_visit_questions').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
    } finally { omitRequest.mockRestore(); }
    let detail = await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, ask));
    const reply = { ...visitGuestCommand(detail.question!.revision), note: 'The campus coordinator answers this exact question.' };
    const questionId = detail.question!.id;
    const omitResponse = vi.spyOn(f.model, 'closePrevious').mockResolvedValue(undefined);
    try {
      await expect(f.run(() => f.sharing.reply(f.user, f.schoolId, f.visit.id, questionId, reply))).rejects.toThrow();
      expect((await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).question).toMatchObject({ revision: 1, state: 'waiting_for_review' });
    } finally { omitResponse.mockRestore(); }
    detail = await f.run(() => f.sharing.reply(f.user, f.schoolId, f.visit.id, questionId, reply));
    detail = await f.run(() => f.sharing.ask(guest, f.schoolId, f.visit.id, { ...visitGuestCommand(detail.question!.revision),
      share_id: sharing.current!.id, note: 'PRIVATE follow-up whose withdrawal must retire its real Request.' }));
    const pendingRevision = detail.question!.revision, revoke = visitGuestCommand(sharing.share_revision);
    const omitSupersession = vi.spyOn(f.model, 'closePrevious').mockResolvedValue(undefined);
    try {
      await expect(f.run(() => f.sharing.revoke(f.user, f.schoolId, f.visit.id, sharing.current!.id, revoke))).rejects.toThrow();
      expect((await f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).question)
        .toMatchObject({ revision: pendingRevision, state: 'waiting_for_review' });
    } finally { omitSupersession.mockRestore(); }
    await f.run(() => f.sharing.revoke(f.user, f.schoolId, f.visit.id, sharing.current!.id, revoke));
    await expect(f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).rejects.toThrow();
  }, 60_000);

  it('rejects stale or foreign sharing references and native edits without the owning command evidence', async () => {
    const f = await createVisitGuestFixture(db), outside = await createVisitGuestFixture(db);
    const input = await f.shareInput(0);
    const outsideRevision = await outside.organiserRevision();
    await expect(f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id,
      { ...input, organiser_person_id: outside.organiser.id, organiser_person_revision: outsideRevision }))).rejects.toThrow();
    await expect(f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id,
      { ...input, organiser_person_revision: input.organiser_person_revision + 1 }))).rejects.toThrow();
    await expect(f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id,
      { ...input, expected_visit_revision: input.expected_visit_revision + 1 }))).rejects.toThrow();
    const prepare = f.model.prepare.bind(f.model);
    const corruptedShare = vi.spyOn(f.model, 'prepare').mockImplementation(async (...args) => {
      args[8] = { ...args[8], directions_hash: visitSharingHash('A faulty adapter attested different instructions.') };
      return prepare(...args);
    });
    try {
      await expect(f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input))).rejects.toThrow();
      expect(await db.selectFrom('gate_visit_shares').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
    } finally { corruptedShare.mockRestore(); }
    const sharing = await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input));
    expect(await f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id, input))).toEqual(sharing);
    await expect(f.run(() => f.sharing.share(f.user, f.schoolId, f.visit.id,
      { ...input, directions: 'Different instructions on the same command.' }))).rejects.toThrow();
    await expect(sql`UPDATE gate_visit_shares SET directions='A native bypass' WHERE id=${sharing.current!.id}::uuid`.execute(db)).rejects.toThrow();
    await expect(sql`DELETE FROM gate_visit_shares WHERE id=${sharing.current!.id}::uuid`.execute(db)).rejects.toThrow();
    const questionInput = { ...visitGuestCommand(0), share_id: sharing.current!.id, note: 'A genuine private question whose commitment must match.' };
    const corruptedQuestion = vi.spyOn(f.model, 'prepare').mockImplementation(async (...args) => {
      args[8] = { ...args[8], note_hash: visitSharingHash('A faulty adapter attested a different question.') };
      return prepare(...args);
    });
    try {
      await expect(f.run(() => f.sharing.ask(f.joined!.user, f.schoolId, f.visit.id, questionInput))).rejects.toThrow();
      expect(await db.selectFrom('gate_visit_questions').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
    } finally { corruptedQuestion.mockRestore(); }
    expect((await f.run(() => f.sharing.ask(f.joined!.user, f.schoolId, f.visit.id, questionInput))).question!.revision).toBe(1);
    const retained = await f.run(() => f.sharing.confirmation(f.user, f.schoolId, f.visit.id, input.command_id));
    expect(retained.state).toBe('accepted');
    expect((await f.run(() => f.visits.detail(f.user, f.schoolId, f.visit.id))).visit.revision).toBe(f.visit.revision);
    expect(await f.run(() => f.sharing.confirmation(f.user, f.schoolId, f.visit.id, randomUUID()))).toMatchObject({ state: 'not_found' });
  }, 60_000);
});
