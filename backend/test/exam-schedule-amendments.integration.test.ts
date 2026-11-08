import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool,types } from 'pg';
import { afterAll,describe,expect,it } from 'vitest';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { createSimulationBranch, SimulationBranchDriver } from '../src/database/simulation-branch.driver.js';
import { SimulationSnapshotStore } from '../src/database/simulation-snapshot-store.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { examAmendmentFixture,examAmendmentServices } from './exam-amendments.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';
const enabled=process.env.TEST_DATABASE_ISOLATED==='true',sourceUrl=enabled?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):'postgresql://invalid.invalid/exam_amend_unused_test';
const target=process.env.ASSESSMENTS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082,value=>value);
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:sourceUrl,max:3})})}) as DatabaseService;
afterAll(()=>db.destroy());
const observations=(connection:Kysely<Database>,school:string,id:string)=>sql<{id:string;revision:number;context_snapshot:Record<string,unknown>;occurrence_id:string;starts_at:Date;ends_at:Date;local_date:string;space_id:string;state:string;source_revision:number;roster_fingerprint:string}>`SELECT register.id,register.revision,register.context_snapshot,
 occurrence.id AS occurrence_id,occurrence.starts_at,occurrence.ends_at,occurrence.local_date,occurrence.space_id,occurrence.state,
 occurrence.source_revision,register.roster_fingerprint FROM activity_attendance_registers register
 JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id WHERE register.school_id=${school}::uuid
 AND register.context_source_kind='examination' AND register.context_source_id=${id}`.execute(connection).then(result=>result.rows);
async function proposed(f:Awaited<ReturnType<typeof examAmendmentFixture>>,operations=f.operations,connection:Kysely<Database>=f.db,offset=3600000){
 const assessment=await connection.selectFrom('assessments').selectAll().where('id','=',f.assessment.id).executeTakeFirstOrThrow(),sitting=await connection.selectFrom('assessment_sittings').selectAll().where('assessment_id','=',f.assessment.id).executeTakeFirstOrThrow();
 const input={expected_assessment_revision:assessment.revision,expected_sitting_revision:sitting.revision,scheduled_at:new Date(new Date(sitting.starts_at).getTime()+offset).toISOString(),
  duration_minutes:60,space_id:f.secondRoom.id,invigilator_user_ids:[f.invigilator.id],reason:'The original hall is unavailable; move the future sitting.'};
 const preview=await operations.previewScheduleAmendment(f.owner,f.schoolId,f.assessment.id,input);
 return {preview,input,command:{...input,command_id:randomUUID(),preview_hash:preview.preview_hash}};
}
describe.runIf(enabled)('future scheduled examination amendments with actual source/Core/attendance',()=>{
 it('replaces same-day arrangements explicitly, preserves frozen candidates and exact history, replays a lost response and confirms only after new acceptances',async()=>{
  const f=await examAmendmentFixture(db);
  await f.run(async()=>{
   const oldSitting=await f.sitting(),before=await observations(db,f.schoolId,oldSitting.id),candidates=await db.selectFrom('assessment_sitting_candidates').selectAll().where('sitting_id','=',oldSitting.id).execute();
   const p=await proposed(f);expect(p.preview).toMatchObject({can_publish:true,candidate_count:1,reissued_invigilator_user_ids:[f.invigilator.id]});
   const accepted=await f.operations.amendSchedule(f.owner,f.schoolId,f.assessment.id,p.command);
   expect(accepted).toMatchObject({command_id:p.command.command_id,assessment:{id:f.assessment.id,status:'scheduled'},sitting:{id:oldSitting.id,state:'planning',space_id:f.secondRoom.id},schedule_state:'awaiting_confirmation'});
   // The result may have been lost after commit. Replaying the original key
   // reads the exact retained result, without a second schedule revision/Offer.
   expect(await f.operations.amendSchedule(f.owner,f.schoolId,f.assessment.id,p.command)).toEqual(accepted);
   await expect(f.operations.amendSchedule(f.owner,f.schoolId,f.assessment.id,{...p.command,reason:'Changed payload'})).rejects.toThrow('different examination');
   const pending=await f.operations.detail(f.owner,f.schoolId,f.assessment.id);
   expect(pending.schedule_state).toBe('awaiting_confirmation');expect(pending.readiness?.blockers.map(row=>row.code)).toEqual(['invigilators']);
   const frozen=await db.selectFrom('assessment_sitting_candidates').selectAll().where('sitting_id','=',oldSitting.id).execute();expect(frozen).toEqual(candidates);
   const after=await observations(db,f.schoolId,oldSitting.id);
   expect(after[0]).toMatchObject({occurrence_id:before[0]!.occurrence_id,space_id:f.secondRoom.id,state:'cancelled',roster_fingerprint:before[0]!.roster_fingerprint});
   expect(new Date(after[0]!.starts_at).toISOString()).toBe(p.input.scheduled_at);
   expect((after[0]!.context_snapshot as {context:{date:string;revision:number;space_id:string}}).context).toMatchObject({revision:oldSitting.revision+1,space_id:f.secondRoom.id});
   const fail={command_id:randomUUID(),expected_assessment_revision:pending.assessment!.revision,expected_sitting_revision:pending.sitting!.revision,reason:'Confirm revision readiness.'};
   await expect(f.operations.confirmScheduleAmendment(f.owner,f.schoolId,f.assessment.id,fail)).rejects.toThrow('acceptance');
   const offer=await db.selectFrom('assessment_sitting_invigilators').selectAll().where('assessment_id','=',f.assessment.id).where('user_id','=',f.invigilator.id).executeTakeFirstOrThrow();
   expect(offer.status).toBe('offered');await f.operations.respondInvigilator(f.invigilator,f.schoolId,f.assessment.id,offer.id,{command_id:randomUUID(),expected_revision:offer.revision,decision:'accepted',note:''});
   await expect(f.operations.confirmScheduleAmendment(f.owner,f.schoolId,f.assessment.id,fail)).rejects.toThrow('acceptance');
   const confirm={...fail,command_id:randomUUID()},confirmed=await f.operations.confirmScheduleAmendment(f.owner,f.schoolId,f.assessment.id,confirm);
   expect(confirmed).toMatchObject({command_id:confirm.command_id,sitting:{id:oldSitting.id,state:'ready'},schedule_state:'ready'});
   expect(await f.operations.confirmScheduleAmendment(f.owner,f.schoolId,f.assessment.id,confirm)).toEqual(confirmed);
   const ready=await observations(db,f.schoolId,oldSitting.id);expect(ready[0]).toMatchObject({occurrence_id:before[0]!.occurrence_id,state:'expected',space_id:f.secondRoom.id});
   expect((await db.selectFrom('assessment_results').selectAll().where('assessment_id','=',f.assessment.id).execute())).toEqual([]);
   const history=(await sql<{action:string;revision:number;previous_snapshot:{space_id:string}}> `SELECT * FROM assessment_schedule_revisions WHERE assessment_id=${f.assessment.id}::uuid ORDER BY revision`.execute(db)).rows;
   expect(history.map(row=>row.action)).toEqual(['amended','confirmed']);expect(history[0]!.previous_snapshot.space_id).toBe(f.firstRoom.id);
   await expect(sql`UPDATE assessment_schedule_revisions SET reason='Overwrite old schedule' WHERE assessment_id=${f.assessment.id}::uuid`.execute(db)).rejects.toThrow('immutable');
   await db.updateTable('school_memberships').set({is_active:false}).where('school_id','=',f.schoolId).where('user_id','=',f.owner.id).execute();
   await expect(f.operations.amendSchedule(f.owner,f.schoolId,f.assessment.id,p.command)).rejects.toThrow('administrator');
  });
 },120000);
 it('rejects stale preview, timetable conflicts, wrong actor and started evidence without rewriting source history',async()=>{
  const f=await examAmendmentFixture(db);
  await f.run(async()=>{
   const p=await proposed(f),before=await f.sitting();
   await expect(f.operations.amendSchedule(f.owner,f.schoolId,f.assessment.id,{...p.command,preview_hash:'0'.repeat(64)})).rejects.toThrow('impact changed');
   expect(await f.sitting()).toEqual(before);
   await expect(f.operations.previewScheduleAmendment(f.invigilator,f.schoolId,f.assessment.id,p.input)).rejects.toThrow('administrator');
   await db.insertInto('timetable_slots').values({class_section_id:f.section.id,term_id:f.term.id,subject_id:f.subject.id,weekday:new Date(p.input.scheduled_at).getUTCDay()||7,
    period_number:44,starts_at:'10:00:00',ends_at:'11:00:00',slot_type:'class',title:'Conflicting class',room:'HALL-B',space_id:f.secondRoom.id,teacher_user_id:f.invigilator.id,updated_by:f.owner.id}).execute();
   const conflicted=await f.operations.previewScheduleAmendment(f.owner,f.schoolId,f.assessment.id,p.input);expect(conflicted.can_publish).toBe(false);
   expect(conflicted.blockers.map(row=>row.code)).toContain('class_timetable');
  });
  const current=await f.sitting();
  await f.runAt(new Date(new Date(current.starts_at).getTime()+1000).toISOString(),async()=>{
   await f.operations.start(f.invigilator,f.schoolId,f.assessment.id,{expected_revision:current.revision});
   const saved=await f.sitting();
   const input={expected_assessment_revision:(await f.source()).revision,expected_sitting_revision:saved.revision,scheduled_at:new Date(new Date(saved.starts_at).getTime()+86400000).toISOString(),duration_minutes:60,
    space_id:f.secondRoom.id,invigilator_user_ids:[f.invigilator.id],reason:'This started sitting must not be moved.'};
   await expect(f.operations.previewScheduleAmendment(f.owner,f.schoolId,f.assessment.id,input)).rejects.toThrow('never-started');expect(await f.sitting()).toEqual(saved);
  });
 },120000);
 it('authorizes frozen-cohort refresh only for the current canonical student and linked guardian endpoints',async()=>{
  const f=await examAmendmentFixture(db);
  await f.run(async()=>{
   // Deliberately end the enrollment in this isolated negative fixture after
   // roster freeze. The new wrapper, rather than the prior dated-roster path,
   // must establish current endpoint eligibility for the retained candidate.
   await db.updateTable('enrollments').set({is_active:false,inactive_from:f.day(1),exit_kind:'withdrawn',
    exit_reason:'Isolated frozen-roster visibility fixture.',ended_by:f.owner.id,ended_at:new Date(f.now)}).where('student_id','=',f.student.id).execute();
   const allowed=async(user:string)=>(await sql<{allowed:boolean}>`SELECT event_user_is_authorized(${f.schoolId}::uuid,'assessment.updated',
     ${JSON.stringify({assessment_id:f.assessment.id,action:'schedule'})}::jsonb,${user}::uuid) AS allowed`.execute(db)).rows[0]!.allowed;
   expect(await allowed(f.learner.id)).toBe(true);expect(await allowed(f.guardian.id)).toBe(true);
   await sql`UPDATE school_people SET retired_at=${f.now}::timestamptz WHERE school_id=${f.schoolId}::uuid AND id=${f.studentPerson.id}::uuid`.execute(db);
   expect(await allowed(f.learner.id)).toBe(false);
   const endpoint=await db.selectFrom('campus_model_agent_endpoints').select('revision').where('id','=',f.guardianLink.endpoint_id).executeTakeFirstOrThrow();
   await db.transaction().execute(tx=>f.core.closeAccountEndpoint(tx,{school_id:f.schoolId,endpoint_id:f.guardianLink.endpoint_id,actor_user_id:f.owner.id,
     expected_revision:endpoint.revision,effective_at:f.now,disposition:'revoked',reason:'End this isolated guardian endpoint.',source_domain:'people',source_record_id:f.parent.id,
     source_revision:2,idempotency_key:randomUUID()}));
   expect(await allowed(f.guardian.id)).toBe(false);
  });
 },120000);
 it.skipIf(!target)('changes one actual captured COW schedule/context and leaves Live plus sibling unchanged, including cross-day canonical dates',async()=>{
  const f=await examAmendmentFixture(db),store=new SimulationSnapshotStore(sourceUrl,requireIsolatedTestDatabaseUrl(target),2),opened:Kysely<Database>[]=[];
  try{
   const captured=await f.sitting(),snapshot=await store.capture(f.schoolId,f.now),liveRows=await observations(db,f.schoolId,captured.id);
   const open=async()=>{const run=randomUUID(),scenario=randomUUID(),namespace=`scenario:${scenario}:run:${run}`;
    const branch=await createSimulationBranch(store.pool,snapshot,{run_id:run,school_id:f.schoolId,scenario_id:scenario,namespace_id:namespace}),driver=new SimulationBranchDriver(store.pool,branch,snapshot),compiler=new PostgresDialect({pool:store.pool});
    const connection=new Kysely<Database>({dialect:{createDriver:()=>driver,createAdapter:()=>compiler.createAdapter(),createQueryCompiler:()=>compiler.createQueryCompiler(),createIntrospector:connection=>compiler.createIntrospector(connection)}}) as DatabaseService;
    opened.push(connection);const selected=simulationRequestEnvironment({institution_id:f.schoolId,scenario_id:scenario,run_id:run,virtual_now:f.now,source_snapshot_ref:`sha256:${snapshot.content_hash}`,manifest_ref:'exam-amendment-isolation-test',checked_at:f.now});
    const services=examAmendmentServices(connection);return {connection,...services,run:<T>(work:()=>Promise<T>)=>services.scope.run(selected,()=>executionEnvironmentStorage.run(selected,work))};};
   const branch=await open(),sibling=await open();
   await branch.run(async()=>{
    const p=await proposed(f,branch.operations,branch.connection,86400000);expect(p.preview.can_publish).toBe(true);
    const result=await branch.operations.amendSchedule(f.owner,f.schoolId,f.assessment.id,p.command);expect(result).toMatchObject({schedule_state:'awaiting_confirmation'});
    const rows=await observations(branch.connection,f.schoolId,captured.id);expect(rows[0]!.local_date).toBe(p.input.scheduled_at.slice(0,10));expect(rows[0]!.occurrence_id).toBe(liveRows[0]!.occurrence_id);
    expect((rows[0]!.context_snapshot as {context:{date:string}}).context.date).toBe(p.input.scheduled_at.slice(0,10));
   });
   expect(await f.sitting()).toEqual(captured);expect(await observations(db,f.schoolId,captured.id)).toEqual(liveRows);
   expect(await sibling.run(()=>observations(sibling.connection,f.schoolId,captured.id))).toEqual(liveRows);
  }finally{for(const connection of opened)await connection.destroy();await store.pool.end();}
 },120000);
});
