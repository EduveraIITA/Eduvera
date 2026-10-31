import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { ProgressiveWorkspaceProvisioner } from '../src/institution-onboarding/progressive-workspace.provisioner.js';
import { ProgressiveSetupService } from '../src/institution-activation/progressive-setup.service.js';
import { CampusEventsService } from '../src/campus-events/campus-events.service.js';
import { ExamOperationsService } from '../src/assessments/exam-operations.service.js';
import { AssessmentsService } from '../src/assessments/assessments.service.js';
import { AssessmentModelBridgeService } from '../src/assessments/assessment-model-bridge.service.js';
import { AssessmentInvigilationOfferBridgeService } from '../src/assessments/assessment-invigilation-offer-bridge.service.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { createLiveExecutionEnvironment } from '../src/campus-model-core/execution-environment.runtime.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { ownedParticipationTestServices } from './owned-participation.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
types.setTypeParser(1082,value=>value);
const pool=new Pool({connectionString:enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/unused',max:3});
const db=new Kysely<Database>({dialect:new PostgresDialect({pool})});
const applicationDb=db as DatabaseService;
const request=(user:AuthUser)=>({authUser:user,requestId:randomUUID(),headers:{'idempotency-key':randomUUID()}}) as unknown as AuthenticatedRequest;
afterAll(()=>db.destroy());

async function fixture(){
  const suffix=randomUUID();
  const account=await db.insertInto('users').values({username:`owned-${suffix}`,email:`owned-${suffix}@example.test`,password_hash:'isolated-test-only',
    first_name:'Owned',last_name:'Context',role:'admin'}).returning(['id','username','email','first_name','last_name','role','is_active']).executeTakeFirstOrThrow();
  const shared=ownedParticipationTestServices(applicationDb);
  const schoolId=await db.transaction().execute(tx=>new ProgressiveWorkspaceProvisioner(shared.core).createForAccount(tx,account,'Asia/Kolkata'));
  const user:AuthUser={...account,active_school_id:schoolId};
  const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
  let now=new Date(`${day}T02:00:00Z`);
  const environment=createLiveExecutionEnvironment({institution_id:schoolId,clock:{now:()=>new Date(now),nowIso:()=>now.toISOString()}});
  const run=<T>(action:()=>Promise<T>)=>executionEnvironmentStorage.run(environment,action);
  const setup=new ProgressiveSetupService(applicationDb,shared.core,shared.core,shared.core);
  const activated=await run(()=>setup.setupAttendance(user,schoolId,{group_name:'Context cohort',participant_names:['Canonical Learner'],
    responsible:{kind:'current_user',self_teaches:true,display_name:'Owned Context'},session:{starts_at:'07:00',ends_at:'08:00',weekdays:[1,2,3,4,5,6,7]}},request(user)));
  const studentId=activated.resources.student_ids[0]!;
  const personId=(await db.selectFrom('students').select('person_id').where('id','=',studentId).executeTakeFirstOrThrow()).person_id;
  const events=new SchoolEventService(applicationDb,shared.core);
  const campusEvents=new CampusEventsService(applicationDb,events,shared.bridge,shared.authorities,shared.core,shared.footprints,shared.planning);
  const exam=new ExamOperationsService(applicationDb,events,new AssessmentModelBridgeService(shared.core),
    new AssessmentInvigilationOfferBridgeService(shared.core),shared.bridge,shared.authorities,shared.core,shared.core,shared.footprints,shared.planning);
  return {schoolId,user,day,run,setNow:(instant:string)=>{now=new Date(instant);},shared,campusEvents,exam,activated,studentId,personId};
}

describe.skipIf(!enabled)('event and examination owning contexts use one accepted participation writer',()=>{
  it('prepares event authority before audience mutations, retains semantic refusals and rolls back unexpected projection failure',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const create=()=>f.campusEvents.create(request(f.user),{school_id:f.schoolId,idempotency_key:randomUUID(),event_type:'workshop',
        title:'Conflict checked workshop',starts_at:`${f.day}T04:00:00Z`,ends_at:`${f.day}T05:00:00Z`,
        audience:{mode:'students',student_ids:[f.studentId]},participation_requirement:'mandatory',requires_rsvp:false,
        requires_guardian_consent:false,payment_required:false,sessions:[{title:'Published plan only',session_type:'activity',
          starts_at:`${f.day}T04:00:00Z`,ends_at:`${f.day}T05:00:00Z`,attendance_mode:'none'}]});
      const draft=await create();
      const input={school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:1};
      const original=f.shared.core.prepareDomainCommand.bind(f.shared.core);
      const prepared=vi.spyOn(f.shared.core,'prepareDomainCommand').mockImplementationOnce(async(tx,command)=>{
        const before=(await sql<{status:string;audience:number}>`SELECT status,(SELECT count(*)::int FROM campus_event_participants
          WHERE event_id=${draft.id}::uuid) AS audience FROM campus_events WHERE id=${draft.id}::uuid`.execute(tx)).rows[0]!;
        expect(before).toEqual({status:'draft',audience:0});
        return original(tx,command);
      });
      const failed=vi.spyOn(f.shared.footprints,'record').mockRejectedValueOnce(new Error('Projection unavailable'));
      await expect(f.campusEvents.publish(request(f.user),draft.id,input)).rejects.toThrow('Projection unavailable');
      prepared.mockRestore();failed.mockRestore();
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid
        AND idempotency_key=${`campus-event:${f.user.id}:${input.idempotency_key}`}`.execute(db)).rows[0]!.count).toBe(0);
      expect((await sql<{status:string;audience:number}>`SELECT status,(SELECT count(*)::int FROM campus_event_participants
        WHERE event_id=${draft.id}::uuid) AS audience FROM campus_events WHERE id=${draft.id}::uuid`.execute(db)).rows[0]).toEqual({status:'draft',audience:0});
      const published=await f.campusEvents.publish(request(f.user),draft.id,input) as typeof draft;
      expect(await f.campusEvents.publish(request(f.user),draft.id,input)).toEqual(published);
      const accepted=(await sql<{state:string;domain_event_id:string;participants:number;registers:number}>`SELECT command.state,outcome.domain_event_id,
        (SELECT count(*)::int FROM campus_model_occurrence_participants WHERE school_id=${f.schoolId}::uuid) AS participants,
        (SELECT count(*)::int FROM activity_attendance_source_contexts WHERE school_id=${f.schoolId}::uuid AND source_kind='event') AS registers
        FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
        WHERE command.school_id=${f.schoolId}::uuid AND command.idempotency_key=${`campus-event:${f.user.id}:${input.idempotency_key}`}`.execute(db)).rows[0]!;
      expect(accepted.state).toBe('accepted');expect(accepted.domain_event_id).toBeTruthy();expect(accepted.registers).toBe(0);
      const overlap=await create();
      const refusal={school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:1};
      await expect(f.campusEvents.publish(request(f.user),overlap.id,refusal)).rejects.toThrow('conflicts');
      await expect(f.campusEvents.publish(request(f.user),overlap.id,refusal)).rejects.toThrow('conflicts');
      expect((await sql<{count:number;state:string}>`SELECT count(*)::int AS count,min(command.state) AS state FROM campus_model_commands command
        WHERE command.school_id=${f.schoolId}::uuid AND command.idempotency_key=${`campus-event:${f.user.id}:${refusal.idempotency_key}`}`.execute(db)).rows[0]).toEqual({count:1,state:'conflicted'});
      expect((await sql<{status:string;count:number}>`SELECT status,(SELECT count(*)::int FROM campus_event_participants
        WHERE event_id=${overlap.id}::uuid) AS count FROM campus_events WHERE id=${overlap.id}::uuid`.execute(db)).rows[0]).toEqual({status:'draft',count:0});
      const cancelled=await f.campusEvents.cancel(request(f.user),draft.id,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:published.revision,
        internal_reason:'Release the venue and expected people.',audience_notice:'The workshop has been cancelled.'}) as typeof draft;
      expect(cancelled.status).toBe('cancelled');
      const projected=(await sql<{state:string;basis:string;change:string}>`SELECT projected.state,projected.basis_event_id AS basis,projected.change_event_id AS change
        FROM campus_model_schedule_occurrences projected JOIN campus_model_entities plan ON plan.id=projected.schedule_entity_id
        WHERE plan.school_id=${f.schoolId}::uuid AND plan.domain='events' AND plan.domain_id=${`${draft.id}:plan`} AND projected.recorded_until IS NULL`.execute(db)).rows[0]!;
      expect(projected.state).toBe('cancelled');expect(projected.basis).not.toBe(projected.change);
      await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.user.id).execute();
      await expect(f.campusEvents.publish(request(f.user),draft.id,input)).rejects.toThrow('active school');
    });
  },60000);

  it('keeps event consent/readiness, check-in/out and lock/reopen rules while accepting only in the kernel',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const draft=await f.campusEvents.create(request(f.user),{school_id:f.schoolId,idempotency_key:randomUUID(),event_type:'workshop',
        title:'Participation context workshop',starts_at:`${f.day}T04:00:00Z`,ends_at:`${f.day}T05:00:00Z`,
        audience:{mode:'students',student_ids:[f.studentId]},participation_requirement:'mandatory',requires_rsvp:false,
        requires_guardian_consent:true,payment_required:false,sessions:[{title:'Workshop check-in',session_type:'activity',
          starts_at:`${f.day}T04:00:00Z`,ends_at:`${f.day}T05:00:00Z`,attendance_mode:'check_in_out'}]});
      const published=await f.campusEvents.publish(request(f.user),draft.id,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:draft.revision}) as typeof draft;
      const sessionId=published.sessions[0]!.id;
      const link=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts
        WHERE school_id=${f.schoolId}::uuid AND source_kind='event' AND source_id=${sessionId}`.execute(db)).rows[0]!;
      expect(link).toBeTruthy();
      f.setNow(`${f.day}T03:55:00Z`);
      const mark={school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:1,records:[{student_id:f.studentId,status:'present',
        observed_at:`${f.day}T03:50:00Z`,note:'',readiness_contradiction_note:null}]};
      await expect(f.campusEvents.attendance(request(f.user),draft.id,sessionId,mark)).rejects.toThrow('contradiction');
      const accepted={...mark,idempotency_key:randomUUID(),records:[{...mark.records[0]!,readiness_contradiction_note:'Observed at the venue; consent is still being reconciled.'}]};
      const checkin=await f.campusEvents.attendance(request(f.user),draft.id,sessionId,accepted);
      expect(checkin.rows[0]).toMatchObject({attendance_status:'present',readiness_contradiction_note:accepted.records[0]!.readiness_contradiction_note});
      expect(checkin.rows[0]!.checked_in_at).toEqual(new Date(`${f.day}T03:50:00Z`));
      await f.campusEvents.attendance(request(f.user),draft.id,sessionId,accepted);
      const detail=await f.shared.kernel.detail(f.user,f.schoolId,link.register_id);
      expect(detail.capabilities.can_record).toBe(false);
      await expect(f.shared.kernel.marks(f.user,f.schoolId,link.register_id,{expected_revision:detail.register.revision,
        records:[{person_id:f.personId,status:'present'}]},request(f.user))).rejects.toThrow('owning domain');
      f.setNow(`${f.day}T05:01:00Z`);
      const checkout=await f.campusEvents.attendance(request(f.user),draft.id,sessionId,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:checkin.session.revision,
        reason:'Departure was observed by the responsible operator.',records:[{student_id:f.studentId,status:'checked_out',observed_at:`${f.day}T05:00:00Z`,note:'Departed',
          readiness_contradiction_note:'Original consent reconciliation remains noted.'}]});
      expect(checkout.rows[0]).toMatchObject({attendance_status:'checked_out'});
      const locked=await f.campusEvents.lock(request(f.user),draft.id,sessionId,{school_id:f.schoolId,idempotency_key:randomUUID(),
        expected_revision:checkout.session.revision,reason:'All expected participants checked out.'});
      expect(locked.session.state).toBe('locked');
      expect((await f.shared.kernel.detail(f.user,f.schoolId,link.register_id)).register.state).toBe('locked');
      const reopened=await f.campusEvents.reopen(request(f.user),draft.id,sessionId,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:locked.session.revision,
        reason:'Review the corrected paper observation.'});
      const cleared=await f.campusEvents.attendance(request(f.user),draft.id,sessionId,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:reopened.session.revision,
        reason:'Withdraw incorrect participant observation for review.',records:[{student_id:f.studentId,status:'not_recorded',observed_at:null,note:'Pending review',readiness_contradiction_note:null}]});
      expect(cleared.counts.not_recorded).toBe(1);
      const trace=(await sql<{accepted:number;observed:number;legacy:number}>`SELECT
        (SELECT count(*)::int FROM activity_attendance_commands WHERE register_id=${link.register_id}::uuid) AS accepted,
        (SELECT count(*)::int FROM campus_model_observations WHERE school_id=${f.schoolId}::uuid AND kind='attendance.participation_observed') AS observed,
        (SELECT count(*)::int FROM campus_event_attendance_records_legacy_source WHERE session_id=${sessionId}::uuid) AS legacy`.execute(db)).rows[0]!;
      expect(trace).toMatchObject({accepted:6,observed:2,legacy:0});
      expect((await f.campusEvents.history(f.user,draft.id,sessionId,f.schoolId)).items).toHaveLength(3);
      await expect(sql`INSERT INTO campus_event_attendance_records_legacy_source(school_id,event_id,session_id,student_id,status,marked_by)
        VALUES(${f.schoolId}::uuid,${draft.id}::uuid,${sessionId}::uuid,${f.studentId}::uuid,'excused',${f.user.id}::uuid)`.execute(db)).rejects.toThrow('shared kernel');
    });
  },60000);

  it('keeps one examiner per person despite multiple memberships and requires an independent moderator',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const suffix=randomUUID();
      const moderator=await db.insertInto('users').values({username:`moderator-${suffix}`,email:`moderator-${suffix}@example.test`,password_hash:'isolated-only',
        first_name:'Independent',last_name:'Moderator',role:'admin'}).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:moderator.id,role:'admin'}).execute();
      const subject=await db.insertInto('subjects').values({school_id:f.schoolId,code:'QUIZ',name:'Quiz subject',short_name:'Quiz'}).returning('id').executeTakeFirstOrThrow();
      const cycle=await db.insertInto('assessment_cycles').values({school_id:f.schoolId,term_id:f.activated.resources.term_id,name:'Quiz cycle',code:'QUIZ',
        starts_on:f.day,ends_on:f.day,created_by:f.user.id,updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
      const service=new AssessmentsService(applicationDb,new SchoolEventService(applicationDb,f.shared.core),f.exam,f.shared.core,f.shared.core);
      const input={cycle_id:cycle.id,class_section_id:f.activated.resources.class_section_id,subject_id:subject.id,title:'Multi-responsibility founder quiz',
        assessment_kind:'quiz',maximum_marks:10,examiner_user_id:f.user.id,moderator_user_id:moderator.id};
      const created=await service.createAssessment(f.user,f.schoolId,input);
      expect(created.status).toBe('draft');
      await expect(service.createAssessment(f.user,f.schoolId,{...input,moderator_user_id:f.user.id})).rejects.toThrow('different people');
    });
  },60000);

  it('prepares examination scheduling before candidate freeze and shares conflicts without making invigilators candidates',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const resource=f.activated.resources;
      const subject=await db.insertInto('subjects').values({school_id:f.schoolId,code:'EXAM',name:'Planned examination',short_name:'Exam'}).returning('id').executeTakeFirstOrThrow();
      const campus=(await sql<{id:string}>`INSERT INTO institution_campuses(school_id,name,code,created_by,updated_by)
        VALUES(${f.schoolId}::uuid,'Publication site','PUB',${f.user.id}::uuid,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
      const space=(await sql<{id:string}>`INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,capacity,created_by,updated_by)
        VALUES(${f.schoolId}::uuid,${campus}::uuid,'Publication hall','PUB','classroom',30,${f.user.id}::uuid,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
      const cycle=await db.insertInto('assessment_cycles').values({school_id:f.schoolId,term_id:resource.term_id,name:'Publication cycle',code:'PUB',starts_on:f.day,ends_on:f.day,
        created_by:f.user.id,updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
      const assessment=await db.insertInto('assessments').values({school_id:f.schoolId,cycle_id:cycle.id,class_section_id:resource.class_section_id,subject_id:subject.id,
        title:'Conflict checked examination',assessment_kind:'exam',maximum_marks:'100',status:'draft',scheduled_at:new Date(`${f.day}T04:00:00Z`),duration_minutes:60,
        created_by:f.user.id,updated_by:f.user.id}).returningAll().executeTakeFirstOrThrow();
      const policy={readiness_minutes_before:60,attendance_close_after_minutes:60,minimum_invigilators:1,require_all_candidate_attendance:true,post_completion_marking_mode:'manual'};
      const sitting=await db.insertInto('assessment_sittings').values({school_id:f.schoolId,assessment_id:assessment.id,campus_id:campus,space_id:space,
        starts_at:new Date(`${f.day}T04:00:00Z`),ends_at:new Date(`${f.day}T05:00:00Z`),state:'planning',policy_revision:1,policy_snapshot:policy,
        created_by:f.user.id,updated_by:f.user.id}).returningAll().executeTakeFirstOrThrow();
      // Independent accepted responsibility source; no accepted participation is seeded.
      await db.insertInto('assessment_sitting_invigilators').values({school_id:f.schoolId,sitting_id:sitting.id,assessment_id:assessment.id,user_id:f.user.id,
        assigned_by:f.user.id,status:'accepted',responded_at:new Date(`${f.day}T02:00:00Z`),revision:2}).execute();
      const operator=(await db.selectFrom('staff_profiles').select('person_id').where('school_id','=',f.schoolId).where('user_id','=',f.user.id).executeTakeFirstOrThrow()).person_id;
      const duty={idempotency_key:randomUUID(),title:'Existing operator duty',purpose:'duty',timezone:'Asia/Kolkata',starts_on:f.day,recurrence:'once',
        starts_at:'09:30',ends_at:'10:30',person_ids:[operator],attendance_mode:'none'};
      const dutyDraft=await f.shared.planning.create(request(f.user),f.schoolId,duty);
      await f.shared.planning.publish(request(f.user),f.schoolId,dutyDraft.id,{idempotency_key:randomUUID(),expected_revision:1});
      const service=new AssessmentsService(applicationDb,new SchoolEventService(applicationDb,f.shared.core),f.exam,f.shared.core,f.shared.core);
      const input={idempotency_key:randomUUID(),expected_revision:1};
      const original=f.shared.core.prepareDomainCommand.bind(f.shared.core);
      const prepared=vi.spyOn(f.shared.core,'prepareDomainCommand').mockImplementationOnce(async(tx,command)=>{
        expect((await tx.selectFrom('assessment_sitting_candidates').select('id').where('sitting_id','=',sitting.id).execute()).length).toBe(0);
        expect((await tx.selectFrom('assessment_sittings').select('state').where('id','=',sitting.id).executeTakeFirstOrThrow()).state).toBe('planning');
        return original(tx,command);
      });
      await expect(service.action(f.user,f.schoolId,assessment.id,'schedule',input)).rejects.toThrow('conflicts');prepared.mockRestore();
      await expect(service.action(f.user,f.schoolId,assessment.id,'schedule',input)).rejects.toThrow('conflicts');
      expect((await db.selectFrom('assessment_sitting_candidates').select('id').where('sitting_id','=',sitting.id).execute()).length).toBe(0);
      expect((await db.selectFrom('assessment_sittings').select('state').where('id','=',sitting.id).executeTakeFirstOrThrow()).state).toBe('planning');
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid
        AND command_type='examination.sitting.plan' AND state='conflicted'`.execute(db)).rows[0]!.count).toBe(1);
      await f.shared.planning.cancel(request(f.user),f.schoolId,dutyDraft.id,{idempotency_key:randomUUID(),expected_revision:2,reason:'Released for examination supervision.'});
      const acceptedInput={idempotency_key:randomUUID(),expected_revision:1};
      expect(await service.action(f.user,f.schoolId,assessment.id,'schedule',acceptedInput)).toMatchObject({status:'scheduled'});
      expect(await service.action(f.user,f.schoolId,assessment.id,'schedule',acceptedInput)).toMatchObject({status:'scheduled'});
      const source=(await sql<{id:string}>`SELECT id FROM schedule_activity_occurrences WHERE school_id=${f.schoolId}::uuid
        AND source='examination' AND source_ref=${sitting.id}`.execute(db)).rows[0]!.id;
      const roster=(await sql<{person_id:string;role:string;attendance_expected:boolean}>`SELECT person_id,participation_role AS role,attendance_expected
        FROM schedule_activity_occurrence_people WHERE occurrence_id=${source}::uuid ORDER BY attendance_expected DESC`.execute(db)).rows;
      expect(roster).toEqual([{person_id:f.personId,role:'participant',attendance_expected:true},{person_id:operator,role:'lead',attendance_expected:false}]);
      const link=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts
        WHERE school_id=${f.schoolId}::uuid AND source_kind='examination' AND source_id=${sitting.id}`.execute(db)).rows[0]!;
      expect((await f.shared.kernel.detail(f.user,f.schoolId,link.register_id)).roster.map(person=>person.person_id)).toEqual([f.personId]);
      const accepted=(await sql<{count:number;event:string}>`SELECT count(*)::int AS count,min(outcome.domain_event_id::text) AS event
        FROM campus_model_commands command JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
        WHERE command.school_id=${f.schoolId}::uuid AND command.command_type='examination.sitting.plan' AND command.state='accepted'`.execute(db)).rows[0]!;
      expect(accepted.count).toBe(1);expect(accepted.event).toBeTruthy();
      const later=await f.shared.planning.create(request(f.user),f.schoolId,{...duty,idempotency_key:randomUUID(),title:'Overlapping later duty'});
      await expect(f.shared.planning.publish(request(f.user),f.schoolId,later.id,{idempotency_key:randomUUID(),expected_revision:1})).rejects.toThrow('conflicts');
      const cancellation={idempotency_key:randomUUID(),expected_revision:2,note:'The examination has been rescheduled by its owner.'};
      expect(await service.action(f.user,f.schoolId,assessment.id,'cancel',cancellation)).toMatchObject({status:'cancelled'});
      expect(await service.action(f.user,f.schoolId,assessment.id,'cancel',cancellation)).toMatchObject({status:'cancelled'});
      expect((await db.selectFrom('assessment_sitting_candidates').select('id').where('sitting_id','=',sitting.id).execute()).length).toBe(1);
      const cancelled=(await sql<{state:string;basis:string;change:string}>`SELECT occurrence.state,occurrence.basis_event_id AS basis,occurrence.change_event_id AS change
        FROM campus_model_schedule_occurrences occurrence JOIN campus_model_entities plan ON plan.id=occurrence.schedule_entity_id
        WHERE plan.school_id=${f.schoolId}::uuid AND plan.domain='assessments' AND plan.domain_id=${`${sitting.id}:plan`}
          AND occurrence.recorded_until IS NULL`.execute(db)).rows[0]!;
      expect(cancelled.state).toBe('cancelled');expect(cancelled.basis).not.toBe(cancelled.change);
    });
  },60000);

  it('uses frozen examination candidates, preserves left-early and rejects offered-only invigilators and future observations',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const resource=f.activated.resources;
      const subject=await db.insertInto('subjects').values({school_id:f.schoolId,code:'EXAM',name:'Examination',short_name:'Exam'}).returning('id').executeTakeFirstOrThrow();
      const campus=(await sql<{id:string}>`INSERT INTO institution_campuses(school_id,name,code,created_by,updated_by)
        VALUES(${f.schoolId}::uuid,'Test site','EXAM',${f.user.id}::uuid,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
      const space=(await sql<{id:string}>`INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,capacity,created_by,updated_by)
        VALUES(${f.schoolId}::uuid,${campus}::uuid,'Exam hall','EXAM','classroom',30,${f.user.id}::uuid,${f.user.id}::uuid) RETURNING id`.execute(db)).rows[0]!.id;
      const cycle=await db.insertInto('assessment_cycles').values({school_id:f.schoolId,term_id:resource.term_id,name:'Assessment cycle',code:'ONE',starts_on:f.day,ends_on:f.day,
        created_by:f.user.id,updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
      const assessment=await db.insertInto('assessments').values({school_id:f.schoolId,cycle_id:cycle.id,class_section_id:resource.class_section_id,subject_id:subject.id,
        title:'Physical examination',assessment_kind:'exam',maximum_marks:'100',status:'scheduled',scheduled_at:new Date(`${f.day}T04:00:00Z`),duration_minutes:60,
        created_by:f.user.id,updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
      const policy={readiness_minutes_before:60,attendance_close_after_minutes:60,minimum_invigilators:1,require_all_candidate_attendance:true,post_completion_marking_mode:'manual'};
      const sitting=await db.insertInto('assessment_sittings').values({school_id:f.schoolId,assessment_id:assessment.id,campus_id:campus,space_id:space,
        starts_at:new Date(`${f.day}T04:00:00Z`),ends_at:new Date(`${f.day}T05:00:00Z`),state:'in_progress',revision:2,policy_revision:1,policy_snapshot:policy,
        roster_frozen_at:new Date(`${f.day}T02:00:00Z`),started_by:f.user.id,started_at:new Date(`${f.day}T04:00:00Z`),created_by:f.user.id,updated_by:f.user.id})
        .returning('id').executeTakeFirstOrThrow();
      const enrollment=await db.selectFrom('enrollments').select('id').where('student_id','=',f.studentId).where('class_section_id','=',resource.class_section_id).executeTakeFirstOrThrow();
      await db.insertInto('assessment_sitting_candidates').values({school_id:f.schoolId,sitting_id:sitting.id,assessment_id:assessment.id,student_id:f.studentId,enrollment_id:enrollment.id}).execute();
      f.setNow(`${f.day}T04:30:00Z`);
      await expect(f.exam.recordAttendance(f.user,f.schoolId,assessment.id,{expected_revision:2,records:[{student_id:f.studentId,status:'present',expected_revision:1,
        observed_at:`${f.day}T04:40:00Z`}]})).rejects.toThrow('actual observation');
      const first=await f.exam.recordAttendance(f.user,f.schoolId,assessment.id,{expected_revision:2,records:[{student_id:f.studentId,status:'left_early',expected_revision:1,
        observed_at:`${f.day}T04:25:00Z`,note:'Left with authorized medical support.'}]});
      expect(first.records[0]).toMatchObject({status:'left_early'});
      const link=(await sql<{register_id:string}>`SELECT register_id FROM activity_attendance_source_contexts WHERE school_id=${f.schoolId}::uuid
        AND source_kind='examination' AND source_id=${sitting.id}`.execute(db)).rows[0]!;
      expect((await f.shared.kernel.detail(f.user,f.schoolId,link.register_id)).roster[0]).toMatchObject({status:'left_early'});
      const offeredSuffix=randomUUID();
      const offered=await db.insertInto('users').values({username:`offered-${offeredSuffix}`,email:`offered-${offeredSuffix}@example.test`,password_hash:'isolated-only',first_name:'Offered',last_name:'Invigilator',role:'staff'}).returningAll().executeTakeFirstOrThrow();
      await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:offered.id,role:'staff'}).execute();
      await db.insertInto('assessment_sitting_invigilators').values({school_id:f.schoolId,sitting_id:sitting.id,assessment_id:assessment.id,user_id:offered.id,assigned_by:f.user.id}).execute();
      await expect(f.exam.recordAttendance({...offered,active_school_id:f.schoolId},f.schoolId,assessment.id,{expected_revision:first.sitting_revision,
        records:[{student_id:f.studentId,status:'present',expected_revision:first.records[0]!.revision}]})).rejects.toThrow('accepted invigilator');
      const operatorPerson=await db.insertInto('school_people').values({school_id:f.schoolId,first_name:'Offered',last_name:'Invigilator'}).returning('id').executeTakeFirstOrThrow();
      const profile=await db.insertInto('staff_profiles').values({school_id:f.schoolId,person_id:operatorPerson.id,user_id:offered.id,staff_code:'EXAM-OP',
        staff_kind:'non_teaching',designation:'Examination operator',employment_type:'contract',
        joined_on:f.day,status:'active',created_by:f.user.id,updated_by:f.user.id}).returning('id').executeTakeFirstOrThrow();
      await db.transaction().execute(tx=>f.shared.core.linkAccountEndpoint(tx,{school_id:f.schoolId,person_id:operatorPerson.id,user_id:offered.id,
        actor_user_id:f.user.id,effective_from:`${f.day}T02:00:00Z`,effective_until:null,source_domain:'staff',source_record_id:profile.id,source_revision:1,metadata:{fixture:true}}));
      await db.updateTable('assessment_sitting_invigilators').set({status:'accepted',responded_at:new Date(`${f.day}T04:30:00Z`),revision:2})
        .where('sitting_id','=',sitting.id).where('user_id','=',offered.id).execute();
      const accepted=await f.exam.recordAttendance({...offered,active_school_id:f.schoolId},f.schoolId,assessment.id,{expected_revision:first.sitting_revision,
        reason:'Reconciled the authorized medical departure with the invigilator source.',records:[{student_id:f.studentId,status:'left_early',
          expected_revision:first.records[0]!.revision,observed_at:`${f.day}T04:29:00Z`,note:'Confirmed by accepted invigilator.'}]});
      expect(accepted.records[0]!.recorded_by).toBe(offered.id);
      await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',offered.id).execute();
      await expect(f.exam.recordAttendance({...offered,active_school_id:f.schoolId},f.schoolId,assessment.id,{expected_revision:accepted.sitting_revision,
        reason:'Changed source after membership revocation.',records:[{student_id:f.studentId,status:'present',expected_revision:accepted.records[0]!.revision}]})).rejects.toThrow('accepted invigilator');
      const completed=await f.exam.complete(f.user,f.schoolId,assessment.id,{expected_revision:accepted.sitting_revision});
      expect(completed.sitting.state).toBe('completed');
      expect((await f.shared.kernel.detail(f.user,f.schoolId,link.register_id)).register.state).toBe('locked');
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM assessment_candidate_attendance_legacy_source WHERE sitting_id=${sitting.id}::uuid`.execute(db)).rows[0]!.count).toBe(0);
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_commands WHERE school_id=${f.schoolId}::uuid
        AND command_type='examination.attendance.record'`.execute(db)).rows[0]!.count).toBe(0);
    });
  },60000);

  it('imports an existing accepted event source without inventing an observation and retains the old signer/history',async()=>{
    const f=await fixture();
    await f.run(async()=>{
      const draft=await f.campusEvents.create(request(f.user),{school_id:f.schoolId,idempotency_key:randomUUID(),event_type:'other',title:'Retained event source',
        starts_at:`${f.day}T04:00:00Z`,ends_at:`${f.day}T05:00:00Z`,audience:{mode:'students',student_ids:[f.studentId]},participation_requirement:'mandatory',
        requires_rsvp:false,requires_guardian_consent:false,payment_required:false,sessions:[{title:'Retained session',session_type:'general',
          starts_at:`${f.day}T04:00:00Z`,ends_at:`${f.day}T05:00:00Z`,attendance_mode:'check_in'}]});
      const sessionId=draft.sessions[0]!.id;
      await sql`INSERT INTO campus_event_participants(school_id,event_id,student_id,participation_requirement)
        VALUES(${f.schoolId}::uuid,${draft.id}::uuid,${f.studentId}::uuid,'mandatory')`.execute(db);
      await sql`INSERT INTO campus_event_session_participants(school_id,event_id,session_id,student_id,participation_requirement)
        VALUES(${f.schoolId}::uuid,${draft.id}::uuid,${sessionId}::uuid,${f.studentId}::uuid,'mandatory')`.execute(db);
      await sql`UPDATE campus_events SET status='published',published_by=${f.user.id}::uuid,published_at=${`${f.day}T02:00:00Z`}::timestamptz,
        revision=2 WHERE id=${draft.id}::uuid`.execute(db);
      await sql`UPDATE campus_event_sessions SET revision=7 WHERE id=${sessionId}::uuid`.execute(db);
      // A controlled historical input fixture, not an application writer.
      // Restore the immutable source fence before calling the actual adapter.
      const original=await db.transaction().execute(async tx=>{
        await sql`ALTER TABLE campus_event_attendance_records_legacy_source DISABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        const retained=(await sql<{id:string}>`INSERT INTO campus_event_attendance_records_legacy_source(school_id,event_id,session_id,student_id,status,
          note,checked_in_at,marked_by,marked_at,updated_at) VALUES(${f.schoolId}::uuid,${draft.id}::uuid,${sessionId}::uuid,${f.studentId}::uuid,
            'present','Original signed paper source',${`${f.day}T04:00:00Z`}::timestamptz,${f.user.id}::uuid,${`${f.day}T04:01:00Z`}::timestamptz,
            ${`${f.day}T04:01:00Z`}::timestamptz) RETURNING id`.execute(tx)).rows[0]!;
        await sql`ALTER TABLE campus_event_attendance_records_legacy_source ENABLE TRIGGER participation_archived_source_immutable`.execute(tx);
        return retained;
      });
      f.setNow(`${f.day}T04:10:00Z`);
      await f.campusEvents.attendance(request(f.user),draft.id,sessionId,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:7,
        records:[{student_id:f.studentId,status:'present',observed_at:`${f.day}T04:00:00Z`,note:'Original signed paper source',readiness_contradiction_note:null}]});
      expect((await sql<{count:number}>`SELECT count(*)::int AS count FROM campus_model_observations WHERE school_id=${f.schoolId}::uuid
        AND kind='attendance.participation_observed'`.execute(db)).rows[0]!.count).toBe(0);
      const common=(await sql<{id:string;recorded_by:string;capture_channel:string}>`SELECT entry.id,entry.recorded_by,entry.capture_channel
        FROM activity_attendance_entries entry JOIN activity_attendance_source_contexts link ON link.register_id=entry.register_id
        WHERE link.school_id=${f.schoolId}::uuid AND link.source_kind='event' AND link.source_id=${sessionId}`.execute(db)).rows[0]!;
      expect(common).toEqual({id:original.id,recorded_by:f.user.id,capture_channel:'legacy_import'});
      const corrected=await f.campusEvents.attendance(request(f.user),draft.id,sessionId,{school_id:f.schoolId,idempotency_key:randomUUID(),expected_revision:7,
        reason:'Corrected the original arrival time from the signed source.',records:[{student_id:f.studentId,status:'late',observed_at:`${f.day}T04:05:00Z`,
          note:'Confirmed correction',readiness_contradiction_note:null}]});
      expect(corrected.rows[0]!.attendance_status).toBe('late');
      expect((await sql<{status:string}>`SELECT status FROM campus_event_attendance_records_legacy_source WHERE id=${original.id}::uuid`.execute(db)).rows[0]!.status).toBe('present');
      expect((await sql<{status:string}>`SELECT status FROM campus_event_attendance_records WHERE id=${original.id}::uuid`.execute(db)).rows[0]!.status).toBe('late');
    });
  },60000);
});
