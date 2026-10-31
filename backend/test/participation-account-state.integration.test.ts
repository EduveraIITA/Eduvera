import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ParticipationPeopleService } from '../src/people/participation-people.service.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { effectiveSchoolAccess, schoolPermission } from '../src/roles/authorization.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused_test';
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) });
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID() }) as AuthenticatedRequest;
afterAll(() => db.destroy());

function services(database: Kysely<Database>) {
  const connection = database as DatabaseService, core = new CampusModelCoreService(connection, new ExecutionDataPlaneScope());
  return { core, people: new ParticipationPeopleService(connection, new SchoolEventService(connection, core), core, core, core, core) };
}

async function fixture() {
  const context = services(db), suffix = randomUUID();
  const owner = await db.insertInto('users').values({ username: `account-state-${suffix}`, email: `account-state-${suffix}@example.test`,
    password_hash: 'isolated-test-only', first_name: 'Account', last_name: 'Owner', role: 'admin' })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, owner, 'UTC'));
  const user: AuthUser = { ...owner, active_school_id: schoolId };
  let now = new Date(Date.now() + 86400000);
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: schoolId,
    clock: { now: () => new Date(now), nowIso: () => now.toISOString() } }), action);
  const identity = await run(() => db.transaction().execute(tx => context.core.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: owner.id, at: now.toISOString() })));
  if (!identity.acting) throw new Error('An acting founder is required.');
  const person = (name: string) => run(() => context.people.create(request(user), schoolId, { first_name: name, idempotency_key: randomUUID() }));
  return { ...context, user, schoolId, owner: identity, person, run, now: () => now.toISOString(), setNow: (value: string) => { now = new Date(value); } };
}

async function acceptedMember(f: Awaited<ReturnType<typeof fixture>>, name = 'Neutral campus person') {
  const person = await f.person(name), suffix = randomUUID();
  const account = await db.insertInto('users').values({ username: `member-${suffix}`, email: `member-${suffix}@example.test`,
    password_hash: 'isolated-test-only', first_name: 'Unrelated account name', last_name: '', role: 'member' })
    .returning(['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_active']).executeTakeFirstOrThrow();
  const invitation = await db.transaction().execute(async tx => {
    await tx.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: account.id, role: 'member' }).execute();
    const invitation = await tx.insertInto('school_invitations').values({ school_id: f.schoolId, person_id: person.id,
      email: account.email, role: 'member', source: 'school', token_hash: randomUUID(), created_by: f.user.id,
      expires_at: new Date(Date.parse(f.now()) + 86400000), accepted_at: new Date(f.now()), accepted_by_user_id: account.id })
      .returning('id').executeTakeFirstOrThrow();
    await tx.updateTable('school_people').set({ account_user_id: account.id }).where('id', '=', person.id).execute();
    return invitation;
  });
  const link = { school_id: f.schoolId, person_id: person.id, user_id: account.id, actor_user_id: account.id,
    effective_from: f.now(), effective_until: null, source_domain: 'auth', source_record_id: invitation.id, source_revision: 1,
    metadata: { relationship: 'accepted_person_invitation' } };
  const endpoint = await f.run(() => db.transaction().execute(tx => f.core.linkAccountEndpoint(tx, link)));
  return { person, account, invitation, endpoint, link, user: { ...account, active_school_id: f.schoolId } satisfies AuthUser };
}

describe.runIf(enabled)('canonical person app-account projection and neutral membership', () => {
  it('finds the renamed founder through the canonical endpoint without backfilling or inventing a typed profile', async () => {
    const f = await fixture();
    await f.run(async () => {
      await f.people.correctName(request(f.user), f.schoolId, f.owner.person_id, { first_name: 'Abhishek', last_name: 'Yadav',
        expected_revision: 1, reason: 'Owner confirmed campus display name', idempotency_key: randomUUID() });
      expect((await f.people.list(f.user, f.schoolId, {})).results).toContainEqual(expect.objectContaining({
        id: f.owner.person_id, label: 'Abhishek Yadav', has_account: true, account_state: 'active', is_you: true }));
      expect(await f.people.detail(f.user, f.schoolId, f.owner.person_id)).toMatchObject({ has_account: true, account_state: 'active', is_you: true });
      expect(await db.selectFrom('school_people').select('account_user_id').where('id', '=', f.owner.person_id).executeTakeFirstOrThrow())
        .toEqual({ account_user_id: null });
      const counts = (await sql<{ typed: number; agents: number; endpoints: number }>`SELECT
        (SELECT count(*) FROM students WHERE school_id=${f.schoolId}::uuid)+(SELECT count(*) FROM staff_profiles WHERE school_id=${f.schoolId}::uuid)
          +(SELECT count(*) FROM guardian_school_profiles WHERE school_id=${f.schoolId}::uuid) AS typed,
        (SELECT count(*) FROM campus_model_agents WHERE school_id=${f.schoolId}::uuid AND agent_kind='human') AS agents,
        (SELECT count(*) FROM campus_model_agent_endpoints WHERE school_id=${f.schoolId}::uuid AND endpoint_kind='account') AS endpoints`.execute(db)).rows[0]!;
      expect(Number(counts.typed)).toBe(0); expect(Number(counts.agents)).toBe(1); expect(Number(counts.endpoints)).toBe(1);
      const passive = await f.person('Aarav');
      expect(passive).toMatchObject({ has_account: false, account_state: 'not_linked', is_you: false });
      expect(await f.people.detail(f.user, f.schoolId, passive.id)).toMatchObject({ has_account: false, account_state: 'not_linked', is_you: false });
    });
  });

  it('uses an accepted exact-person neutral binding as identity, never employment, enrollment or permission', async () => {
    const f = await fixture(), member = await acceptedMember(f);
    await f.run(async () => {
      const resolved = await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: member.account.id, at: f.now() }));
      expect(resolved).toMatchObject({ acting: true, person_id: member.person.id, agent_id: member.endpoint.agent_id });
      expect(await db.transaction().execute(tx => f.core.resolvePersonAgent(tx, { school_id: f.schoolId, person_id: member.person.id, at: f.now() })))
        .toMatchObject({ acting: true, user_id: member.account.id });
      expect(await db.transaction().execute(tx => f.core.linkAccountEndpoint(tx, member.link))).toMatchObject({ replayed: true, agent_id: member.endpoint.agent_id });
      expect((await f.people.list(f.user, f.schoolId, {})).results).toContainEqual(expect.objectContaining({ id: member.person.id,
        has_account: true, account_state: 'active', is_you: false, affiliations: [] }));
      expect(await db.transaction().execute(tx => f.core.listPersonAccountStates(tx, { school_id: f.schoolId, person_ids: [member.person.id], at: f.now(), viewer_user_id: member.account.id })))
        .toEqual([{ person_id: member.person.id, has_account: true, account_state: 'active', is_you: true }]);
      expect(await effectiveSchoolAccess(db, member.account.id, f.schoolId)).toEqual({ role: 'member', sources: [] });
      await expect(schoolPermission(db, member.user, f.schoolId, 'attendance.record')).rejects.toThrow();
      await expect(f.people.list(member.user, f.schoolId, {})).rejects.toThrow();
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM (
        SELECT id FROM students WHERE school_id=${f.schoolId}::uuid AND person_id=${member.person.id}::uuid
        UNION ALL SELECT id FROM staff_profiles WHERE school_id=${f.schoolId}::uuid AND person_id=${member.person.id}::uuid
        UNION ALL SELECT person_id AS id FROM guardian_school_profiles WHERE school_id=${f.schoolId}::uuid AND person_id=${member.person.id}::uuid
      ) profiles`.execute(db)).rows[0]!.count).toBe('0');
    });
  });

  it('preserves retained linkage while current account, membership, future or ended endpoint makes access inactive', async () => {
    const f = await fixture(), member = await acceptedMember(f);
    const state = () => f.run(() => db.transaction().execute(tx => f.core.listPersonAccountStates(tx, { school_id: f.schoolId,
      person_ids: [member.person.id], at: f.now(), viewer_user_id: member.account.id })));
    await db.updateTable('users').set({ is_active: false }).where('id', '=', member.account.id).execute();
    expect(await state()).toEqual([{ person_id: member.person.id, has_account: true, account_state: 'inactive', is_you: false }]);
    await db.updateTable('users').set({ is_active: true }).where('id', '=', member.account.id).execute();
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', member.account.id).execute();
    expect((await state())[0]).toMatchObject({ has_account: true, account_state: 'inactive' });
    await db.updateTable('school_memberships').set({ is_active: true }).where('school_id', '=', f.schoolId).where('user_id', '=', member.account.id).execute();
    const at = Date.parse(f.now()); f.setNow(new Date(at - 1000).toISOString());
    expect((await state())[0]).toMatchObject({ has_account: true, account_state: 'inactive' });
    f.setNow(new Date(at + 1000).toISOString());
    await f.run(() => db.transaction().execute(tx => f.core.closeAccountEndpoint(tx, { school_id: f.schoolId, endpoint_id: member.endpoint.endpoint_id,
      actor_user_id: f.user.id, expected_revision: 1, effective_at: f.now(), disposition: 'ended', reason: 'Explicit account access ended',
      source_domain: 'auth', source_record_id: randomUUID(), source_revision: 1, idempotency_key: randomUUID() })));
    expect((await state())[0]).toMatchObject({ has_account: true, account_state: 'inactive' });
  });

  it('guards exact accepted binding and one open invitation per campus person without email or name matching', async () => {
    const f = await fixture(), person = await f.person('Same name'), other = await f.person('Same name');
    const account = await db.insertInto('users').values({ username: `guard-${randomUUID()}`, email: `guard-${randomUUID()}@example.test`,
      password_hash: 'isolated-test-only', first_name: 'Same name', last_name: '', role: 'member' }).returning('id').executeTakeFirstOrThrow();
    const invitation = { school_id: f.schoolId, person_id: person.id, email: f.user.email, role: 'member' as const, source: 'school' as const,
      token_hash: randomUUID(), created_by: f.user.id, expires_at: new Date(Date.parse(f.now()) + 86400000) };
    await expect(db.updateTable('school_people').set({ account_user_id: account.id }).where('id', '=', person.id).execute()).rejects.toThrow('accepted exact-person invitation');
    const pending = await db.insertInto('school_invitations').values(invitation).returning('id').executeTakeFirstOrThrow();
    await expect(db.updateTable('school_people').set({ account_user_id: account.id }).where('id', '=', person.id).execute()).rejects.toThrow('accepted exact-person invitation');
    await expect(db.insertInto('school_invitations').values({ ...invitation, token_hash: randomUUID() }).execute()).rejects.toThrow('school_invitations_open_person');
    await expect(db.updateTable('school_invitations').set({ accepted_at: new Date(f.now()) }).where('id', '=', pending.id).execute()).rejects.toThrow('member_invitation_acceptance_actor');
    await db.updateTable('school_invitations').set({ accepted_at: new Date(f.now()), accepted_by_user_id: account.id }).where('id', '=', pending.id).execute();
    await db.updateTable('school_people').set({ account_user_id: account.id }).where('id', '=', person.id).execute();
    await expect(db.updateTable('school_people').set({ account_user_id: account.id }).where('id', '=', other.id).execute()).rejects.toThrow('accepted exact-person invitation');
    await db.insertInto('school_invitations').values({ ...invitation, person_id: other.id, token_hash: randomUUID(),
      accepted_at: new Date(f.now()), accepted_by_user_id: account.id }).execute();
    await expect(db.updateTable('school_people').set({ account_user_id: account.id }).where('id', '=', other.id).execute()).rejects.toThrow('school_people_account_user_scope');
    await expect(db.updateTable('school_people').set({ account_user_id: null }).where('id', '=', person.id).execute()).rejects.toThrow('silently cleared');
    await expect(db.insertInto('school_invitations').values({ ...invitation, person_id: null, token_hash: randomUUID() }).execute()).rejects.toThrow('person_invitation_member_target');
    const foreign = await fixture();
    await expect(db.insertInto('school_invitations').values({ ...invitation, school_id: foreign.schoolId, token_hash: randomUUID() }).execute()).rejects.toThrow('person_invitation_scope');
  });

  it('fails closed on a conflicting explicit profile identity without merging same-name people or replacing retained endpoints', async () => {
    const f = await fixture(), member = await acceptedMember(f, 'Same display name'), other = await f.person('Same display name');
    await db.insertInto('staff_profiles').values({ school_id: f.schoolId, person_id: other.id, user_id: member.account.id,
      staff_code: `C-${randomUUID().slice(0, 12)}`,   
      staff_kind: 'non_teaching', designation: 'Explicit legacy profile', department: 'Campus', employment_type: 'contract',
      status: 'active', created_by: f.user.id, updated_by: f.user.id }).execute();
    await f.run(async () => {
      expect(await db.transaction().execute(tx => f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: member.account.id, at: f.now() })))
        .toMatchObject({ acting: false, reason: 'profile_unlinked' });
      const states = await db.transaction().execute(tx => f.core.listPersonAccountStates(tx, { school_id: f.schoolId,
        person_ids: [member.person.id, other.id], at: f.now(), viewer_user_id: member.account.id }));
      expect(states).toEqual(expect.arrayContaining([
        { person_id: member.person.id, has_account: true, account_state: 'inactive', is_you: false },
        { person_id: other.id, has_account: true, account_state: 'inactive', is_you: false },
      ]));
      await expect(db.transaction().execute(tx => f.core.linkAccountEndpoint(tx, { ...member.link, person_id: other.id }))).rejects.toThrow('linked to this person');
      expect((await sql<{ count: string }>`SELECT count(*) AS count FROM campus_model_agent_endpoints
        WHERE school_id=${f.schoolId}::uuid AND user_id=${member.account.id}::uuid`.execute(db)).rows[0]!.count).toBe('1');
      expect(await db.selectFrom('school_people').select('account_user_id').where('id', '=', member.person.id).executeTakeFirstOrThrow())
        .toEqual({ account_user_id: member.account.id });
    });
  });

  it('does not disclose pending app invitations to a People manager without current invitation permission', async () => {
    const f = await fixture(), person = await f.person('Private pending access');
    await db.insertInto('school_invitations').values({ school_id: f.schoolId, person_id: person.id, role: 'member',
      email: 'private-pending@example.test', token_hash: randomUUID(), created_by: f.user.id, expires_at: new Date(Date.parse(f.now()) + 86400000) }).execute();
    await db.insertInto('staff_profiles').values({ school_id: f.schoolId, person_id: f.owner.person_id, user_id: f.user.id,
      staff_code: `M-${randomUUID().slice(0, 12)}`,    staff_kind: 'non_teaching',
      designation: 'People manager', department: 'Campus', employment_type: 'full_time', status: 'active', created_by: f.user.id, updated_by: f.user.id }).execute();
    await sql`INSERT INTO school_access_exceptions(school_id,user_id,permission,reason,source_kind,valid_from,valid_until,review_due_on,created_by)
      VALUES(${f.schoolId}::uuid,${f.user.id}::uuid,'sis.manage','Explicit People management only','manual',current_date-1,current_date+30,current_date+15,${f.user.id}::uuid)`.execute(db);
    await db.updateTable('school_memberships').set({ role: 'staff' }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
    await f.run(async () => {
      const detail = await f.people.detail(f.user, f.schoolId, person.id);
      expect(detail).toMatchObject({ account_state: 'not_linked', capabilities: { can_invite: false } });
      expect(detail).not.toHaveProperty('pending_invitation');
      const page = await f.people.list(f.user, f.schoolId, {});
      expect(page.capabilities.can_invite).toBe(false);
      expect(page.results.every(row => !('pending_invitation' in row))).toBe(true);
    });
  });

  it('bounds status lookup to the visible finite page and only discloses safe pending invitation metadata to current Live inviters', async () => {
    const f = await fixture();
    for (let i = 0; i < 26; i++) await f.person(`Paged ${String(i).padStart(2, '0')}`);
    const spy = vi.spyOn(f.core, 'listPersonAccountStates');
    await f.run(async () => {
      const page = await f.people.list(f.user, f.schoolId, { search: 'Paged', page: 2 });
      expect(page.results).toHaveLength(1); expect(page.total).toBe(26); expect(page.capabilities.can_invite).toBe(true);
      expect(spy.mock.calls.at(-1)?.[1].person_ids).toEqual([page.results[0]!.id]);
      const personId = page.results[0]!.id;
      const invitation = await db.insertInto('school_invitations').values({ school_id: f.schoolId, person_id: personId, role: 'member',
        email: 'never-disclosed@example.test', token_hash: randomUUID(), created_by: f.user.id, expires_at: new Date(Date.parse(f.now()) + 1000) })
        .returning('id').executeTakeFirstOrThrow();
      const detail = await f.people.detail(f.user, f.schoolId, personId);
      expect(detail).toMatchObject({ pending_invitation: { id: invitation.id, state: 'pending' }, has_account: false });
      expect(JSON.stringify(detail)).not.toContain('never-disclosed'); expect(JSON.stringify(detail)).not.toContain('token_hash');
      f.setNow(new Date(Date.parse(f.now()) + 2000).toISOString());
      expect(await f.people.detail(f.user, f.schoolId, personId)).toMatchObject({ pending_invitation: { id: invitation.id, state: 'expired' } });
      await expect(db.transaction().execute(tx => f.core.listPersonAccountStates(tx, { school_id: f.schoolId,
        person_ids: Array.from({ length: 26 }, () => randomUUID()), at: f.now() }))).rejects.toThrow();
    });
    spy.mockRestore();
  });

  it.runIf(Boolean(targetUrl))('reads captured and run-local identity in the selected COW world without changing Live or a sibling', async () => {
    const f = await fixture(), member = await acceptedMember(f), pending = await f.person('Pending invitation');
    f.setNow(new Date(Date.parse(f.now()) + 1000).toISOString());
    await db.insertInto('school_invitations').values({ school_id: f.schoolId, person_id: pending.id, role: 'member', email: 'private@example.test',
      token_hash: randomUUID(), created_by: f.user.id, expires_at: new Date(Date.parse(f.now()) + 86400000) }).execute();
    const store = new SimulationSnapshotStore(sourceUrl, requireIsolatedTestDatabaseUrl(targetUrl), 4), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, f.now());
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId,
          namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } });
        opened.push(database);
        const environment = simulationRequestEnvironment({ institution_id: f.schoolId, scenario_id: scenarioId, run_id: runId, virtual_now: f.now(),
          source_snapshot_ref: `sha256:${captured.content_hash}`, manifest_ref: 'person-account-state-test', checked_at: f.now() });
        return { ...services(database), database, run: <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action) };
      };
      const branch = await open(), sibling = await open();
      await branch.run(async () => {
        expect(await branch.people.detail(f.user, f.schoolId, member.person.id)).toMatchObject({ has_account: true, account_state: 'active', capabilities: { can_invite: false } });
        expect(await branch.people.detail(f.user, f.schoolId, pending.id)).not.toHaveProperty('pending_invitation');
        await expect(db.transaction().execute(tx => branch.core.listPersonAccountStates(tx, { school_id: f.schoolId, person_ids: [], at: f.now() })))
          .rejects.toThrow('selected execution data plane');
        await branch.people.correctName(request(f.user), f.schoolId, f.owner.person_id, { first_name: 'Run-local', last_name: 'Owner',
          expected_revision: 1, reason: 'Simulation-only campus name change', idempotency_key: randomUUID() });
        await branch.database.transaction().execute(tx => branch.core.closeAccountEndpoint(tx, { school_id: f.schoolId,
          endpoint_id: member.endpoint.endpoint_id, actor_user_id: f.user.id, expected_revision: 1, effective_at: f.now(), disposition: 'revoked',
          reason: 'Simulation-only access revocation', source_domain: 'auth', source_record_id: randomUUID(), source_revision: 1, idempotency_key: randomUUID() }));
        expect(await branch.people.detail(f.user, f.schoolId, member.person.id)).toMatchObject({ has_account: true, account_state: 'inactive' });
        expect(await branch.people.detail(f.user, f.schoolId, f.owner.person_id)).toMatchObject({ label: 'Run-local Owner', account_state: 'active', is_you: true });
      });
      for (const context of [{ ...f, people: f.people }, sibling]) await context.run(async () => {
        expect(await context.people.detail(f.user, f.schoolId, member.person.id)).toMatchObject({ account_state: 'active' });
        expect(await context.people.detail(f.user, f.schoolId, f.owner.person_id)).toMatchObject({ label: 'Account Owner', is_you: true });
      });
    } finally {
      await Promise.all(opened.map(database => database.destroy())); await store.pool.end();
    }
  }, 120000);
});
