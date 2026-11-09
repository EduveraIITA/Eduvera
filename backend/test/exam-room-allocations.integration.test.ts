import { randomUUID } from 'node:crypto';
import { Kysely,PostgresDialect,sql } from 'kysely';
import { Pool,types } from 'pg';
import { afterAll,describe,expect,it } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { AuthUser } from '../src/common/request.js';
import { CoordinationConfigurationService } from '../src/campus-model-core/coordination-configuration.service.js';
import { InvigilationInvitationPolicyService } from '../src/assessments/invigilation-invitation-policy.service.js';
import { academicRequest,createAcademicOfferingFixture,prepareOfferingExam } from './academic-offering-cycle.test-support.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { examAmendmentFixture,examAmendmentServices } from './exam-amendments.test-support.js';
import { linkFixtureStaffIdentity } from './fixture-human-identity.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const worldTarget=process.env.ASSESSMENTS_SIMULATION_TEST_TARGET_URL;
const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
const url=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/exam_rooms_unused_test';
types.setTypeParser(1082,value=>value);
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:url,max:3})})}) as DatabaseService;
afterAll(()=>db.destroy());

type Exam=Awaited<ReturnType<typeof examAmendmentFixture>>['operations'];
const candidates=(id:string)=>db.selectFrom('assessment_sitting_candidates').selectAll().where('assessment_id','=',id).orderBy('roll_number_snapshot').orderBy('person_id').execute();
const sitting=(id:string)=>db.selectFrom('assessment_sittings').selectAll().where('assessment_id','=',id).executeTakeFirstOrThrow();
const marks=(id:string)=>db.selectFrom('assessment_results').selectAll().where('assessment_id','=',id).execute();

async function accept(exam:Exam,school:string,id:string,invigilator:AuthUser){
  const assignment=await db.selectFrom('assessment_sitting_invigilators').selectAll().where('assessment_id','=',id)
    .where('user_id','=',invigilator.id).executeTakeFirstOrThrow();
  await exam.respondInvigilator(invigilator,school,id,assignment.id,{command_id:randomUUID(),expected_revision:assignment.revision,decision:'accepted'});
}

async function arrange(exam:Exam,school:string,id:string,owner:AuthUser,primary:string,secondary:string,first:AuthUser,second:AuthUser){
  const source=await db.selectFrom('assessments').selectAll().where('id','=',id).executeTakeFirstOrThrow();
  const current=await sitting(id);
  const body={expected_assessment_revision:source.revision,expected_sitting_revision:current.revision,
    scheduled_at:new Date(current.starts_at).toISOString(),duration_minutes:source.duration_minutes,space_id:primary,invigilator_user_ids:[first.id]};
  const arranged=await exam.updateArrangements(owner,school,id,{...body,
    room_allocations:[{space_id:primary,candidate_count:1,invigilator_user_ids:[first.id]},
      {space_id:secondary,candidate_count:1,invigilator_user_ids:[second.id]}]});
  await expect(exam.updateArrangements(owner,school,id,{...body,expected_assessment_revision:arranged.assessment.revision,
    expected_sitting_revision:arranged.sitting.revision})).rejects.toThrow('split-room editor');
  return arranged;
}

async function runExam(exam:Exam,school:string,id:string,owner:AuthUser,staff:[AuthUser,AuthUser]){
  const plan=await exam.detail(owner,school,id);
  const canonical=(await sql<{space_id:string;register_source:string}>`
    SELECT occurrence.space_id,register.context_source_id AS register_source FROM schedule_activity_occurrences occurrence
    JOIN activity_attendance_registers register ON register.school_id=occurrence.school_id AND register.occurrence_id=occurrence.id
    WHERE occurrence.school_id=${school}::uuid AND occurrence.context_ref=${id}::uuid AND occurrence.source='examination'
  `.execute(db)).rows;
  expect(canonical).toEqual(expect.arrayContaining(plan.room_allocations!.map(room=>({space_id:room.space_id,register_source:room.room_id}))));
  expect(canonical).toHaveLength(2);
  const roomViews=await Promise.all(staff.map(actor=>exam.detail(actor,school,id)));
  expect(roomViews.map(view=>view.candidates.length)).toEqual([1,1]);
  expect(roomViews.map(view=>view.viewer_room_id)).toEqual(plan.room_allocations!.map(room=>room.room_id));
  await expect(exam.start(staff[0],school,id,{expected_revision:plan.sitting.revision})).rejects.toThrow('administrator');
  const started=await exam.start(owner,school,id,{expected_revision:plan.sitting.revision});
  const record=(index:number)=>({candidate_id:(roomViews[index]!.candidates[0] as {candidate_id:string}).candidate_id,
    expected_revision:1,status:'present',note:'Observed in the assigned room.'});
  await expect(exam.recordAttendance(staff[0],school,id,{expected_revision:started.sitting.revision,records:[record(1)]})).rejects.toThrow('accepted invigilator');
  const first=await exam.recordAttendance(staff[0],school,id,{expected_revision:started.sitting.revision,records:[record(0)]});
  await expect(exam.complete(owner,school,id,{expected_revision:first.sitting_revision})).rejects.toThrow('1 remaining');
  const second=await exam.recordAttendance(staff[1],school,id,{expected_revision:first.sitting_revision,records:[record(1)]});
  return exam.complete(owner,school,id,{expected_revision:second.sitting_revision});
}

describe.runIf(enabled)('simultaneous rooms with actual campus attendance and marks',()=>{
  it('freezes class learners by roll number, checks the second room and opens one marking register',async()=>{
    const f=await examAmendmentFixture(db);
    const nextPerson=await db.insertInto('school_people').values({school_id:f.schoolId,first_name:'Arjun',last_name:'Rao'}).returning('id').executeTakeFirstOrThrow();
    const nextStudent=await db.insertInto('students').values({school_id:f.schoolId,person_id:nextPerson.id,admission_number:'ROOMS-2'}).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('enrollments').values({student_id:nextStudent.id,class_section_id:f.section.id,term_id:f.term.id,roll_number:2,enrolled_on:f.day(-1)}).execute();
    const starts=`${f.day(4)}T09:00:00.000Z`;
    const paper=await f.run(async()=>{
      const source=await f.source();
      const created=await f.assessments.createAssessment(f.owner,f.schoolId,{cycle_id:source.cycle_id,class_section_id:f.section.id,subject_id:f.subject.id,
        title:'Networks written examination',assessment_kind:'exam',maximum_marks:100,scheduled_at:starts,duration_minutes:60,evidence_requirement:'none',
        examiner_user_id:f.owner.id,moderator_user_id:f.moderator.id,space_id:f.firstRoom.id,invigilator_user_ids:[f.invigilator.id]});
      const arranged=await arrange(f.operations,f.schoolId,created.id,f.owner,f.firstRoom.id,f.secondRoom.id,f.invigilator,f.alternate);
      await accept(f.operations,f.schoolId,created.id,f.invigilator);
      expect((await f.operations.readiness(f.owner,f.schoolId,created.id)).blockers.map(row=>row.message)).toContain('HALL-B needs 1 more invigilator acceptance.');
      await accept(f.operations,f.schoolId,created.id,f.alternate);
      const slot=await db.insertInto('timetable_slots').values({class_section_id:f.section.id,term_id:f.term.id,subject_id:f.subject.id,
        weekday:new Date(starts).getUTCDay()||7,period_number:50,starts_at:'09:00:00',ends_at:'10:00:00',slot_type:'class',
        title:'Independent lab booking',room:'HALL-B',space_id:f.secondRoom.id,teacher_user_id:f.owner.id,updated_by:f.owner.id}).returning('id').executeTakeFirstOrThrow();
      expect((await f.operations.readiness(f.owner,f.schoolId,created.id)).blockers.map(row=>row.code)).toContain('room_timetable');
      await db.deleteFrom('timetable_slots').where('id','=',slot.id).execute();
      await f.assessments.action(f.owner,f.schoolId,created.id,'schedule',{expected_revision:arranged.assessment.revision,idempotency_key:randomUUID()});
      const calendar=await f.assessments.calendar(f.guardian,f.schoolId,f.day(4),f.day(4),f.student.id);
      expect(calendar.items.find(row=>row.id===created.id)?.venue).toBe(f.firstRoom.name);
      return created;
    });
    await f.runAt(new Date(Date.parse(starts)+1000).toISOString(),async()=>{
      expect((await candidates(paper.id)).map(row=>row.student_id)).toEqual([f.student.id,nextStudent.id]);
      await runExam(f.operations,f.schoolId,paper.id,f.owner,[f.invigilator,f.alternate]);
      await f.assessments.action(f.owner,f.schoolId,paper.id,'open-marking',{expected_revision:paper.revision+2,idempotency_key:randomUUID()});
      expect((await marks(paper.id)).map(row=>row.student_id).sort()).toEqual([f.student.id,nextStudent.id].sort());
    });
  },120000);

  it.each([false,true])('uses canonical people and the assigned Calendar room with legacy class present: %s',async mixed=>{
    const f=await createAcademicOfferingFixture(db);
    if(mixed)await db.insertInto('class_sections').values({school_id:f.schoolId,academic_year:'mixed',grade:'Grade 12',section:'A'}).execute();
    await f.run(async()=>{
      const input=await prepareOfferingExam(db,f,'automatic','practical');
      const staff=await db.insertInto('users').values({username:`room-alternate-${randomUUID()}`,email:`${randomUUID()}@example.test`,
        password_hash:'isolated-only',first_name:'Priya',last_name:'Shah',role:'staff'}).returningAll().executeTakeFirstOrThrow();
      const alternate={...staff,active_school_id:f.schoolId};
      await db.insertInto('school_memberships').values({school_id:f.schoolId,user_id:staff.id,role:'staff'}).execute();
      await linkFixtureStaffIdentity(db,{school_id:f.schoolId,user_id:staff.id,owner_user_id:f.owner.id,teaching:false});
      const policy=new InvigilationInvitationPolicyService(db,f.core,new CoordinationConfigurationService(f.core),f.core,f.core);
      const workspace=await policy.workspace(f.owner,f.schoolId);
      await policy.approve(academicRequest(f.owner),f.schoolId,{expected_revision:workspace.policy.revision,enabled:true,
        recipient_person_ids:workspace.eligible_recipients.filter(row=>[alternate.id,f.instructor.actor.id].includes(row.user_id)).map(row=>row.person_id),
        response_due_minutes:10080,expires_after_minutes:43200,approval_note:'Approve two independently assigned rooms in this isolated course.',idempotency_key:randomUUID()});
      const paper=await f.assessments.createAssessment(f.owner,f.schoolId,input.input);
      const arranged=await arrange(f.exam,f.schoolId,paper.id,f.owner,input.original.id,input.replacement.id,f.instructor.actor,alternate);
      await accept(f.exam,f.schoolId,paper.id,f.instructor.actor);await accept(f.exam,f.schoolId,paper.id,alternate);
      await f.assessments.action(f.owner,f.schoolId,paper.id,'schedule',{expected_revision:arranged.assessment.revision,idempotency_key:randomUUID()});
      const plan=await f.exam.detail(f.owner,f.schoolId,paper.id);
      const frozen=await candidates(paper.id);
      expect(frozen).toHaveLength(2);
      expect(frozen.every(row=>row.student_id===null&&row.person_id&&row.offering_id===f.source.id&&row.room_id)).toBe(true);
      for(const learner of [f.learner,f.secondLearner]){
        const person=frozen.find(row=>row.person_id===learner.id)!;
        const calendar=await f.assessments.calendar(learner.actor,f.schoolId,f.date(2),f.date(2),undefined,'offering_v1',learner.id);
        expect(calendar.items.find(item=>item.id===paper.id)?.venue).toBe(plan.room_allocations?.find(room=>room.room_id===person.room_id)?.name);
      }
      expect(await runExam(f.exam,f.schoolId,paper.id,f.owner,[f.instructor.actor,alternate])).toMatchObject({assessment_status:'marking'});
      const results=await marks(paper.id);
      expect(results).toHaveLength(2);
      expect(results.every(mark=>mark.student_id===null&&mark.learner_id===mark.person_id)).toBe(true);
    });
  },120000);
  it.skipIf(!worldTarget)('publishes room assignments only in the chosen Simulation and keeps Live plus its sibling unchanged',async()=>{
    const f=await examAmendmentFixture(db);
    const next=await db.insertInto('school_people').values({school_id:f.schoolId,first_name:'Simulation',last_name:'Candidate'}).returning('id').executeTakeFirstOrThrow();
    const student=await db.insertInto('students').values({school_id:f.schoolId,person_id:next.id,admission_number:'SIM-ROOMS-2'}).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('enrollments').values({student_id:student.id,class_section_id:f.section.id,term_id:f.term.id,
      roll_number:2,enrolled_on:f.day(-1)}).execute();
    const starts=`${f.day(5)}T09:00:00.000Z`;
    const draft=await f.run(async()=>{
      const source=await f.source();
      return f.assessments.createAssessment(f.owner,f.schoolId,{cycle_id:source.cycle_id,class_section_id:f.section.id,
        subject_id:f.subject.id,title:'Simulation classroom paper',assessment_kind:'exam',maximum_marks:100,
        scheduled_at:starts,duration_minutes:60,evidence_requirement:'none',examiner_user_id:f.owner.id,
        moderator_user_id:f.moderator.id,space_id:f.firstRoom.id,invigilator_user_ids:[f.invigilator.id]});
    });
    const original=await sitting(draft.id);
    const store=new SimulationSnapshotStore(url,requireIsolatedTestDatabaseUrl(worldTarget),2),opened:DatabaseService[]=[];
    const readRooms=(connection:DatabaseService)=>connection.selectFrom('assessment_sitting_rooms').selectAll()
      .where('school_id','=',f.schoolId).where('sitting_id','=',original.id).orderBy('position').execute();
    try {
      const snapshot=await store.capture(f.schoolId,f.now);
      const open=async()=>{
        const run=randomUUID(),scenario=randomUUID(),namespace=`scenario:${scenario}:run:${run}` as const;
        const branch=await createSimulationBranch(store.pool,snapshot,{run_id:run,school_id:f.schoolId,scenario_id:scenario,namespace_id:namespace});
        const driver=new SimulationBranchDriver(store.pool,branch,snapshot),compiler=new PostgresDialect({pool:store.pool});
        const connection=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),
          createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:source=>compiler.createIntrospector(source)}}) as DatabaseService;
        opened.push(connection);
        const environment=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenario,run_id:run,virtual_now:f.now,
          source_snapshot_ref:`sha256:${snapshot.content_hash}`,manifest_ref:'simultaneous-exam-rooms-test',checked_at:f.now});
        const services=examAmendmentServices(connection);
        return {connection,...services,run:<T>(work:()=>Promise<T>)=>services.scope.run(environment,()=>executionEnvironmentStorage.run(environment,work))};
      };
      const selected=await open(),sibling=await open();
      await selected.run(async()=>{
        const arranged=await selected.operations.updateArrangements(f.owner,f.schoolId,draft.id,{
          expected_assessment_revision:draft.revision,expected_sitting_revision:original.revision,scheduled_at:starts,duration_minutes:60,
          space_id:f.firstRoom.id,invigilator_user_ids:[f.invigilator.id],
          room_allocations:[{space_id:f.firstRoom.id,candidate_count:1,invigilator_user_ids:[f.invigilator.id]},
            {space_id:f.secondRoom.id,candidate_count:1,invigilator_user_ids:[f.alternate.id]}],
        });
        for(const actor of [f.invigilator,f.alternate]){
          const offer=await selected.connection.selectFrom('assessment_sitting_invigilators').select(['id','revision'])
            .where('assessment_id','=',draft.id).where('user_id','=',actor.id).executeTakeFirstOrThrow();
          await selected.operations.respondInvigilator(actor,f.schoolId,draft.id,offer.id,{command_id:randomUUID(),
            expected_revision:offer.revision,decision:'accepted'});
        }
        await selected.assessments.action(f.owner,f.schoolId,draft.id,'schedule',{expected_revision:arranged.assessment.revision,idempotency_key:randomUUID()});
        const split=await selected.operations.detail(f.owner,f.schoolId,draft.id);
        expect(split.room_allocations?.map(room=>room.space_id)).toEqual([f.firstRoom.id,f.secondRoom.id]);
        expect(split.candidates).toHaveLength(2);
        expect(await readRooms(selected.connection)).toHaveLength(2);
      });
      expect(await readRooms(db)).toEqual([]);
      expect(await sibling.run(()=>readRooms(sibling.connection))).toEqual([]);
      expect(await sitting(draft.id)).toEqual(original);
      await sibling.run(async()=>expect((await sibling.operations.detail(f.owner,f.schoolId,draft.id)).sitting?.state).toBe('planning'));
    }finally{await Promise.all(opened.map(connection=>connection.destroy()));await store.pool.end();}
  },120000);

});
