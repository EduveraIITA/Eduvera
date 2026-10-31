import { randomUUID } from 'node:crypto';
import { Kysely,PostgresDialect,sql } from 'kysely';
import { Pool,types } from 'pg';
import { afterAll,describe,expect,it,vi } from 'vitest';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import { ResponsibilityProjectionService } from '../src/campus-model-core/responsibility-projection.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { createSimulationBranch,SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { ParticipationPeopleService } from '../src/people/participation-people.service.js';
import { PeopleService } from '../src/people/people.service.js';
import { PeopleImportService } from '../src/people/people-import.service.js';
import { IMPORT_COLUMNS,PERSON_REFERENCE_COLUMNS } from '../src/people/import-csv.js';
import { StaffOperationsService } from '../src/staff-operations/staff-operations.service.js';
import { StaffLeaveModelBridgeService } from '../src/staff-operations/staff-leave-model-bridge.service.js';
import { StaffCoverageOfferBridgeService } from '../src/staff-operations/staff-coverage-offer-bridge.service.js';
import { GovernanceService } from '../src/governance/governance.service.js';
import { ActivityPlanningService } from '../src/schedule-planning/activity-planning.service.js';
import { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import { AcademicParticipationBridge } from '../src/attendance/academic-participation-bridge.service.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthenticatedRequest,AuthUser } from '../src/common/request.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const sourceUrl=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused_test';
const targetUrl=process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082,value=>value);
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:sourceUrl,max:4})})});
const request=(user:AuthUser)=>({authUser:user,requestId:randomUUID(),headers:{'idempotency-key':randomUUID()}}) as unknown as AuthenticatedRequest;
afterAll(()=>db.destroy());

function services(database:Kysely<Database>){
  const connection=database as DatabaseService,scope=new ExecutionDataPlaneScope(),core=new CampusModelCoreService(connection,scope),events=new SchoolEventService(connection,core);
  const attendance=new ActivityAttendanceService(connection,core,core,core,core,core,undefined,core),academic=new AcademicParticipationBridge(connection,attendance);
  return {core,participants:new ParticipationPeopleService(connection,events,core,core,core,core),people:new PeopleService(connection,events,core,core,core,academic),
    imports:new PeopleImportService(connection,events,core,core,core,academic),
    staff:new StaffOperationsService(connection,new StaffLeaveModelBridgeService(new GovernanceService(connection,events),core),new StaffCoverageOfferBridgeService(core),
      createStaffCoverageReconciliationTestDouble(),core,core,core,core),
    planning:new ActivityPlanningService(connection,events,core,core,core,new ResponsibilityProjectionService(core,scope)),
    attendance};
}

async function fixture(){
  const context=services(db),suffix=randomUUID();
  const account=await db.insertInto('users').values({username:`attach-${suffix}`,email:`attach-${suffix}@example.test`,password_hash:'isolated-only',first_name:'Account',last_name:'Owner',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
  const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx,account,'UTC'));
  // Freeze only after provisioning: the founder endpoint was just made
  // effective by that real-clock operation. Rewinding to today's 09:30 makes
  // the same legitimate founder not-yet-effective when tests run after 09:30.
  // One captured instant also keeps its UTC day and DB-clock upload expiry
  // consistent, without advancing a 24-hour draft into tomorrow's expiry.
  const now=new Date().toISOString(),day=now.slice(0,10),user:AuthUser={...account,active_school_id:schoolId};
  const run=<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}}),action);
  const term=await db.insertInto('academic_terms').values({school_id:schoolId,academic_year:'2026-27',name:'Current term',attendance_threshold:'85',starts_on:day,ends_on:new Date(Date.parse(day)+30*86400000).toISOString().slice(0,10),is_active:true}).returning('id').executeTakeFirstOrThrow();
  const section=await db.insertInto('class_sections').values({school_id:schoolId,academic_year:'2026-27',grade:'Open',section:'A'}).returning('id').executeTakeFirstOrThrow();
  const owner=await run(()=>db.transaction().execute(tx=>context.core.resolveAccountEndpoint(tx,{school_id:schoolId,user_id:user.id,at:now})));
  if(!owner.acting)throw new Error('Fixture founder needs current canonical identity.');
  const person=(first_name:string)=>run(()=>context.participants.create(request(user),schoolId,{first_name,idempotency_key:randomUUID()}));
  return {...context,schoolId,user,day,now,run,term:term.id,section:section.id,owner,person};
}
const enrollment=(f:Awaited<ReturnType<typeof fixture>>,personId:string,revision=1)=>({school_id:f.schoolId,person:{id:personId,expected_revision:revision},admission_number:`A-${randomUUID().slice(0,8)}`,
  date_of_birth:null,class_section_id:f.section,term_id:f.term,roll_number:Math.floor(Math.random()*20000)+1,enrolled_on:f.day});
const work=(personId:string,revision=1)=>({person:{id:personId,expected_revision:revision},idempotency_key:randomUUID(),staff_code:`W-${randomUUID().slice(0,8)}`,staff_kind:'non_teaching',
  designation:'Campus worker',employment_type:'unspecified',joined_on:null});
function attachmentCsv(f:Awaited<ReturnType<typeof fixture>>,personId:string,revision=1){
  const columns=[...IMPORT_COLUMNS,...PERSON_REFERENCE_COLUMNS];
  const values:Record<string,string>={admission_number:`I-${randomUUID().slice(0,8)}`,first_name:'Ignored CSV name',last_name:'',date_of_birth:'',class:'OpenA',roll_number:'101',enrolled_on:f.day,
    guardian_key:'',guardian_first_name:'',guardian_last_name:'',guardian_phone:'',guardian_email:'',relationship:'',person_id:personId,person_revision:String(revision),guardian_person_id:'',guardian_person_revision:''};
  return `${columns.join(',')}\n${columns.map(key=>values[key]).join(',')}`;
}
async function counts(database:Kysely<Database>,schoolId:string){return (await sql<Record<'people'|'students'|'staff'|'memberships'|'invitations'|'commands'|'events',string>>`SELECT
  (SELECT count(*) FROM school_people WHERE school_id=${schoolId}::uuid) people,(SELECT count(*) FROM students WHERE school_id=${schoolId}::uuid) students,
  (SELECT count(*) FROM staff_profiles WHERE school_id=${schoolId}::uuid) staff,(SELECT count(*) FROM school_memberships WHERE school_id=${schoolId}::uuid) memberships,
  (SELECT count(*) FROM school_invitations WHERE school_id=${schoolId}::uuid) invitations,
  (SELECT count(*) FROM campus_model_commands WHERE school_id=${schoolId}::uuid) commands,
  (SELECT count(*) FROM campus_model_events WHERE school_id=${schoolId}::uuid) events`.execute(database)).rows[0];}
async function expectPersonRevisionAligned(database:Kysely<Database>,schoolId:string,personId:string){
  const rows=(await sql<{revision:number;source_revision:number}>`SELECT person.revision,entity.source_revision FROM school_people person
    JOIN campus_model_entities entity ON entity.school_id=person.school_id AND entity.domain='people' AND entity.kind='person' AND entity.domain_id=person.id::text
    WHERE person.school_id=${schoolId}::uuid AND person.id=${personId}::uuid`.execute(database)).rows;
  expect(rows).toHaveLength(1);expect(rows[0]!.source_revision).toBe(rows[0]!.revision);
}

describe.runIf(enabled)('existing-person typed profile attachments through the owning DT path',()=>{
  it('enrolls an existing adult without guardian/DOB, preserves account identity, and presents canonical account state',async()=>{
    const f=await fixture();await f.run(async()=>{
      const before=await counts(db,f.schoolId),input=enrollment(f,f.owner.person_id);
      const review=await f.people.preview(request(f.user),input);
      expect(review.input).toMatchObject({first_name:'Account',last_name:'Owner',guardian:null,date_of_birth:null});
      const accepted=await f.people.commit(request(f.user),review.id);
      expect(accepted.person_id).toBe(f.owner.person_id);
      expect(await f.people.commit(request(f.user),review.id)).toEqual(accepted);
      expect(await db.selectFrom('students').select(['person_id','user_id','date_of_birth']).where('id','=',accepted.student_id).executeTakeFirstOrThrow())
        .toEqual({person_id:f.owner.person_id,user_id:null,date_of_birth:null});
      const listed=await f.people.list(f.user,{school_id:f.schoolId});
      expect(listed.results[0]).toMatchObject({person_id:f.owner.person_id,has_account:true,account_state:'active',is_you:true});
      const current=await db.transaction().execute(tx=>f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:f.user.id,at:f.now}));
      expect(current).toMatchObject({agent_id:f.owner.agent_id,person_id:f.owner.person_id,endpoint_id:f.owner.endpoint_id});
      await expectPersonRevisionAligned(db,f.schoolId,f.owner.person_id);
      const after=await counts(db,f.schoolId);expect(after).toMatchObject({people:before!.people,memberships:before!.memberships,invitations:before!.invitations});
      expect((await sql<{state:string;safe_context:{request_hash:string}}>`SELECT state,safe_context FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND command_type='people.learner.attach'`.execute(db)).rows)
        .toEqual([expect.objectContaining({state:'accepted',safe_context:expect.objectContaining({request_hash:expect.stringMatching(/^[a-f0-9]{64}$/)})})]);
    });
  });

  it('attaches learner facts without rewriting an already finalized mixed-activity roster or evidence',async()=>{
    const f=await fixture(),person=await f.person('Already attended');await f.run(async()=>{
      const plan=await f.planning.create(request(f.user),f.schoolId,{idempotency_key:randomUUID(),title:'Pinned attendance',purpose:'training',timezone:'UTC',starts_on:f.day,
        recurrence:'once',starts_at:'09:00',ends_at:'10:00',person_ids:[person.id],attendance_mode:'roll_call',recorder_person_id:f.owner.person_id,reviewer_person_id:f.owner.person_id});
      await f.planning.publish(request(f.user),f.schoolId,plan.id,{idempotency_key:randomUUID(),expected_revision:1});
      const occurrence=(await f.planning.ensureOccurrences(f.schoolId,f.day,f.day)).find(row=>row.plan_version_id===plan.id)!;
      const id=await f.attendance.ensureRegister(f.schoolId,occurrence.id);
      await f.attendance.submitRecords(f.user,f.schoolId,id,{expected_revision:0,records:[{person_id:person.id,status:'present'}]},request(f.user));
      await f.attendance.transition(f.user,f.schoolId,id,'finalize',{expected_revision:1},request(f.user));
      const before=await f.attendance.detail(f.user,f.schoolId,id),history=await f.attendance.history(f.user,f.schoolId,id,{});
      const review=await f.people.preview(request(f.user),enrollment(f,person.id));await f.people.commit(request(f.user),review.id);
      expect(await f.attendance.detail(f.user,f.schoolId,id)).toEqual(before);expect(await f.attendance.history(f.user,f.schoolId,id,{})).toEqual(history);
      expect((await f.planning.getOccurrence(f.schoolId,occurrence.id)).participants).toEqual(occurrence.participants);
    });
  });

  it('links an existing guardian person once with no account, leave-signing authority or inferred identity',async()=>{
    const f=await fixture(),learner=await f.person('Learner'),guardian=await f.person('Guardian');await f.run(async()=>{
      const review=await f.people.preview(request(f.user),enrollment(f,learner.id)),accepted=await f.people.commit(request(f.user),review.id);
      const input={school_id:f.schoolId,student_id:accepted.student_id,person:{id:guardian.id,expected_revision:1},relationship:'guardian',idempotency_key:randomUUID()};
      const before=await counts(db,f.schoolId),linked=await f.people.linkGuardian(request(f.user),input);
      expect(await f.people.linkGuardian(request(f.user),input)).toEqual(linked);
      await expect(f.people.linkGuardian(request(f.user),{...input,is_primary:true})).rejects.toThrow('different guardian');
      const row=await db.selectFrom('guardian_relationships').select(['can_authorize_leave','guardian_id','school_id']).where('id','=',linked.id).executeTakeFirstOrThrow();
      expect(row).toEqual({can_authorize_leave:false,guardian_id:linked.guardian_id,school_id:f.schoolId});
      expect(await db.selectFrom('parents').select('user_id').where('id','=',linked.guardian_id).executeTakeFirstOrThrow()).toEqual({user_id:null});
      await expectPersonRevisionAligned(db,f.schoolId,guardian.id);
      expect(await counts(db,f.schoolId)).toMatchObject({people:before!.people,memberships:before!.memberships,invitations:before!.invitations});
      await expect(f.people.linkGuardian(request(f.user),{...input,person:{id:learner.id,expected_revision:2},idempotency_key:randomUUID()})).rejects.toThrow('own guardian');
    });
  });

  it('creates passive work without email/invites, completes optional-account onboarding, and reuses an existing canonical account explicitly',async()=>{
    const f=await fixture(),person=await f.person('Passive worker'),other=await f.person('Another passive worker');await f.run(async()=>{
      const input=work(person.id),before=await counts(db,f.schoolId),created=await f.staff.createProfile(f.user,f.schoolId,input);
      expect(created).toMatchObject({person_id:person.id,invitation:null,profile:{person_id:person.id,user_id:null,email:''}});
      expect(await f.staff.createProfile(f.user,f.schoolId,input)).toEqual(JSON.parse(JSON.stringify(created)));
      await f.staff.createProfile(f.user,f.schoolId,work(other.id));
      const profileId=(created.profile as {id:string}).id;
      const items=await db.selectFrom('staff_onboarding_items').select(['id','item_key','required']).where('staff_profile_id','=',profileId).execute();
      expect(items.find(item=>item.item_key==='account_access')).toMatchObject({required:false});
      for(const item of items.filter(item=>item.required)){
        const current=await db.selectFrom('staff_profiles').select('revision').where('id','=',profileId).executeTakeFirstOrThrow();
        await f.staff.updateOnboarding(f.user,f.schoolId,profileId,{item_id:item.id,completed:true,note:'Verified owning employment evidence',expected_revision:current.revision});
      }
      expect(await db.selectFrom('staff_profiles').select(['status','user_id']).where('id','=',profileId).executeTakeFirstOrThrow()).toEqual({status:'active',user_id:null});
      const ownerWork=await f.staff.createProfile(f.user,f.schoolId,work(f.owner.person_id));
      expect(ownerWork.profile).toMatchObject({person_id:f.owner.person_id,user_id:f.user.id});
      await expectPersonRevisionAligned(db,f.schoolId,f.owner.person_id);await expectPersonRevisionAligned(db,f.schoolId,person.id);
      expect(await counts(db,f.schoolId)).toMatchObject({people:before!.people,memberships:before!.memberships,invitations:before!.invitations});
    });
  });

  it('refuses stale/wrong-campus/duplicate attachments and rolls back an injected journal failure before allowing a retry',async()=>{
    const f=await fixture(),outside=await fixture(),person=await f.person('Attachment target');await f.run(async()=>{
      await expect(f.people.preview(request(f.user),enrollment(f,outside.owner.person_id))).rejects.toThrow('existing active person');
      await expect(f.people.preview(request(f.user),enrollment(f,person.id,99))).rejects.toThrow('person changed');
      const review=await f.people.preview(request(f.user),enrollment(f,person.id)),before=await counts(db,f.schoolId);
      const fail=vi.spyOn(f.core,'recordAcceptedEvent').mockRejectedValueOnce(new Error('Injected journal failure'));
      await expect(f.people.commit(request(f.user),review.id)).rejects.toThrow('Injected journal failure');fail.mockRestore();
      expect(await counts(db,f.schoolId)).toEqual(before);
      await f.people.commit(request(f.user),review.id);
      await expect(f.people.preview(request(f.user),enrollment(f,person.id,2))).rejects.toThrow('already has a learner record');
    });
  });

  it('only completes app-access onboarding for an active canonical account, including a later neutral account with no typed work-account ID',async()=>{
    const f=await fixture(),person=await f.person('Passive account checklist');await f.run(async()=>{
      const created=await f.staff.createProfile(f.user,f.schoolId,work(person.id)),profileId=(created.profile as {id:string}).id;
      const item=await db.selectFrom('staff_onboarding_items').selectAll().where('staff_profile_id','=',profileId).where('item_key','=','account_access').executeTakeFirstOrThrow();
      const snapshot=async()=>({profile:await db.selectFrom('staff_profiles').selectAll().where('id','=',profileId).executeTakeFirstOrThrow(),
        item:await db.selectFrom('staff_onboarding_items').selectAll().where('id','=',item.id).executeTakeFirstOrThrow(),
        effects:(await sql<{audits:string;events:string}>`SELECT (SELECT count(*) FROM audit_events WHERE school_id=${f.schoolId}::uuid)::text audits,
          (SELECT count(*) FROM event_outbox WHERE school_id=${f.schoolId}::uuid)::text events`.execute(db)).rows[0]});
      const complete=async(staff=f.staff)=>{const profile=await db.selectFrom('staff_profiles').select('revision').where('id','=',profileId).executeTakeFirstOrThrow();
        return staff.updateOnboarding(f.user,f.schoolId,profileId,{item_id:item.id,completed:true,note:'Verify actual app access',expected_revision:profile.revision});};
      const before=await snapshot();await expect(complete()).rejects.toThrow('does not have active app access');expect(await snapshot()).toEqual(before);
      const noIdentity=new StaffOperationsService(db as DatabaseService,new StaffLeaveModelBridgeService(new GovernanceService(db as DatabaseService,new SchoolEventService(db as DatabaseService)),f.core),
        new StaffCoverageOfferBridgeService(f.core),createStaffCoverageReconciliationTestDouble(),f.core,f.core);
      await expect(complete(noIdentity)).rejects.toThrow('could not be verified');expect(await snapshot()).toEqual(before);
      await f.staff.updateOnboarding(f.user,f.schoolId,profileId,{item_id:item.id,completed:false,note:'App access is optional for this worker',expected_revision:before.profile.revision});
      const account=await db.insertInto('users').values({username:`later-member-${randomUUID()}`,email:`later-member-${randomUUID()}@example.test`,password_hash:'isolated-only',
        first_name:'Unrelated account label',last_name:'',role:'member'}).returning(['id','email']).executeTakeFirstOrThrow();
      const invitation=await db.transaction().execute(async tx=>{
        await tx.insertInto('school_memberships').values({school_id:f.schoolId,user_id:account.id,role:'member'}).execute();
        const invite=await tx.insertInto('school_invitations').values({school_id:f.schoolId,person_id:person.id,email:account.email,role:'member',source:'school',token_hash:randomUUID(),
          created_by:f.user.id,expires_at:new Date(Date.parse(f.now)+86400000),accepted_at:new Date(f.now),accepted_by_user_id:account.id}).returning('id').executeTakeFirstOrThrow();
        await tx.updateTable('school_people').set({account_user_id:account.id}).where('id','=',person.id).execute();return invite;
      });
      const endpoint=await db.transaction().execute(tx=>f.core.linkAccountEndpoint(tx,{school_id:f.schoolId,person_id:person.id,user_id:account.id,actor_user_id:account.id,
        effective_from:f.now,effective_until:null,source_domain:'auth',source_record_id:invitation.id,source_revision:1,metadata:{relationship:'accepted_person_invitation'}}));
      expect((await snapshot()).profile.user_id).toBeNull();await complete();expect((await snapshot()).item.completed_by).toBe(f.user.id);
      await db.updateTable('users').set({is_active:false}).where('id','=',account.id).execute();
      const inactive=await snapshot();await expect(complete()).rejects.toThrow('does not have active app access');expect(await snapshot()).toEqual(inactive);
      await db.updateTable('users').set({is_active:true}).where('id','=',account.id).execute();
      const later=new Date(Date.parse(f.now)+1000).toISOString();
      await executionEnvironmentStorage.run(createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(later),nowIso:()=>later}}),async()=>{
        await db.transaction().execute(tx=>f.core.closeAccountEndpoint(tx,{school_id:f.schoolId,endpoint_id:endpoint.endpoint_id,actor_user_id:f.user.id,expected_revision:1,
          effective_at:later,disposition:'ended',reason:'Explicit app access ended',source_domain:'auth',source_record_id:randomUUID(),source_revision:1,idempotency_key:randomUUID()}));
        const ended=await snapshot();await expect(complete()).rejects.toThrow('does not have active app access');expect(await snapshot()).toEqual(ended);
      });
      expect((await db.selectFrom('school_memberships').select('role').where('school_id','=',f.schoolId).where('user_id','=',account.id).execute())).toEqual([{role:'member'}]);
    });
  });

  it('registers each newly-created legacy intake person atomically under one prepared owning command',async()=>{
    const f=await fixture();await f.run(async()=>{
      const review=await f.people.preview(request(f.user),{...enrollment(f,f.owner.person_id),person:undefined,first_name:'Legacy learner',last_name:'',date_of_birth:'2010-01-01',
        guardian:{mode:'new',first_name:'Legacy guardian',last_name:'',phone:'+919123456789',email:''},relationship:'guardian'});
      const accepted=await f.people.commit(request(f.user),review.id);
      const identities=(await sql<{domain_id:string}>`SELECT domain_id FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid AND domain='people' AND kind='person'`.execute(db)).rows;
      expect(identities).toContainEqual({domain_id:accepted.person_id});
      const guardian=(await sql<{person_id:string}>`SELECT profile.person_id FROM guardian_relationships relation JOIN guardian_school_profiles profile
        ON profile.guardian_id=relation.guardian_id AND profile.school_id=relation.school_id WHERE relation.student_id=${accepted.student_id}::uuid`.execute(db)).rows[0]!;
      expect(identities).toContainEqual({domain_id:guardian.person_id});
      expect((await sql<{state:string}>`SELECT state FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND command_type='people.learner.intake'`.execute(db)).rows).toEqual([{state:'accepted'}]);
    });
  });

  it('reviews explicit import person IDs and nullable DOB without creating duplicate identities or guardian requirements',async()=>{
    const f=await fixture(),person=await f.person('Canonical import name');await f.run(async()=>{
      const columns=[...IMPORT_COLUMNS,...PERSON_REFERENCE_COLUMNS];
      const values:Record<string,string>={admission_number:`I-${randomUUID().slice(0,8)}`,first_name:'Ignored CSV name',last_name:'',date_of_birth:'',class:'OpenA',roll_number:'101',enrolled_on:f.day,
        guardian_key:'',guardian_first_name:'',guardian_last_name:'',guardian_phone:'',guardian_email:'',relationship:'',person_id:person.id,person_revision:'1',guardian_person_id:'',guardian_person_revision:''};
      const staged=await f.imports.stage(request(f.user),{school_id:f.schoolId,term_id:f.term,filename:'explicit.csv',csv:`${columns.join(',')}\n${columns.map(key=>values[key]).join(',')}`,idempotency_key:randomUUID()});
      const detail=await f.imports.detail(f.user,staged.id,f.schoolId);expect(detail.review?.summary.errors).toBe(0);
      expect(detail.review?.rows[0]?.normalized).toMatchObject({person:{id:person.id,expected_revision:1},first_name:'Canonical import name',guardian_choice:{mode:'none'}});
      const before=await counts(db,f.schoolId),input={school_id:f.schoolId,expected_revision:detail.revision,validation_token:detail.review!.validation_token,verified:true};
      const accepted=await f.imports.commit(request(f.user),staged.id,input);expect(await f.imports.commit(request(f.user),staged.id,input)).toEqual(accepted);
      expect(await db.selectFrom('students').select('person_id').where('id','=',accepted!.enrolled[0]!.student_id).executeTakeFirstOrThrow()).toEqual({person_id:person.id});
      await expectPersonRevisionAligned(db,f.schoolId,person.id);
      expect(await counts(db,f.schoolId)).toMatchObject({people:before!.people,memberships:before!.memberships,invitations:before!.invitations});
    });
  });

  it('rejects stale import source revisions and changed payload retries without committing partially attached records',async()=>{
    const f=await fixture(),person=await f.person('Reviewed import person');await f.run(async()=>{
      const staged=await f.imports.stage(request(f.user),{school_id:f.schoolId,term_id:f.term,filename:'stale.csv',csv:attachmentCsv(f,person.id),idempotency_key:randomUUID()});
      const review=await f.imports.detail(f.user,staged.id,f.schoolId),before=await counts(db,f.schoolId);
      await f.participants.correctName(request(f.user),f.schoolId,person.id,{first_name:'Changed after review',last_name:'',expected_revision:1,
        reason:'Verified spelling changed after staged import',idempotency_key:randomUUID()});
      const afterCorrection=await counts(db,f.schoolId);
      await expect(f.imports.commit(request(f.user),staged.id,{school_id:f.schoolId,expected_revision:review.revision,validation_token:review.review!.validation_token,verified:true}))
        .rejects.toThrow(/invalid row|School records changed/);
      expect(await counts(db,f.schoolId)).toEqual(afterCorrection);
      expect(afterCorrection).toMatchObject({students:before!.students,people:before!.people});
      const target=await f.person('Work payload target'),input=work(target.id);
      await f.staff.createProfile(f.user,f.schoolId,input);
      await expect(f.staff.createProfile(f.user,f.schoolId,{...input,designation:'Different work'})).rejects.toThrow('different employment');
      await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
      await expect(f.staff.createProfile(f.user,f.schoolId,input)).rejects.toThrow('Active school staff');
    });
  });

  it('commits a reviewed mixed import with exact people and new people in one prepared batch without account or authority grants',async()=>{
    const f=await fixture(),learner=await f.person('Existing mixed learner'),guardian=await f.person('Existing mixed guardian');await f.run(async()=>{
      const columns=[...IMPORT_COLUMNS,...PERSON_REFERENCE_COLUMNS];
      const base:Record<string,string>={admission_number:'',first_name:'',last_name:'',date_of_birth:'',class:'OpenA',roll_number:'',enrolled_on:f.day,
        guardian_key:'',guardian_first_name:'',guardian_last_name:'',guardian_phone:'',guardian_email:'',relationship:'guardian',person_id:'',person_revision:'',guardian_person_id:'',guardian_person_revision:''};
      const rows:Array<Record<string,string>>=[{...base,admission_number:`M-${randomUUID().slice(0,8)}`,first_name:'Ignored imported spelling',roll_number:'101',
        person_id:learner.id,person_revision:'1',guardian_person_id:guardian.id,guardian_person_revision:'1'},
        {...base,admission_number:`M-${randomUUID().slice(0,8)}`,first_name:'New mixed learner',roll_number:'102',
          guardian_first_name:'New mixed guardian',guardian_phone:'+919123456789'}];
      const csv=[columns.join(','),...rows.map(row=>columns.map(key=>row[key]).join(','))].join('\n');
      const staged=await f.imports.stage(request(f.user),{school_id:f.schoolId,term_id:f.term,filename:'mixed.csv',csv,idempotency_key:randomUUID()});
      const review=await f.imports.detail(f.user,staged.id,f.schoolId);expect(review.review!.summary.errors).toBe(0);
      const before=await counts(db,f.schoolId),accounts=await db.selectFrom('users').select(sql<string>`count(*)::text`.as('count')).executeTakeFirstOrThrow();
      const accepted=await f.imports.commit(request(f.user),staged.id,{school_id:f.schoolId,expected_revision:review.revision,validation_token:review.review!.validation_token,verified:true});
      expect(accepted).toMatchObject({students:2,guardians_created:2,guardians_reused:0});
      const students=await db.selectFrom('students').select(['id','person_id','user_id']).where('school_id','=',f.schoolId).execute();
      expect(students).toContainEqual({id:accepted!.enrolled[0]!.student_id,person_id:learner.id,user_id:null});
      const newLearner=students.find(row=>row.person_id!==learner.id)!;
      const newGuardian=(await sql<{person_id:string}>`SELECT profile.person_id FROM guardian_relationships relation JOIN guardian_school_profiles profile
        ON profile.guardian_id=relation.guardian_id AND profile.school_id=relation.school_id WHERE relation.student_id=${newLearner.id}::uuid`.execute(db)).rows[0]!;
      for(const id of [newLearner.person_id,newGuardian.person_id])expect((await sql`SELECT id FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid AND domain='people' AND kind='person' AND domain_id=${id}`.execute(db)).rows).toHaveLength(1);
      expect(await counts(db,f.schoolId)).toMatchObject({people:String(Number(before!.people)+2),memberships:before!.memberships,invitations:before!.invitations});
      expect(await db.selectFrom('users').select(sql<string>`count(*)::text`.as('count')).executeTakeFirstOrThrow()).toEqual(accounts);
      expect((await db.selectFrom('guardian_relationships').select('id').where('school_id','=',f.schoolId).where('can_authorize_leave','=',true).execute())).toHaveLength(0);
      expect((await sql<{state:string}>`SELECT state FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid AND command_type='people.enrollment.import'`.execute(db)).rows).toEqual([{state:'accepted'}]);
      await expectPersonRevisionAligned(db,f.schoolId,learner.id);await expectPersonRevisionAligned(db,f.schoolId,guardian.id);
    });
  });

  it('retains legacy import and staff source IDs while registering created people under their prepared owning commands',async()=>{
    const f=await fixture();await f.run(async()=>{
      const row=[`L-${randomUUID().slice(0,8)}`,'Imported learner','','2010-01-01','OpenA','101',f.day,'family1','Imported guardian','', '+919123456789','','guardian'];
      const staged=await f.imports.stage(request(f.user),{school_id:f.schoolId,term_id:f.term,filename:'legacy.csv',csv:`${IMPORT_COLUMNS.join(',')}\n${row.join(',')}`,idempotency_key:randomUUID()});
      const review=await f.imports.detail(f.user,staged.id,f.schoolId);expect(review.review!.summary.errors).toBe(0);
      const accepted=await f.imports.commit(request(f.user),staged.id,{school_id:f.schoolId,expected_revision:review.revision,validation_token:review.review!.validation_token,verified:true});
      const people=(await sql<{person_id:string}>`SELECT person_id FROM students WHERE id=${accepted!.enrolled[0]!.student_id}::uuid
        UNION SELECT profile.person_id FROM guardian_relationships relation JOIN guardian_school_profiles profile ON profile.guardian_id=relation.guardian_id AND profile.school_id=relation.school_id
          WHERE relation.student_id=${accepted!.enrolled[0]!.student_id}::uuid`.execute(db)).rows;
      for(const person of people)expect((await sql`SELECT id FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid AND domain='people' AND kind='person' AND domain_id=${person.person_id}`.execute(db)).rows).toHaveLength(1);
      const staffAccount=await db.insertInto('users').values({username:`legacy-worker-${randomUUID()}`,email:`legacy-worker-${randomUUID()}@example.test`,first_name:'Existing account',last_name:'',role:'staff',password_hash:'isolated-only'}).returning(['id','email']).executeTakeFirstOrThrow();
      await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:staffAccount.id,role:'staff'}).execute();
      const employment=await f.staff.createProfile(f.user,f.schoolId,{first_name:'Legacy worker',last_name:'',email:staffAccount.email,phone:'',staff_code:`L-${randomUUID().slice(0,8)}`,
        staff_kind:'non_teaching',designation:'Campus worker',employment_type:'unspecified',joined_on:null});
      expect(employment.invitation).not.toBeNull();
      const profile=employment.profile as {person_id:string;user_id:string|null};
      expect(profile.user_id).toBeNull(); // matching email is not accepted account/person identity
      expect(await db.selectFrom('school_invitations').select('person_id').where('id','=',employment.invitation!.id).executeTakeFirstOrThrow())
        .toEqual({person_id:profile.person_id});
      expect((await sql`SELECT id FROM campus_model_entities WHERE school_id=${f.schoolId}::uuid AND domain='people' AND kind='person' AND domain_id=${profile.person_id}`.execute(db)).rows).toHaveLength(1);
      expect((await sql<{command_type:string;state:string}>`SELECT command_type,state FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid
        AND command_type IN ('people.enrollment.import','people.employment.intake') ORDER BY command_type`.execute(db)).rows)
        .toEqual([{command_type:'people.employment.intake',state:'accepted'},{command_type:'people.enrollment.import',state:'accepted'}]);
    });
  });

  it.runIf(Boolean(targetUrl))('uses the same attachments in one COW world while Live and a sibling retain their original profiles and app access',async()=>{
    const f=await fixture(),learner=await f.person('World learner'),worker=await f.person('World worker'),imported=await f.person('World import');
    const store=new SimulationSnapshotStore(sourceUrl,requireIsolatedTestDatabaseUrl(targetUrl),4),opened:Kysely<Database>[]=[];
    try{
      const captured=await store.capture(f.schoolId,f.now);
      const open=async()=>{const runId=randomUUID(),scenarioId=randomUUID(),branch=await createSimulationBranch(store.pool,captured,{run_id:runId,school_id:f.schoolId,scenario_id:scenarioId,namespace_id:`scenario:${scenarioId}:run:${runId}`});
        const driver=new SimulationBranchDriver(store.pool,branch,captured),compiler=new PostgresDialect({pool:store.pool});
        const database=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:connection=>compiler.createIntrospector(connection)}});opened.push(database);
        const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:f.now,source_snapshot_ref:`sha256:${captured.content_hash}`,manifest_ref:'person-attachment-test',checked_at:f.now});
        return {...services(database),database,run:<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,action)};};
      const branch=await open(),sibling=await open(),before=await counts(db,f.schoolId);
      await branch.run(async()=>{const review=await branch.people.preview(request(f.user),enrollment(f,learner.id)),accepted=await branch.people.commit(request(f.user),review.id);
        await branch.people.linkGuardian(request(f.user),{school_id:f.schoolId,student_id:accepted.student_id,person:{id:f.owner.person_id,expected_revision:1},relationship:'guardian',idempotency_key:randomUUID()});
        const workRecord=await branch.staff.createProfile(f.user,f.schoolId,work(worker.id));
        const workProfile=workRecord.profile as {id:string;revision:number};
        const accountItem=await branch.database.selectFrom('staff_onboarding_items').selectAll().where('staff_profile_id','=',workProfile.id).where('item_key','=','account_access').executeTakeFirstOrThrow();
        const beforeWork=await branch.database.selectFrom('staff_profiles').selectAll().where('id','=',workProfile.id).executeTakeFirstOrThrow();
        await expect(branch.staff.updateOnboarding(f.user,f.schoolId,workProfile.id,{item_id:accountItem.id,completed:true,note:'No account must not be completed',expected_revision:workProfile.revision}))
          .rejects.toThrow('does not have active app access');
        expect(await branch.database.selectFrom('staff_onboarding_items').selectAll().where('id','=',accountItem.id).executeTakeFirstOrThrow()).toEqual(accountItem);
        expect(await branch.database.selectFrom('staff_profiles').selectAll().where('id','=',workProfile.id).executeTakeFirstOrThrow()).toEqual(beforeWork);
        const staged=await branch.imports.stage(request(f.user),{school_id:f.schoolId,term_id:f.term,filename:'world.csv',csv:attachmentCsv(f,imported.id),idempotency_key:randomUUID()});
        const importedReview=await branch.imports.detail(f.user,staged.id,f.schoolId);
        await branch.imports.commit(request(f.user),staged.id,{school_id:f.schoolId,expected_revision:importedReview.revision,validation_token:importedReview.review!.validation_token,verified:true});
        expect(await counts(branch.database,f.schoolId)).toMatchObject({people:before!.people,students:'2',staff:'1',memberships:before!.memberships,invitations:before!.invitations});
      });
      expect(await counts(db,f.schoolId)).toEqual(before);expect(await sibling.run(()=>counts(sibling.database,f.schoolId))).toEqual(before);
    }finally{await Promise.all(opened.map(database=>database.destroy()));await store.pool.end();}
  },120000);
});
