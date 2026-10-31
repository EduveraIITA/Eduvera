import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { AssessmentsService } from '../src/assessments/assessments.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { AuditService } from '../src/common/audit.service.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { GovernanceService } from '../src/governance/governance.service.js';
import { InstitutionSetupService } from '../src/institution-setup/institution-setup.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { ParticipationPeopleService } from '../src/people/participation-people.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { PersonAccountInvitationsService } from '../src/operations/person-account-invitations.service.js';
import { RequestsService } from '../src/requests/requests.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { StaffCoverageOfferBridgeService } from '../src/staff-operations/staff-coverage-offer-bridge.service.js';
import { StaffLeaveModelBridgeService } from '../src/staff-operations/staff-leave-model-bridge.service.js';
import { StaffOperationsService } from '../src/staff-operations/staff-operations.service.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused_test';
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) });
const req = (user: AuthUser) => ({ authUser:user,requestId:randomUUID() }) as AuthenticatedRequest;
afterAll(() => db.destroy());
function services(database: Kysely<Database>) {
  const connection = database as DatabaseService, scope = new ExecutionDataPlaneScope(), core = new CampusModelCoreService(connection,scope);
  const events = new SchoolEventService(connection,core), governance = new GovernanceService(connection,events);
  return { core, people:new ParticipationPeopleService(connection,events,core,core,core,core),
    operations:new OperationsService(connection,createStaffCoverageReconciliationTestDouble(),new PersonAccountInvitationsService(connection,core,core,core)),
    staff:new StaffOperationsService(connection,new StaffLeaveModelBridgeService(governance,core),new StaffCoverageOfferBridgeService(core),
      createStaffCoverageReconciliationTestDouble(),core,core,core,core),
    setup:new InstitutionSetupService(connection,new AuditService(connection),core,core,core,core), requests:new RequestsService(connection,undefined,scope),
    assessments:new AssessmentsService(connection,events,undefined,core,core) };
}
async function fixture() {
  const s = services(db), suffix = randomUUID();
  const account = await db.insertInto('users').values({username:`canonical-staff-${suffix}`,email:`canonical-staff-${suffix}@example.test`,
    first_name:'Account label',last_name:'Unchanged',password_hash:'isolated-only',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(s.core).createForAccount(tx,account,'UTC'));
  const user:AuthUser={...account,active_school_id:schoolId}, now=new Date().toISOString();
  const run = <T>(fn:()=>Promise<T>) => executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}}),fn);
  const person = await run(() => s.people.create(req(user),schoolId,{first_name:'Original campus name',contact_email:'before@example.test',contact_phone:'+919000000001',idempotency_key:randomUUID()}));
  return {...s,user,schoolId,now,run,person};
}
const work = (personId:string) => ({person:{id:personId,expected_revision:1},idempotency_key:randomUUID(),staff_code:`W-${randomUUID().slice(0,8)}`,
  staff_kind:'non_teaching',designation:'Campus worker',employment_type:'contract',joined_on:null});

describe.skipIf(!enabled)('canonical staff person ownership after migration 216',()=>{
  it('has no second writable name/contact authority or identity-creating insert trigger',async()=>{
    const columns=(await sql<{column_name:string}>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_profiles'`.execute(db)).rows.map(r=>r.column_name);
    expect(columns).not.toEqual(expect.arrayContaining(['first_name','last_name','email','phone']));
    expect(columns.filter(c=>['first_name','last_name','email','phone'].includes(c))).toEqual([]);
    expect((await sql`SELECT 1 FROM pg_trigger WHERE tgrelid='staff_profiles'::regclass AND tgname='staff_profile_person_identity'`.execute(db)).rows).toEqual([]);
    expect((await sql<{definition:string}>`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='staff_profiles'::regclass AND conname='staff_profiles_person_scope_fk'`.execute(db)).rows[0]?.definition).toContain('FOREIGN KEY (school_id, person_id)');
    await expect(db.insertInto('staff_profiles').values({school_id:randomUUID(),person_id:randomUUID(),user_id:null,staff_code:'NO-IMPLICIT',staff_kind:'non_teaching',designation:'Invalid',employment_type:'unspecified',joined_on:null,created_by:null,updated_by:null}).execute()).rejects.toThrow();
  });
  it('shows one corrected current identity across staff and campus setup without changing account or employment history',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const saved=await f.staff.createProfile(f.user,f.schoolId,work(f.person.id));
      const profile=saved.profile as {id:string};
      const native=await db.selectFrom('staff_profiles').selectAll().where('id','=',profile.id).executeTakeFirstOrThrow();
      const section=await db.insertInto('class_sections').values({school_id:f.schoolId,academic_year:'2026-27',grade:'Example',section:'A'}).returning('id').executeTakeFirstOrThrow();
      const declined=(await sql<{id:string}>`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by,response_note)
        SELECT ${f.schoolId}::uuid,type.id,${profile.id}::uuid,${section.id}::uuid,current_date,'declined',${f.user.id}::uuid,'Cannot take this duty'
        FROM staff_responsibility_types type WHERE type.school_id=${f.schoolId}::uuid AND type.code='class_teacher' RETURNING id`.execute(db)).rows[0]!;
      const correction=await f.people.correctName(req(f.user),f.schoolId,f.person.id,{first_name:'Corrected campus name',expected_revision:2,reason:'Verified current spelling',idempotency_key:randomUUID()});
      await f.people.correctProfile(req(f.user),f.schoolId,f.person.id,{contact_email:'corrected@example.test',contact_phone:'+919000000002',expected_revision:correction.revision,reason:'Verified contact',idempotency_key:randomUUID()});
      const workspace=await f.staff.workspace(f.user,f.schoolId);
      expect(workspace).toMatchObject({mode:'admin',profiles:expect.arrayContaining([expect.objectContaining({id:native.id,first_name:'Corrected campus name',email:'corrected@example.test',phone:'+919000000002'})])});
      expect((await f.setup.workspace(f.user,f.schoolId)).staff).toEqual(expect.arrayContaining([expect.objectContaining({id:native.id,first_name:'Corrected campus name'})]));
      const workItems=await f.requests.workspaceItems(f.user,{school_id:f.schoolId,environment_namespace_id:`live:${f.schoolId}`,recorded_at:f.now,
        school_name:'Isolated example campus',timezone:'UTC',membership_roles:['admin'],relationships:[],
        assignments:[{action_key:'responsibilities.manage',capability_key:'responsibilities.manage',scope:{kind:'institution',id:f.schoolId}}]});
      expect(workItems).toEqual(expect.arrayContaining([expect.objectContaining({source_id:declined.id,detail:expect.stringContaining('Corrected campus name')})]));
      expect(await db.selectFrom('staff_profiles').selectAll().where('id','=',native.id).executeTakeFirstOrThrow()).toEqual(native);
      expect(await db.selectFrom('users').select(['first_name','last_name']).where('id','=',f.user.id).executeTakeFirstOrThrow()).toEqual({first_name:'Account label',last_name:'Unchanged'});
      expect((await f.people.detail(f.user,f.schoolId,f.person.id)).profile).toEqual({contact_email:'corrected@example.test',contact_phone:'+919000000002'});
      await expect(f.staff.createProfile(f.user,f.schoolId,{...work(f.person.id),email:'not-an-employment-contact@example.test'})).rejects.toThrow();
    });
  });
  it('creates reviewed employment intake with exact intended-person invitation and current People-owned contacts',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const saved=await f.staff.createProfile(f.user,f.schoolId,{first_name:'New employee',last_name:'',email:`new-employee-${randomUUID()}@example.test`,phone:'+919000000003',
        staff_code:`N-${randomUUID().slice(0,8)}`,staff_kind:'non_teaching',designation:'Campus helper',employment_type:'unspecified',joined_on:null});
      const profile=saved.profile as {person_id:string;email:string};
      expect(saved.invitation).not.toBeNull();
      expect(await db.selectFrom('school_invitations').select(['person_id','role']).where('id','=',saved.invitation!.id).executeTakeFirstOrThrow())
        .toEqual({person_id:profile.person_id,role:'staff'});
      expect(await db.selectFrom('school_people').select(['first_name','contact_email','contact_phone']).where('id','=',profile.person_id).executeTakeFirstOrThrow())
        .toEqual({first_name:'New employee',contact_email:profile.email,contact_phone:'+919000000003'});
      expect((await sql`SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
        WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='people.employment.intake' AND command.state='accepted'`.execute(db)).rows).toHaveLength(1);
    });
  });
  it('keeps assessment work selectors on current canonical worker names while retaining account IDs',async()=>{
    const f=await fixture();await f.run(async()=>{
      const identity=await db.transaction().execute(tx=>f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:f.user.id,at:f.now}));
      if(!identity.acting)throw new Error('Fixture founder needs current canonical app identity.');
      const owner=await db.selectFrom('school_people').select(['id','revision']).where('school_id','=',f.schoolId).where('id','=',identity.person_id).executeTakeFirstOrThrow();
      await f.staff.createProfile(f.user,f.schoolId,{...work(owner.id),person:{id:owner.id,expected_revision:owner.revision}});
      await f.people.correctName(req(f.user),f.schoolId,owner.id,{first_name:'Canonical exam reviewer',expected_revision:owner.revision+1,
        reason:'Verified current campus name',idempotency_key:randomUUID()});
      const workspace=await f.assessments.workspace(f.user,f.schoolId);
      expect(workspace.references?.staff).toEqual(expect.arrayContaining([expect.objectContaining({id:f.user.id,first_name:'Canonical exam reviewer'})]));
      expect(await db.selectFrom('users').select('first_name').where('id','=',f.user.id).executeTakeFirstOrThrow()).toEqual({first_name:'Account label'});
    });
  });
  it('requires an explicit unlinked staff person before issuing a usable current staff invitation',async()=>{
    const f=await fixture(),other=await fixture();await f.run(async()=>{
      const saved=await f.staff.createProfile(f.user,f.schoolId,work(f.person.id)),profile=saved.profile as {id:string};
      await sql`WITH people AS (INSERT INTO school_people(school_id,first_name,last_name)
        SELECT ${f.schoolId}::uuid,'Fictional bulk worker '||number,'' FROM generate_series(1,26) AS number RETURNING id)
        INSERT INTO staff_profiles(school_id,person_id,staff_code,staff_kind,designation,employment_type)
        SELECT ${f.schoolId}::uuid,id,'B-'||row_number() OVER(),'non_teaching','Fictional worker','unspecified' FROM people`.execute(db);
      expect((await f.operations.invitationWorkspace(f.user,f.schoolId)).staff).toHaveLength(27);
      expect((await f.operations.invitationWorkspace(f.user,f.schoolId)).staff).toEqual(expect.arrayContaining([
        expect.objectContaining({id:f.person.id,name:'Original campus name',email:'before@example.test'})]));
      const email=`exact-staff-access-${randomUUID()}@example.test`;
      await expect(f.operations.invite(f.user,f.schoolId,{email,role:'staff'})).rejects.toThrow(/Choose the staff person/);
      await expect(f.operations.invite(f.user,f.schoolId,{email,role:'staff',person_id:other.person.id})).rejects.toThrow(/current staff person/);
      expect(await db.selectFrom('school_invitations').select('id').where('school_id','=',f.schoolId).execute()).toEqual([]);
      const legacy=await db.insertInto('school_invitations').values({school_id:f.schoolId,email:`legacy-${randomUUID()}@example.test`,role:'staff',
        token_hash:randomUUID(),created_by:f.user.id,expires_at:new Date(Date.parse(f.now)+1800000)}).returning(['id','token_hash']).executeTakeFirstOrThrow();
      await expect(f.operations.resendInvitation(f.user,f.schoolId,legacy.id)).rejects.toThrow(/no confirmed campus person/);
      expect((await db.selectFrom('school_invitations').select('token_hash').where('id','=',legacy.id).executeTakeFirstOrThrow()).token_hash).toBe(legacy.token_hash);
      const invitation=await f.operations.invite(f.user,f.schoolId,{email,role:'staff',person_id:f.person.id});
      if(!invitation.token)throw new Error('Isolated test expects manual fictional invitation delivery.');
      expect(await db.selectFrom('school_invitations').select('person_id').where('id','=',invitation.id).executeTakeFirstOrThrow()).toEqual({person_id:f.person.id});
      await f.operations.acceptInvite({email,token:invitation.token,password:'S3cure!Campus-9274',first_name:'Account label',last_name:'Only'});
      const account=await db.selectFrom('users').select('id').where('email','=',email).executeTakeFirstOrThrow();
      expect(await db.selectFrom('staff_profiles').select(['user_id','status']).where('id','=',profile.id).executeTakeFirstOrThrow()).toEqual({user_id:account.id,status:'onboarding'});
      expect((await f.operations.invitationWorkspace(f.user,f.schoolId)).staff.map(person=>person.id)).not.toContain(f.person.id);
      await expect(f.operations.invite(f.user,f.schoolId,{email,role:'staff',person_id:f.person.id})).rejects.toThrow(/Manage existing access/);
      expect(await db.selectFrom('school_people').select(['first_name','contact_email']).where('id','=',f.person.id).executeTakeFirstOrThrow())
        .toEqual({first_name:'Original campus name',contact_email:'before@example.test'});
    });
  });
  it.runIf(Boolean(targetUrl))('corrects current worker details in one actual COW branch without changing Live or its sibling',async()=>{
    const f=await fixture();
    await f.run(()=>f.staff.createProfile(f.user,f.schoolId,work(f.person.id)));
    const store=new SimulationSnapshotStore(sourceUrl,requireIsolatedTestDatabaseUrl(targetUrl),4),opened:Kysely<Database>[]=[];
    try {
      const captured=await store.capture(f.schoolId,f.now);
      const open=async()=>{const runId=randomUUID(),scenarioId=randomUUID();
        const branch=await createSimulationBranch(store.pool,captured,{run_id:runId,school_id:f.schoolId,scenario_id:scenarioId,namespace_id:`scenario:${scenarioId}:run:${runId}`});
        const driver=new SimulationBranchDriver(store.pool,branch,captured),compiler=new PostgresDialect({pool:store.pool});
        const database=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:d=>compiler.createIntrospector(d)}});opened.push(database);
        const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:f.now,source_snapshot_ref:`sha256:${captured.content_hash}`,manifest_ref:'staff-canonical-test',checked_at:f.now});
        return {...services(database),run:<T>(fn:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,fn)};};
      const branch=await open(),sibling=await open(),before=await f.run(()=>f.people.detail(f.user,f.schoolId,f.person.id));
      // Simulation deliberately disables app-account controls. Compare each
      // data plane to its own unchanged baseline, not Live-only capabilities.
      const siblingBefore=await sibling.run(()=>sibling.people.detail(f.user,f.schoolId,f.person.id));
      await branch.run(async()=>{
        const corrected=await branch.people.correctName(req(f.user),f.schoolId,f.person.id,{first_name:'Scenario worker',expected_revision:2,reason:'Scenario correction',idempotency_key:randomUUID()});
        await branch.people.correctProfile(req(f.user),f.schoolId,f.person.id,{contact_email:'world-only@example.test',contact_phone:'+919000000004',expected_revision:corrected.revision,reason:'Scenario contact',idempotency_key:randomUUID()});
        expect(await branch.staff.workspace(f.user,f.schoolId)).toMatchObject({mode:'admin',profiles:expect.arrayContaining([expect.objectContaining({first_name:'Scenario worker',email:'world-only@example.test'})])});
      });
      expect(await f.run(()=>f.people.detail(f.user,f.schoolId,f.person.id))).toEqual(before);
      expect(await sibling.run(()=>sibling.people.detail(f.user,f.schoolId,f.person.id))).toEqual(siblingBefore);
    } finally { await Promise.all(opened.map(d=>d.destroy()));await store.pool.end(); }
  },120000);
});
