import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AcademicReportsService } from "../src/academic-reports/academic-reports.service.js";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused";
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const suite = isolated ? describe : describe.skip;

suite("configurable grading and immutable report cards", () => {
  let database: DatabaseService;
  let reports: AcademicReportsService;
  let assessments: AssessmentsService;
  let schoolId: string;
  let termId: string;
  let classId: string;
  let subjectId: string;
  let studentId: string;
  let admin: AuthUser;
  let reviewer: AuthUser;
  let examiner: AuthUser;
  let moderator: AuthUser;
  let guardian: AuthUser;

  beforeAll(async () => {
    database = new DatabaseService();
    const schoolEvents = new SchoolEventService(database);
    const assessmentCore = new CampusModelCoreService(database);
    reports = new AcademicReportsService(database, schoolEvents, assessmentCore, assessmentCore);
    assessments = new AssessmentsService(database, schoolEvents, undefined, assessmentCore, assessmentCore);
    const suffix = randomUUID();
    await pool.query(`INSERT INTO institution_capability_packs(code,label,description,institution_kinds,cohort_label,learner_label,default_subject_names,requires_staff)
      VALUES('india_school_core','Indian school core','Test capability pack',ARRAY['school'],'Class','Student',ARRAY['English'],true) ON CONFLICT DO NOTHING`);
    const users = (await pool.query(`INSERT INTO users(username,email,password_hash,first_name,last_name,role) VALUES
      ($1,$2,'x','Admin','Maker','admin'),($3,$4,'x','Admin','Reviewer','admin'),($5,$6,'x','Examiner','One','staff'),
      ($7,$8,'x','Moderator','One','staff'),($9,$10,'x','Guardian','One','parent') RETURNING *`, [
      `report.admin.${suffix}`, `report.admin.${suffix}@example.test`, `report.reviewer.${suffix}`, `report.reviewer.${suffix}@example.test`,
      `report.examiner.${suffix}`, `report.examiner.${suffix}@example.test`, `report.moderator.${suffix}`, `report.moderator.${suffix}@example.test`,
      `report.guardian.${suffix}`, `report.guardian.${suffix}@example.test`,
    ])).rows;
    const school = (await pool.query("INSERT INTO schools(name,code) VALUES('Report Test',$1) RETURNING id", [`report-${suffix.slice(0, 12)}`])).rows[0];
    schoolId = school.id;
    const user = (row: any): AuthUser => ({ ...row, is_active: true, active_school_id: schoolId });
    const mappedUsers = users.map(user);
    admin = mappedUsers[0]!;
    reviewer = mappedUsers[1]!;
    examiner = mappedUsers[2]!;
    moderator = mappedUsers[3]!;
    guardian = mappedUsers[4]!;
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$6,'admin'),($2,$6,'admin'),($3,$6,'staff'),($4,$6,'staff'),($5,$6,'guardian')", [admin.id, reviewer.id, examiner.id, moderator.id, guardian.id, schoolId]);
    const assessmentProfile = (await pool.query("INSERT INTO school_custom_roles(school_id,name,description,created_by) VALUES($1,'Assessment staff','Eligible for examiner and moderation assignments',$2) RETURNING id", [schoolId, admin.id])).rows[0].id;
    await pool.query(`INSERT INTO school_custom_role_duties(school_id,role_id,responsibility_type_id)
      SELECT $1,$2,id FROM staff_responsibility_types WHERE school_id=$1 AND code IN ('internal_examiner','exam_in_charge')`, [schoolId, assessmentProfile]);
    await pool.query(`INSERT INTO school_custom_role_assignments(school_id,user_id,role_id,assigned_by,is_primary)
      VALUES($1,$2,$4,$5,true),($1,$3,$4,$5,true)`, [schoolId, examiner.id, moderator.id, assessmentProfile, admin.id]);
    termId = (await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'2032-33','Term 1','2032-04-01','2032-09-30') RETURNING id", [schoolId])).rows[0].id;
    classId = (await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2032-33','8','A') RETURNING id", [schoolId])).rows[0].id;
    subjectId = (await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'ENG','English','English') RETURNING id", [schoolId])).rows[0].id;
    const commenterProfile = (await pool.query(`WITH staff_fixture_input(school_id,user_id,staff_code,first_name,last_name,email,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) AS (VALUES ($1,$2,$3,'Examiner','One',$4,'teaching','Class teacher','full_time',current_date,'active',$5,$5,gen_random_uuid())), canonical_fixture_person AS (INSERT INTO school_people(id,school_id,first_name,last_name,contact_email,contact_phone) SELECT input.person_id::uuid,input.school_id::uuid,input.first_name,input.last_name,input.email,'' FROM staff_fixture_input input RETURNING id) INSERT INTO staff_profiles(school_id,user_id,staff_code,staff_kind,designation,employment_type,joined_on,status,created_by,updated_by,person_id) SELECT input.school_id::uuid,input.user_id::uuid,input.staff_code,input.staff_kind,input.designation,input.employment_type,input.joined_on::date,input.status,input.created_by::uuid,input.updated_by::uuid,input.person_id::uuid FROM staff_fixture_input input JOIN canonical_fixture_person person ON person.id=input.person_id::uuid RETURNING id`, [schoolId, examiner.id, `REPORT-${suffix.slice(0, 8)}`, examiner.email, admin.id])).rows[0].id;
    for(const actor of [admin,reviewer,examiner,moderator]) await linkFixtureStaffIdentity(database,{school_id:schoolId,user_id:actor.id,owner_user_id:admin.id});
    const classTeacherType = (await pool.query("SELECT id FROM staff_responsibility_types WHERE school_id=$1 AND code='class_teacher'", [schoolId])).rows[0].id;
    await pool.query(`INSERT INTO staff_responsibility_assignments(school_id,responsibility_type_id,staff_profile_id,class_section_id,starts_on,status,assigned_by)
      VALUES($1,$2,$3,$4,current_date,'active',$5)`, [schoolId, classTeacherType, commenterProfile, classId, admin.id]);
    const person = (await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Learner','One') RETURNING id", [schoolId])).rows[0];
    studentId = (await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'R-001') RETURNING id", [schoolId, person.id])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,'2032-04-01')", [studentId, classId, termId]);
    const parentId = (await pool.query("INSERT INTO parents(user_id) VALUES($1) RETURNING id", [guardian.id])).rows[0].id;
    const guardianPerson = (await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Guardian','One') RETURNING id", [schoolId])).rows[0].id;
    await pool.query("INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)", [schoolId, parentId, guardianPerson]);
    await pool.query("INSERT INTO guardian_relationships(school_id,guardian_id,student_id,relationship,is_primary) VALUES($1,$2,$3,'guardian',true)", [schoolId, parentId, studentId]);
  });

  afterAll(async () => {
    // Unique disposable fixtures now include accepted Core commands. Retain
    // their source/audit history instead of deleting append-only evidence.
    await database?.destroy();
    await pool.end();
  });

  it("derives, independently reviews, publishes and corrects a term report", async () => {
    const cycle = await assessments.createCycle(admin, schoolId, { term_id: termId, name: "Term 1", code: "T1", starts_on: "2032-08-01", ends_on: "2032-09-15", result_label: "Term result" });
    const assessment = await assessments.createAssessment(admin, schoolId, { cycle_id: cycle.id, class_section_id: classId, subject_id: subjectId, title: "English assignment", assessment_kind: "assignment", maximum_marks: 80, weight_percent: 100, scheduled_at: "2032-08-10T03:30:00.000Z", duration_minutes: 90, venue: "", instructions: "Written assignment", evidence_requirement: "none", examiner_user_id: examiner.id, moderator_user_id: moderator.id });
    let assessmentState = await assessments.action(admin, schoolId, assessment.id, "schedule", { expected_revision: assessment.revision, note: "Scheduled" });
    assessmentState = await assessments.action(admin, schoolId, assessment.id, "open-marking", { expected_revision: assessmentState.revision, note: "Paper complete" });
    let assessmentDetail = await assessments.detail(examiner, schoolId, assessment.id);
    assessmentState = await assessments.recordResults(examiner, schoolId, assessment.id, { expected_assessment_revision: assessmentState.revision, results: [{ result_id: (assessmentDetail.results[0] as any).id, outcome: "scored", marks: 64, grade: "", feedback: "Clear work", expected_revision: (assessmentDetail.results[0] as any).revision, reason: "Initial mark" }] });
    assessmentState = await assessments.action(examiner, schoolId, assessment.id, "submit", { expected_revision: assessmentState.revision, note: "Complete" });
    assessmentState = await assessments.action(moderator, schoolId, assessment.id, "approve", { expected_revision: assessmentState.revision, note: "Checked" });
    assessmentState = await assessments.action(admin, schoolId, assessment.id, "publish", { expected_revision: assessmentState.revision, note: "Release one" });

    let scheme = await reports.createScheme(admin, schoolId, { term_id: termId, class_section_id: classId, name: "Term 1 report", code: "TERM1", absence_treatment: "incomplete", review_mode: "independent", bands: [{ code: "F", label: "Needs support", minimum_percentage: 0, maximum_percentage: 59.99 }, { code: "P", label: "Pass", minimum_percentage: 60, maximum_percentage: 100 }] });
    scheme = await reports.saveSubjectPlan(admin, schoolId, scheme.id, { subject_id: subjectId, pass_percentage: 40, expected_revision: scheme.revision, components: [{ code: "TERM", name: "Term assessment", weight_percentage: 100, assessment_ids: [assessment.id] }] });
    scheme = await reports.activateScheme(admin, schoolId, scheme.id, { expected_revision: scheme.revision, note: "Policy checked" });
    let batch = await reports.generateReport(admin, schoolId, scheme.id, { expected_revision: scheme.revision, correction_reason: "" });
    const report = await reports.reportDetail(admin, schoolId, batch.id);
    expect(report.students[0]).toMatchObject({ outcome: "complete", overall_percentage: "80.00", overall_grade: "P" });
    const teacherRemarks = await reports.updateComments(examiner, schoolId, batch.id, studentId, {
      expected_revision: (report.students[0] as any).comment_revision, expected_batch_revision: batch.revision,
      class_teacher_comment: "Teacher's current assessment", principal_comment: "Cannot edit the principal's remarks" });
    expect(teacherRemarks.principal_comment).toBe("");
    await expect(reports.batchAction(examiner, schoolId, batch.id, "review", { expected_revision: teacherRemarks.batch_revision, note: "Teacher is not a reviewer" })).rejects.toThrow(/administrator/i);
    batch = { ...batch, revision: teacherRemarks.batch_revision };
    const remarks = { expected_revision: teacherRemarks.comment_revision, expected_batch_revision: batch.revision,
      class_teacher_comment: "Steady progress", principal_comment: "Keep going", idempotency_key: randomUUID() };
    const savedRemarks = await reports.updateComments(admin, schoolId, batch.id, studentId, remarks);
    const remarkEvidence = await pool.query(`SELECT outcome.domain_event_id,outcome.metadata FROM campus_model_commands command
      JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id
      WHERE command.school_id=$1 AND command.command_type='academic_reports.report.remarks' AND command.state='accepted'`, [schoolId]);
    expect(remarkEvidence.rows).toHaveLength(2);
    expect(remarkEvidence.rows.every(row => typeof row.domain_event_id === "string")).toBe(true);
    expect(JSON.stringify(remarkEvidence.rows)).not.toMatch(/Steady progress|Keep going|Teacher's current assessment|principal_comment|class_teacher_comment/);
    expect(JSON.parse(JSON.stringify(await reports.updateComments(admin, schoolId, batch.id, studentId, remarks)))).toEqual(JSON.parse(JSON.stringify(savedRemarks)));
    await expect(reports.updateComments(admin, schoolId, batch.id, studentId, { ...remarks, class_teacher_comment: "Different retry" })).rejects.toThrow(/different work/i);
    await expect(reports.batchAction(reviewer, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Stale review" })).rejects.toThrow(/changed/i);
    batch = { ...batch, revision: savedRemarks.batch_revision };
    await expect(reports.batchAction(admin, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Self review" })).rejects.toThrow(/independent reviewer/i);
    // Hold the native review immediately before its UPDATE commits. A second
    // actual service call must wait on the batch and then see reviewed state,
    // rather than reading draft and writing a learner after review has passed.
    const raceKey = `${batch.id}:review-race`, raceName = `test_report_race_${batch.id.replaceAll("-", "")}`;
    const blocker = await pool.connect();
    const waitForLock = async (event: "advisory" | "transactionid") => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event=$1 AND query ILIKE '%grading_report_batches%') AS waiting", [event]);
        if (waiting.rows[0].waiting) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Native report operation did not reach ${event} lock`);
    };
    await pool.query(`CREATE FUNCTION ${raceName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id::text=TG_ARGV[0] AND NEW.status='reviewed' AND OLD.status='draft' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(NEW.id::text||':review-race',0));
      END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${raceName} BEFORE UPDATE ON grading_report_batches FOR EACH ROW EXECUTE FUNCTION ${raceName}('${batch.id}');`);
    try {
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [raceKey]);
      const reviewing = reports.batchAction(reviewer, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Calculation checked" });
      await waitForLock("advisory");
      const lateEdit = reports.updateComments(admin, schoolId, batch.id, studentId, { expected_revision: savedRemarks.comment_revision,
        expected_batch_revision: batch.revision, class_teacher_comment: "After review", principal_comment: "Not accepted" }).catch(error => error as Error);
      await waitForLock("transactionid");
      await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [raceKey]);
      batch = await reviewing;
      const lateOutcome: unknown = await lateEdit;
      expect(lateOutcome).toBeInstanceOf(Error);
      expect((lateOutcome as Error).message).toMatch(/before review/i);
      expect((await reports.reportDetail(admin, schoolId, batch.id)).students[0]).toMatchObject({ class_teacher_comment: "Steady progress", principal_comment: "Keep going" });
    } finally {
      await blocker.query("SELECT pg_advisory_unlock_all()"); blocker.release();
      await pool.query(`DROP TRIGGER ${raceName} ON grading_report_batches; DROP FUNCTION ${raceName}();`);
    }
    batch = await reports.batchAction(admin, schoolId, batch.id, "publish", { expected_revision: batch.revision, note: "Term report published" });
    let family = await reports.familyReports(guardian, schoolId, studentId);
    expect(family.reports[0]).toMatchObject({ sequence: 1, overall_percentage: "80.00", overall_grade: "P", class_teacher_comment: "Steady progress" });
    expect((family.reports[0] as any).subjects[0].assessment_ids).toContain(assessment.id);
    await expect(reports.familyReports(guardian, schoolId, randomUUID())).rejects.toThrow(/cannot view/i);

    assessmentDetail = await assessments.detail(examiner, schoolId, assessment.id);
    assessmentState = await assessments.recordResults(examiner, schoolId, assessment.id, { expected_assessment_revision: assessmentState.revision, results: [{ result_id: (assessmentDetail.results[0] as any).id, outcome: "scored", marks: 72, grade: "", feedback: "Recounted", expected_revision: (assessmentDetail.results[0] as any).revision, reason: "Verified recount" }] });
    assessmentState = await assessments.action(examiner, schoolId, assessment.id, "submit", { expected_revision: assessmentState.revision, note: "Correction complete" });
    assessmentState = await assessments.action(moderator, schoolId, assessment.id, "approve", { expected_revision: assessmentState.revision, note: "Correction checked" });
    await assessments.action(admin, schoolId, assessment.id, "publish", { expected_revision: assessmentState.revision, note: "Corrected release" });
    batch = await reports.generateReport(admin, schoolId, scheme.id, { expected_revision: scheme.revision, correction_reason: "Published assessment correction" });
    batch = await reports.batchAction(reviewer, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Corrected calculation checked" });
    await reports.batchAction(admin, schoolId, batch.id, "publish", { expected_revision: batch.revision, note: "Corrected term report" });
    family = await reports.familyReports(guardian, schoolId, studentId);
    expect(family.reports[0]).toMatchObject({ sequence: 2, overall_percentage: "90.00", overall_grade: "P" });
    const releases = await pool.query("SELECT sequence,status FROM grading_report_batches WHERE scheme_id=$1 ORDER BY sequence", [scheme.id]);
    expect(releases.rows).toEqual([{ sequence: 1, status: "published" }, { sequence: 2, status: "published" }]);
    const events = await pool.query<{ event_type: string; audience_user_ids: string[]; payload: { action: string; status: string; revision: number } }>("SELECT event_type,audience_user_ids,payload FROM event_outbox WHERE aggregate_type='grading_report_batch' AND aggregate_id IN(SELECT id FROM grading_report_batches WHERE scheme_id=$1) ORDER BY sequence", [scheme.id]);
    expect(events.rows.map((row) => row.event_type)).toEqual(Array(8).fill("academic_report.updated"));
    expect(events.rows.map((row) => row.payload.action)).toEqual(["generated", "remarks", "remarks", "review", "publish", "generated", "review", "publish"]);
    expect(events.rows[0]!.audience_user_ids).toEqual(expect.arrayContaining([admin.id, reviewer.id, examiner.id]));
    expect(events.rows[0]!.audience_user_ids).not.toContain(guardian.id);
    expect(events.rows[4]!.audience_user_ids).toEqual(expect.arrayContaining([admin.id, reviewer.id, examiner.id, guardian.id]));
    const runtimeAuthorization = await pool.query<{ admin_on_generate: boolean; commenter_on_generate: boolean; guardian_on_generate: boolean; guardian_on_publish: boolean }>(`SELECT
      event_user_is_authorized($1,'academic_report.updated',$2::jsonb,$3) AS admin_on_generate,
      event_user_is_authorized($1,'academic_report.updated',$2::jsonb,$4) AS commenter_on_generate,
      event_user_is_authorized($1,'academic_report.updated',$2::jsonb,$5) AS guardian_on_generate,
      event_user_is_authorized($1,'academic_report.updated',$6::jsonb,$5) AS guardian_on_publish`, [
      schoolId, JSON.stringify(events.rows[0]!.payload), admin.id, examiner.id, guardian.id, JSON.stringify(events.rows[4]!.payload),
    ]);
    expect(runtimeAuthorization.rows[0]).toEqual({ admin_on_generate: true, commenter_on_generate: true, guardian_on_generate: false, guardian_on_publish: true });
  });

  it("averages two published assessments in one component without doubling its weight", async () => {
    const cycle = await assessments.createCycle(admin, schoolId, { term_id: termId, name: "Continuous assessment", code: "CONTINUOUS", starts_on: "2032-08-01", ends_on: "2032-09-15", result_label: "Course result" });
    const sourceIds: string[] = [];
    for (const [index, marks] of [10, 18].entries()) {
      let assessment = await assessments.createAssessment(admin, schoolId, { cycle_id: cycle.id, class_section_id: classId, subject_id: subjectId,
        title: `Continuous English assignment ${index + 1}`, assessment_kind: "assignment", maximum_marks: 20, scheduled_at: `2032-08-${11 + index}T03:30:00.000Z`, duration_minutes: 60,
        evidence_requirement: "none", examiner_user_id: examiner.id, moderator_user_id: moderator.id });
      assessment = await assessments.action(admin, schoolId, assessment.id, "schedule", { expected_revision: assessment.revision }) as typeof assessment;
      assessment = await assessments.action(admin, schoolId, assessment.id, "open-marking", { expected_revision: assessment.revision }) as typeof assessment;
      const register = await assessments.detail(examiner, schoolId, assessment.id);
      const row = register.results[0] as { id: string; revision: number };
      assessment = await assessments.recordResults(examiner, schoolId, assessment.id, { expected_assessment_revision: assessment.revision,
        results: [{ result_id: row.id, outcome: "scored", marks, expected_revision: row.revision, reason: "Verified initial result" }] });
      assessment = await assessments.action(examiner, schoolId, assessment.id, "submit", { expected_revision: assessment.revision }) as typeof assessment;
      assessment = await assessments.action(moderator, schoolId, assessment.id, "approve", { expected_revision: assessment.revision, note: "Independently checked" }) as typeof assessment;
      assessment = await assessments.action(admin, schoolId, assessment.id, "publish", { expected_revision: assessment.revision, note: "Published continuous result" }) as typeof assessment;
      sourceIds.push(assessment.id);
    }
    let scheme = await reports.createScheme(admin, schoolId, { term_id: termId, class_section_id: classId, name: "Continuous English report", code: "CONTINUOUS",
      bands: [{ code: "F", label: "Needs support", minimum_percentage: 0, maximum_percentage: 49.99 }, { code: "P", label: "Pass", minimum_percentage: 50, maximum_percentage: 100 }] });
    scheme = await reports.saveSubjectPlan(admin, schoolId, scheme.id, { subject_id: subjectId, expected_revision: scheme.revision,
      components: [{ code: "CONTINUOUS", name: "Continuous assignments", weight_percentage: 100, assessment_ids: sourceIds }] });
    scheme = await reports.activateScheme(admin, schoolId, scheme.id, { expected_revision: scheme.revision, note: "Both assessments form one complete component" });
    const batch = await reports.generateReport(admin, schoolId, scheme.id, { expected_revision: scheme.revision });
    const detail = await reports.reportDetail(admin, schoolId, batch.id);
    expect(detail.students[0]).toMatchObject({ overall_percentage: "70.00", overall_grade: "P" });
    expect(detail.components[0]).toMatchObject({ weight_percentage: "100.00", percentage: "70.00", source_assessment_count: 2 });
  });
});
