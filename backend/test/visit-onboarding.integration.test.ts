import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as appConfig from '../src/config.js';
import * as email from '../src/common/email-transport.js';
import type { AuthUser } from '../src/common/request.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SimulationBranchDriver, createSimulationBranch } from '../src/database/simulation-branch.driver.js';
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { VisitOnboardingIdentity } from '../src/gate/visit-onboarding-identity.js';
import { VisitOnboardingModel } from '../src/gate/visit-onboarding.model.js';
import { VisitOnboardingService, visitOnboardingCredential } from '../src/gate/visit-onboarding.service.js';
import { createVisitGuestFixture, visitGuestLater, visitGuestRunAt } from './visit-guest-view.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/visit_onboarding_unused_test';
const target = process.env.VISIT_GUEST_SIMULATION_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
afterAll(() => db.destroy()); afterEach(() => vi.restoreAllMocks());
function service(database: DatabaseService) { const core = new CampusModelCoreService(database, new ExecutionDataPlaneScope());
  return new VisitOnboardingService(database, core, new VisitOnboardingIdentity(core), new VisitOnboardingModel(core, core, core)); }
async function fixture(wholeCampus=false) {
  const f = await createVisitGuestFixture(db,{wholeCampus}), onboarding = service(db);
  const input = { command_id: randomUUID(), expected_revision: 0, expected_visit_revision: f.visit.revision, action: 'issue' as const, ends_at: visitGuestLater(f.now, 300) };
  const issued = await f.run(() => onboarding.change(f.user, f.schoolId, f.visit.id, input));
  const token = issued.join_url ? new URLSearchParams(new URL(issued.join_url).hash.slice(1)).get('token')! : '';
  if (!token) throw new Error('The isolated Live issue must expose its credential only in its explicit response.');
  const guestAccount = await db.selectFrom('users').select('email_verified_at').where('id', '=', f.joined!.user.id).executeTakeFirstOrThrow();
  const guest = { ...f.joined!.user, email_verified_at: guestAccount.email_verified_at };
  const ownerAccount = await db.selectFrom('users').select('email_verified_at').where('id', '=', f.user.id).executeTakeFirstOrThrow();
  return { ...f, user: { ...f.user, email_verified_at: ownerAccount.email_verified_at }, onboarding, issued, token, issueInput: input, guest };
}
async function mailbox(onboarding: VisitOnboardingService, token: string, address: string) {
  let code = '', deliveries = 0; const settings = appConfig.config();
  vi.spyOn(appConfig, 'config').mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: true });
  vi.spyOn(email, 'sendTransactionalEmail').mockImplementation(async message => {
    if (message.to !== address || !address.endsWith('@example.test')) throw new Error('Unexpected synthetic recipient.');
    code = /confirmation code is:\s*(\d{6})/.exec(message.text)?.[1] ?? ''; deliveries++;
  });
  const proof = await onboarding.proof({ token, email: address }, `fixture:${randomUUID()}`);
  expect(proof.delivery).toBe('email_accepted'); expect(deliveries).toBe(1); expect(code).toMatch(/^\d{6}$/);
  expect(JSON.stringify(proof)).not.toContain(code); return { proof, code };
}
describe.runIf(enabled)('Reusable visit link and independent visitor identities', () => {
  it('issues one reusable hash-only locator, preserves exact replay and rejects stale/changed commands', async () => {
    const f = await fixture(); expect(f.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await f.run(() => f.onboarding.change(f.user, f.schoolId, f.visit.id, f.issueInput))).toMatchObject({ receipt: { replayed: true }, join_url: f.issued.join_url });
    expect(JSON.stringify(await f.run(() => f.onboarding.management(f.user, f.schoolId, f.visit.id)))).not.toContain(f.token);
    await expect(f.run(() => f.onboarding.change(f.user, f.schoolId, f.visit.id, { ...f.issueInput, ends_at: visitGuestLater(f.now, 301) }))).rejects.toThrow('different');
    await expect(f.run(() => f.onboarding.change(f.user, f.schoolId, f.visit.id, { ...f.issueInput, command_id: randomUUID() }))).rejects.toThrow('changed');
    const rows = (await sql<{ token_hash: string }>`SELECT token_hash FROM gate_visit_onboarding_links WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows;
    expect(rows).toHaveLength(1); expect(rows[0]!.token_hash).not.toBe(f.token);
    const events = await db.selectFrom('event_outbox').select(['payload', 'notification_payload', 'notification_user_ids']).where('school_id', '=', f.schoolId).where('event_type', 'like', 'gate.visit_onboarding.%').execute();
    expect(events).toHaveLength(1); expect(JSON.stringify(events)).not.toContain(f.token); expect(events[0]!.notification_user_ids).toEqual([]);
    expect(await f.run(() => f.onboarding.confirmation(f.user, f.schoolId, f.visit.id, f.issueInput.command_id))).toMatchObject({ state: 'accepted', source_id: f.issueInput.command_id });
    expect(await f.run(() => f.onboarding.reveal(f.user, f.schoolId, f.visit.id, { expected_revision: 1, expected_visit_revision: 1 }))).toMatchObject({ join_url: f.issued.join_url, revision: 1 });
    expect((await f.run(() => f.onboarding.management(f.user, f.schoolId, f.visit.id))).revision).toBe(1);
    await expect(f.run(() => f.onboarding.reveal(f.user, f.schoolId, f.visit.id, { expected_revision: 2, expected_visit_revision: 1 }))).rejects.toThrow('changed');
  }, 60_000);
  it('retains an entire-campus destination in the public preview and own registered view without a fabricated room',async()=>{
    const f=await fixture(true),preview=await f.onboarding.preview({token:f.token});
    expect(preview.visit.place_label).toBe(f.visit.place.label);
    await f.onboarding.join(f.guest,{token:f.token,command_id:randomUUID()});
    const own=await f.run(()=>f.onboarding.participant(f.guest,f.schoolId,f.visit.id));
    expect(own.visit.place).toEqual({label:f.visit.place.label,campus_label:f.visit.place.label});
    expect(own.visit.place).not.toHaveProperty('id');
    expect(own).toMatchObject({entry_permission:false,presence_confirmed:false});
    expect(own).not.toHaveProperty('question');
  },60_000);
  it('lets multiple verified accounts self-register without changing plan, movement, organiser thread or existing authority', async () => {
    const f = await fixture(), guest = f.guest;
    const preview = await f.onboarding.preview({ token: f.token }); expect(preview.visit.id).toBe(f.visit.id);
    expect(JSON.stringify(preview)).not.toMatch(/organiser|question|phone|email|party_size/);
    const command = randomUUID(), first = await f.onboarding.join(guest, { token: f.token, command_id: command });
    expect(await f.onboarding.join(guest, { token: f.token, command_id: command })).toEqual({ ...first, replayed: true });
    await f.onboarding.join(f.user, { token: f.token, command_id: randomUUID() });
    expect((await f.run(() => f.onboarding.management(f.user, f.schoolId, f.visit.id))).current!.registration_count).toBe(2);
    const own = await f.run(() => f.onboarding.participant(guest, f.schoolId, f.visit.id));
    expect(own).toMatchObject({ registration: { id: first.registration_id, evidence: 'self_registered' }, entry_permission: false, presence_confirmed: false });
    expect(own).not.toHaveProperty('question'); expect(own).not.toHaveProperty('participants');
    await expect(f.run(() => f.sharing.sharedDetail(guest, f.schoolId, f.visit.id))).rejects.toThrow();
    expect((await f.run(() => f.visits.detail(f.user, f.schoolId, f.visit.id))).visit).toMatchObject({ party_size: 12, revision: 1, last_movement: null });
    expect(await db.selectFrom('campus_model_observations').select('id').where('school_id', '=', f.schoolId).execute()).toEqual([]);
    expect((await f.run(() => f.sharing.discovery(guest, f.schoolId))).has_registered).toBe(true);
  }, 60_000);
  it('creates a neutral account only after independent proof, then binds exactly its self-declared person with assigned-work scope', async () => {
    const f = await fixture(), address = `visit-self-${randomUUID()}@example.test`, { proof, code } = await mailbox(f.onboarding, f.token, address);
    const accountInput = { token: f.token, email: address, challenge_id: proof.challenge_id, code, first_name: 'Fictional Self Visitor', last_name: '', password: 'Synthetic-Self-Visitor-2026!' };
    await expect(f.onboarding.account({ ...accountInput, code: code === '000000' ? '111111' : '000000' })).rejects.toThrow('invalid');
    expect(await f.onboarding.account(accountInput)).toEqual({ status: 'created' });
    await expect(f.onboarding.account(accountInput)).rejects.toThrow('invalid');
    expect((await sql`SELECT id FROM auth_visit_onboarding_challenges WHERE id=${proof.challenge_id}::uuid`.execute(db)).rows).toEqual([]);
    const account = await db.selectFrom('users').selectAll().where('email', '=', address).executeTakeFirstOrThrow();
    const audits = await db.selectFrom('audit_events').select(['action', 'metadata']).where('actor_id', '=', account.id).execute();
    expect(audits).toContainEqual({ action: 'auth.visit_registration.account_created', metadata: { link_id: f.issued.current!.id, creates_membership: false } });
    expect(JSON.stringify(audits)).not.toContain(code); expect(JSON.stringify(audits)).not.toContain(f.token);
    expect(await db.selectFrom('school_memberships').select('school_id').where('user_id', '=', account.id).execute()).toEqual([]);
    const user: AuthUser = { id: account.id, username: account.username, email: account.email, first_name: account.first_name, last_name: account.last_name, role: 'member', is_active: true, email_verified_at: account.email_verified_at, active_school_id: null };
    const joined = await f.onboarding.join(user, { token: f.token, command_id: randomUUID() });
    expect((await db.selectFrom('school_memberships').select(['role', 'access_scope']).where('user_id', '=', user.id).execute())).toEqual([{ role: 'member', access_scope: 'assigned_work' }]);
    await expect(db.transaction().execute(tx => tx.updateTable('school_memberships').set({ role: 'admin' }).where('school_id', '=', f.schoolId).where('user_id', '=', user.id).execute())).rejects.toThrow();
    expect((await db.selectFrom('school_memberships').select(['role', 'access_scope']).where('user_id', '=', user.id).execute())).toEqual([{ role: 'member', access_scope: 'assigned_work' }]);
    const person = await db.selectFrom('school_people').select(['id', 'first_name', 'account_user_id']).where('school_id', '=', f.schoolId).where('account_user_id', '=', user.id).executeTakeFirstOrThrow();
    expect(person.first_name).toBe('Fictional Self Visitor');
    expect(await f.onboarding.participant({ ...user, active_school_id: f.schoolId }, f.schoolId, f.visit.id)).toMatchObject({ registration: { id: joined.registration_id } });
    expect(await db.selectFrom('staff_profiles').select('id').where('user_id', '=', user.id).execute()).toEqual([]);
    expect(await f.sharing.discovery({ ...user, active_school_id: f.schoolId }, f.schoolId)).toMatchObject({ can_manage: false, has_shared: false, has_registered: true });
  }, 60_000);
  it('bounds mailbox resend and removes expired private challenges before issuing a new confirmation', async () => {
    const f = await fixture(), address = `visit-proof-${randomUUID()}@example.test`, first = await mailbox(f.onboarding, f.token, address);
    await expect(f.onboarding.proof({ token: f.token, email: address }, `fixture:${randomUUID()}`)).rejects.toThrow('one minute');
    await sql`UPDATE auth_visit_onboarding_challenges SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 second' WHERE id=${first.proof.challenge_id}::uuid`.execute(db);
    await expect(f.onboarding.account({ token: f.token, email: address, challenge_id: first.proof.challenge_id, code: first.code,
      first_name: 'Expired Proof Visitor', last_name: '', password: 'Synthetic-Expired-Visitor-2026!' })).rejects.toThrow('expired');
    const next = await mailbox(f.onboarding, f.token, address);
    expect(next.proof.challenge_id).not.toBe(first.proof.challenge_id);
    expect((await sql`SELECT id FROM auth_visit_onboarding_challenges WHERE id=${first.proof.challenge_id}::uuid`.execute(db)).rows).toEqual([]);
    expect(await db.selectFrom('users').select('id').where('email', '=', address).execute()).toEqual([]);
  }, 60_000);
  it('revocation and rotation invalidate old links/own access without deleting account/history or restoring old grants', async () => {
    const f = await fixture(), guest = f.guest; await f.onboarding.join(guest, { token: f.token, command_id: randomUUID() });
    await f.run(() => f.onboarding.change(f.user, f.schoolId, f.visit.id, { command_id: randomUUID(), expected_revision: 1, expected_visit_revision: 1, action: 'revoke' }));
    await expect(f.onboarding.preview({ token: f.token })).rejects.toThrow('unavailable');
    await expect(f.run(() => f.onboarding.participant(guest, f.schoolId, f.visit.id))).rejects.toThrow('ended');
    const rotated = await f.run(() => f.onboarding.change(f.user, f.schoolId, f.visit.id, { ...f.issueInput, command_id: randomUUID(), expected_revision: 2 }));
    expect(rotated.join_url).not.toBe(f.issued.join_url);
    expect((await f.run(() => f.onboarding.change(f.user, f.schoolId, f.visit.id, f.issueInput))).join_url).toBeNull();
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM gate_visit_onboarding_registrations WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(1);
  }, 60_000);
  it('refuses unverified accounts, changed claim IDs, cancelled sources and forged native registrations', async () => {
    const f = await fixture(), guest = f.guest;
    await expect(f.onboarding.join({ ...guest, email_verified_at: null }, { token: f.token, command_id: randomUUID() })).rejects.toThrow('verified');
    const command = randomUUID(); await f.onboarding.join(guest, { token: f.token, command_id: command });
    await expect(f.onboarding.join(f.user, { token: f.token, command_id: command })).rejects.toThrow('another');
    await expect(db.transaction().execute(async tx => { const person = await f.core.resolveAccountEndpoint(tx, { school_id: f.schoolId, user_id: f.user.id, at: new Date().toISOString() });
      if (!person.acting) throw new Error('The fixture needs its real current identity.');
      await sql`INSERT INTO gate_visit_onboarding_registrations(id,school_id,visit_id,link_id,user_id,person_id,registered_at) VALUES(${randomUUID()}::uuid,${f.schoolId}::uuid,${f.visit.id}::uuid,${f.issued.current!.id}::uuid,${f.user.id}::uuid,${person.person_id}::uuid,${new Date()})`.execute(tx); })).rejects.toThrow('accepted');
    await f.run(() => f.visits.cancel(f.user, f.schoolId, f.visit.id, { command_id: randomUUID(), expected_revision: 1 }));
    await expect(f.onboarding.join(f.user, { token: f.token, command_id: randomUUID() })).rejects.toThrow('unavailable');
    expect((await f.run(() => f.onboarding.participant(guest, f.schoolId, f.visit.id))).visit.state).toBe('cancelled');
  }, 60_000);
  it('rechecks issuer authority and exact expiry for preview, reveal, new joins and retained participant reads', async () => {
    const f = await fixture(), guest = f.guest; await f.onboarding.join(guest, { token: f.token, command_id: randomUUID() });
    await expect(visitGuestRunAt(f.schoolId, f.issueInput.ends_at, () => f.onboarding.preview({ token: f.token }))).rejects.toThrow('unavailable');
    await expect(visitGuestRunAt(f.schoolId, f.issueInput.ends_at, () => f.onboarding.participant(guest, f.schoolId, f.visit.id))).rejects.toThrow('ended');
    await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
    await expect(f.onboarding.preview({ token: f.token })).rejects.toThrow('unavailable');
    await expect(f.onboarding.join(guest, { token: f.token, command_id: randomUUID() })).rejects.toThrow('unavailable');
    await expect(f.run(() => f.onboarding.participant(guest, f.schoolId, f.visit.id))).rejects.toThrow('unavailable');
    await expect(f.run(() => f.onboarding.reveal(f.user, f.schoolId, f.visit.id, { expected_revision: 1, expected_visit_revision: 1 }))).rejects.toThrow('authority');
  }, 60_000);
});

async function world(store: SimulationSnapshotStore, snapshot: StoredSimulationSnapshot, school: string) {
  const run = randomUUID(), scenario = randomUUID(), namespace = `scenario:${scenario}:run:${run}` as const,
    branch = await createSimulationBranch(store.pool, snapshot, { run_id: run, school_id: school, scenario_id: scenario, namespace_id: namespace }),
    driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool }),
    database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(), createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: d => compiler.createIntrospector(d) } }) as DatabaseService;
  const environment = simulationRequestEnvironment({ institution_id: school, scenario_id: scenario, run_id: run, virtual_now: snapshot.captured_at,
    source_snapshot_ref: `sha256:${snapshot.content_hash}`, manifest_ref: 'visit-self-registration-cow', checked_at: snapshot.captured_at });
  return { database, onboarding: service(database), run: <T>(operation: () => Promise<T>) => executionEnvironmentStorage.run(environment, operation) };
}
describe.runIf(enabled && Boolean(target))('Visitor registration source in actual isolated worlds', () => {
  it('retains safe captured self view and branch-only revocation, blocks real onboarding and leaves Live/sibling unchanged', async () => {
    const f = await fixture(), guest = f.guest; await f.onboarding.join(guest, { token: f.token, command_id: randomUUID() });
    const original = await f.run(() => f.onboarding.participant(guest, f.schoolId, f.visit.id)), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3), opened: DatabaseService[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, new Date().toISOString()), first = await world(store, snapshot, f.schoolId), sibling = await world(store, snapshot, f.schoolId); opened.push(first.database, sibling.database);
      expect(snapshot.counts.auth_visit_onboarding_challenges ?? 0).toBe(0);
      await first.run(async () => {
        expect(visitOnboardingCredential(f.schoolId, f.visit.id, f.issueInput.command_id)).not.toBe(f.token);
        expect(await first.onboarding.participant(guest, f.schoolId, f.visit.id)).toEqual(original);
        expect((await first.onboarding.management(f.user, f.schoolId, f.visit.id)).public_onboarding_supported).toBe(false);
        await expect(first.onboarding.preview({ token: f.token })).rejects.toThrow('Live');
        await expect(first.onboarding.proof({}, 'unused-fixture-ip')).rejects.toThrow('Live');
        await expect(first.onboarding.account({})).rejects.toThrow('Live');
        await expect(first.onboarding.join(guest, {})).rejects.toThrow('Live');
        await expect(first.onboarding.reveal(f.user, f.schoolId, f.visit.id, { expected_revision: 1, expected_visit_revision: 1 })).rejects.toThrow('Live');
        await first.onboarding.change(f.user, f.schoolId, f.visit.id, { command_id: randomUUID(), expected_revision: 1, expected_visit_revision: 1, action: 'revoke' });
        await expect(first.onboarding.participant(guest, f.schoolId, f.visit.id)).rejects.toThrow('ended');
        const branchCommand = { ...f.issueInput, command_id: randomUUID(), expected_revision: 2 };
        const branchIssued = await first.onboarding.change(f.user, f.schoolId, f.visit.id, branchCommand);
        expect(branchIssued).toMatchObject({ revision: 3, join_url: null, public_onboarding_supported: false });
        expect(await first.onboarding.change(f.user, f.schoolId, f.visit.id, branchCommand)).toMatchObject({ receipt: { replayed: true }, join_url: null });
      });
      expect(await f.run(() => f.onboarding.participant(guest, f.schoolId, f.visit.id))).toEqual(original);
      expect(await sibling.run(() => sibling.onboarding.participant(guest, f.schoolId, f.visit.id))).toEqual(original);
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
