import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { CoordinationConfigurationService } from '../src/campus-model-core/coordination-configuration.service.js';
import { coordinationConfigurationHash, type CoordinationConfigurationPort } from '../src/campus-model-core/coordination-configuration.port.js';
import { InvigilationInvitationPolicyService } from '../src/assessments/invigilation-invitation-policy.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { linkFixtureStaffIdentity } from './fixture-human-identity.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused', max: 3 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), applicationDb = db as DatabaseService;
const request = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {} }) as unknown as AuthenticatedRequest;
afterAll(() => db.destroy());

async function fixture() {
  const suffix = randomUUID(), core = new CampusModelCoreService(applicationDb), configurations = new CoordinationConfigurationService(core);
  const account = await db.insertInto('users').values({ username: `invitation-policy-${suffix}`, email: `invitation-policy-${suffix}@example.test`,
    first_name: 'Explicit', last_name: 'Administrator', password_hash: 'isolated-only', role: 'admin' }).returningAll().executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, 'Asia/Kolkata'));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  const at = new Date(Date.now() + 86400000).toISOString();
  const environment = createLiveExecutionEnvironment({ institution_id: schoolId, clock: { now: () => new Date(at), nowIso: () => at } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const service = new InvigilationInvitationPolicyService(applicationDb, core, configurations, core, core);
  const workspace = await run(() => service.workspace(user, schoolId));
  const person = workspace.eligible_recipients.find(row => row.user_id === user.id)!;
  const body = { expected_revision: 0, enabled: true, recipient_person_ids: [person.person_id], response_due_minutes: 30,
    expires_after_minutes: 120, approval_note: 'Approve exact named recipients and truthful response windows.', idempotency_key: randomUUID() };
  const counts = async () => (await sql<Record<string, number>>`SELECT
    (SELECT count(*)::int FROM assessment_invigilation_policy_versions WHERE school_id=${schoolId}::uuid) AS versions,
    (SELECT count(*)::int FROM assessment_invigilation_policy_current WHERE school_id=${schoolId}::uuid) AS pointers,
    (SELECT count(*)::int FROM campus_model_coordination_configurations WHERE school_id=${schoolId}::uuid) AS configurations,
    (SELECT count(*)::int FROM campus_model_behaviour_versions WHERE school_id=${schoolId}::uuid) AS behaviours,
    (SELECT count(*)::int FROM campus_model_agent_authorities WHERE school_id=${schoolId}::uuid) AS authorities,
    (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${schoolId}::uuid) AS commands,
    (SELECT count(*)::int FROM campus_model_command_outcomes outcome JOIN campus_model_commands command ON command.id=outcome.command_id WHERE command.school_id=${schoolId}::uuid) AS outcomes,
    (SELECT count(*)::int FROM campus_model_events WHERE school_id=${schoolId}::uuid) AS events,
    (SELECT count(*)::int FROM event_outbox WHERE school_id=${schoolId}::uuid) AS outbox,
    (SELECT count(*)::int FROM audit_events WHERE school_id=${schoolId}::uuid) AS audits`.execute(db)).rows[0]!;
  return { schoolId, user, core, configurations, service, run, body, workspace, counts, at };
}

describe.skipIf(!enabled)('explicit institution-owned invitation configuration with real PostgreSQL', () => {
  it('evaluates future virtual grants on execution time and rejects exact expiry, revocation and inactive membership', async () => {
    const f=await fixture();
    await f.run(async()=>{
      // The grant really starts tomorrow, not at the database host clock.
      expect(Date.parse(f.at)).toBeGreaterThan(Date.now());
      await f.service.approve(request(f.user),f.schoolId,f.body);
      const route=await db.transaction().execute(tx=>f.core.resolveEventRoute(tx,{school_id:f.schoolId,source_domain:'assessments',
        event_type:'assessment.invigilation.offered',selector_key:'assessment_invigilation_recipient',occurred_at:f.at}));
      if(route.status!=='matched')throw new Error('The explicitly activated test route was unavailable.');
      const authorize=(at:string)=>db.transaction().execute(tx=>f.core.authorizeCandidateRecipients(tx,{school_id:f.schoolId,
        behaviour_version_id:route.behaviour_version_id,subscription_id:route.subscription_id,occurred_at:at,
        recipients:[{agent_kind:'human',user_id:f.user.id}],scope:null}));
      expect((await authorize(f.at)).authorised).toEqual([{agent_kind:'human',user_id:f.user.id}]);
      const end=new Date(Date.parse(f.at)+60_000).toISOString();
      // These are explicit negative-case interventions in this isolated Core
      // fixture, not application-created attendance or invented human consent.
      await sql`UPDATE campus_model_agent_authorities SET effective_until=${end}::timestamptz
        WHERE school_id=${f.schoolId}::uuid AND grant_source='approved_coordination_policy'`.execute(db);
      expect((await authorize(new Date(Date.parse(end)-1).toISOString())).authorised).toHaveLength(1);
      expect((await authorize(end)).unauthorized).toEqual([{agent_kind:'human',user_id:f.user.id}]);
      await sql`UPDATE campus_model_agent_authorities SET revoked_at=${f.at}::timestamptz,revoked_by=${f.user.id}::uuid
        WHERE school_id=${f.schoolId}::uuid AND grant_source='approved_coordination_policy'`.execute(db);
      expect((await authorize(f.at)).unauthorized).toHaveLength(1);
      await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
      expect((await authorize(f.at)).unresolved).toEqual([{agent_kind:'human',user_id:f.user.id}]);
    });
  });
  it('requires current approval and exact eligible recipients, preserves replay, and disables without operational grants', async () => {
    const f = await fixture();
    expect(f.workspace.policy).toMatchObject({ state: 'unconfigured', revision: 0, enabled: false });
    const passive = await db.insertInto('school_people').values({ school_id: f.schoolId, first_name: 'Passive', last_name: 'Participant' }).returning('id').executeTakeFirstOrThrow();
    await f.run(async () => {
      await expect(f.service.approve(request(f.user), f.schoolId, { ...f.body, recipient_person_ids: [passive.id] })).rejects.toThrow('currently eligible');
      await expect(f.service.workspace({ ...f.user, active_school_id: randomUUID() }, f.schoolId)).rejects.toThrow('Switch to this institution');
      const saved = await f.service.approve(request(f.user), f.schoolId, f.body);
      expect(saved.policy).toMatchObject({ state: 'enabled', revision: 1 });
      expect(await f.service.approve(request(f.user), f.schoolId, f.body)).toEqual(saved);
      await expect(f.service.approve(request(f.user), f.schoolId, { ...f.body, response_due_minutes: 31 })).rejects.toThrow('different rules');
      await expect(f.service.approve(request(f.user), f.schoolId, { ...f.body, idempotency_key: randomUUID() })).rejects.toThrow('rules changed');
      const facts = (await sql<{ commands: number; active_routes: number; attendance_grants: number; assignments: number }>`SELECT
        (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND state='accepted') AS commands,
        (SELECT count(*)::int FROM campus_model_behaviour_versions WHERE school_id=${f.schoolId}::uuid AND status='approved') AS active_routes,
        (SELECT count(*)::int FROM campus_model_agent_authorities WHERE school_id=${f.schoolId}::uuid AND capability LIKE 'attendance%') AS attendance_grants,
        (SELECT count(*)::int FROM assessment_sitting_invigilators WHERE school_id=${f.schoolId}::uuid) AS assignments`.execute(db)).rows[0]!;
      expect(facts).toEqual({ commands: 2, active_routes: 1, attendance_grants: 0, assignments: 0 });
      const source = (await sql<{ snapshot: Record<string, unknown>; configuration_hash: string }>`SELECT snapshot,configuration_hash
        FROM campus_model_coordination_configurations WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!;
      expect(coordinationConfigurationHash(source.snapshot as unknown as Parameters<typeof coordinationConfigurationHash>[0])).toBe(source.configuration_hash);
      const disabled = await f.service.approve(request(f.user), f.schoolId, { ...f.body, expected_revision: 1, enabled: false,
        recipient_person_ids: [], approval_note: 'Explicitly disable invitations until the next administrator review.', idempotency_key: randomUUID() });
      expect(disabled.policy).toMatchObject({ state: 'disabled', revision: 2 });
      expect(disabled.readiness.can_create_invitations).toBe(false);
      const route = await db.transaction().execute(tx => f.core.resolveEventRoute(tx, { school_id: f.schoolId, source_domain: 'assessments',
        event_type: 'assessment.invigilation.offered', selector_key: 'assessment_invigilation_recipient', occurred_at: new Date(Date.now() + 86400000).toISOString() }));
      expect(route.status).toBe('unmatched');
      expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_agent_authorities
        WHERE school_id=${f.schoolId}::uuid AND grant_source='approved_coordination_policy' AND revoked_at IS NULL`.execute(db)).rows[0]!.count).toBe(0);
      await expect(sql`UPDATE assessment_invigilation_policy_versions SET approval_note='Overwrite accepted evidence' WHERE school_id=${f.schoolId}::uuid`.execute(db)).rejects.toThrow('immutable');
      await expect(sql`UPDATE campus_model_coordination_configurations SET snapshot='{}'::jsonb WHERE school_id=${f.schoolId}::uuid`.execute(db)).rejects.toThrow('immutable');
    });
  });

  it('rejects nonadministrators and accounts that cease to be eligible without silently repairing authority', async () => {
    const f = await fixture(), suffix = randomUUID();
    const staff = await db.insertInto('users').values({ username: `policy-staff-${suffix}`, email: `policy-staff-${suffix}@example.test`,
      first_name: 'Selected', last_name: 'Colleague', password_hash: 'isolated-only', role: 'staff' }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('school_memberships').values({ school_id: f.schoolId, user_id: staff.id, role: 'staff' }).execute();
    const identity = await linkFixtureStaffIdentity(applicationDb, { school_id: f.schoolId, user_id: staff.id, owner_user_id: f.user.id });
    await f.run(async () => {
      const staffUser: AuthUser = { ...staff, active_school_id: f.schoolId };
      await expect(f.service.workspace(staffUser, f.schoolId)).rejects.toThrow('administrator');
      await expect(f.service.approve(request(staffUser), f.schoolId, f.body)).rejects.toThrow('administrator');
      await f.service.approve(request(f.user), f.schoolId, { ...f.body, recipient_person_ids: [identity.person_id] });
      await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', staff.id).execute();
      const changed = await f.service.workspace(f.user, f.schoolId);
      expect(changed.readiness).toEqual({ can_create_invitations: false, missing_recipient_count: 1 });
      expect(changed.eligible_recipients.some(person => person.person_id === identity.person_id)).toBe(false);
      await expect(f.service.approve(request(f.user), f.schoolId, { ...f.body, expected_revision: 1,
        recipient_person_ids: [identity.person_id], idempotency_key: randomUUID() })).rejects.toThrow('currently eligible');
      await db.updateTable('school_memberships').set({ is_active: false }).where('school_id', '=', f.schoolId).where('user_id', '=', f.user.id).execute();
      await expect(f.service.approve(request(f.user), f.schoolId, { ...f.body, recipient_person_ids: [identity.person_id] })).rejects.toThrow('administrator');
    });
  });

  it('rolls back configuration, grants, policy, command outcomes and outbox on failure, then safely retries', async () => {
    const f = await fixture();
    const failing: CoordinationConfigurationPort = { configureRoute: async (tx, input) => {
      await f.configurations.configureRoute(tx, input); throw new Error('Injected configuration persistence failure');
    } };
    const faulty = new InvigilationInvitationPolicyService(applicationDb, f.core, failing, f.core, f.core);
    await f.run(async () => {
      const before = await f.counts();
      await expect(faulty.approve(request(f.user), f.schoolId, f.body)).rejects.toThrow('Injected configuration');
      expect(await f.counts()).toEqual(before);
      expect((await f.service.workspace(f.user, f.schoolId)).policy.state).toBe('unconfigured');
      const after = await f.service.approve(request(f.user), f.schoolId, f.body);
      expect(after.policy.revision).toBe(1);
      expect((await f.counts()).commands! - before.commands!).toBe(2);
      expect((await f.counts()).configurations! - before.configurations!).toBe(1);
    });
  });
});
