import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AssessmentModelBridgeService } from "../src/assessments/assessment-model-bridge.service.js";
import type { AssessmentInvigilationOfferBridgeService } from "../src/assessments/assessment-invigilation-offer-bridge.service.js";
import { ExamOperationsService } from "../src/assessments/exam-operations.service.js";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import type { CampusModelCorePort } from "../src/campus-model-core/campus-model-core.port.js";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { RequestsService } from "../src/requests/requests.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated=process.env.TEST_DATABASE_ISOLATED==="true";
const databaseUrl=isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/unused";
const pool=new Pool({connectionString:databaseUrl,max:2});
const suite=isolated?describe:describe.skip;

const date=(value:Date)=>value.toISOString().slice(0,10);

suite("physical examination-day operations",()=>{
  let database:DatabaseService;let assessments:AssessmentsService;let operations:ExamOperationsService;let requests:RequestsService;
  let schoolId:string;let termId:string;let classId:string;let subjectId:string;let studentId:string;let campusId:string;
  let admin:AuthUser;let examiner:AuthUser;let moderator:AuthUser;let invigilator:AuthUser;
  const users:string[]=[];
  const recordAcceptedChange=vi.fn().mockResolvedValue({});

  beforeAll(async()=>{
    database=new DatabaseService();const events=new SchoolEventService(database);
    const modelBridge=new AssessmentModelBridgeService({recordAcceptedChange} as unknown as CampusModelCorePort);
    const invigilationOffers={
      publishOffer:vi.fn().mockResolvedValue({}),cancelOpenOffer:vi.fn().mockResolvedValue(null),
      retainedResponseCommand:vi.fn().mockResolvedValue(null),
      currentResponseBinding:vi.fn().mockImplementation((_transaction,input)=>Promise.resolve({
        binding_id:randomUUID(),message_id:randomUUID(),correlation_id:randomUUID(),
        source_assignment_revision:input.assignment_revision,selected_user_id:input.selected_user_id,
        behaviour_version_id:randomUUID(),subscription_id:randomUUID(),
        response_due_at:new Date(Date.now()+3_600_000).toISOString(),expires_at:new Date(Date.now()+7_200_000).toISOString(),
      })),
      recordResponse:vi.fn().mockResolvedValue({}),
    } as unknown as AssessmentInvigilationOfferBridgeService;
    operations=new ExamOperationsService(database,events,modelBridge,invigilationOffers);assessments=new AssessmentsService(database,events,operations);requests=new RequestsService(database);
    const suffix=randomUUID();
    const inserted=(await pool.query(`INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES
      ($1,$2,'x','Admin','Exam','admin'),($3,$4,'x','Examiner','Exam','staff'),
      ($5,$6,'x','Moderator','Exam','staff'),($7,$8,'x','Invigilator','Exam','staff') RETURNING *`,[
      `exam.ops.admin.${suffix}`,`exam.ops.admin.${suffix}@example.test`,`exam.ops.examiner.${suffix}`,`exam.ops.examiner.${suffix}@example.test`,
      `exam.ops.moderator.${suffix}`,`exam.ops.moderator.${suffix}@example.test`,`exam.ops.invigilator.${suffix}`,`exam.ops.invigilator.${suffix}@example.test`,
    ])).rows;
    users.push(...inserted.map(row=>row.id));
    schoolId=(await pool.query("INSERT INTO schools(name,code) VALUES('Exam Operations',$1) RETURNING id",[`exam-ops-${suffix.slice(0,12)}`])).rows[0].id;
    const auth=(row:any):AuthUser=>({...row,is_active:true,active_school_id:schoolId});
    [admin,examiner,moderator,invigilator]=inserted.map(auth) as [AuthUser,AuthUser,AuthUser,AuthUser];
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$5,'admin'),($2,$5,'staff'),($3,$5,'staff'),($4,$5,'staff')",[admin.id,examiner.id,moderator.id,invigilator.id,schoolId]);
    const roleId=(await pool.query("INSERT INTO school_custom_roles(school_id,name,description,created_by) VALUES($1,'Exam leads','Assessment test role',$2) RETURNING id",[schoolId,admin.id])).rows[0].id;
    await pool.query("INSERT INTO school_custom_role_duties(school_id,role_id,responsibility_type_id) SELECT $1,$2,id FROM staff_responsibility_types WHERE school_id=$1 AND code IN ('internal_examiner','exam_in_charge')",[schoolId,roleId]);
    await pool.query("INSERT INTO school_custom_role_assignments(school_id,user_id,role_id,assigned_by,is_primary) VALUES($1,$2,$4,$5,true),($1,$3,$4,$5,true)",[schoolId,examiner.id,moderator.id,roleId,admin.id]);
    const now=new Date();const yesterday=new Date(now.getTime()-86400000);const later=new Date(now.getTime()+30*86400000);
    termId=(await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'current','Term', $2,$3) RETURNING id",[schoolId,date(yesterday),date(later)])).rows[0].id;
    classId=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'current','10','A') RETURNING id",[schoolId])).rows[0].id;
    subjectId=(await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'MATH','Mathematics','Maths') RETURNING id",[schoolId])).rows[0].id;
    const personId=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Candidate','One') RETURNING id",[schoolId])).rows[0].id;
    studentId=(await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'E-001') RETURNING id",[schoolId,personId])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,$4)",[studentId,classId,termId,date(yesterday)]);
    campusId=(await pool.query("INSERT INTO institution_campuses(school_id,name,code,campus_type,is_primary,created_by,updated_by) VALUES($1,'Main campus','MAIN','main',true,$2,$2) RETURNING id",[schoolId,admin.id])).rows[0].id;
  });

  afterAll(async()=>{
    if(schoolId){
      await pool.query("DELETE FROM event_outbox WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM assessment_operation_audits WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM assessment_sitting_incidents WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM assessment_candidate_attendance WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM assessment_sitting_candidates WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM assessment_sitting_invigilators WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM assessment_sittings WHERE school_id=$1",[schoolId]);
      for(const table of ["assessment_results","assessment_staff_assignments","assessment_audits","assessments","assessment_cycles"]) await pool.query(`DELETE FROM ${table} WHERE school_id=$1`,[schoolId]);
      await pool.query("DELETE FROM timetable_slots WHERE class_section_id=$1",[classId]);
      await pool.query("DELETE FROM enrollments WHERE student_id=$1",[studentId]);
      await pool.query("DELETE FROM students WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM school_people WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM school_custom_role_assignments WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM school_custom_roles WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM school_memberships WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM campus_spaces WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM institution_campuses WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM subjects WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM class_sections WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM academic_terms WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM schools WHERE id=$1",[schoolId]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[users]);
    }
    await database?.destroy();await pool.end();
  });

  it("freezes the roster, records factual attendance and opens marking without deriving outcomes",async()=>{
    const savedPolicy=await operations.savePolicy(admin,schoolId,{readiness_minutes_before:60,attendance_close_after_minutes:60,minimum_invigilators:1,require_all_candidate_attendance:true,post_completion_marking_mode:"automatic",expected_revision:1});
    expect(savedPolicy).toMatchObject({revision:2,post_completion_marking_mode:"automatic"});
    const cycle=await assessments.createCycle(admin,schoolId,{term_id:termId,name:"Term examination",code:"TERM-EXAM",starts_on:date(new Date()),ends_on:date(new Date(Date.now()+7*86400000)),result_label:"Result"});
    const spaceId=(await pool.query("INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,capacity,created_by,updated_by) VALUES($1,$2,'Examination hall','EXAM-HALL','auditorium',50,$3,$3) RETURNING id",[schoolId,campusId,admin.id])).rows[0].id;
    const startsAt=new Date(Date.now()+20*60_000).toISOString();
    const created=await assessments.createAssessment(admin,schoolId,{cycle_id:cycle.id,class_section_id:classId,subject_id:subjectId,title:"Mathematics paper",assessment_kind:"exam",maximum_marks:80,weight_percent:30,scheduled_at:startsAt,duration_minutes:90,venue:"Legacy hall label",instructions:"Written paper",evidence_requirement:"optional",examiner_user_id:examiner.id,moderator_user_id:moderator.id,space_id:spaceId,invigilator_user_ids:[invigilator.id]});
    expect(created).toMatchObject({status:"draft",sitting:{state:"planning",space_id:spaceId}});
    const offer=(await pool.query("SELECT * FROM assessment_sitting_invigilators WHERE assessment_id=$1",[created.id])).rows[0];
    const offeredRequests=await requests.inbox(invigilator,{portal:"teacher"});
    expect(offeredRequests.items).toContainEqual(expect.objectContaining({
      kind:"assessment_invigilation",source_id:offer.id,title:"Mathematics paper",
      status_label:"Invigilation response needed",action_label:"Review duty",
      href:`/teacher/assessments?assessment=${created.id}`,
    }));
    await operations.respondInvigilator(invigilator,schoolId,created.id,offer.id,{command_id:randomUUID(),expected_revision:offer.revision,decision:"accepted",note:"Duty accepted"});
    expect((await requests.inbox(invigilator,{portal:"teacher"})).items.some(item=>item.kind==="assessment_invigilation"&&item.source_id===offer.id)).toBe(false);
    const scheduled=await assessments.action(admin,schoolId,created.id,"schedule",{expected_revision:created.revision,note:"Ready"});
    expect(scheduled.status).toBe("scheduled");
    const operation=await operations.detail(invigilator,schoolId,created.id);
    expect(operation).toMatchObject({sitting:{state:"ready"},space:{name:"Examination hall"},attendance_counts:{total:1,unrecorded:1},viewer_assignment:{status:"accepted"}});
    const started=await operations.start(invigilator,schoolId,created.id,{expected_revision:operation.sitting!.revision});
    const attendance=await operations.recordAttendance(invigilator,schoolId,created.id,{expected_revision:started.sitting.revision,records:[{student_id:studentId,status:"present",note:"Identity checked",expected_revision:1}]});
    const incident=await operations.createIncident(invigilator,schoolId,created.id,{expected_revision:attendance.sitting_revision,student_id:studentId,category:"materials",severity:"minor",summary:"Replacement answer booklet issued"});
    await operations.resolveIncident(invigilator,schoolId,created.id,incident.incident.id,{expected_revision:incident.incident.revision,resolution:"Original damaged booklet retained"});
    const completed=await operations.complete(invigilator,schoolId,created.id,{expected_revision:incident.sitting_revision});
    expect(completed).toMatchObject({sitting:{state:"completed"},assessment_status:"marking"});
    const result=(await pool.query("SELECT outcome,marks FROM assessment_results WHERE assessment_id=$1 AND student_id=$2",[created.id,studentId])).rows[0];
    expect(result).toEqual({outcome:"unrecorded",marks:null});
    const detail=await assessments.detail(examiner,schoolId,created.id);
    expect(detail).toMatchObject({assessment:{venue:"Examination hall"},exam_operation:{sitting:{state:"completed"},attendance_counts:{present:1}}});
    expect(recordAcceptedChange.mock.calls.map(call=>call[1].command_type)).toEqual([
      "examination.sitting.plan",
      "examination.sitting.start",
      "examination.attendance.record",
      "examination.incident.report",
      "examination.incident.resolve",
      "examination.sitting.complete",
    ]);

    const second=await assessments.createAssessment(admin,schoolId,{cycle_id:cycle.id,class_section_id:classId,subject_id:subjectId,title:"Mathematics practical",assessment_kind:"practical",maximum_marks:20,weight_percent:10,scheduled_at:startsAt,duration_minutes:45,venue:"Legacy hall label",instructions:"Practical",evidence_requirement:"optional",examiner_user_id:examiner.id,moderator_user_id:moderator.id,space_id:spaceId,invigilator_user_ids:[invigilator.id]});
    const firstCandidate=(await pool.query("SELECT id FROM assessment_sitting_candidates WHERE sitting_id=$1",[operation.sitting!.id])).rows[0].id;
    const secondSitting=(await pool.query("SELECT id FROM assessment_sittings WHERE assessment_id=$1",[second.id])).rows[0].id;
    await expect(pool.query(`INSERT INTO assessment_sitting_incidents(school_id,sitting_id,candidate_id,student_id,category,severity,summary,observed_at,recorded_by)
      VALUES($1,$2,$3,$4,'other','info','Cross-sitting candidate must fail',now(),$5)`,[schoolId,secondSitting,firstCandidate,studentId,invigilator.id])).rejects.toMatchObject({code:"23503"});
  });

  it("explains and enforces class, room and invigilator conflicts from the effective timetable",async()=>{
    const cycle=await assessments.createCycle(admin,schoolId,{term_id:termId,name:"Conflict examination",code:"CONFLICT-EXAM",starts_on:date(new Date()),ends_on:date(new Date(Date.now()+7*86400000)),result_label:"Result"});
    const spaceId=(await pool.query("INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,capacity,created_by,updated_by) VALUES($1,$2,'Conflict hall','CONFLICT-HALL','auditorium',50,$3,$3) RETURNING id",[schoolId,campusId,admin.id])).rows[0].id;
    const startsAt=(await pool.query("SELECT (((now() AT TIME ZONE timezone)::date+2+time '10:00') AT TIME ZONE timezone) AS starts_at FROM schools WHERE id=$1",[schoolId])).rows[0].starts_at.toISOString();
    const slotId=(await pool.query(`INSERT INTO timetable_slots(
        class_section_id,term_id,subject_id,weekday,period_number,starts_at,ends_at,
        slot_type,title,room,teacher_user_id,teacher_designation,space_id,updated_by
      ) SELECT $1,$2,$3,extract(isodow FROM ($4::timestamptz AT TIME ZONE school.timezone))::smallint,
        23,time '09:30',time '10:30','class','Scheduled Mathematics','CONFLICT-HALL',$5,
        'Teacher',$6,$7 FROM schools school WHERE school.id=$8 RETURNING id`,[classId,termId,subjectId,startsAt,invigilator.id,spaceId,admin.id,schoolId])).rows[0].id;
    const created=await assessments.createAssessment(admin,schoolId,{cycle_id:cycle.id,class_section_id:classId,subject_id:subjectId,title:"Timetable-aware paper",assessment_kind:"exam",maximum_marks:40,weight_percent:10,scheduled_at:startsAt,duration_minutes:60,venue:"Conflict hall",instructions:"Written paper",evidence_requirement:"optional",examiner_user_id:examiner.id,moderator_user_id:moderator.id,space_id:spaceId,invigilator_user_ids:[invigilator.id]});
    const offer=(await pool.query("SELECT * FROM assessment_sitting_invigilators WHERE assessment_id=$1",[created.id])).rows[0];
    await operations.respondInvigilator(invigilator,schoolId,created.id,offer.id,{command_id:randomUUID(),expected_revision:offer.revision,decision:"accepted",note:"Duty accepted"});

    const readiness=await operations.readiness(admin,schoolId,created.id);
    expect(readiness.can_schedule).toBe(false);
    expect(readiness.blockers.map(blocker=>blocker.code)).toEqual(expect.arrayContaining(["class_timetable","room_timetable","invigilator_timetable"]));
    await expect(assessments.action(admin,schoolId,created.id,"schedule",{expected_revision:created.revision,note:"Ready"})).rejects.toThrow(/readiness issues before scheduling/i);

    const revisedStart=new Date(new Date(startsAt).getTime()+2*60*60_000).toISOString();
    const sitting=(await pool.query("SELECT * FROM assessment_sittings WHERE assessment_id=$1",[created.id])).rows[0];
    const revised=await operations.updateArrangements(admin,schoolId,created.id,{expected_assessment_revision:created.revision,expected_sitting_revision:sitting.revision,scheduled_at:revisedStart,duration_minutes:60,space_id:spaceId,invigilator_user_ids:[invigilator.id]});
    expect(revised).toMatchObject({assessment:{revision:created.revision+1},sitting:{revision:sitting.revision+1,space_id:spaceId}});
    const revisedOffer=(await pool.query("SELECT * FROM assessment_sitting_invigilators WHERE assessment_id=$1 AND user_id=$2",[created.id,invigilator.id])).rows[0];
    expect(revisedOffer).toMatchObject({status:"offered",response_note:""});
    expect((await operations.readiness(admin,schoolId,created.id)).blockers.map(blocker=>blocker.code)).toEqual(["invigilators"]);
    await operations.respondInvigilator(invigilator,schoolId,created.id,revisedOffer.id,{command_id:randomUUID(),expected_revision:revisedOffer.revision,decision:"accepted",note:"Revised duty accepted"});
    const clear=await operations.readiness(admin,schoolId,created.id);
    expect(clear).toMatchObject({can_schedule:true,candidate_count:1,room_capacity:50,accepted_invigilator_count:1,timetable_contract:"effective_school_schedule_v4"});
    await pool.query("DELETE FROM timetable_slots WHERE id=$1",[slotId]);
  });
});
