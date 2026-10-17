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
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated=process.env.TEST_DATABASE_ISOLATED==="true";
const databaseUrl=isolated?requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL):"postgresql://invalid.invalid/unused";
const pool=new Pool({connectionString:databaseUrl,max:2});
const suite=isolated?describe:describe.skip;
const day=(value:Date)=>value.toISOString().slice(0,10);

suite("offline assessment and result lifecycle",()=>{
  let database:DatabaseService;let service:AssessmentsService;let examOperations:ExamOperationsService;let schoolId:string;let termId:string;let classId:string;let subjectId:string;let studentId:string;let spaceId:string;
  let admin:AuthUser;let examiner:AuthUser;let moderator:AuthUser;let guardian:AuthUser;let assessmentId:string;
  const user=(row:any):AuthUser=>({...row,is_active:true,active_school_id:schoolId});

  beforeAll(async()=>{
    database=new DatabaseService();const events=new SchoolEventService(database);const bridge=new AssessmentModelBridgeService({recordAcceptedChange:vi.fn().mockResolvedValue({})} as unknown as CampusModelCorePort);
    const invigilationOffers={publishOffer:vi.fn().mockResolvedValue({}),cancelOpenOffer:vi.fn().mockResolvedValue(null),retainedResponseCommand:vi.fn().mockResolvedValue(null),currentResponseBinding:vi.fn().mockImplementation((_transaction,input)=>Promise.resolve({binding_id:randomUUID(),message_id:randomUUID(),correlation_id:randomUUID(),source_assignment_revision:input.assignment_revision,selected_user_id:input.selected_user_id,behaviour_version_id:randomUUID(),subscription_id:randomUUID(),response_due_at:new Date(Date.now()+3_600_000).toISOString(),expires_at:new Date(Date.now()+7_200_000).toISOString()})),recordResponse:vi.fn().mockResolvedValue({})} as unknown as AssessmentInvigilationOfferBridgeService;
    examOperations=new ExamOperationsService(database,events,bridge,invigilationOffers);service=new AssessmentsService(database,events,examOperations);const suffix=randomUUID();
    await pool.query(`INSERT INTO institution_capability_packs(code,label,description,institution_kinds,cohort_label,learner_label,default_subject_names,requires_staff)
      VALUES('india_school_core','Indian school core','Test capability pack',ARRAY['school'],'Class','Student',ARRAY['English'],true) ON CONFLICT DO NOTHING`);
    const users=(await pool.query(`INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES
      ($1,$2,'x','Admin','One','admin'),($3,$4,'x','Examiner','One','staff'),($5,$6,'x','Moderator','One','staff'),($7,$8,'x','Guardian','One','parent') RETURNING *`,[
      `assessment.admin.${suffix}`,`assessment.admin.${suffix}@example.test`,`assessment.examiner.${suffix}`,`assessment.examiner.${suffix}@example.test`,`assessment.moderator.${suffix}`,`assessment.moderator.${suffix}@example.test`,`assessment.guardian.${suffix}`,`assessment.guardian.${suffix}@example.test`
    ])).rows;
    const school=(await pool.query("INSERT INTO schools(name,code) VALUES('Assessment Test',$1) RETURNING id",[`assess-${suffix.slice(0,12)}`])).rows[0];schoolId=school.id;
    const mappedUsers=users.map(user);
    admin=mappedUsers[0]!;examiner=mappedUsers[1]!;moderator=mappedUsers[2]!;guardian=mappedUsers[3]!;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$5,'admin'),($2,$5,'staff'),($3,$5,'staff'),($4,$5,'guardian')",[admin.id,examiner.id,moderator.id,guardian.id,schoolId]);
    const assessmentProfile=(await pool.query("INSERT INTO school_custom_roles(school_id,name,description,created_by) VALUES($1,'Assessment staff','Eligible for examiner and moderation assignments',$2) RETURNING id",[schoolId,admin.id])).rows[0].id;
    await pool.query(`INSERT INTO school_custom_role_duties(school_id,role_id,responsibility_type_id)
      SELECT $1,$2,id FROM staff_responsibility_types WHERE school_id=$1 AND code IN ('internal_examiner','exam_in_charge')`,[schoolId,assessmentProfile]);
    await pool.query(`INSERT INTO school_custom_role_assignments(school_id,user_id,role_id,assigned_by,is_primary)
      VALUES($1,$2,$4,$5,true),($1,$3,$4,$5,true)`,[schoolId,examiner.id,moderator.id,assessmentProfile,admin.id]);
    const today=new Date();const yesterday=new Date(today.getTime()-86400000);const later=new Date(today.getTime()+30*86400000);
    termId=(await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'current','Term 1',$2,$3) RETURNING id",[schoolId,day(yesterday),day(later)])).rows[0].id;
    classId=(await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'current','7','A') RETURNING id",[schoolId])).rows[0].id;
    subjectId=(await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'ENG','English','English') RETURNING id",[schoolId])).rows[0].id;
    await pool.query(`INSERT INTO class_section_staff_assignments(school_id,class_section_id,user_id,role,subject_id,valid_from,valid_until,assigned_by)
      VALUES($1,$2,$3,'subject_teacher',$4,$5,$6,$7)`,[schoolId,classId,examiner.id,subjectId,day(yesterday),day(later),admin.id]);
    const person=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Learner','One') RETURNING id",[schoolId])).rows[0];
    studentId=(await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'A-001') RETURNING id",[schoolId,person.id])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,$4)",[studentId,classId,termId,day(yesterday)]);
    const campusId=(await pool.query("INSERT INTO institution_campuses(school_id,name,code,campus_type,is_primary,created_by,updated_by) VALUES($1,'Main campus','MAIN','main',true,$2,$2) RETURNING id",[schoolId,admin.id])).rows[0].id;
    spaceId=(await pool.query("INSERT INTO campus_spaces(school_id,campus_id,name,code,kind,capacity,created_by,updated_by) VALUES($1,$2,'Exam hall','EXAM-HALL','auditorium',50,$3,$3) RETURNING id",[schoolId,campusId,admin.id])).rows[0].id;
    const parentId=(await pool.query("INSERT INTO parents(user_id,phone) VALUES($1,'9000000000') RETURNING id",[guardian.id])).rows[0].id;
    const guardianPerson=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Guardian','One') RETURNING id",[schoolId])).rows[0].id;
    await pool.query("INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)",[schoolId,parentId,guardianPerson]);
    await pool.query("INSERT INTO guardian_relationships(school_id,guardian_id,student_id,relationship,is_primary) VALUES($1,$2,$3,'guardian',true)",[schoolId,parentId,studentId]);
  });

  afterAll(async()=>{
    if(schoolId){
      const userIds=[admin?.id,examiner?.id,moderator?.id,guardian?.id].filter(Boolean);
      await pool.query("DELETE FROM notifications WHERE recipient_id=ANY($1::uuid[])",[userIds]);
      await pool.query("DELETE FROM event_outbox WHERE school_id=$1",[schoolId]);
      for(const table of ["assessment_operation_audits","assessment_sitting_incidents","assessment_candidate_attendance","assessment_sitting_candidates","assessment_sitting_invigilators","assessment_sittings"]){
        await pool.query(`DELETE FROM ${table} WHERE school_id=$1`,[schoolId]);
      }
      for(const table of ["assessment_publication_results","assessment_publications","assessment_evidence","assessment_result_revisions","assessment_results","assessment_staff_assignments","assessment_audits","assessments","assessment_cycles"]){
        await pool.query(`DELETE FROM ${table} WHERE school_id=$1`,[schoolId]);
      }
      await pool.query("DELETE FROM guardian_relationships WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM guardian_school_profiles WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM enrollments WHERE student_id IN(SELECT id FROM students WHERE school_id=$1)",[schoolId]);
      await pool.query("DELETE FROM students WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM class_section_staff_assignments WHERE school_id=$1",[schoolId]);
      await pool.query("DELETE FROM parents WHERE user_id=ANY($1::uuid[])",[userIds]);
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
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[userIds]);
    }
    await database?.destroy();await pool.end();
  });

  it("keeps teacher-planned class tests inside assigned assessment scope and principal review",async()=>{
    const now=new Date();const scheduledAt=new Date(now.getTime()+86400000);
    const cycle=await service.createCycle(admin,schoolId,{term_id:termId,name:"Class tests",code:"CLASS-TEST",starts_on:day(now),ends_on:day(new Date(now.getTime()+15*86400000)),result_label:"Class test result"});
    const workspace=await service.workspace(examiner,schoolId);
    expect(workspace).toMatchObject({mode:"staff",can_plan_class_test:true,planner_user_id:examiner.id});
    expect("references" in workspace ? workspace.references.classes : []).toEqual([expect.objectContaining({id:classId})]);
    const input={cycle_id:cycle.id,class_section_id:classId,subject_id:subjectId,title:"English vocabulary test",assessment_kind:"class_test",maximum_marks:20,weight_percent:null,scheduled_at:scheduledAt.toISOString(),duration_minutes:40,venue:"Room 7A",instructions:"Offline written test",evidence_requirement:"optional",examiner_user_id:examiner.id,moderator_user_id:admin.id};
    const planned=await service.createAssessment(examiner,schoolId,input);
    expect(planned).toMatchObject({assessment_kind:"class_test",status:"draft",created_by:examiner.id});
    await expect(service.createAssessment(examiner,schoolId,{...input,title:"Not permitted exam",assessment_kind:"exam"})).rejects.toThrow(/class tests only/i);
    await expect(service.createAssessment(examiner,schoolId,{...input,title:"Self reviewed test",moderator_user_id:examiner.id})).rejects.toThrow(/different people/i);
  });

  it("keeps marking, moderation, publication and correction as separate states",async()=>{
    const now=new Date();const scheduledAt=new Date(now.getTime()+20*60_000);
    const cycle=await service.createCycle(admin,schoolId,{term_id:termId,name:"Term 1 examinations",code:"T1",starts_on:day(now),ends_on:day(new Date(now.getTime()+7*86400000)),result_label:"Term result"});
    const assessment=await service.createAssessment(admin,schoolId,{cycle_id:cycle.id,class_section_id:classId,subject_id:subjectId,title:"English paper",assessment_kind:"exam",maximum_marks:80,weight_percent:30,scheduled_at:scheduledAt.toISOString(),duration_minutes:90,venue:"Hall",instructions:"Offline written paper",evidence_requirement:"optional",examiner_user_id:examiner.id,moderator_user_id:moderator.id,space_id:spaceId,invigilator_user_ids:[examiner.id]});
    assessmentId=assessment.id;
    const offer=(await pool.query("SELECT id,revision FROM assessment_sitting_invigilators WHERE assessment_id=$1 AND user_id=$2",[assessmentId,examiner.id])).rows[0];
    await examOperations.respondInvigilator(examiner,schoolId,assessmentId,offer.id,{command_id:randomUUID(),expected_revision:offer.revision,decision:"accepted",note:"Duty accepted"});
    let state=await service.action(admin,schoolId,assessmentId,"schedule",{expected_revision:assessment.revision,note:"Schedule confirmed"});
    const operation=await examOperations.detail(examiner,schoolId,assessmentId);
    const started=await examOperations.start(examiner,schoolId,assessmentId,{expected_revision:operation.sitting!.revision});
    const attendance=await examOperations.recordAttendance(examiner,schoolId,assessmentId,{expected_revision:started.sitting.revision,records:[{student_id:studentId,status:"present",note:"Identity checked",expected_revision:1}]});
    await examOperations.complete(examiner,schoolId,assessmentId,{expected_revision:attendance.sitting_revision});
    state=await service.action(admin,schoolId,assessmentId,"open-marking",{expected_revision:state.revision,note:"Paper completed"});
    let detail=await service.detail(examiner,schoolId,assessmentId);expect(detail.results).toHaveLength(1);expect(detail.results[0]).toMatchObject({outcome:"unrecorded",first_name:"Learner"});
    state=await service.recordResults(examiner,schoolId,assessmentId,{expected_assessment_revision:state.revision,results:[{result_id:(detail.results[0] as any).id,outcome:"scored",marks:64,grade:"A",feedback:"Clear written work",expected_revision:(detail.results[0] as any).revision,reason:"Initial marks entry"}]});
    state=await service.action(examiner,schoolId,assessmentId,"submit",{expected_revision:state.revision,note:"Register complete"});
    await expect(service.action(examiner,schoolId,assessmentId,"approve",{expected_revision:state.revision,note:"Trying self approval"})).rejects.toThrow(/moderator|assessments\.moderate/i);
    state=await service.action(moderator,schoolId,assessmentId,"approve",{expected_revision:state.revision,note:"Checked against paper totals"});
    state=await service.action(admin,schoolId,assessmentId,"publish",{expected_revision:state.revision,note:"First moderated release"});expect(state.status).toBe("published");
    const first=await service.familyResults(guardian,schoolId,studentId);expect(first.results[0]).toMatchObject({marks:"64.00",sequence:1,grade:"A",term_name:"Term 1",academic_year:"current"});

    detail=await service.detail(examiner,schoolId,assessmentId);
    state=await service.recordResults(examiner,schoolId,assessmentId,{expected_assessment_revision:state.revision,results:[{result_id:(detail.results[0] as any).id,outcome:"scored",marks:66,grade:"A",feedback:"Total corrected after recount",expected_revision:(detail.results[0] as any).revision,reason:"Verified addition correction"}]});
    expect(state.status).toBe("marking");
    state=await service.action(examiner,schoolId,assessmentId,"submit",{expected_revision:state.revision,note:"Correction ready"});
    state=await service.action(moderator,schoolId,assessmentId,"approve",{expected_revision:state.revision,note:"Correction independently checked"});
    await service.action(admin,schoolId,assessmentId,"publish",{expected_revision:state.revision,note:"Corrected moderated release"});
    const corrected=await service.familyResults(guardian,schoolId,studentId);expect(corrected.results[0]).toMatchObject({marks:"66.00",sequence:2});
    const publications=await pool.query("SELECT sequence FROM assessment_publications WHERE assessment_id=$1 ORDER BY sequence",[assessmentId]);expect(publications.rows.map((row)=>row.sequence)).toEqual([1,2]);
    const events=await pool.query<{event_type:string;audience_user_ids:string[];payload:{action:string;status:string;revision:number}}>("SELECT event_type,audience_user_ids,payload FROM event_outbox WHERE aggregate_type='assessment' AND aggregate_id=$1 ORDER BY sequence",[assessmentId]);
    expect(events.rows.map((row)=>row.event_type)).toEqual(Array(10).fill("assessment.updated"));
    expect(events.rows.map((row)=>row.payload.action)).toEqual(["schedule","open-marking","results-recorded","submit","approve","publish","correction-started","submit","approve","publish"]);
    expect(events.rows[1]!.audience_user_ids).toEqual(expect.arrayContaining([admin.id,examiner.id,moderator.id]));
    expect(events.rows[1]!.audience_user_ids).not.toContain(guardian.id);
    expect(events.rows.at(-1)!.audience_user_ids).toEqual(expect.arrayContaining([admin.id,examiner.id,moderator.id,guardian.id]));
    const runtimeAuthorization=await pool.query<{examiner_before_publish:boolean;guardian_before_publish:boolean;guardian_on_publish:boolean}>(`SELECT
      event_user_is_authorized($1,'assessment.updated',$2::jsonb,$3) AS examiner_before_publish,
      event_user_is_authorized($1,'assessment.updated',$2::jsonb,$4) AS guardian_before_publish,
      event_user_is_authorized($1,'assessment.updated',$5::jsonb,$4) AS guardian_on_publish`,[
      schoolId,JSON.stringify(events.rows[1]!.payload),examiner.id,guardian.id,JSON.stringify(events.rows.at(-1)!.payload),
    ]);
    expect(runtimeAuthorization.rows[0]).toEqual({examiner_before_publish:true,guardian_before_publish:false,guardian_on_publish:true});
  });

  it("does not expose another institution's learner",async()=>{
    const other=(await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Other','Learner') RETURNING id",[schoolId])).rows[0];
    const otherStudent=(await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'A-002') RETURNING id",[schoolId,other.id])).rows[0];
    await expect(service.familyResults(guardian,schoolId,otherStudent.id)).rejects.toThrow(/cannot view/i);
  });
});
