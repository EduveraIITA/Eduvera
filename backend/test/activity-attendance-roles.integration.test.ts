import {randomUUID} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Pool,types} from 'pg';
import {afterAll,describe,expect,it} from 'vitest';
import {CampusModelCoreService} from '../src/campus-model-core/campus-model-core.service.js';
import {ResponsibilityProjectionService} from '../src/campus-model-core/responsibility-projection.service.js';
import {createLiveExecutionEnvironment} from '../src/campus-model-core/execution-environment.runtime.js';
import {executionEnvironmentStorage} from '../src/campus-model-core/execution-time.runtime.js';
import {ProgressiveWorkspaceProvisioner} from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import {InstitutionOnboardingService} from '../src/institution-onboarding/institution-onboarding.service.js';
import {AuditService} from '../src/common/audit.service.js';
import {SchoolEventService} from '../src/school/school-event.service.js';
import {ActivityPlanningService} from '../src/schedule-planning/activity-planning.service.js';
import {ActivityOccurrenceEngine} from '../src/schedule-planning/activity-occurrence.engine.js';
import {ActivityAttendanceService} from '../src/attendance/activity-attendance.service.js';
import {ActivityWorkspaceProjection} from '../src/workspace/activity-workspace.projection.js';
import type {WorkspaceRepositorySnapshot} from '../src/workspace/workspace.contracts.js';
import {SimulationSnapshotStore} from '../src/database/simulation-snapshot-store.js';
import {createSimulationBranch,SimulationBranchDriver} from '../src/database/simulation-branch.driver.js';
import {simulationRequestEnvironment} from '../src/database/simulation-world.service.js';
import {ExecutionDataPlaneScope} from '../src/database/execution-data-plane.js';
import type {DatabaseService} from '../src/database/database.service.js';
import type {Database} from '../src/database/types.js';
import type {AuthenticatedRequest,AuthUser} from '../src/common/request.js';
import {requireIsolatedTestDatabaseUrl} from './test-database.js';
import {linkFixtureStaffIdentity} from './fixture-human-identity.test-support.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const sourceUrl=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused_test';
const targetUrl=process.env.SIMULATION_ROSTER_TEST_TARGET_URL;
types.setTypeParser(1082,value=>value);
const pool=new Pool({connectionString:sourceUrl,max:4});
const db=new Kysely<Database>({dialect:new PostgresDialect({pool})});
const applicationDb=db as DatabaseService;
const request=(user:AuthUser)=>({authUser:user,requestId:randomUUID(),ip:'127.0.0.1',headers:{'idempotency-key':randomUUID()}}) as unknown as AuthenticatedRequest;
const addDays=(date:string,count:number)=>new Date(Date.parse(date)+count*86400000).toISOString().slice(0,10);
afterAll(()=>db.destroy());

function services(database:Kysely<Database>){
 const connection=database as DatabaseService,scope=new ExecutionDataPlaneScope(),core=new CampusModelCoreService(connection,scope);
 const responsibilities=new ResponsibilityProjectionService(core,scope),events=new SchoolEventService(connection,core);
 return {core,responsibilities,engine:new ActivityOccurrenceEngine(core,responsibilities),
  planning:new ActivityPlanningService(connection,events,core,core,core,responsibilities),
  attendance:new ActivityAttendanceService(connection,core,core,core,core,core)};
}

async function fixture(goal:'attendance'|'gate'='attendance'){
 const context=services(db),suffix=randomUUID();
 const account=await db.insertInto('users').values({username:`roster-${suffix}`,email:`roster-${suffix}@example.test`,
  password_hash:'isolated-test-only',first_name:'Account',last_name:'Owner',role:'admin'})
  .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
 const provisioner=new ProgressiveWorkspaceProvisioner(context.core);
 const schoolId=await db.transaction().execute(tx=>provisioner.createForAccount(tx,account,'UTC'));
 const user:AuthUser={...account,active_school_id:schoolId};
 const day=addDays(new Date().toISOString().slice(0,10),1),now=`${day}T09:30:00.000Z`;
 const environment=createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now}});
 const run=<T>(work:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,work);
 const owner=await run(()=>db.transaction().execute(tx=>context.core.resolveAccountEndpoint(tx,{school_id:schoolId,user_id:user.id,at:now})));
 if(!owner.acting)throw new Error('Fixture needs the real explicit founder endpoint.');
 const learner=(await sql<{id:string}>`INSERT INTO school_people(school_id,first_name,last_name)
  VALUES(${schoolId}::uuid,'Aarav','Participant') RETURNING id`.execute(db)).rows[0]!.id;
 const onboarding=new InstitutionOnboardingService(applicationDb,new AuditService(applicationDb),provisioner,context.core);
 await run(()=>onboarding.setGoals(user,{goals:[goal],primary:goal},request(user)));
 const draft=(title:string,people=[learner],groups:string[]=[])=>context.planning.create(request(user),schoolId,{
  idempotency_key:randomUUID(),title,purpose:'training',timezone:'UTC',starts_on:day,recurrence:'once',starts_at:'09:00',ends_at:'10:00',
  person_ids:people,group_ids:groups,lead_person_id:owner.person_id,recorder_person_id:owner.person_id,
  reviewer_person_id:owner.person_id,attendance_mode:'roll_call'});
 const publish=async(title:string,people=[learner],groups:string[]=[])=>{
  const plan=await draft(title,people,groups),input={idempotency_key:randomUUID(),expected_revision:plan.revision};
  const published=await context.planning.publish(request(user),schoolId,plan.id,input);
  const occurrence=(await context.planning.ensureOccurrences(schoolId,day,day)).find(row=>row.plan_version_id===plan.id)!;
  const registerId=await context.attendance.ensureRegister(schoolId,occurrence.id);
  return {plan:published,publishInput:input,occurrence,registerId};
 };
 return {...context,schoolId,user,owner,learner,day,now,run,draft,publish};
}

async function teamMembership(f:Awaited<ReturnType<typeof fixture>>,namespace=`live:${f.schoolId}`){
 const team=(await sql<{id:string}>`INSERT INTO campus_model_agents(school_id,agent_kind,external_ref,label,status)
  VALUES(${f.schoolId}::uuid,'team',${`team:${randomUUID()}`},'Explicit team','active') RETURNING id`.execute(db)).rows[0]!;
 const realm=(await sql<{id:string}>`SELECT id FROM operational_realms WHERE legacy_school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!;
 await sql`INSERT INTO campus_responsibility_team_memberships(school_id,realm_id,environment_namespace_id,team_agent_id,member_agent_id,
   effective_from,source_domain,source_record_id,source_revision)
  VALUES(${f.schoolId}::uuid,${realm.id}::uuid,${namespace},${team.id}::uuid,${f.owner.agent_id}::uuid,
   ${new Date(Date.parse(f.now)-86400000)}::timestamptz,'people',${team.id},1)`.execute(db);
 return {id:team.id,realmId:realm.id};
}

describe.runIf(enabled)('scheduled operators and explicit attendance participation remain distinct',()=>{
 it('keeps submitted work with its exact current reviewer beyond the recent-day horizon, until finalization',async()=>{
  const f=await fixture();
  await f.run(async()=>{
   const account=await db.insertInto('users').values({username:`reviewer-${randomUUID()}`,email:`reviewer-${randomUUID()}@example.test`,
    password_hash:'isolated-test-only',first_name:'Independent',last_name:'Reviewer',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
   await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:account.id,role:'admin',is_active:true}).execute();
   await linkFixtureStaffIdentity(applicationDb,{school_id:f.schoolId,user_id:account.id,owner_user_id:f.user.id});
   const reviewer:AuthUser={...account,active_school_id:f.schoolId};
   const reviewerIdentity=await db.transaction().execute(tx=>f.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:reviewer.id,at:f.now}));
   if(!reviewerIdentity.acting)throw new Error('The appointed reviewer requires an explicit account link.');
   const draft=await f.planning.create(request(f.user),f.schoolId,{idempotency_key:randomUUID(),title:'Independent review',
    purpose:'training',timezone:'UTC',starts_on:f.day,recurrence:'once',starts_at:'09:00',ends_at:'10:00',person_ids:[f.learner],
    recorder_person_id:f.owner.person_id,reviewer_person_id:reviewerIdentity.person_id,attendance_mode:'roll_call'});
   await f.planning.publish(request(f.user),f.schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:1});
   const occurrence=(await f.planning.ensureOccurrences(f.schoolId,f.day,f.day)).find(row=>row.plan_version_id===draft.id)!;
   const register=await f.attendance.ensureRegister(f.schoolId,occurrence.id);
   expect(await f.attendance.pendingActivityReviews(reviewer,f.schoolId)).toEqual([]);
   await f.attendance.submitRecords(f.user,f.schoolId,register,
    {expected_revision:0,records:[{person_id:f.learner,status:'present'}]},request(f.user));
   const submitted=await f.attendance.detail(f.user,f.schoolId,register);
   // Recorder and technical administrator are not appointed reviewers.
   expect(await f.attendance.pendingActivityReviews(f.user,f.schoolId)).toEqual([]);
   expect(await f.attendance.pendingActivityReviews(reviewer,f.schoolId)).toEqual([
    expect.objectContaining({register_id:register,occurrence_id:occurrence.id,revision:submitted.register.revision})]);
   const laterDay=addDays(f.day,20),laterAt=`${laterDay}T09:30:00.000Z`;
   const later=createLiveExecutionEnvironment({institution_id:f.schoolId,clock:{now:()=>new Date(laterAt),nowIso:()=>laterAt}});
   await executionEnvironmentStorage.run(later,async()=>{
    const snapshot:WorkspaceRepositorySnapshot={institution:{id:f.schoolId,name:'Disposable campus',timezone:'UTC'},
     membership_roles:['admin'],realm_id:'unused-by-presentation',environment_namespace_id:`live:${f.schoolId}`,
     acting_agent_id:reviewerIdentity.agent_id,owner_agent_ids:[reviewerIdentity.agent_id],assignments:[],messages:[],relationships:[]};
    const pending=await new ActivityWorkspaceProjection(applicationDb,f.planning,f.attendance,f.core)
     .load(reviewer,snapshot,new Date(laterAt),laterDay);
    expect(pending.work).toEqual([expect.objectContaining({status_label:'Awaiting review',
     href:`/areas/attendance/registers?date=${f.day}&register_id=${register}`,action_label:'Review register'})]);
    expect(pending.now).toEqual([]);
    // Current permission is required in addition to the retained appointment.
    await sql`UPDATE school_memberships SET role='staff' WHERE school_id=${f.schoolId}::uuid AND user_id=${reviewer.id}::uuid`.execute(db);
    await expect(f.attendance.detail(reviewer,f.schoolId,register)).rejects.toThrow('outside your current responsibilities');
    expect(await f.attendance.pendingActivityReviews(reviewer,f.schoolId)).toEqual([]);
    await sql`UPDATE school_memberships SET role='admin' WHERE school_id=${f.schoolId}::uuid AND user_id=${reviewer.id}::uuid`.execute(db);
    const finalRequest=request(reviewer),input={expected_revision:submitted.register.revision};
    await f.attendance.transition(reviewer,f.schoolId,register,'finalize',input,finalRequest);
    await f.attendance.transition(reviewer,f.schoolId,register,'finalize',input,finalRequest);
    expect(await f.attendance.pendingActivityReviews(reviewer,f.schoolId)).toEqual([]);
    expect((await f.attendance.detail(reviewer,f.schoolId,register)).register.state).toBe('locked');
   });
   await expect(f.attendance.pendingActivityReviews({...reviewer,active_school_id:randomUUID()},f.schoolId)).rejects.toThrow('Choose this institution');
  });
 },60000);

 it('records only the chosen attendee while preserving the lead commitment, authority, trace and pending onboarding recovery',async()=>{
  const f=await fixture();
  await f.run(async()=>{
   const {plan,publishInput,occurrence,registerId}=await f.publish('First attendance');
   expect(occurrence.participants).toEqual(expect.arrayContaining([
    expect.objectContaining({person_id:f.owner.person_id,participation_role:'lead',attendance_expected:false}),
    expect.objectContaining({person_id:f.learner,attendance_expected:true}),
   ]));
   const screen=await f.attendance.detail(f.user,f.schoolId,registerId);
   expect(screen.roster.map(person=>person.person_id)).toEqual([f.learner]);
   expect(screen.capabilities.can_record).toBe(true);
   const snapshot:WorkspaceRepositorySnapshot={institution:{id:f.schoolId,name:'Disposable campus',timezone:'UTC'},
    membership_roles:['admin'],realm_id:'unused-by-presentation',environment_namespace_id:`live:${f.schoolId}`,
    acting_agent_id:null,owner_agent_ids:[],assignments:[],messages:[],relationships:[]};
   const today=await new ActivityWorkspaceProjection(applicationDb,f.planning,f.attendance,f.core)
    .load(f.user,snapshot,new Date(f.now),f.day);
   expect(today.now).toEqual([expect.objectContaining({detail:'Scheduled activity · 1 expected participant',action_label:'Open register'})]);
   await f.attendance.submitRecords(f.user,f.schoolId,registerId,
    {expected_revision:0,records:[{person_id:f.learner,status:'present'}]},request(f.user));
   const accepted=await f.attendance.detail(f.user,f.schoolId,registerId);
   expect(accepted.register.state).toBe('submitted');
   expect(accepted.counts).toMatchObject({participants:1,recorded:1,unrecorded:0});
   const footprint=(await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_occurrence_participants
    WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!;
   expect(footprint.count).toBe(2);
   const resume=()=>sql<{resume_step:string;resume_path:string;revision:number}>`SELECT resume_step,resume_path,revision
    FROM progressive_onboarding_workspaces WHERE school_id=${f.schoolId}::uuid`.execute(db);
   const retained=(await resume()).rows[0]!;
   expect(retained).toMatchObject({resume_step:'operating',resume_path:'/areas/attendance/registers'});
   await f.planning.publish(request(f.user),f.schoolId,plan.id,publishInput);
   expect((await resume()).rows[0]).toEqual(retained);
   expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM progressive_onboarding_audits audit
    JOIN progressive_onboarding_workspaces workspace ON workspace.id=audit.workspace_id
    WHERE workspace.school_id=${f.schoolId}::uuid AND audit.metadata->>'source'='accepted_activity_publication'`.execute(db)).rows[0]!.count).toBe(1);
   const conflict=await f.draft('A lead cannot be double booked',[f.learner]);
   await expect(f.planning.publish(request(f.user),f.schoolId,conflict.id,{idempotency_key:randomUUID(),expected_revision:1})).rejects.toThrow('conflicts');
   expect((await f.attendance.detail(f.user,f.schoolId,registerId)).roster).toEqual(accepted.roster);
  });
 },60000);

 it.each(['person','group','class','team'] as const)('retains a recorder who is explicitly also an attendee through %s',async kind=>{
  const f=await fixture();
  await f.run(async()=>{
   const people=[f.learner];let groups:string[]=[];
   if(kind==='person')people.push(f.owner.person_id);
   if(kind==='group'){
    const group=(await sql<{id:string}>`INSERT INTO participation_groups(school_id,name,created_by)
     VALUES(${f.schoolId}::uuid,'Explicit participants',${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
    await sql`INSERT INTO participation_group_members(school_id,group_id,person_id,starts_on,created_by)
     VALUES(${f.schoolId}::uuid,${group}::uuid,${f.owner.person_id}::uuid,${f.day}::date,${f.user.id}::uuid)`.execute(db);
    groups=[`group:${group}`];
   }
   if(kind==='class'){
    const term=await db.insertInto('academic_terms').values({school_id:f.schoolId,academic_year:'2026-27',name:'Explicit class term',
     starts_on:f.day,ends_on:addDays(f.day,30),attendance_threshold:'75',is_active:true,updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
    const section=await db.insertInto('class_sections').values({school_id:f.schoolId,academic_year:'2026-27',grade:'Explicit',section:'',updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
    const student=await db.insertInto('students').values({school_id:f.schoolId,person_id:f.owner.person_id,user_id:null,
     admission_number:`EXPLICIT-${randomUUID()}`,date_of_birth:null,blood_group:null,emergency_contact:null}).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('enrollments').values({student_id:student.id,class_section_id:section.id,term_id:term.id,roll_number:1,enrolled_on:f.day,is_active:true}).execute();
    groups=[`class:${section.id}`];
   }
   if(kind==='team'){
    const team=await teamMembership(f);
    groups=[`team:${team.id}`];
   }
   const {occurrence,registerId}=await f.publish(`Explicit ${kind} participation`,people,groups);
   expect(occurrence.participants.find(person=>person.person_id===f.owner.person_id)?.attendance_expected).toBe(true);
   const screen=await f.attendance.detail(f.user,f.schoolId,registerId);
   expect(screen.roster.map(person=>person.person_id).sort()).toEqual([f.learner,f.owner.person_id].sort());
   await expect(f.attendance.submitRecords(f.user,f.schoolId,registerId,
    {expected_revision:0,records:[{person_id:f.learner,status:'present'}]},request(f.user))).rejects.toThrow('required participant');
   expect((await f.attendance.detail(f.user,f.schoolId,registerId)).counts.recorded).toBe(0);
   await f.attendance.submitRecords(f.user,f.schoolId,registerId,{expected_revision:0,
    records:[{person_id:f.learner,status:'present'},{person_id:f.owner.person_id,status:'present'}]},request(f.user));
   const submitted=await f.attendance.detail(f.user,f.schoolId,registerId);
   expect(submitted.counts).toMatchObject({participants:2,recorded:2,unrecorded:0});
  });
 },60000);

 it('does not reinterpret already retained occurrence or register snapshots, and leaves another onboarding goal unchanged',async()=>{
  const f=await fixture('gate');
  await f.run(async()=>{
   const draft=await f.draft('Retained source before the correction');
   const old=(await f.engine.expand(applicationDb,f.schoolId,f.day,f.day,draft.id)).find(row=>row.plan_version_id===draft.id)!;
   // Explicit pre-change fixture: old source defaulted every scheduled person to
   // attendance. No real campus or accepted historical evidence is rewritten.
   old.participants=old.participants.map(person=>({...person,attendance_expected:true}));
   await f.engine.retain(applicationDb,[old]);
   await f.planning.publish(request(f.user),f.schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:1});
   const registerId=await f.attendance.ensureRegister(f.schoolId,old.id);
   await f.attendance.submitRecords(f.user,f.schoolId,registerId,{expected_revision:0,
    records:[{person_id:f.learner,status:'present'},{person_id:f.owner.person_id,status:'present'}]},request(f.user));
   const before=await f.attendance.detail(f.user,f.schoolId,registerId);
   expect(before.counts.participants).toBe(2);
   const retained=await f.planning.ensureOccurrences(f.schoolId,f.day,f.day);
   expect(retained.find(row=>row.id===old.id)?.participants.every(person=>person.attendance_expected)).toBe(true);
   expect(await f.attendance.detail(f.user,f.schoolId,registerId)).toEqual(before);
   expect((await sql<{resume_step:string;resume_goal_key:string}>`SELECT resume_step,resume_goal_key
    FROM progressive_onboarding_workspaces WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0])
    .toEqual({resume_step:'first_use',resume_goal_key:'gate'});
  });
 },60000);

 it('refuses a lead-only roll call without treating an empty selected group as attendance enrolment',async()=>{
  const f=await fixture();
  await f.run(async()=>{
   const group=(await sql<{id:string}>`INSERT INTO participation_groups(school_id,name,created_by)
    VALUES(${f.schoolId}::uuid,'Empty intended cohort',${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
   const draft=await f.draft('Nobody was enrolled',[],[`group:${group}`]);
   await expect(f.planning.publish(request(f.user),f.schoolId,draft.id,
    {idempotency_key:randomUUID(),expected_revision:1})).rejects.toThrow('no eligible people');
   expect((await f.planning.getPlan(f.user,f.schoolId,draft.id)).state).toBe('draft');
   expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_plan_publication_evidence
    WHERE version_id=${draft.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
  });
 });

 it('does not advance another administrator account owner’s pending onboarding',async()=>{
  const f=await fixture();
  await f.run(async()=>{
   const account=await db.insertInto('users').values({username:`other-${randomUUID()}`,email:`other-${randomUUID()}@example.test`,
    password_hash:'isolated-test-only',first_name:'Another',last_name:'Administrator',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
   await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:account.id,role:'admin',is_active:true}).execute();
   await linkFixtureStaffIdentity(applicationDb,{school_id:f.schoolId,user_id:account.id,owner_user_id:f.user.id});
   const another:AuthUser={...account,active_school_id:f.schoolId},draft=await f.draft('Accepted by another administrator');
   const read=()=>sql<{revision:number;resume_step:string;resume_goal_key:string}>`SELECT revision,resume_step,resume_goal_key
    FROM progressive_onboarding_workspaces WHERE school_id=${f.schoolId}::uuid`.execute(db);
   const before=(await read()).rows[0];
   await f.planning.publish(request(another),f.schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:1});
   expect((await read()).rows[0]).toEqual(before);
  });
 });

 it('does not borrow planning team membership from another tenant or execution namespace',async()=>{
  const f=await fixture(),other=await fixture();
  await f.run(async()=>{
   const realm=(await sql<{id:string}>`SELECT id FROM operational_realms WHERE legacy_school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!;
   const namespace=`scenario:${randomUUID()}:run:${randomUUID()}`;
   await sql`INSERT INTO execution_environment_namespaces(namespace_id,realm_id,environment_kind,source_namespace_id,status,expires_at)
    VALUES(${namespace},${realm.id}::uuid,'simulation',${`live:${f.schoolId}`},'active',${`${addDays(f.day,10)}T00:00:00.000Z`}::timestamptz)`.execute(db);
   const wrongNamespace=await teamMembership(f,namespace),wrongTenant=await teamMembership(other);
   for(const team of [wrongNamespace,wrongTenant]){
    const people=await db.transaction().execute(tx=>f.responsibilities.snapshotPlanningTeamPeople(tx,{school_id:f.schoolId,
     team_id:team.id,from:`${f.day}T00:00:00.000Z`,until:`${addDays(f.day,1)}T00:00:00.000Z`}));
    expect(people).toEqual([]);
   }
  });
 });

 it('exposes canonical place-creation context only to an active institution administrator',async()=>{
  const f=await fixture();
  await f.run(async()=>{
   const campus=(await sql<{id:string}>`INSERT INTO institution_campuses(school_id,name,code,is_primary,created_by,updated_by)
    VALUES(${f.schoolId}::uuid,'Approved campus','ACTIVE',true,${f.user.id}::uuid,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
   await sql`INSERT INTO institution_campuses(school_id,name,code,status,created_by,updated_by)
    VALUES(${f.schoolId}::uuid,'Closed campus','CLOSED','inactive',${f.user.id}::uuid,${f.user.id}::uuid)`.execute(db);
   expect(await f.planning.catalogue(f.user,f.schoolId)).toMatchObject({can_manage:true,can_create_places:true,
    campuses:[{id:campus,label:'Approved campus',is_primary:true}]});
   // A global account role and an acting campus person do not make an active
   // staff membership into institution setup authority.
   const account=await db.insertInto('users').values({username:`catalogue-${randomUUID()}`,email:`catalogue-${randomUUID()}@example.test`,
    password_hash:'isolated-test-only',first_name:'Campus',last_name:'Participant',role:'admin'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
   await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:account.id,role:'staff',is_active:true}).execute();
   await linkFixtureStaffIdentity(applicationDb,{school_id:f.schoolId,user_id:account.id,owner_user_id:f.user.id});
   expect(await f.planning.catalogue({...account,active_school_id:f.schoolId},f.schoolId))
    .toMatchObject({can_manage:false,can_create_places:false,campuses:[],people:[]});
  });
 });

 it.runIf(Boolean(targetUrl))('uses the same roster and command path in an isolated Simulation without changing Live or a sibling',async()=>{
  const f=await fixture(),target=requireIsolatedTestDatabaseUrl(targetUrl);
  const team=await teamMembership(f);
  const original=await f.run(()=>f.publish('Captured participation'));
  const store=new SimulationSnapshotStore(sourceUrl,target,4),opened:Kysely<Database>[]=[];
  try{
   const snapshot=await store.capture(f.schoolId,f.now);
   const open=async()=>{
    const runId=randomUUID(),scenarioId=randomUUID();
    const branch=await createSimulationBranch(store.pool,snapshot,{run_id:runId,school_id:f.schoolId,scenario_id:scenarioId,
     namespace_id:`scenario:${scenarioId}:run:${runId}`});
    const driver=new SimulationBranchDriver(store.pool,branch,snapshot),compiler=new PostgresDialect({pool:store.pool});
    const database=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),
     createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:connection=>compiler.createIntrospector(connection)}});
    opened.push(database);
    const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,virtual_now:`${f.day}T11:30:00.000Z`,
     source_snapshot_ref:`sha256:${snapshot.content_hash}`,manifest_ref:'roster-participation-test',checked_at:f.now});
    return {database,context:services(database),run:<T>(work:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,work)};
   };
   const branch=await open(),sibling=await open();
   await branch.run(async()=>{
    const before=await branch.context.attendance.detail(f.user,f.schoolId,original.registerId);
    expect(before.roster.map(person=>person.person_id)).toEqual([f.learner]);
    await branch.context.attendance.submitRecords(f.user,f.schoolId,original.registerId,
     {expected_revision:0,records:[{person_id:f.learner,status:'late'}]},request(f.user));
    const submitted=await branch.context.attendance.detail(f.user,f.schoolId,original.registerId);
    expect(submitted.register.state).toBe('submitted');
    expect(submitted.counts).toMatchObject({participants:1,late:1,recorded:1});
    const draft=await branch.context.planning.create(request(f.user),f.schoolId,{idempotency_key:randomUUID(),title:'Run-local explicit team participation',
     purpose:'training',timezone:'UTC',starts_on:f.day,recurrence:'once',starts_at:'11:00',ends_at:'12:00',person_ids:[f.learner],
     group_ids:[`team:${team.id}`],lead_person_id:f.owner.person_id,recorder_person_id:f.owner.person_id,reviewer_person_id:f.owner.person_id,attendance_mode:'roll_call'});
    await branch.context.planning.publish(request(f.user),f.schoolId,draft.id,{idempotency_key:randomUUID(),expected_revision:1});
    const occurrence=(await branch.context.planning.ensureOccurrences(f.schoolId,f.day,f.day)).find(row=>row.plan_version_id===draft.id)!;
    expect(occurrence.participants.find(person=>person.person_id===f.owner.person_id)?.attendance_expected).toBe(true);
    const register=await branch.context.attendance.ensureRegister(f.schoolId,occurrence.id);
    await branch.context.attendance.submitRecords(f.user,f.schoolId,register,{expected_revision:0,
     records:[{person_id:f.learner,status:'present'},{person_id:f.owner.person_id,status:'present'}]},request(f.user));
    expect((await branch.context.attendance.detail(f.user,f.schoolId,register)).counts.recorded).toBe(2);
    const worldSnapshot:WorkspaceRepositorySnapshot={institution:{id:f.schoolId,name:'Disposable campus',timezone:'UTC'},
     membership_roles:['admin'],realm_id:'unused-by-presentation',environment_namespace_id:'unused-by-presentation',
     acting_agent_id:null,owner_agent_ids:[],assignments:[],messages:[],relationships:[]};
    const today=await new ActivityWorkspaceProjection(branch.database as DatabaseService,branch.context.planning,branch.context.attendance,branch.context.core)
     .load(f.user,worldSnapshot,new Date(`${f.day}T11:30:00.000Z`),f.day);
    expect(today.now).toEqual([expect.objectContaining({detail:'Scheduled activity · 2 expected participants'})]);
    expect(today.work).toHaveLength(2);
    expect(today.work).toEqual(expect.arrayContaining([expect.objectContaining({
     href:`/areas/attendance/registers?date=${f.day}&register_id=${original.registerId}`,status_label:'Awaiting review'})]));
    await branch.context.attendance.transition(f.user,f.schoolId,original.registerId,'finalize',
     {expected_revision:submitted.register.revision},request(f.user));
    expect((await branch.context.attendance.pendingActivityReviews(f.user,f.schoolId)).map(item=>item.register_id)).toEqual([register]);
    expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_versions WHERE id=${draft.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
    await sibling.run(async()=>{
     const copied=await sql<{count:number}>`SELECT count(*)::int AS count FROM schedule_versions
      WHERE id=${draft.id}::uuid`.execute(sibling.database);
     expect(copied.rows[0]!.count).toBe(0);
    });
   });
   expect((await f.run(()=>f.attendance.detail(f.user,f.schoolId,original.registerId))).counts)
    .toMatchObject({participants:1,recorded:0,unrecorded:1});
   expect((await sibling.run(()=>sibling.context.attendance.detail(f.user,f.schoolId,original.registerId))).counts)
    .toMatchObject({participants:1,recorded:0,unrecorded:1});
   expect(await f.run(()=>f.attendance.pendingActivityReviews(f.user,f.schoolId))).toEqual([]);
   expect(await sibling.run(()=>sibling.context.attendance.pendingActivityReviews(f.user,f.schoolId))).toEqual([]);
  }finally{
   await Promise.all(opened.map(database=>database.destroy()));
   await store.pool.end();
  }
 },120000);
});
