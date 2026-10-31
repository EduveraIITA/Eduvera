import { ConflictException, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { AttendanceModelService } from "../attendance-model/attendance-model.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { SchoolService } from "../school/school.service.js";
import { ActivityAttendanceService } from "./activity-attendance.service.js";

/** Same derived aggregates and current-recipient handoff from every UI adapter. */
@Injectable()
export class AcademicParticipationEffects {
  constructor(kernel: ActivityAttendanceService,school: SchoolService,sessions: AttendanceModelService,events: SchoolEventService) {
    kernel.registerAcademicEffects(async(tx,input) => {
      const source = (await sql<{source_kind:"daily_class"|"scheduled_session";source_id:string;class_id:string;term_id:string;date:string;subject_id:string|null;state:"draft"|"submitted"|"locked"}>`
        SELECT link.source_kind,link.source_id,link.context_snapshot->'context'->>'class_id' AS class_id,
          link.context_snapshot->'context'->>'term_id' AS term_id,link.context_snapshot->'context'->>'date' AS date,
          occurrence.subject_id,register.state FROM activity_attendance_source_contexts link
        JOIN activity_attendance_registers register ON register.id=link.register_id AND register.school_id=link.school_id
        JOIN schedule_activity_occurrences occurrence ON occurrence.id=register.occurrence_id AND occurrence.school_id=register.school_id
        WHERE link.register_id=${input.register_id}::uuid AND link.school_id=${input.school_id}::uuid AND link.state='active'
          AND link.source_kind IN ('daily_class','scheduled_session')`.execute(tx)).rows[0];
      if (!source) throw new ConflictException("The academic register has no active owning-domain migration context.");
      const changes = (await sql<{student_id:string;id:string;status:"present"|"absent"|"late"|"excused"|"half_day";remarks:string;previous_status:"present"|"absent"|"late"|"excused"|"half_day"|null}>`
        SELECT person.student_id,revision.entry_id AS id,revision.new_status AS status,revision.new_remarks AS remarks,revision.previous_status
        FROM activity_attendance_entry_revisions revision JOIN activity_attendance_academic_roster person
          ON person.register_id=revision.register_id AND person.person_id=revision.person_id
        WHERE revision.register_id=${input.register_id}::uuid AND revision.school_id=${input.school_id}::uuid
          AND revision.register_revision=${input.register_revision} AND revision.new_status IS NOT NULL`.execute(tx)).rows;
      if (source.source_kind==='daily_class' && changes.length) await school.refreshSubjectAttendance(tx,changes.map((row) => row.student_id));
      if (source.source_kind==='scheduled_session' && source.subject_id) await sessions.refreshSubjectAggregate(tx,input.school_id,source.term_id,source.subject_id);
      await events.enqueueAttendanceUpdates(tx,{schoolId:input.school_id,classSectionId:source.class_id,termId:source.term_id,
        date:source.date,requestId:input.request_id,...(source.source_kind==='scheduled_session' ? {sessionId:source.source_id,suppressNotifications:true}:{}),
        ...(input.operation==='approved_leave' ? {suppressNotifications:true}:{}),
        records:changes.map((row) => ({...row,revision:input.register_revision}))});
      await events.enqueueRegisterEvent(tx,{schoolId:input.school_id,classSectionId:source.class_id,termId:source.term_id,
        date:source.date,requestId:input.request_id,...(source.source_kind==='scheduled_session'?{sessionId:source.source_id}:{}),
        state:input.operation==='reopen'?'unlocked':source.state,revision:input.register_revision,actorId:input.actor_user_id,action:input.operation});
    });
  }
}
