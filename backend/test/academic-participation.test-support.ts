import { sql, type Transaction } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../src/common/request.js';
import { executionNow } from '../src/campus-model-core/execution-time.runtime.js';
import { ActivityAttendanceService } from '../src/attendance/activity-attendance.service.js';
import { AcademicParticipationBridge } from '../src/attendance/academic-participation-bridge.service.js';
import { AcademicParticipationEffects } from '../src/attendance/academic-participation-effects.service.js';
import { AttendanceModelService } from '../src/attendance-model/attendance-model.service.js';
import { CampusModelCoreService } from '../src/campus-model-core/campus-model-core.service.js';
import type { DatabaseService } from '../src/database/database.service.js';
import type { Database } from '../src/database/types.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { SchoolService } from '../src/school/school.service.js';
import { createStaffCoverageReconciliationTestDouble } from './staff-coverage-reconciliation.test-support.js';

/** Keep all normal service transactions inside a rollback-only test fixture. */
export function fixtureTransactionDatabase(transaction: Transaction<Database>): DatabaseService {
  return new Proxy(transaction,{get(target,key){
    if(key==='transaction')return()=>{
      const nested={execute:<T>(callback:(tx:Transaction<Database>)=>Promise<T>)=>callback(target),setIsolationLevel:()=>nested};
      return nested;
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }}) as unknown as DatabaseService;
}

export async function rollbackAcademicFixture(database: DatabaseService, action: (db: DatabaseService, tx: Transaction<Database>)=>Promise<void>) {
  const rollback=new Error('rollback accepted academic test fixture');
  try {await database.transaction().execute(async tx=>{await action(fixtureTransactionDatabase(tx),tx);throw rollback;});}
  catch(error){if(error!==rollback)throw error;}
}

/** Same accepted kernel, effects and owning adapters as application requests. */
export function academicParticipationTestServices(database: DatabaseService) {
  const core=new CampusModelCoreService(database,new ExecutionDataPlaneScope()),events=new SchoolEventService(database,core);
  const kernel=new ActivityAttendanceService(database,core,core,core,core,core,undefined,core);
  const bridge=new AcademicParticipationBridge(database,kernel);
  const sessions=new AttendanceModelService(database,events,kernel,bridge,core,core);
  const school=new SchoolService(database,events,createStaffCoverageReconciliationTestDouble(),core,
    undefined,undefined,undefined,bridge);
  new AcademicParticipationEffects(kernel,school,sessions,events);
  return {core,events,kernel,bridge,sessions,school};
}

/** Explicitly fixture a real subject schedule, retaining its temporal owner evidence. */
export async function configureAcademicSubjectSessions(database: DatabaseService, core: CampusModelCoreService,
  user: AuthUser, schoolId: string, classId: string, termId: string, timezone: string) {
  const subject = await database.insertInto('subjects').values({ school_id: schoolId, code: 'ROSTER', name: 'Roster subject', short_name: 'Roster' })
    .returningAll().executeTakeFirstOrThrow();
  await database.transaction().execute(async tx => {
    await sql`UPDATE institution_operating_rules SET attendance_academic_mode='scheduled_session',revision=revision+1,updated_by=${user.id}::uuid WHERE school_id=${schoolId}::uuid`.execute(tx);
    const section = await tx.selectFrom('class_sections').selectAll().where('id','=',classId).executeTakeFirstOrThrow();
    const term = await tx.selectFrom('academic_terms').selectAll().where('id','=',termId).executeTakeFirstOrThrow();
    const slots = await tx.selectFrom('timetable_slots').selectAll().where('class_section_id','=',classId).where('term_id','=',termId).execute();
    for (const slot of slots) {
      await tx.updateTable('timetable_slots').set({ slot_type:'class',subject_id:subject.id,title:subject.name,revision:slot.revision+1 }).where('id','=',slot.id).execute();
      await core.recordLegacyTimetableSlotChange(tx,{ school_id:schoolId,actor_user_id:user.id,action:'updated',source_record_id:slot.id,
        source_revision:slot.revision+1,previous_source_revision:slot.revision,term_id:termId,starts_on:term.starts_on,ends_on:term.ends_on,
        timezone,occurred_at:executionNow().toISOString(),class_section:{kind:'class',domain:'academic_structure',domain_id:classId,
          label:section.grade,lifecycle_state:'active',source_revision:section.revision,metadata:{}},
        slot:{weekday:slot.weekday,period_number:slot.period_number,starts_at:slot.starts_at,ends_at:slot.ends_at,title:subject.name,slot_type:'class',
          teacher_user_id:user.id,subject:{kind:'subject',domain:'academic_structure',domain_id:subject.id,label:subject.name,lifecycle_state:'active',source_revision:1,metadata:{}},
          space:null,room_snapshot:''},correlation_id:randomUUID() });
    }
  });
}
