import { randomUUID } from "node:crypto";
import { Kysely,PostgresDialect,sql } from "kysely";
import { Pool,types } from "pg";
import { afterAll,describe,expect,it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuthenticatedRequest,AuthUser } from "../src/common/request.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { createLiveExecutionEnvironment,createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { AcademicParticipationBridge } from "../src/attendance/academic-participation-bridge.service.js";
import { AcademicParticipationEffects } from "../src/attendance/academic-participation-effects.service.js";
import { AttendanceModelService } from "../src/attendance-model/attendance-model.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import type { StaffCoverageReconciliationPort } from "../src/staff-operations/staff-coverage-reconciliation.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import type { CampusModelObservation } from "../src/campus-model-core/contracts.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
types.setTypeParser(1082,value=>value);
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:enabled
  ?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused',max:3})})});
const applicationDb=db as DatabaseService;
const core=new CampusModelCoreService(applicationDb),events=new SchoolEventService(applicationDb,core);
const kernel=new ActivityAttendanceService(applicationDb,core,core,core,core,core);
const bridge=new AcademicParticipationBridge(applicationDb,kernel);
const sessions=new AttendanceModelService(applicationDb,events,kernel,bridge,core,core);
const school=new SchoolService(applicationDb,events,{} as StaffCoverageReconciliationPort,core,
  undefined,undefined,undefined,bridge);
new AcademicParticipationEffects(kernel,school,sessions,events);
const request=(user:AuthUser,key=randomUUID())=>({authUser:user,requestId:randomUUID(),headers:{'idempotency-key':key}}) as unknown as AuthenticatedRequest;
afterAll(()=>db.destroy());

async function fixture(mode:'automatic'|'staff_review') {
  const suffix=randomUUID();
  const owner=await db.insertInto('users').values({username:`qr-owner-${suffix}`,email:`qr-owner-${suffix}@example.test`,
    first_name:'QR',last_name:'Owner',role:'admin',password_hash:'isolated-test-only'})
    .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
  const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(core).createForAccount(tx,owner,'Asia/Kolkata'));
  const admin:AuthUser={...owner,active_school_id:schoolId};
  const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
  let now=new Date(`${date}T03:35:00Z`);
  const environment=createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now.toISOString()}});
  const run=<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,action);
  return run(async()=>{
    const setup=await new ProgressiveSetupService(applicationDb,core,core,core).setupAttendance(admin,schoolId,
      {group_name:'QR shared class',participant_names:['QR One','QR Two'],responsible:{kind:'current_user',self_teaches:true,display_name:'QR Owner'},
        session:{starts_at:'09:00',ends_at:'10:00',weekdays:[1,2,3,4,5,6,7]}},request(admin));
    await sql`UPDATE institution_operating_rules SET attendance_academic_mode='scheduled_session',attendance_academic_channels=ARRAY['staff_roll_call','student_qr'],
      attendance_self_check_in_mode=${mode},revision=revision+1,updated_by=${admin.id}::uuid,updated_at=${now}
      WHERE school_id=${schoolId}::uuid`.execute(db);
    const subject=(await sql<{id:string}>`INSERT INTO subjects(school_id,code,name,short_name)
      VALUES(${schoolId}::uuid,'QR','Shared session','QR') RETURNING id`.execute(db)).rows[0]!;
    await db.transaction().execute(async tx=>{
      const slot=(await sql<{id:string;revision:number;weekday:number;period_number:number;term_id:string;class_section_id:string}>`
        UPDATE timetable_slots SET slot_type='class',subject_id=${subject.id}::uuid,title='Shared session',revision=revision+1
        WHERE class_section_id=${setup.resources.class_section_id}::uuid AND weekday=EXTRACT(ISODOW FROM ${date}::date)::int
        RETURNING id,revision,weekday,period_number,term_id,class_section_id`.execute(tx)).rows[0]!;
      const term=await tx.selectFrom('academic_terms').select(['starts_on','ends_on']).where('id','=',slot.term_id).executeTakeFirstOrThrow();
      await core.recordLegacyTimetableSlotChange(tx,{school_id:schoolId,actor_user_id:admin.id,action:'updated',source_record_id:slot.id,
        source_revision:slot.revision,previous_source_revision:slot.revision-1,term_id:slot.term_id,starts_on:String(term.starts_on),ends_on:String(term.ends_on),
        timezone:'Asia/Kolkata',occurred_at:now.toISOString(),class_section:{kind:'class',domain:'academic_structure',domain_id:slot.class_section_id,
          label:'QR shared class',lifecycle_state:'active',source_revision:1,metadata:{}},slot:{weekday:slot.weekday,period_number:slot.period_number,
          starts_at:'09:00',ends_at:'10:00',title:'Shared session',slot_type:'class',teacher_user_id:admin.id,
          subject:{kind:'subject',domain:'academic_structure',domain_id:subject.id,label:'Shared session',lifecycle_state:'active',source_revision:1,metadata:{}},
          space:null,room_snapshot:''},correlation_id:randomUUID()});
    });
    const learners:AuthUser[]=[];
    for(const [index,studentId] of setup.resources.student_ids.entries()) {
      const account=await db.insertInto('users').values({username:`qr-person-${index}-${suffix}`,email:`qr-person-${index}-${suffix}@example.test`,
        first_name:'QR',last_name:String(index),role:'student',password_hash:'isolated-test-only'})
        .returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
      const person=(await db.selectFrom('students').select('person_id').where('id','=',studentId).executeTakeFirstOrThrow()).person_id;
      await db.updateTable('students').set({user_id:account.id}).where('id','=',studentId).execute();
      await sql`INSERT INTO school_memberships(school_id,user_id,role) VALUES(${schoolId}::uuid,${account.id}::uuid,'student')`.execute(db);
      await db.transaction().execute(tx=>core.linkAccountEndpoint(tx,{school_id:schoolId,person_id:person,user_id:account.id,actor_user_id:admin.id,
        effective_from:new Date(now.getTime()-1000).toISOString(),effective_until:null,source_domain:'people',source_record_id:studentId,source_revision:1,metadata:{fixture:true}}));
      learners.push({...account,active_school_id:schoolId});
    }
    const workspace=await sessions.workspace(admin,date),sessionId=workspace.registers[0]!.session_id as string;
    return {admin,schoolId,date,sessionId,learners,run,setNow:(value:string)=>{now=new Date(value);}};
  });
}

describe.skipIf(!enabled)('one shared QR evidence and configured decision lifecycle',()=>{
  it('retains human report and actual software acceptance, exact retry, current-rule refusal and human correction',async()=>{
    const f=await fixture('automatic');
    await f.run(async()=>{
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      const report=await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!));
      expect(report.status).toBe('recorded');
      expect(await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!))).toEqual(report);
      const source=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts
        WHERE school_id=${f.schoolId}::uuid AND source_id=${f.sessionId} AND state='active'`.execute(db)).rows[0]!;
      const screen=await kernel.detail(f.admin,f.schoolId,source.register_id);
      expect(screen.register.revision).toBe(2);
      expect(screen.counts.present).toBe(1);
      const actors=(await sql<{kind:string;human:string|null;software:string|null}>`SELECT agent.agent_kind AS kind,entry.recorded_by AS human,
        entry.recorded_by_agent_id AS software FROM activity_attendance_entries entry JOIN campus_model_agents agent ON agent.id=entry.recorded_by_agent_id
        WHERE entry.register_id=${source.register_id}::uuid`.execute(db)).rows;
      expect(actors).toEqual([{kind:'software',human:null,software:expect.any(String)}]);
      const observations=(await sql<{kind:string}>`SELECT agent.agent_kind AS kind FROM campus_model_observations observation
        JOIN campus_model_agents agent ON agent.id=observation.captured_by_agent_id
        WHERE observation.school_id=${f.schoolId}::uuid ORDER BY observation.created_at,observation.id`.execute(db)).rows;
      expect(observations.map(row=>row.kind).sort()).toEqual(['human','software']);
      const person=screen.roster.find(row=>row.status==='present')!;
      await kernel.marks(f.admin,f.schoolId,source.register_id,{expected_revision:2,reason:'Reviewed the signed register correction',
        records:[{person_id:person.person_id,status:'late'}]},request(f.admin));
      expect((await sql<{software:string|null;human:string}>`SELECT recorded_by AS human,recorded_by_agent_id AS software
        FROM activity_attendance_entries WHERE register_id=${source.register_id}::uuid`.execute(db)).rows[0]).toEqual({human:f.admin.id,software:null});
      expect((await sessions.screen(f.admin,f.sessionId)).roster.some((row:any)=>row.status==='late')).toBe(true);
      await expect(kernel.detail(f.learners[0]!,f.schoolId,source.register_id)).rejects.toThrow('responsibilities');
      const nextQr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      expect((await sessions.selfCheckIn(f.learners[0]!,nextQr.token,request(f.learners[0]!))).status).toBe('pending_review');
      expect((await kernel.detail(f.admin,f.schoolId,source.register_id)).roster.find(row=>row.person_id===person.person_id)!.status).toBe('late');
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM attendance_session_entries_legacy_source
        WHERE session_id=${f.sessionId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      await sql`UPDATE institution_operating_rules SET attendance_self_check_in_mode='disabled',revision=revision+1 WHERE school_id=${f.schoolId}::uuid`.execute(db);
      await expect(sessions.selfCheckIn(f.learners[1]!,qr.token,request(f.learners[1]!))).rejects.toThrow('approved');
    });
  },60000);

  it('keeps manual reports pending and rejects expired, revoked or wrong-campus tokens',async()=>{
    const f=await fixture('staff_review');
    await f.run(async()=>{
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      await expect(sessions.selfCheckIn({...f.learners[0]!,active_school_id:randomUUID()},qr.token,request(f.learners[0]!))).rejects.toThrow();
      const pending=await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!));
      expect(pending.status).toBe('pending_review');
      const source=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts WHERE school_id=${f.schoolId}::uuid AND source_id=${f.sessionId}`.execute(db)).rows[0]!;
      expect((await kernel.detail(f.admin,f.schoolId,source.register_id)).counts.recorded).toBe(0);
      const decisionRequest=request(f.admin);
      await sessions.decideEvidence(f.admin,f.sessionId,pending.evidence_id,{expected_revision:1,decision:'accepted',note:'Confirmed against the signed attendance record'},decisionRequest);
      await sessions.decideEvidence(f.admin,f.sessionId,pending.evidence_id,{expected_revision:1,decision:'accepted',note:'Confirmed against the signed attendance record'},decisionRequest);
      expect((await kernel.detail(f.admin,f.schoolId,source.register_id)).counts.present).toBe(1);
      await sql`UPDATE attendance_qr_challenges SET revoked_at=${new Date()} WHERE session_id=${f.sessionId}::uuid`.execute(db);
      await expect(sessions.selfCheckIn(f.learners[1]!,qr.token,request(f.learners[1]!))).rejects.toThrow('expired');
      const fresh=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      f.setNow(new Date(Date.parse(fresh.expires_at)+1).toISOString());
      await expect(sessions.selfCheckIn(f.learners[1]!,fresh.token,request(f.learners[1]!))).rejects.toThrow('expired');
    });
  },60000);

  it('rolls evidence, command, observation, outbox and revision back together on a failed ingress',async()=>{
    const f=await fixture('automatic');
    await f.run(async()=>{
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      const snapshot=async()=>(await sql<{evidence:number;commands:number;outcomes:number;outbox:number;revision:number}>`SELECT
        (SELECT count(*)::int FROM activity_attendance_evidence WHERE school_id=${f.schoolId}::uuid) AS evidence,
        (SELECT count(*)::int FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid) AS commands,
        (SELECT count(*)::int FROM campus_model_command_outcomes outcome JOIN campus_model_commands command ON command.id=outcome.command_id
          WHERE command.school_id=${f.schoolId}::uuid) AS outcomes,
        (SELECT count(*)::int FROM event_outbox WHERE school_id=${f.schoolId}::uuid) AS outbox,
        (SELECT revision FROM activity_attendance_registers WHERE school_id=${f.schoolId}::uuid) AS revision`.execute(db)).rows[0];
      const before=await snapshot();
      const failedKernel=new ActivityAttendanceService(applicationDb,core,core,{
        recordObservations:()=>Promise.reject(new Error('Isolated injected ingress failure')),
        transitionObservations:(tx,input)=>core.transitionObservations(tx,input),
      },core,core);
      const failed=new AttendanceModelService(applicationDb,events,failedKernel,
        new AcademicParticipationBridge(applicationDb,failedKernel),core,core);
      await expect(failed.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!))).rejects.toThrow('injected ingress failure');
      expect(await snapshot()).toEqual(before);
      expect((await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!))).status).toBe('recorded');
    });
  },60000);

  it('refuses forged QR sources, someone outside the current enrollment and a revoked account endpoint before recording evidence',async()=>{
    const f=await fixture('staff_review');
    await f.run(async()=>{
      await expect(sessions.issueQr(f.learners[0]!,f.sessionId,request(f.learners[0]!))).rejects.toThrow();
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      await expect(sessions.selfCheckIn(f.learners[0]!,randomUUID(),request(f.learners[0]!))).rejects.toThrow('expired');
      await expect(sessions.selfCheckIn(f.learners[0]!,{token:qr.token,person_id:randomUUID()},request(f.learners[0]!))).rejects.toThrow();
      const student=await db.selectFrom('students').select('id').where('school_id','=',f.schoolId)
        .where('user_id','=',f.learners[0]!.id).executeTakeFirstOrThrow();
      await db.updateTable('enrollments').set({is_active:false,inactive_from:f.date,exit_kind:'withdrawn',
        exit_reason:'Isolated current enrollment revocation',ended_by:f.admin.id,ended_at:new Date(`${f.date}T03:35:00Z`)})
        .where('student_id','=',student.id).execute();
      await expect(sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!))).rejects.toThrow('current academic participation');
      const identity=await db.transaction().execute(tx=>core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:f.learners[1]!.id,
        at:`${f.date}T03:35:00.000Z`}));
      if(!identity.acting)throw new Error('The test participant must initially have an active endpoint.');
      await db.transaction().execute(tx=>core.closeAccountEndpoint(tx,{school_id:f.schoolId,endpoint_id:identity.endpoint_id,
        actor_user_id:f.admin.id,expected_revision:1,effective_at:`${f.date}T03:35:00.000Z`,disposition:'revoked',
        reason:'Isolated own-report endpoint revocation',source_domain:'people',source_record_id:identity.person_id,
        source_revision:2,idempotency_key:randomUUID()}));
      await expect(sessions.selfCheckIn(f.learners[1]!,qr.token,request(f.learners[1]!))).rejects.toThrow();
      expect((await sql<{evidence:number;entries:number}>`SELECT
        (SELECT count(*)::int FROM activity_attendance_evidence WHERE school_id=${f.schoolId}::uuid) AS evidence,
        (SELECT count(*)::int FROM activity_attendance_entries WHERE school_id=${f.schoolId}::uuid) AS entries`.execute(db)).rows[0])
        .toEqual({evidence:0,entries:0});
    });
  },60000);

  it('does not review another dated session evidence or preserve a reviewer permission after membership revocation',async()=>{
    const f=await fixture('staff_review');
    await f.run(async()=>{
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      const pending=await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!));
      const nextDate=new Date(Date.parse(`${f.date}T00:00:00Z`)+7*86400000).toISOString().slice(0,10);
      const other=(await sessions.workspace(f.admin,nextDate)).registers[0]!.session_id as string;
      expect(other).not.toBe(f.sessionId);
      await expect(sessions.decideEvidence(f.admin,other,pending.evidence_id,
        {expected_revision:0,decision:'accepted',note:'Isolated wrong session review'},request(f.admin)))
        .rejects.toThrow('could not be found');
      await expect(sessions.decideEvidence(f.learners[1]!,f.sessionId,pending.evidence_id,
        {expected_revision:1,decision:'accepted',note:'An unrelated participant cannot approve this'},request(f.learners[1]!))).rejects.toThrow();
      await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId)
        .where('user_id','=',f.admin.id).execute();
      await expect(sessions.decideEvidence(f.admin,f.sessionId,pending.evidence_id,
        {expected_revision:1,decision:'accepted',note:'No retained administrator override'},request(f.admin))).rejects.toThrow();
      expect((await sql<{state:string;decided_by:string|null}>`SELECT state,decided_by FROM activity_attendance_evidence
        WHERE id=${pending.evidence_id}::uuid`.execute(db)).rows[0]).toEqual({state:'pending',decided_by:null});
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM activity_attendance_entries
        WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(0);
    });
  },60000);

  it('requires the exact accepted software command, event, actor, behavior and context before accepting an observation',async()=>{
    const f=await fixture('automatic');
    const otherSchoolId=(await fixture('staff_review')).schoolId;
    await f.run(async()=>{
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!));
      const receipt=(await sql<{command_id:string;actor_id:string;behavior_id:string;event_id:string;register_id:string;person_id:string}>`
        SELECT command.id AS command_id,command.actor_agent_id AS actor_id,command.configuration_refs->0->>'ref' AS behavior_id,
          outcome.domain_event_id AS event_id,target.domain_id AS register_id,student.person_id
        FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id AND outcome.status='accepted'
        JOIN campus_model_entities target ON target.id=command.target_entity_id
        JOIN students student ON student.school_id=command.school_id AND student.user_id=${f.learners[0]!.id}::uuid
        WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='attendance.participation.accept_configured_evidence'`.execute(db)).rows[0]!;
      const observation:CampusModelObservation={school_id:f.schoolId,kind:'attendance.participation_observed',
        captured_by:{kind:'configured_software',agent_id:receipt.actor_id,behaviour_version_id:receipt.behavior_id,
          command_id:receipt.command_id,source_domain:'attendance'},
        subject:{kind:'person',domain:'people',domain_id:receipt.person_id,label:'QR One',lifecycle_state:'active',source_revision:1,metadata:{}},
        context:{kind:'attendance_register',domain:'attendance',domain_id:receipt.register_id,label:'Shared session',lifecycle_state:'active',source_revision:2,metadata:{}},
        source_type:'attendance.participation',source_ref:randomUUID(),source_record_id:randomUUID(),
        observed_at:`${f.date}T03:35:00.000Z`,received_at:`${f.date}T03:35:00.000Z`,evidence_refs:[],
        payload:{attendance_status:'present',capture_channel:'self_check_in'},schema_version:1,state:'accepted',
        idempotency_key:`isolated-observation-${randomUUID()}`,domain_event_id:receipt.event_id};
      // Establish that the baseline is valid without retaining a fabricated
      // additional decision; every negative must fail because of its own gate.
      const rollback=new Error('rollback valid observation control');
      await expect(db.transaction().execute(async tx=>{
        expect(await core.recordObservations(tx,[observation])).toHaveLength(1);
        throw rollback;
      })).rejects.toBe(rollback);
      const before=(await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count;
      const software=observation.captured_by as Extract<NonNullable<CampusModelObservation['captured_by']>,{kind:'configured_software'}>;
      const variants:CampusModelObservation[]=[
        {...observation,captured_by:{...software,command_id:randomUUID()}},
        {...observation,captured_by:{...software,agent_id:randomUUID()}},
        {...observation,captured_by:{...software,behaviour_version_id:randomUUID()}},
        {...observation,captured_by:{...software,source_domain:'another_domain'}},
        {...observation,domain_event_id:randomUUID()},
        {...observation,context:null},
        {...observation,context:{...observation.context!,domain_id:randomUUID()}},
        {...observation,state:'pending'},
        {...observation,school_id:otherSchoolId},
      ];
      for(const variant of variants)await expect(db.transaction().execute(tx=>core.recordObservations(tx,[variant]))).rejects.toThrow();
      // Exercise the actual Core namespace gate with rollback-only transaction
      // scopes. These are negative address tests, not a COW application parity claim.
      const scopedCore=new CampusModelCoreService(applicationDb,new ExecutionDataPlaneScope());
      const scenarioId=randomUUID();
      for(const runId of [randomUUID(),randomUUID()]) {
        const instant=`${f.date}T03:35:00.000Z`;
        const environment=createSimulationExecutionEnvironment({institution_id:f.schoolId,scenario_id:scenarioId,run_id:runId,
          virtual_clock:{now:()=>new Date(instant),nowIso:()=>instant,advanceBy:()=>instant,advanceTo:()=>instant},
          source_snapshot_ref:'isolated-negative-address-fixture',coverage_gate:{status:'passed',manifest_ref:'isolated-address-gate-only',checked_at:instant},
          expires_at:new Date(Date.parse(instant)+3600000).toISOString()});
        await expect(executionEnvironmentStorage.run(environment,()=>db.transaction().execute(tx=>scopedCore.recordObservations(tx,[observation]))))
          .rejects.toThrow('exact accepted command and context');
      }
      await sql`UPDATE campus_model_agents SET status='suspended' WHERE id=${receipt.actor_id}::uuid`.execute(db);
      await expect(db.transaction().execute(tx=>core.recordObservations(tx,[observation]))).rejects.toThrow('active approved behavior');
      await expect(sessions.selfCheckIn(f.learners[1]!,qr.token,request(f.learners[1]!))).rejects.toThrow('suspended or revoked');
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_observations
        WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(before);
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM execution_environment_namespaces
        WHERE namespace_id LIKE ${`scenario:${scenarioId}:run:%`}`.execute(db)).rows[0]!.count).toBe(0);
    });
  },60000);

  it('keeps automatic acceptance entry remarks and its immutable revision consistent after an unrecorded draft',async()=>{
    const f=await fixture('automatic');
    await f.run(async()=>{
      const qr=await sessions.issueQr(f.admin,f.sessionId,request(f.admin));
      const source=(await sql<{register_id:string;person_id:string}>`SELECT link.register_id,student.person_id
        FROM activity_attendance_source_contexts link JOIN students student ON student.school_id=link.school_id AND student.user_id=${f.learners[0]!.id}::uuid
        WHERE link.school_id=${f.schoolId}::uuid AND link.source_id=${f.sessionId}`.execute(db)).rows[0]!;
      await kernel.marks(f.admin,f.schoolId,source.register_id,{expected_revision:0,
        records:[{person_id:source.person_id,status:null,remarks:'Awaiting a fresh own report'}]},request(f.admin));
      expect((await sessions.selfCheckIn(f.learners[0]!,qr.token,request(f.learners[0]!))).status).toBe('recorded');
      const accepted=(await sql<{remarks:string;previous_remarks:string|null;new_remarks:string}>`SELECT entry.remarks,history.previous_remarks,history.new_remarks
        FROM activity_attendance_entries entry JOIN activity_attendance_entry_revisions history ON history.entry_id=entry.id
          AND history.register_revision=entry.revision
        WHERE entry.register_id=${source.register_id}::uuid AND entry.person_id=${source.person_id}::uuid`.execute(db)).rows[0]!;
      expect(accepted.previous_remarks).toBe('Awaiting a fresh own report');
      expect(accepted.new_remarks).toBe(accepted.remarks);
    });
  },60000);
});
