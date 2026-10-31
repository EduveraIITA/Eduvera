import { randomUUID } from 'node:crypto';
import { acceptWithRecipientProof } from "./invitation-recipient-proof.test-support.js";
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import { AcademicParticipationBridge } from '../src/attendance/academic-participation-bridge.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { PersonAccountInvitationsService } from '../src/operations/person-account-invitations.service.js';
import { ParticipationPeopleService } from '../src/people/participation-people.service.js';
import { PeopleService } from '../src/people/people.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { guardianFeeReviewServices } from './fee-review.test-support.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';

const enabled = process.env.TEST_DATABASE_ISOLATED === 'true';
const sourceUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : 'postgresql://invalid.invalid/unused_test';
const targetUrl = process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) });
const request = (user: AuthUser) => ({ authUser:user, requestId:randomUUID() }) as AuthenticatedRequest;
afterAll(() => db.destroy());

function services(database: Kysely<Database>) {
  const connection=database as DatabaseService,core=new CampusModelCoreService(connection,new ExecutionDataPlaneScope());
  const events=new SchoolEventService(connection,core),invitations=new PersonAccountInvitationsService(connection,core,core,core);
  const operations=new OperationsService(connection,createStaffCoverageReconciliationTestDouble(),invitations);
  const attendance=new ActivityAttendanceService(connection,core,core,core,core,core,undefined,core);
  return {core,invitations,operations,participants:new ParticipationPeopleService(connection,events,core,core,core,core),
    people:new PeopleService(connection,events,core,core,core,new AcademicParticipationBridge(connection,attendance)),fees:guardianFeeReviewServices(connection,operations,core).service};
}

async function fixture() {
  const context=services(db),suffix=randomUUID();
  const account=await db.insertInto('users').values({username:`canonical-guardian-${suffix}`,email:`canonical-guardian-${suffix}@example.test`,
    first_name:'Account',last_name:'Owner',password_hash:'isolated-only',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
  const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx,account,'UTC'));
  const user:AuthUser={...account,active_school_id:schoolId},now=new Date().toISOString(),day=now.slice(0,10);
  const run=<T>(fn:()=>Promise<T>)=>executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}}),fn);
  const term=await db.insertInto('academic_terms').values({school_id:schoolId,academic_year:'2026-27',name:'Current term',attendance_threshold:'85',
    starts_on:day,ends_on:new Date(Date.parse(now)+30*86400000).toISOString().slice(0,10),is_active:true}).returning('id').executeTakeFirstOrThrow();
  const section=await db.insertInto('class_sections').values({school_id:schoolId,academic_year:'2026-27',grade:'Open',section:'A'}).returning('id').executeTakeFirstOrThrow();
  const person=(first_name:string,contacts={})=>run(()=>context.participants.create(request(user),schoolId,{first_name,...contacts,idempotency_key:randomUUID()}));
  const learner=async()=>{
    const p=await person('Learner');
    return run(async()=>{
      const review=await context.people.preview(request(user),{school_id:schoolId,person:{id:p.id,expected_revision:1},
        admission_number:`A-${randomUUID().slice(0,8)}`,date_of_birth:null,class_section_id:section.id,term_id:term.id,
        roll_number:Math.floor(Math.random()*20000)+1,enrolled_on:day,guardian:null});
      return context.people.commit(request(user),review.id);
    });
  };
  return {...context,schoolId,user,now,day,run,person,learner};
}

const link=(schoolId:string,studentId:string,personId:string,revision=1)=>({school_id:schoolId,student_id:studentId,
  person:{id:personId,expected_revision:revision},relationship:'guardian',is_primary:false,idempotency_key:randomUUID()});

describe.skipIf(!enabled)('explicit canonical guardian ownership after migration 218',()=>{
  it('does not create a campus identity from a global guardian or an unrelated campus profile',async()=>{
    expect((await sql`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parents' AND column_name='phone'`.execute(db)).rows).toEqual([]);
    expect((await sql`SELECT 1 FROM pg_proc WHERE proname='ensure_guardian_school_person'`.execute(db)).rows).toEqual([]);
    const f=await fixture(),other=await fixture(),student=await f.learner(),guardian=await other.person('Other campus guardian');
    const parent=await db.insertInto('parents').values({user_id:null}).returning('id').executeTakeFirstOrThrow();
    const before=await db.selectFrom('school_people').select('id').where('school_id','=',f.schoolId).execute();
    await expect(db.insertInto('guardian_relationships').values({student_id:student.student_id,guardian_id:parent.id,relationship:'guardian'}).execute())
      .rejects.toThrow(/explicit canonical guardian profile/);
    await db.insertInto('guardian_school_profiles').values({school_id:other.schoolId,guardian_id:parent.id,person_id:guardian.id}).execute();
    await expect(db.insertInto('guardian_relationships').values({student_id:student.student_id,guardian_id:parent.id,relationship:'guardian'}).execute())
      .rejects.toThrow(/explicit canonical guardian profile/);
    expect(await db.selectFrom('school_people').select('id').where('school_id','=',f.schoolId).execute()).toEqual(before);
    expect(await db.selectFrom('parents').select('user_id').where('id','=',parent.id).executeTakeFirstOrThrow()).toEqual({user_id:null});
  });

  it('links a passive person explicitly, replays once and reads corrected contact details everywhere',async()=>{
    const f=await fixture(),student=await f.learner(),second=await f.learner();
    const guardian=await f.person('Campus guardian',{contact_phone:'+919000000101',contact_email:'campus-only@example.test'});
    await f.run(async()=>{
      const input=link(f.schoolId,student.student_id,guardian.id),saved=await f.people.linkGuardian(request(f.user),input);
      expect(await f.people.linkGuardian(request(f.user),input)).toEqual(saved);
      await expect(f.people.linkGuardian(request(f.user),{...input,relationship:'mother'})).rejects.toThrow(/different guardian/);
      await expect(f.people.linkGuardian(request(f.user),link(f.schoolId,second.student_id,guardian.id))).rejects.toThrow(/changed|revision/i);
      const secondLink=await f.people.linkGuardian(request(f.user),link(f.schoolId,second.student_id,guardian.id,2));
      expect(secondLink.guardian_id).toBe(saved.guardian_id);
      const relations=await db.selectFrom('guardian_relationships').selectAll().where('guardian_id','=',saved.guardian_id).execute();
      expect(relations).toHaveLength(2);expect(relations.every(row=>!row.can_authorize_leave)).toBe(true);
      expect(await db.selectFrom('parents').select('user_id').where('id','=',saved.guardian_id).executeTakeFirstOrThrow()).toEqual({user_id:null});
      const corrected=await f.participants.correctProfile(request(f.user),f.schoolId,guardian.id,{contact_phone:'+919000000102',
        contact_email:'corrected-campus@example.test',expected_revision:3,reason:'Verified current contact',idempotency_key:randomUUID()});
      expect(corrected.revision).toBe(4);
      expect(await f.people.guardians(f.user,{school_id:f.schoolId,search:'9000000102'})).toMatchObject({results:[{id:saved.guardian_id,phone:'+919000000102'}]});
      expect((await f.operations.overview(f.user,f.schoolId)).guardians).toEqual(expect.arrayContaining([
        expect.objectContaining({id:saved.id,phone:'+919000000102'}),expect.objectContaining({id:secondLink.id,phone:'+919000000102'})]));
      expect((await sql`SELECT 1 FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
        WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='people.guardian.attach' AND command.state='accepted'`.execute(db)).rows).toHaveLength(2);
      expect(await db.selectFrom('school_invitations').select('id').where('school_id','=',f.schoolId).execute()).toEqual([]);
      expect(await db.selectFrom('guardian_relationships').selectAll().where('guardian_id','=',saved.guardian_id).execute()).toEqual(relations);
    });
  });

  it('accepts an exact guardian invitation without rewriting campus contacts, then completes a material Core command',async()=>{
    const f=await fixture(),student=await f.learner(),guardian=await f.person('Campus guardian',{contact_phone:'+919000000103',contact_email:'separate-contact@example.test'});
    const saved=await f.run(()=>f.people.linkGuardian(request(f.user),link(f.schoolId,student.student_id,guardian.id)));
    const email=`guardian-access-${randomUUID()}@example.test`;
    const invitation=await f.run(()=>f.operations.invite(f.user,f.schoolId,{email,role:'guardian',guardian_id:saved.guardian_id}));
    if(!invitation.token)throw new Error('Isolated test expects manual fictional invitation delivery.');
    expect(await f.run(()=>acceptWithRecipientProof(f.operations, {email,token:invitation.token,password:'S3cure!Campus-9274',first_name:'Different account label',last_name:'Only'})))
      .toMatchObject({accepted:true,school_id:f.schoolId,role:'guardian'});
    const account=await db.selectFrom('users').select(['id','username','email','first_name','last_name','role','is_active']).where('email','=',email).executeTakeFirstOrThrow();
    const actor:AuthUser={...account,active_school_id:f.schoolId};
    await f.run(async()=>{
      expect(await db.transaction().execute(tx=>f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:actor.id,at:f.now})))
        .toMatchObject({acting:true,person_id:guardian.id});
      expect(await db.selectFrom('school_people').select(['first_name','contact_email','contact_phone']).where('id','=',guardian.id).executeTakeFirstOrThrow())
        .toEqual({first_name:'Campus guardian',contact_email:'separate-contact@example.test',contact_phone:'+919000000103'});
      expect(await db.selectFrom('parents').select('user_id').where('id','=',saved.guardian_id).executeTakeFirstOrThrow()).toEqual({user_id:actor.id});
      const invoice=await db.insertInto('fee_invoices').values({school_id:f.schoolId,student_id:student.student_id,reference:randomUUID(),
        description:'Fictional course charge',amount_paise:30000,due_on:f.day,created_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
      const input={kind:'charge',note:'Please explain this fictional charge',idempotency_key:randomUUID()},review=await f.fees.submit(actor,f.schoolId,invoice.id,input);
      expect(await f.fees.submit(actor,f.schoolId,invoice.id,input)).toEqual(review);
      expect((await sql`SELECT 1 FROM fee_native_review_requests request JOIN campus_model_commands command ON command.school_id=request.school_id AND command.correlation_id=request.command_id
        JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id WHERE request.id=${review.id}::uuid
        AND request.submitter_person_id=${guardian.id}::uuid AND command.state='accepted'`.execute(db)).rows).toHaveLength(1);
      expect(await db.selectFrom('fee_payments').select('id').where('invoice_id','=',invoice.id).execute()).toEqual([]);
      await expect(acceptWithRecipientProof(f.operations, {email,token:invitation.token,password:'S3cure!Campus-9274',first_name:'Different account label',last_name:'Only'}))
        .rejects.toThrow(/invalid, expired or already used/);
    });
  });

  it('refuses another account even when the intended person has only ended app access and a passive guardian wrapper',async()=>{
    const f=await fixture(),student=await f.learner(),guardian=await f.person('Retained account person');
    const originalEmail=`original-guardian-${randomUUID()}@example.test`;
    const memberInvite=await f.run(()=>f.operations.invite(f.user,f.schoolId,{email:originalEmail,role:'member',person_id:guardian.id,idempotency_key:randomUUID()}));
    if(!memberInvite.token)throw new Error('Isolated test expects manual fictional invitation delivery.');
    await f.run(()=>acceptWithRecipientProof(f.operations, {email:originalEmail,token:memberInvite.token,password:'S3cure!Campus-9274',first_name:'Original account',last_name:'Only'}));
    const original=await db.selectFrom('users').select('id').where('email','=',originalEmail).executeTakeFirstOrThrow();
    const saved=await f.run(()=>f.people.linkGuardian(request(f.user),link(f.schoolId,student.student_id,guardian.id,2)));
    const endedAt=new Date(Date.parse(f.now)+1000).toISOString();
    const afterEnd=<T>(fn:()=>Promise<T>)=>executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(endedAt),nowIso:()=>endedAt}}),fn);
    await afterEnd(()=>db.transaction().execute(async tx=>{
      const endpoint=await f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:original.id,at:f.now});
      if(!endpoint.acting)throw new Error('Accepted account needs current endpoint.');
      await f.core.closeAccountEndpoint(tx,{school_id:f.schoolId,endpoint_id:endpoint.endpoint_id,actor_user_id:f.user.id,
        expected_revision:1,effective_at:endedAt,disposition:'ended',reason:'Retained fictional account ended',source_domain:'auth',
        source_record_id:randomUUID(),source_revision:1,idempotency_key:randomUUID()});
    }));
    const email=`replacement-guardian-${randomUUID()}@example.test`,invitation=await f.run(()=>f.operations.invite(f.user,f.schoolId,{email,role:'guardian',guardian_id:saved.guardian_id}));
    if(!invitation.token)throw new Error('Isolated test expects manual fictional invitation delivery.');
    await expect(afterEnd(()=>acceptWithRecipientProof(f.operations, {email,token:invitation.token,password:'S3cure!Campus-9274',first_name:'Replacement account',last_name:'Only'})))
      .rejects.toThrow(/retained app access/);
    expect(await db.selectFrom('users').select('id').where('email','=',email).execute()).toEqual([]);
    expect(await db.selectFrom('parents').select('user_id').where('id','=',saved.guardian_id).executeTakeFirstOrThrow()).toEqual({user_id:null});
    expect(await db.selectFrom('school_invitations').select('accepted_at').where('id','=',invitation.id).executeTakeFirstOrThrow()).toEqual({accepted_at:null});
    expect(await db.selectFrom('school_people').select('account_user_id').where('id','=',guardian.id).executeTakeFirstOrThrow()).toEqual({account_user_id:original.id});
  });

  it.runIf(Boolean(targetUrl))('creates a guardian profile in one actual COW branch without changing Live or its sibling',async()=>{
    const f=await fixture(),student=await f.learner(),guardian=await f.person('Scenario guardian',{contact_phone:'+919000000104'});
    const store=new SimulationSnapshotStore(sourceUrl,requireIsolatedTestDatabaseUrl(targetUrl),4),opened:Kysely<Database>[]=[];
    try {
      const captured=await store.capture(f.schoolId,f.now);
      const open=async()=>{const runId=randomUUID(),scenarioId=randomUUID();
        const branch=await createSimulationBranch(store.pool,captured,{run_id:runId,school_id:f.schoolId,scenario_id:scenarioId,namespace_id:`scenario:${scenarioId}:run:${runId}`});
        const driver=new SimulationBranchDriver(store.pool,branch,captured),compiler=new PostgresDialect({pool:store.pool});
        const database=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:d=>compiler.createIntrospector(d)}});opened.push(database);
        const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:f.now,source_snapshot_ref:`sha256:${captured.content_hash}`,manifest_ref:'guardian-canonical-test',checked_at:f.now});
        return {...services(database),database,run:<T>(fn:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,fn)};};
      const branch=await open(),sibling=await open();
      await branch.run(async()=>{
        const saved=await branch.people.linkGuardian(request(f.user),link(f.schoolId,student.student_id,guardian.id));
        expect(await branch.database.selectFrom('guardian_school_profiles').select('person_id').where('guardian_id','=',saved.guardian_id).executeTakeFirstOrThrow()).toEqual({person_id:guardian.id});
        await branch.participants.correctProfile(request(f.user),f.schoolId,guardian.id,{contact_email:'',contact_phone:'+919000000105',expected_revision:2,
          reason:'Scenario-only current contact',idempotency_key:randomUUID()});
        expect(await branch.people.guardians(f.user,{school_id:f.schoolId,search:'9000000105'})).toMatchObject({results:[{id:saved.guardian_id,phone:'+919000000105'}]});
        await expect(branch.operations.acceptInvite({})).rejects.toThrow(/managed in Live/);
      });
      expect(await f.run(()=>f.people.guardians(f.user,{school_id:f.schoolId,search:'Scenario guardian'}))).toEqual({results:[]});
      expect(await sibling.run(()=>sibling.people.guardians(f.user,{school_id:f.schoolId,search:'Scenario guardian'}))).toEqual({results:[]});
      for(const database of [db,sibling.database])expect(await database.selectFrom('school_people').select('contact_phone').where('id','=',guardian.id).executeTakeFirstOrThrow())
        .toEqual({contact_phone:'+919000000104'});
    } finally {await Promise.all(opened.map(database=>database.destroy()));await store.pool.end();}
  },120000);
});
