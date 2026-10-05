import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AcademicReportsService } from "../src/academic-reports/academic-reports.service.js";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import type { AuthUser } from "../src/common/request.js";
import { DatabaseService } from "../src/database/database.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

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
  const createdUsers: string[] = [];

  beforeAll(async () => {
    database = new DatabaseService();
    reports = new AcademicReportsService(database);
    assessments = new AssessmentsService(database);
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
    createdUsers.push(...users.map((row) => row.id));
    await pool.query("INSERT INTO school_memberships(user_id,school_id,role) VALUES($1,$6,'admin'),($2,$6,'admin'),($3,$6,'staff'),($4,$6,'staff'),($5,$6,'guardian')", [admin.id, reviewer.id, examiner.id, moderator.id, guardian.id, schoolId]);
    termId = (await pool.query("INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on) VALUES($1,'2032-33','Term 1','2032-04-01','2032-09-30') RETURNING id", [schoolId])).rows[0].id;
    classId = (await pool.query("INSERT INTO class_sections(school_id,academic_year,grade,section) VALUES($1,'2032-33','8','A') RETURNING id", [schoolId])).rows[0].id;
    subjectId = (await pool.query("INSERT INTO subjects(school_id,code,name,short_name) VALUES($1,'ENG','English','English') RETURNING id", [schoolId])).rows[0].id;
    const person = (await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Learner','One') RETURNING id", [schoolId])).rows[0];
    studentId = (await pool.query("INSERT INTO students(school_id,person_id,admission_number) VALUES($1,$2,'R-001') RETURNING id", [schoolId, person.id])).rows[0].id;
    await pool.query("INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on) VALUES($1,$2,$3,1,'2032-04-01')", [studentId, classId, termId]);
    const parentId = (await pool.query("INSERT INTO parents(user_id,phone) VALUES($1,'9000000999') RETURNING id", [guardian.id])).rows[0].id;
    const guardianPerson = (await pool.query("INSERT INTO school_people(school_id,first_name,last_name) VALUES($1,'Guardian','One') RETURNING id", [schoolId])).rows[0].id;
    await pool.query("INSERT INTO guardian_school_profiles(school_id,guardian_id,person_id) VALUES($1,$2,$3)", [schoolId, parentId, guardianPerson]);
    await pool.query("INSERT INTO guardian_relationships(school_id,guardian_id,student_id,relationship,is_primary) VALUES($1,$2,$3,'guardian',true)", [schoolId, parentId, studentId]);
  });

  afterAll(async () => {
    if (schoolId) {
      await pool.query("DELETE FROM notifications WHERE recipient_id=ANY($1::uuid[])", [createdUsers]);
      for (const table of [
        "grading_report_assessment_sources", "grading_report_components", "grading_report_subjects", "grading_report_students", "grading_report_audits", "grading_report_batches",
        "grading_component_assessments", "grading_components", "grading_scheme_subjects", "grading_scheme_bands", "grading_schemes",
        "assessment_publication_results", "assessment_publications", "assessment_evidence", "assessment_result_revisions", "assessment_results", "assessment_staff_assignments", "assessment_audits", "assessments", "assessment_cycles",
      ]) await pool.query(`DELETE FROM ${table} WHERE school_id=$1`, [schoolId]);
      await pool.query("DELETE FROM guardian_relationships WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM guardian_school_profiles WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM enrollments WHERE student_id IN(SELECT id FROM students WHERE school_id=$1)", [schoolId]);
      await pool.query("DELETE FROM students WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM parents WHERE user_id=ANY($1::uuid[])", [createdUsers]);
      await pool.query("DELETE FROM school_people WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM school_memberships WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM subjects WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM class_sections WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM academic_terms WHERE school_id=$1", [schoolId]);
      await pool.query("DELETE FROM schools WHERE id=$1", [schoolId]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [createdUsers]);
    }
    await database?.destroy();
    await pool.end();
  });

  it("derives, independently reviews, publishes and corrects a term report", async () => {
    const cycle = await assessments.createCycle(admin, schoolId, { term_id: termId, name: "Term 1", code: "T1", starts_on: "2032-08-01", ends_on: "2032-09-15", result_label: "Term result" });
    const assessment = await assessments.createAssessment(admin, schoolId, { cycle_id: cycle.id, class_section_id: classId, subject_id: subjectId, title: "English paper", assessment_kind: "exam", maximum_marks: 80, weight_percent: 100, scheduled_at: "2032-08-10T03:30:00.000Z", duration_minutes: 90, venue: "Hall", instructions: "Offline paper", evidence_requirement: "none", examiner_user_id: examiner.id, moderator_user_id: moderator.id });
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
    await reports.updateComments(admin, schoolId, batch.id, studentId, { expected_revision: (report.students[0] as any).comment_revision, class_teacher_comment: "Steady progress", principal_comment: "Keep going" });
    await expect(reports.batchAction(admin, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Self review" })).rejects.toThrow(/independent reviewer/i);
    batch = await reports.batchAction(reviewer, schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Calculation checked" });
    batch = await reports.batchAction(admin, schoolId, batch.id, "publish", { expected_revision: batch.revision, note: "Term report published" });
    let family = await reports.familyReports(guardian, schoolId, studentId);
    expect(family.reports[0]).toMatchObject({ sequence: 1, overall_percentage: "80.00", overall_grade: "P", class_teacher_comment: "Steady progress" });
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
  });
});
