import {randomUUID} from "node:crypto";
import {sql,type Transaction} from "kysely";
import type {AuthenticatedRequest} from "../common/request.js";
import type {Database} from "../database/types.js";
import type {SchoolEventService} from "../school/school-event.service.js";
import type {ImportJob,ImportReceipt,ImportValidation} from "./import-types.js";

export async function saveValidatedImport(db:Transaction<Database>,events:SchoolEventService,req:AuthenticatedRequest,job:ImportJob,review:ImportValidation):Promise<ImportReceipt>{
  const included=review.rows.filter(r=>r.decision==='include').map(r=>r.normalized!);
  const groups=new Map<string,{id:string;person_id:string;first_name:string;last_name:string;phone:string;email:string}>();
  for(const row of included)if(row.guardian_choice.mode==='new'&&!groups.has(row.guardian_group))groups.set(row.guardian_group,{id:randomUUID(),person_id:randomUUID(),first_name:row.guardian_first_name,last_name:row.guardian_last_name,phone:row.guardian_phone,email:row.guardian_email});
  const guardians=[...groups.values()];
  const students=included.map(row=>({...row,id:randomUUID(),person_id:randomUUID(),guardian_id:row.guardian_choice.mode==='existing'?row.guardian_choice.id:groups.get(row.guardian_group)!.id}));
  await db.insertInto("school_people").values([
    ...students.map(s=>({id:s.person_id,school_id:job.school_id,first_name:s.first_name,last_name:s.last_name,contact_phone:"",contact_email:""})),
    ...guardians.map(g=>({id:g.person_id,school_id:job.school_id,first_name:g.first_name,last_name:g.last_name,contact_phone:g.phone,contact_email:g.email})),
  ]).execute();
  if(guardians.length){
    await db.insertInto("parents").values(guardians.map(g=>({id:g.id,user_id:null,phone:g.phone}))).execute();
    await db.insertInto("guardian_school_profiles").values(guardians.map(g=>({school_id:job.school_id,guardian_id:g.id,person_id:g.person_id}))).execute();
  }
  await db.insertInto("students").values(students.map(s=>({id:s.id,school_id:job.school_id,person_id:s.person_id,user_id:null,admission_number:s.admission_number,date_of_birth:s.date_of_birth,blood_group:null,emergency_contact:null}))).execute();
  await db.insertInto("guardian_relationships").values(students.map(s=>({student_id:s.id,guardian_id:s.guardian_id,relationship:s.relationship,is_primary:true,can_authorize_leave:false}))).execute();
  await db.insertInto("enrollments").values(students.map(s=>({student_id:s.id,class_section_id:s.class_section_id,term_id:job.term_id,roll_number:s.roll_number,enrolled_on:s.enrolled_on}))).execute();
  await sql`INSERT INTO subject_attendance(student_id,subject_id,term_id)
    SELECT DISTINCT e.student_id,t.subject_id,e.term_id FROM enrollments e JOIN timetable_slots t ON t.class_section_id=e.class_section_id AND t.term_id=e.term_id
    WHERE e.student_id=ANY(${students.map(s=>s.id)}::uuid[]) AND t.slot_type='class' AND t.subject_id IS NOT NULL`.execute(db);
  const registers=(await sql<{id:string;revision:number}>`UPDATE attendance_registers SET state='draft',revision=revision+1,submitted_by=NULL,submitted_at=NULL,updated_at=now()
    WHERE id=ANY(${review.registers.filter(r=>r.state==='submitted').map(r=>r.id)}::uuid[]) AND school_id=${job.school_id}::uuid AND state='submitted' RETURNING id,revision`.execute(db)).rows;
  const auditBase={school_id:job.school_id,actor_id:req.authUser.id,request_id:req.requestId,ip_hash:null};
  await db.insertInto("audit_events").values([
    ...students.map(s=>({...auditBase,action:"people.student.enrolled",target_type:"student",target_id:s.id,metadata:{import_id:job.id,row_number:s.row_number,guardian_id:s.guardian_id,class_section_id:s.class_section_id,enrolled_on:s.enrolled_on,can_authorize_leave:false}})),
    ...registers.map(r=>({...auditBase,action:"attendance.register.roster_changed",target_type:"attendance_register",target_id:r.id,metadata:{import_id:job.id,revision:r.revision,state:"draft"}})),
    {...auditBase,action:"people.import.committed",target_type:"people_import",target_id:job.id,metadata:{students:students.length,guardians_created:guardians.length,skipped:review.summary.skipped}},
  ]).execute();
  for(const classId of [...new Set(students.map(s=>s.class_section_id))].sort()){
    const guardianIds=students.filter(s=>s.class_section_id===classId).map(s=>s.guardian_id);
    const audience=(await sql<{user_id:string}>`SELECT DISTINCT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
      WHERE m.school_id=${job.school_id}::uuid AND m.is_active AND (m.role='admin' OR
      (m.role='staff' AND EXISTS(SELECT 1 FROM timetable_slots t WHERE t.class_section_id=${classId}::uuid AND t.term_id=${job.term_id}::uuid AND t.teacher_user_id=m.user_id)) OR
      (m.role='guardian' AND EXISTS(SELECT 1 FROM parents p WHERE p.id=ANY(${guardianIds}::uuid[]) AND p.user_id=m.user_id)))`.execute(db)).rows.map(r=>r.user_id);
    await events.enqueueUserEvent(db,{schoolId:job.school_id,eventType:"people.updated",aggregateType:"class_section",aggregateId:classId,audienceUserIds:audience,
      idempotencyKey:`people-import:${job.id}:${classId}`,payload:{class_section_id:classId,term_id:job.term_id,import_id:job.id,refresh:["people","teacher.home","teacher.attendance","principal.home","principal.attendance","parent.home"]}});
  }
  await sql`UPDATE people_import_rows r SET student_id=x.student_id FROM jsonb_to_recordset(${JSON.stringify(students.map(s=>({row_number:s.row_number,student_id:s.id})))}::jsonb) AS x(row_number int,student_id uuid)
    WHERE r.import_id=${job.id}::uuid AND r.school_id=${job.school_id}::uuid AND r.row_number=x.row_number`.execute(db);
  await sql`UPDATE people_import_rows SET raw_values='{}'::jsonb,guardian_choice='{}'::jsonb WHERE import_id=${job.id}::uuid`.execute(db);
  const receipt:ImportReceipt={import_id:job.id,students:students.length,guardians_created:guardians.length,guardians_reused:review.summary.existing_guardians,skipped:review.summary.skipped,registers_reopened:registers.length,
    enrolled:students.map(s=>({row_number:s.row_number,student_id:s.id,admission_number:s.admission_number}))};
  await sql`UPDATE people_imports SET state='committed',revision=revision+1,receipt=${JSON.stringify(receipt)}::jsonb,commit_token=${review.validation_token},committed_at=now(),updated_at=now() WHERE id=${job.id}::uuid`.execute(db);
  return receipt;
}
