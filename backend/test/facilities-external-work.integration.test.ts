import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { assignedWorkOnly } from '../src/auth/assigned-work-access.js';
import { InvitationEmailWorker } from '../src/common/invitation-queue.js';
import { acceptWithRecipientProof } from './invitation-recipient-proof.test-support.js';
import * as configuration from '../src/config.js';
import * as emailTransport from '../src/common/email-transport.js';
import { createExternalRepairFixture, externalCommand, externalPhoto, readExternalBytes } from './facilities-external-work.test-support.js';
import { academicScaffoldingCounts } from './learning-offerings.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const url = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/external_repair_unused_test';
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }) }) as DatabaseService;
let directory: string | undefined;
beforeAll(async () => { if (!enabled) return; process.env.INVITATION_EMAIL_ENABLED = 'false';
  directory = await mkdtemp(join(tmpdir(), 'thatcampus-external-repair-native-')); process.env.UPLOAD_DIR = directory; });
afterAll(async () => { await db.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe.skipIf(!enabled)('Exact external technician repair authority', () => {
  it('delivers the source invitation and independent proof through the real transport boundary, then opens only its exact job', async () => {
    const f = await createExternalRepairFixture(db, { pending: true });
    await f.run(async () => {
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      const settings = configuration.config(), messages: Array<{ to: string; text: string }> = [];
      const configSpy = vi.spyOn(configuration, 'config').mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: true, PUBLIC_URL: 'https://fictional-campus.example.test' });
      const transport = vi.spyOn(emailTransport, 'sendTransactionalEmail').mockImplementation(message => {
        if (message.to !== f.email) throw new Error('Synthetic mailbox refuses another recipient.');
        messages.push({ to: message.to, text: message.text });
        return Promise.resolve();
      });
      try {
        const invitation = await f.invitations.create(f.user, f.schoolId, { role: 'member', person_id: f.person.id,
          email: f.email, idempotency_key: randomUUID(), work_context: { kind: 'facility_repair', source_id: f.repair.id, access_id: grant.external_access!.id } });
        expect(invitation.delivery).toBe('queued'); expect(messages).toEqual([]);
        await new InvitationEmailWorker(db).deliverPending();
        expect(messages).toHaveLength(1); expect(messages[0]!.text).not.toContain('PRIVATE');
        const deliveredLink = messages[0]!.text.match(/https:\/\/[^\s]+/u)?.[0];
        if (!deliveredLink) throw new Error('The delivered invitation needs its actual secure join link.');
        const fragment = new URLSearchParams(new URL(deliveredLink).hash.slice(1)), token = fragment.get('token');
        if (!token) throw new Error('The delivered invitation needs the recipient credential in its fragment.');
        const proofResult = await f.operations.recipientProof({ email: f.email, token });
        expect(proofResult).toMatchObject({ verification_required: true, delivery: 'email_accepted' });
        expect(messages).toHaveLength(2);
        const code = messages[1]!.text.match(/Your confirmation code is:\s*(\d{6})(?:\s|$)/u)?.[1];
        if (!code) throw new Error('The independent recipient email needs its actual proof code.');
        expect(JSON.stringify(proofResult)).not.toContain(code);
        const input = { email: f.email, token, recipient_proof: code, password: f.password, first_name: 'Fictional Technician', last_name: '' };
        const accepted = await f.operations.acceptInvite(input);
        expect(accepted).toMatchObject({ accepted: true, role: 'member', school_id: f.schoolId });
        const account = await db.selectFrom('users').select(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active'])
          .where('email', '=', f.email).executeTakeFirstOrThrow();
        const technician = { ...account, active_school_id: f.schoolId };
        expect(await assignedWorkOnly(db, f.schoolId, technician.id)).toBe(true);
        await expect(f.facilities.options(technician, f.schoolId, {})).rejects.toThrow();
        await expect(f.facilities.settings(technician, f.schoolId)).rejects.toThrow();
        await expect(f.facilities.report(technician, f.schoolId, { ...externalCommand(0), problem: 'Not a granted report capability', location_note: 'No new campus access' })).rejects.toThrow();
        expect((await f.facilities.workspace(technician, f.schoolId, {})).can_report).toBe(false);
        const endpoint = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx,
          { school_id: f.schoolId, user_id: technician.id, at: f.now }));
        expect(endpoint).toMatchObject({ acting: true, person_id: f.person.id });
        expect(await f.invitations.continuation(technician, f.schoolId, invitation.id)).toMatchObject({
          kind: 'facility_repair', source_id: f.repair.id, href: `/areas/facilities?repair_id=${f.repair.id}` });
        await expect(f.invitations.continuation(f.user, f.schoolId, invitation.id)).rejects.toThrow();
        expect((await f.facilities.detail(f.user, f.schoolId, f.repair.id)).handler.id).toBe(f.custodianPersonId);
        expect((await f.facilities.detail(technician, f.schoolId, f.repair.id)).external_access!.can_activate).toBe(true);
        expect(await f.operations.acceptInvite({ ...input, recover_accepted: true })).toMatchObject({ accepted: true, accepted_user_id: technician.id });
        expect(await db.selectFrom('campus_model_agents').select('id').where('school_id', '=', f.schoolId).where('person_id', '=', f.person.id).execute()).toHaveLength(1);
        await expect(sql`UPDATE school_invitations SET work_source_id=${randomUUID()}::uuid WHERE id=${invitation.id}::uuid`.execute(db)).rejects.toThrow();
        const sourceEvent = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId)
          .where('event_type', '=', 'facilities.updated').where('aggregate_id', '=', f.repair.id).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
        expect((await sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,'facilities.updated',${JSON.stringify(sourceEvent.payload)}::jsonb,${technician.id}::uuid) AS valid`.execute(db)).rows[0]!.valid).toBe(true);
        for (const event of ['people.updated', 'campus_scene.updated', 'campus_assets.updated', 'notification.created', 'coordination.updated'])
          expect((await sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,${event},${JSON.stringify(sourceEvent.payload)}::jsonb,${technician.id}::uuid) AS valid`.execute(db)).rows[0]!.valid).toBe(false);
        await f.facilities.endExternal(f.user, f.schoolId, f.repair.id, grant.external_access!.id,
          { ...externalCommand(grant.revision), note: 'The fictional invitation check is finished.' });
        await expect(f.invitations.continuation(technician, f.schoolId, invitation.id)).rejects.toThrow();
        expect((await sql<{ valid: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,'facilities.updated',${JSON.stringify(sourceEvent.payload)}::jsonb,${technician.id}::uuid) AS valid`.execute(db)).rows[0]!.valid).toBe(false);
      } finally { transport.mockRestore(); configSpy.mockRestore(); }
    });
  }, 90_000);

  it('retains a pending person grant without changing the handler, creating an account or manufacturing acceptance', async () => {
    const f = await createExternalRepairFixture(db, { pending: true });
    await f.run(async () => {
      const input = await f.grantInput(f.repair.revision), granted = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input);
      expect(granted.handler.id).toBe(f.custodianPersonId);
      expect(granted.external_access).toMatchObject({ person: { id: f.person.id, has_app_access: false }, instructions: input.instructions });
      expect(await db.selectFrom('users').select('id').where('email', '=', f.email).execute()).toEqual([]);
      expect(await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input)).toMatchObject({ revision: granted.revision });
      await expect(f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, { ...input, instructions: 'Changed exact commitment' })).rejects.toThrow();
      expect((await f.facilities.work(f.user, f.schoolId)).needs_me.filter(item => item.repair_id === f.repair.id)).toEqual([]);
      const accepted = await db.selectFrom('facilities_repair_receipts').select('action').where('repair_id', '=', f.repair.id).execute();
      expect(accepted.some(row => row.action === 'accepted')).toBe(false);
      expect(await academicScaffoldingCounts(db, f.schoolId)).toEqual({ students: 0, staff: 0, classes: 0, terms: 0, enrollments: 0, guardians: 0, roles: 0, schedules: 0 });
    });
  }, 60_000);

  it('cancels queued invitation delivery when the owning assignment ends before the worker sends it', async () => {
    const f = await createExternalRepairFixture(db, { pending: true });
    await f.run(async () => {
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      const settings = configuration.config();
      const configSpy = vi.spyOn(configuration, 'config').mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: true,
        PUBLIC_URL: 'https://fictional-campus.example.test' });
      const transport = vi.spyOn(emailTransport, 'sendTransactionalEmail').mockRejectedValue(new Error('An ended job must not contact any recipient.'));
      try {
        const invitation = await f.operations.invite(f.user, f.schoolId, { role: 'member', person_id: f.person.id,
          email: f.email, idempotency_key: randomUUID(), work_context: { kind: 'facility_repair', source_id: f.repair.id, access_id: grant.external_access!.id } });
        expect(invitation.delivery).toBe('queued');
        await f.facilities.endExternal(f.user, f.schoolId, f.repair.id, grant.external_access!.id,
          { ...externalCommand(grant.revision), note: 'This work is no longer being offered to the supplier.' });
        await new InvitationEmailWorker(db).deliverPending();
        expect(transport).not.toHaveBeenCalled();
        expect((await sql<{ delivery_state: string; encrypted_token: string | null }>`SELECT delivery_state,encrypted_token
          FROM invitation_email_jobs WHERE invitation_id=${invitation.id}::uuid`.execute(db)).rows[0]).toEqual({ delivery_state: 'cancelled', encrypted_token: null });
        expect(await db.selectFrom('users').select('id').where('email', '=', f.email).execute()).toEqual([]);
        expect((await db.selectFrom('school_invitations').select('accepted_at').where('id', '=', invitation.id).executeTakeFirstOrThrow()).accepted_at).toBeNull();
      } finally { transport.mockRestore(); configSpy.mockRestore(); }
    });
  }, 60_000);

  it('allows identity joining before a future work start without accepting or exposing the job', async () => {
    const f = await createExternalRepairFixture(db, { pending: true });
    await f.run(async () => {
      const starts = new Date(Date.parse(f.now) + 86_400_000).toISOString();
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id,
        await f.grantInput(f.repair.revision, { starts_at: starts }));
      const invitation = await f.operations.invite(f.user, f.schoolId, { role: 'member', person_id: f.person.id, email: f.email,
        idempotency_key: randomUUID(), work_context: { kind: 'facility_repair', source_id: f.repair.id, access_id: grant.external_access!.id } });
      const accepted = await acceptWithRecipientProof(f.operations, { email: f.email, token: invitation.token,
        password: f.password, first_name: 'Future Technician', last_name: '' });
      expect(accepted).toMatchObject({ accepted: true, school_id: f.schoolId, continuation: { source_id: f.repair.id } });
      const account = await db.selectFrom('users').select(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active'])
        .where('email', '=', f.email).executeTakeFirstOrThrow();
      const technician = { ...account, active_school_id: f.schoolId };
      expect(await assignedWorkOnly(db, f.schoolId, technician.id)).toBe(true);
      await expect(f.operations.invitationContinuation(technician, f.schoolId, invitation.id)).rejects.toThrow();
      await expect(f.facilities.detail(technician, f.schoolId, f.repair.id)).rejects.toThrow();
      expect((await f.facilities.detail(f.user, f.schoolId, f.repair.id)).handler.id).toBe(f.custodianPersonId);
      expect(await db.selectFrom('facilities_repair_receipts').select('action').where('repair_id', '=', f.repair.id)
        .where('action', '=', 'accepted').execute()).toEqual([]);
    });
  }, 60_000);

  it('keeps an intentionally pending assignment out of unrelated manager recovery', async () => {
    const f = await createExternalRepairFixture(db), unrelatedManager = f.joined!.user;
    await f.run(async () => {
      const passive = await f.people.create({ authUser: f.user, requestId: randomUUID(), headers: {}, ip: '127.0.0.1' } as never,
        f.schoolId, { first_name: 'Fictional Pending Supplier', last_name: '', idempotency_key: randomUUID() });
      const person = await db.selectFrom('school_people').select('revision').where('school_id', '=', f.schoolId).where('id', '=', passive.id).executeTakeFirstOrThrow();
      await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id,
        await f.grantInput(f.repair.revision, { person_id: passive.id, expected_person_revision: person.revision }));
      // Explicit authority fixture, matching the existing orphan-recovery test:
      // the normally joined unrelated person is a manager, not a repair participant.
      await db.updateTable('school_memberships').set({ role: 'admin' }).where('school_id', '=', f.schoolId).where('user_id', '=', unrelatedManager.id).execute();
      await expect(f.facilities.detail(unrelatedManager, f.schoolId, f.repair.id)).rejects.toThrow();
      expect((await f.facilities.workspace(unrelatedManager, f.schoolId, { view: 'all' })).repairs).toEqual([]);
      expect(await f.facilities.work(unrelatedManager, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
      expect((await f.facilities.work(f.user, f.schoolId)).needs_me.filter(row => row.repair_id === f.repair.id)).toEqual([]);
    });
  }, 60_000);

  it('replaces only an obsolete same-repair pending invitation and retains its refusal and audit history', async () => {
    const f = await createExternalRepairFixture(db, { pending: true });
    await f.run(async () => {
      let first = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      const invite = (repair: { id: string; external_access: { id: string } | null }) => f.operations.invite(f.user, f.schoolId,
        { role: 'member', person_id: f.person.id, email: f.email, idempotency_key: randomUUID(),
          work_context: { kind: 'facility_repair', source_id: repair.id, access_id: repair.external_access!.id } });
      const original = await invite(first);
      let other = await f.facilities.report(f.borrower, f.schoolId,
        { ...externalCommand(0), problem: 'Independent fictional source', location_note: 'Independent room' });
      other = await f.facilities.grantExternal(f.user, f.schoolId, other.id, await f.grantInput(other.revision));
      await expect(invite(other)).rejects.toThrow();
      expect((await db.selectFrom('school_invitations').select('revoked_at').where('id', '=', original.id).executeTakeFirstOrThrow()).revoked_at).toBeNull();
      first = await f.facilities.endExternal(f.user, f.schoolId, first.id, first.external_access!.id,
        { ...externalCommand(first.revision), note: 'The first offer expired; the campus will issue updated instructions.' });
      first = await f.facilities.grantExternal(f.user, f.schoolId, first.id, await f.grantInput(first.revision,
        { instructions: 'Updated connector inspection instructions for this same repair.' }));
      const replacement = await invite(first);
      expect(replacement.id).not.toBe(original.id);
      expect((await db.selectFrom('school_invitations').select('revoked_at').where('id', '=', original.id).executeTakeFirstOrThrow()).revoked_at).not.toBeNull();
      expect((await db.selectFrom('school_invitations').select('revoked_at').where('id', '=', replacement.id).executeTakeFirstOrThrow()).revoked_at).toBeNull();
      await expect(f.operations.recipientProof({ email: f.email, token: original.token })).rejects.toThrow();
      expect((await sql<{ target_id: string }>`SELECT target_id FROM school_operations_audit WHERE school_id=${f.schoolId}::uuid
        AND action='invitation.superseded' AND target_id=${original.id}::uuid`.execute(db)).rows).toHaveLength(1);
      expect((await f.facilities.detail(f.user, f.schoolId, other.id)).external_access!.id).toBe(other.external_access!.id);
      expect(await db.selectFrom('users').select('id').where('email', '=', f.email).execute()).toEqual([]);
    });
  }, 90_000);

  it('shares only reviewed instructions and selected evidence, then retains ordinary work and separate campus verification', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      const privateKey = externalCommand(f.repair.revision), privatePhoto = externalPhoto('PRIVATE-original-photo');
      let current = await f.facilities.addPhoto(f.borrower, f.schoolId, f.repair.id, privateKey, privatePhoto);
      const sharedKey = externalCommand(current.revision), sharedPhoto = externalPhoto('reviewed-connector-photo');
      current = await f.facilities.addPhoto(f.borrower, f.schoolId, current.id, sharedKey, sharedPhoto);
      current = await f.facilities.act(f.user, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'accept' });
      current = await f.facilities.act(f.user, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'update',
        status: 'waiting', wait_reason: 'access', note: 'PRIVATE internal coordination note; do not share with contractor.' });
      const granted = await f.facilities.grantExternal(f.user, f.schoolId, current.id,
        await f.grantInput(current.revision, { shared_photo_ids: [sharedKey.command_id] }));
      const view = await f.facilities.detail(technician, f.schoolId, current.id);
      expect(view.external_view).toBe(true); expect(JSON.stringify(view)).not.toContain('PRIVATE');
      expect(view.photos.map(photo => photo.id)).toEqual([sharedKey.command_id]);
      expect(await readExternalBytes((await f.facilities.photo(technician, f.schoolId, current.id, sharedKey.command_id)).stream)).toEqual(sharedPhoto.data);
      await expect(f.facilities.photo(technician, f.schoolId, current.id, privateKey.command_id)).rejects.toThrow();
      expect(view.allowed_actions).toMatchObject({ assign: false, assign_coordinator: false, assign_verifier: false, verify: false });
      const activate = externalCommand(granted.revision);
      current = await f.facilities.activateExternal(technician, f.schoolId, current.id, granted.external_access!.id, activate);
      expect(current.handler.id).toBe(f.person.id); expect(current.state).toBe('reported');
      expect(await f.facilities.activateExternal(technician, f.schoolId, current.id, granted.external_access!.id, activate)).toMatchObject({ revision: current.revision });
      current = await f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'accept' });
      current = await f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'update', status: 'waiting',
        wait_reason: 'parts', note: 'Connector ordered; the camera is not repaired yet.', expected_finish_at: new Date(Date.parse(f.now) + 86_400_000).toISOString() });
      expect(current.state).toBe('waiting');
      current = await f.facilities.addPhoto(technician, f.schoolId, current.id, externalCommand(current.revision), externalPhoto('technician-connector-evidence'));
      expect(JSON.stringify(current)).not.toContain('PRIVATE');
      current = await f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'complete', note: 'Connector fitted and tested; campus should check.' });
      expect(current.state).toBe('awaiting_verification'); expect(current.allowed_actions.verify).toBe(false);
      await expect(f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'verify' })).rejects.toThrow();
      expect((await f.facilities.work(f.borrower, f.schoolId)).needs_me).toEqual(expect.arrayContaining([expect.objectContaining({ repair_id: current.id, action: 'verify' })]));
      current = await f.facilities.act(f.borrower, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'verify', note: 'Campus checked the repaired connector.' });
      expect(current.state).toBe('closed');
      const native = await db.selectFrom('facilities_repair_receipts').select(['action', 'actor_person_id']).where('repair_id', '=', current.id).execute();
      expect(native).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'completed', actor_person_id: f.person.id }),
        expect.objectContaining({ action: 'verified', actor_person_id: f.borrowerPersonId })]));
      const events = await db.selectFrom('event_outbox').select('payload').where('school_id', '=', f.schoolId).where('event_type', '=', 'facilities.updated').execute();
      expect(JSON.stringify(events)).not.toMatch(/PRIVATE|connector ordered|instructions|file_name/iu);
    });
  }, 90_000);

  it('denies unrelated repairs and authority changes despite ordinary campus membership', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      const second = await f.facilities.report(f.borrower, f.schoolId, { ...externalCommand(0), problem: 'PRIVATE second repair', location_note: 'Private second location' });
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      await expect(f.facilities.detail(technician, f.schoolId, second.id)).rejects.toThrow();
      expect((await f.facilities.workspace(technician, f.schoolId, {})).repairs.map(row => row.id)).toEqual([f.repair.id]);
      expect((await f.facilities.detail(technician, f.schoolId, f.repair.id)).external_view).toBe(true);
      await expect(f.facilities.grantExternal(technician, f.schoolId, f.repair.id, await f.grantInput(grant.revision))).rejects.toThrow();
      await expect(f.facilities.act(technician, f.schoolId, f.repair.id, { ...externalCommand(grant.revision), action: 'assign',
        handler_person_id: f.person.id, note: 'Cannot assign myself using membership alone.' })).rejects.toThrow();
      await expect(f.facilities.saveSettings(technician, f.schoolId, { ...externalCommand(1), handler_person_id: f.person.id, verifier_mode: 'handler' })).rejects.toThrow();
      expect(await assignedWorkOnly(db, f.schoolId, technician.id)).toBe(false); // Its independent campus membership was never downgraded.
      const unlocated = await f.facilities.report(f.borrower, f.schoolId, { ...externalCommand(0),
        problem: 'PRIVATE unlinked original complaint', location_note: 'PRIVATE original resident access circumstances' });
      await f.facilities.grantExternal(f.user, f.schoolId, unlocated.id, await f.grantInput(unlocated.revision));
      expect(JSON.stringify(await f.facilities.detail(technician, f.schoolId, unlocated.id))).not.toContain('PRIVATE');
      expect(JSON.stringify(await f.facilities.workspace(technician, f.schoolId, {}))).not.toContain('PRIVATE');
    });
  }, 60_000);

  it('does not expose a scheduled job or activate it before its explicit start', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      const starts = new Date(Date.parse(f.now) + 86_400_000).toISOString();
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id,
        await f.grantInput(f.repair.revision, { starts_at: starts }));
      expect(grant.external_access!.state).toBe('scheduled');
      await expect(f.facilities.detail(technician, f.schoolId, f.repair.id)).rejects.toThrow();
      await expect(f.facilities.activateExternal(technician, f.schoolId, f.repair.id, grant.external_access!.id,
        externalCommand(grant.revision))).rejects.toThrow();
      expect((await f.facilities.workspace(technician, f.schoolId, {})).repairs).toEqual([]);
      expect((await f.facilities.work(technician, f.schoolId)).needs_me).toEqual([]);
      expect((await sql<{ valid: boolean }>`SELECT facilities_event_recipient_valid(${f.schoolId}::uuid,${JSON.stringify({ repair_id: f.repair.id })}::jsonb,${technician.id}::uuid) AS valid`.execute(db)).rows[0]!.valid).toBe(false);
    });
  }, 60_000);

  it('ends only one source, keeps another assignment and stable account, and refuses retained private evidence', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      const photo = externalCommand(f.repair.revision);
      let first = await f.facilities.addPhoto(f.borrower, f.schoolId, f.repair.id, photo, externalPhoto('first-shared-evidence'));
      first = await f.facilities.grantExternal(f.user, f.schoolId, first.id, await f.grantInput(first.revision, { shared_photo_ids: [photo.command_id] }));
      const activation = externalCommand(first.revision);
      first = await f.facilities.activateExternal(technician, f.schoolId, first.id, first.external_access!.id, activation);
      first = await f.facilities.act(technician, f.schoolId, first.id, { ...externalCommand(first.revision), action: 'accept' });
      let second = await f.facilities.report(f.borrower, f.schoolId, { ...externalCommand(0), problem: 'Other fictional job', location_note: 'Other fictional room' });
      second = await f.facilities.grantExternal(f.user, f.schoolId, second.id, await f.grantInput(second.revision));
      const identityBefore = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: technician.id, at: f.now }));
      const end = { ...externalCommand(first.revision), note: 'This supplier no longer handles this exact repair.' };
      const ended = await f.facilities.endExternal(f.user, f.schoolId, first.id, first.external_access!.id, end);
      expect(await f.facilities.endExternal(f.user, f.schoolId, first.id, first.external_access!.id, end)).toMatchObject({ revision: ended.revision });
      await expect(f.facilities.detail(technician, f.schoolId, first.id)).rejects.toThrow();
      const retained = await f.facilities.confirmation(technician, f.schoolId, first.id, activation.command_id);
      expect(retained).toMatchObject({ state: 'accepted', result: { id: first.id, action: 'external_ready' } });
      expect(JSON.stringify(retained)).not.toMatch(/PRIVATE|instructions|photos|problem/u);
      await expect(f.facilities.photo(technician, f.schoolId, first.id, photo.command_id)).rejects.toThrow();
      await expect(f.facilities.act(technician, f.schoolId, first.id, { ...externalCommand(ended.revision), action: 'complete', note: 'Revoked actor cannot report completion.' })).rejects.toThrow();
      expect((await f.facilities.detail(technician, f.schoolId, second.id)).external_view).toBe(true);
      expect(await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: technician.id, at: f.now }))).toEqual(identityBefore);
      expect((await f.facilities.work(technician, f.schoolId)).needs_me.some(item => item.repair_id === first.id)).toBe(false);
      expect((await sql<{ valid: boolean }>`SELECT facilities_event_recipient_valid(${f.schoolId}::uuid,${JSON.stringify({ repair_id: first.id })}::jsonb,${technician.id}::uuid) AS valid`.execute(db)).rows[0]!.valid).toBe(false);
    });
  }, 90_000);

  it('rejects stale sources, cross-repair photo sharing, invalid dates and exact-command mutations', async () => {
    const f = await createExternalRepairFixture(db);
    await f.run(async () => {
      const second = await f.facilities.report(f.borrower, f.schoolId, { ...externalCommand(0), problem: 'Other fictional photo source', location_note: 'Other room' });
      const photo = externalCommand(second.revision);
      await f.facilities.addPhoto(f.borrower, f.schoolId, second.id, photo, externalPhoto('private-other-repair'));
      const input = await f.grantInput(f.repair.revision);
      for (const change of [{ shared_photo_ids: [photo.command_id] }, { ends_at: input.starts_at },
        { ends_at: new Date(Date.parse(f.now) + 366 * 86_400_000).toISOString() },
        { expected_person_revision: 999999 }, { expected_revision: 999999 }, { person_id: randomUUID() }])
        await expect(f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, { ...input, ...change })).rejects.toThrow();
      const grant = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input);
      await expect(f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, { ...input, ends_at: new Date(Date.parse(f.endsAt) + 1).toISOString() })).rejects.toThrow();
      expect(await f.facilities.confirmation(f.user, f.schoolId, f.repair.id, input.command_id)).toMatchObject({ state: 'accepted', result: { id: f.repair.id, revision: grant.revision } });
    });
  }, 60_000);

  it('rolls back grant, native operation and DT evidence together on a failed accepted-event completion', async () => {
    const f = await createExternalRepairFixture(db);
    await f.run(async () => {
      const input = await f.grantInput(f.repair.revision), finish = vi.spyOn(f.model, 'finish').mockRejectedValueOnce(new Error('Injected external grant event failure'));
      await expect(f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input)).rejects.toThrow('Injected external grant event failure');
      finish.mockRestore();
      expect((await f.facilities.detail(f.user, f.schoolId, f.repair.id)).revision).toBe(f.repair.revision);
      expect(await f.facilities.confirmation(f.user, f.schoolId, f.repair.id, input.command_id)).toMatchObject({ state: 'not_found' });
      expect(await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input)).toMatchObject({ revision: f.repair.revision + 1 });
    });
  }, 60_000);

  it('requires immutable grant evidence and native membership scope constraints', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      const granted = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      const source = await db.selectFrom('facilities_external_assignments').selectAll().where('school_id', '=', f.schoolId)
        .where('id', '=', granted.external_access!.id).executeTakeFirstOrThrow();
      await expect(db.updateTable('facilities_external_assignments').set({ instructions: 'Overwrite the retained instructions' })
        .where('id', '=', source.id).execute()).rejects.toThrow('append-only');
      await expect(db.deleteFrom('facilities_external_assignments').where('id', '=', source.id).execute()).rejects.toThrow('append-only');
      await expect(db.insertInto('facilities_external_assignments').values({ ...source, id: randomUUID(), command_id: randomUUID(),
        previous_assignment_id: source.id, source_revision: granted.revision + 1, instructions: 'A forged native grant without a retained DT operation.' }).execute()).rejects.toThrow();
      await expect(sql`UPDATE school_memberships SET access_scope='worldwide' WHERE school_id=${f.schoolId}::uuid AND user_id=${technician.id}::uuid`.execute(db)).rejects.toThrow();
      await expect(sql`INSERT INTO school_memberships(school_id,user_id,role,access_scope)
        VALUES(${f.schoolId}::uuid,${technician.id}::uuid,'staff','assigned_work')`.execute(db)).rejects.toThrow();
      expect(await db.selectFrom('facilities_external_assignments').select('id').where('repair_id', '=', f.repair.id).execute()).toEqual([{ id: source.id }]);
    });
  }, 60_000);

  it('rejects owning-adapter drift between the prepared grant commitment and native shared instructions', async () => {
    const f = await createExternalRepairFixture(db);
    await f.run(async () => {
      const input = await f.grantInput(f.repair.revision), original = f.model.prepare.bind(f.model);
      const drift = vi.spyOn(f.model, 'prepare').mockImplementation(async (...args: Parameters<typeof f.model.prepare>) => {
        const command = await original(...args);
        if (args[4] === 'external_shared') args[5].instructions = 'A corrupted adapter changed these instructions after the accepted commitment.';
        return command;
      });
      try { await expect(f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input)).rejects.toThrow(); }
      finally { drift.mockRestore(); }
      expect(await db.selectFrom('facilities_external_assignments').select('id').where('repair_id', '=', f.repair.id).execute()).toEqual([]);
      expect(await f.facilities.confirmation(f.user, f.schoolId, f.repair.id, input.command_id)).toMatchObject({ state: 'not_found' });
      const accepted = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, input);
      expect(accepted.external_access!.instructions).toBe(input.instructions);
    });
  }, 60_000);

  it('serializes revocation against work completion and preserves campus verification independently', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      let current = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      current = await f.facilities.activateExternal(technician, f.schoolId, current.id, current.external_access!.id, externalCommand(current.revision));
      current = await f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'accept' });
      const before = current.revision, assignment = current.external_access!.id;
      const outcomes = await Promise.allSettled([
        f.facilities.endExternal(f.user, f.schoolId, current.id, assignment, { ...externalCommand(before), note: 'Campus ends supplier access now.' }),
        f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(before), action: 'complete', note: 'Technician reports connector work done.' }),
      ]);
      expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
      current = await f.facilities.detail(f.user, f.schoolId, current.id);
      expect(current.revision).toBe(before + 1);
      if (current.state === 'awaiting_verification') {
        current = await f.facilities.endExternal(f.user, f.schoolId, current.id, current.external_access!.id,
          { ...externalCommand(current.revision), note: 'Access ends while campus checks completion.' });
        expect(current.state).toBe('awaiting_verification');
        expect((await f.facilities.work(f.borrower, f.schoolId)).needs_me.some(row => row.repair_id === current.id && row.action === 'verify')).toBe(true);
      }
      await expect(f.facilities.detail(technician, f.schoolId, current.id)).rejects.toThrow();
      expect(await db.selectFrom('facilities_repair_receipts').select('revision').where('repair_id', '=', current.id)
        .where('revision', '=', before + 1).execute()).toHaveLength(1);
    });
  }, 60_000);

  it('requires a new campus handoff before reopening ended technician work and sending a fresh invitation', async () => {
    const f = await createExternalRepairFixture(db), technician = f.joined!.user;
    await f.run(async () => {
      let current = await f.facilities.grantExternal(f.user, f.schoolId, f.repair.id, await f.grantInput(f.repair.revision));
      current = await f.facilities.activateExternal(technician, f.schoolId, current.id, current.external_access!.id, externalCommand(current.revision));
      current = await f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'accept' });
      current = await f.facilities.act(technician, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'complete', note: 'Supplier reports the connector repaired.' });
      current = await f.facilities.endExternal(f.user, f.schoolId, current.id, current.external_access!.id,
        { ...externalCommand(current.revision), note: 'Supplier access ends while campus checks its work.' });
      expect(current.state).toBe('awaiting_verification');
      current = await f.facilities.act(f.borrower, f.schoolId, current.id,
        { ...externalCommand(current.revision), action: 'reopen', note: 'The connection still fails; further work is needed.', reopen_kind: 'further_work' });
      expect(current.can_invite_external).toBe(false);
      await expect(f.facilities.grantExternal(f.user, f.schoolId, current.id, await f.grantInput(current.revision))).rejects.toThrow();
      await expect(f.facilities.detail(technician, f.schoolId, current.id)).rejects.toThrow();
      current = await f.facilities.act(f.user, f.schoolId, current.id, { ...externalCommand(current.revision), action: 'assign',
        handler_person_id: f.custodianPersonId, note: 'Campus coordinator takes responsibility for arranging further repair.' });
      current = await f.facilities.grantExternal(f.user, f.schoolId, current.id, await f.grantInput(current.revision));
      expect(current.handler.id).toBe(f.custodianPersonId);
      const fresh = await f.facilities.detail(technician, f.schoolId, current.id);
      expect(fresh.allowed_actions.accept).toBe(false); expect(fresh.external_access!.can_activate).toBe(true);
    });
  }, 90_000);
});
