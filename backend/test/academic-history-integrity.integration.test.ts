import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { AcademicReportsService } from "../src/academic-reports/academic-reports.service.js";
import { datedAcademicRoster } from "../src/academic-reports/academic-record-context.js";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { PeopleService } from "../src/people/people.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SimulationSnapshotStore } from "../src/database/simulation-snapshot-store.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { academicParticipationTestServices } from "./academic-participation.test-support.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const isolated = process.env.TEST_DATABASE_ISOLATED === "true";
const sourceUrl = isolated ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";
types.setTypeParser(1082, value => value);
const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: sourceUrl, max: 4 }) }) }) as DatabaseService;
afterAll(() => database.destroy());
const request = (authUser: AuthUser) => ({ authUser, requestId: randomUUID(), protocol: "http", headers: { host: "localhost" }, ip: "127.0.0.1" }) as AuthenticatedRequest;
const offset = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const services = (db: DatabaseService) => {
  const shared = academicParticipationTestServices(db);
  return { assessments: new AssessmentsService(db, shared.events, undefined, shared.core, shared.core),
    reports: new AcademicReportsService(db, shared.events, shared.core, shared.core),
    people: new PeopleService(db, shared.events, shared.core, shared.core, shared.core, shared.bridge) };
};

async function fixture() {
  const suffix = randomUUID(), shared = academicParticipationTestServices(database);
  const account = async (name: string, role: "admin" | "student") => database.insertInto("users").values({ username: `academic-history-${name}-${suffix}`,
    email: `academic-history-${name}-${suffix}@example.test`, password_hash: "isolated-fixture-only", first_name: name, last_name: "Synthetic", role }).returningAll().executeTakeFirstOrThrow();
  const ownerAccount = await account("Owner", "admin");
  const schoolId = await database.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(shared.core).createForAccount(tx, ownerAccount, "UTC"));
  const owner = { ...ownerAccount, active_school_id: schoolId } as AuthUser, reviewerAccount = await account("Reviewer", "admin"), learnerAccount = await account("Sana", "student");
  const reviewer = { ...reviewerAccount, active_school_id: schoolId } as AuthUser, learner = { ...learnerAccount, active_school_id: schoolId } as AuthUser;
  await database.insertInto("school_memberships").values([{ school_id: schoolId, user_id: reviewer.id, role: "admin" },
    { school_id: schoolId, user_id: reviewer.id, role: "staff" },{ school_id: schoolId, user_id: owner.id, role: "staff" },
    { school_id: schoolId, user_id: learner.id, role: "student" }]).execute();
  await linkFixtureStaffIdentity(database, { school_id: schoolId, user_id: reviewer.id, owner_user_id: owner.id });
  const today = (await sql<{ today: string }>`SELECT campus_permission_date(${schoolId}::uuid)::text AS today`.execute(database)).rows[0]!.today;
  const term = await database.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "QA2026", name: "Historical term",
    starts_on: offset(today, -30), ends_on: offset(today, 30), is_active: true, attendance_threshold: "75" }).returningAll().executeTakeFirstOrThrow();
  const classes = await database.insertInto("class_sections").values(["A", "B"].map(section => ({ school_id: schoolId, academic_year: "QA2026", grade: "7", section }))).returningAll().execute();
  const classA = classes.find(row => row.section === "A")!.id, classB = classes.find(row => row.section === "B")!.id;
  const person = await database.insertInto("school_people").values({ school_id: schoolId, first_name: "Sana", last_name: "Synthetic" }).returning("id").executeTakeFirstOrThrow();
  const student = await database.insertInto("students").values({ school_id: schoolId, person_id: person.id, user_id: learner.id, admission_number: "HISTORY-1" }).returning("id").executeTakeFirstOrThrow();
  const enrollment = await database.insertInto("enrollments").values({ student_id: student.id, class_section_id: classA, term_id: term.id,
    enrolled_on: offset(today, -20), roll_number: 1 }).returningAll().executeTakeFirstOrThrow();
  const subject = await database.insertInto("subjects").values({ school_id: schoolId, code: "HISTORY", name: "Programming", short_name: "Code" }).returning("id").executeTakeFirstOrThrow();
  const service = services(database);
  const cycle = await service.assessments.createCycle(owner, schoolId, { term_id: term.id, name: "Historical cycle", code: "HISTORY",
    starts_on: term.starts_on, ends_on: term.ends_on });
  let assessment = await service.assessments.createAssessment(owner, schoolId, { cycle_id: cycle.id, class_section_id: classA, subject_id: subject.id,
    title: "Historical programming assignment", assessment_kind: "assignment", maximum_marks: 20, scheduled_at: `${offset(today, -10)}T09:00:00.000Z`,
    evidence_requirement: "none", examiner_user_id: owner.id, moderator_user_id: reviewer.id });
  assessment = await service.assessments.action(owner, schoolId, assessment.id, "schedule", { expected_revision: assessment.revision }) as typeof assessment;
  return { schoolId, owner, reviewer, learner, studentId: student.id, enrollmentId: enrollment.id, today, termId: term.id, classA, classB,
    subjectId: subject.id, assessment, ...service };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function move(db: DatabaseService, f: Fixture, classId: string, roll: number, day = f.today) {
  const people = services(db).people, current = (await people.lifecycle(f.owner, f.studentId, f.schoolId)).current as { id: string; revision: number };
  const review = await people.previewLifecycle(request(f.owner), f.studentId, { school_id: f.schoolId, action: "move_class", expected_enrollment_id: current.id,
    expected_revision: current.revision, effective_on: day, reason: "Reviewed academic history transfer", target_class_section_id: classId, target_term_id: f.termId, roll_number: roll });
  const accepted = await people.commitLifecycle(request(f.owner), review.id);
  expect(await people.commitLifecycle(request(f.owner), review.id)).toEqual(accepted);
}
async function publishAssessment(db: DatabaseService, f: Fixture, marks = 16) {
  const service = services(db).assessments;
  let state = await db.selectFrom("assessments").selectAll().where("id", "=", f.assessment.id).executeTakeFirstOrThrow();
  if (state.status === "scheduled") state = await service.action(f.owner, f.schoolId, state.id, "open-marking", { expected_revision: state.revision }) as typeof state;
  const row = await db.selectFrom("assessment_results").selectAll().where("assessment_id", "=", state.id).executeTakeFirstOrThrow();
  state = await service.recordResults(f.owner, f.schoolId, state.id, { expected_assessment_revision: state.revision,
    results: [{ result_id: row.id, outcome: "scored", marks, expected_revision: row.revision, reason: "Verified historical source" }] });
  state = await service.action(f.owner, f.schoolId, state.id, "submit", { expected_revision: state.revision }) as typeof state;
  state = await service.action(f.reviewer, f.schoolId, state.id, "approve", { expected_revision: state.revision, note: "Independent source review" }) as typeof state;
  return service.action(f.owner, f.schoolId, state.id, "publish", { expected_revision: state.revision, note: "Release historical result" });
}
async function scheme(db: DatabaseService, f: Fixture, assessmentIds = [f.assessment.id]) {
  const reports = services(db).reports;
  const draft = await reports.createPolicy(f.owner, f.schoolId, { name: "Historical grading", code: "HISTORY", configuration: { result_format: "percentage",
    bands: [{ code: "F", label: "Needs support", minimum_percentage: 0, maximum_percentage: 49.99, passed: false },
      { code: "P", label: "Pass", minimum_percentage: 50, maximum_percentage: 100, passed: true }] } });
  const policy = await reports.activatePolicy(f.owner, f.schoolId, draft.id, { expected_revision: draft.revision, note: "Approved grade bands" });
  let state = await reports.createScheme(f.owner, f.schoolId, { term_id: f.termId, class_section_id: f.classA, name: "Historical report", code: "HISTORY",
    grading_policy_id: policy.id, review_mode: "independent" });
  state = await reports.saveSubjectPlan(f.owner, f.schoolId, state.id, { subject_id: f.subjectId, expected_revision: state.revision,
    components: [{ code: "ASSIGNMENT", name: "Programming assignment", weight_percentage: 100, assessment_ids: assessmentIds }] });
  return reports.activateScheme(f.owner, f.schoolId, state.id, { expected_revision: state.revision, note: "Approved academic sources" });
}
async function release(db: DatabaseService, f: Fixture, plan: { id: string; revision: number }, correctionReason = "") {
  const reports = services(db).reports;
  let batch = await reports.generateReport(f.owner, f.schoolId, plan.id, { expected_revision: plan.revision, correction_reason: correctionReason });
  batch = await reports.batchAction(f.reviewer, f.schoolId, batch.id, "review", { expected_revision: batch.revision, note: "Reviewed academic source" });
  return reports.batchAction(f.owner, f.schoolId, batch.id, "publish", { expected_revision: batch.revision, note: "Published academic report" });
}

describe.runIf(isolated)("dated academic history integrity", () => {
  it("marks the assessment-date roster after actual A→B→A moves without duplicate rows or late joiners", async () => {
    const f = await fixture();
    await move(database, f, f.classB, 4); await move(database, f, f.classA, 9);
    const latePerson = await database.insertInto("school_people").values({ school_id: f.schoolId, first_name: "Late", last_name: "Joiner" }).returning("id").executeTakeFirstOrThrow();
    const late = await database.insertInto("students").values({ school_id: f.schoolId, person_id: latePerson.id, admission_number: "HISTORY-LATE" }).returning("id").executeTakeFirstOrThrow();
    await database.insertInto("enrollments").values({ student_id: late.id, class_section_id: f.classA, term_id: f.termId, enrolled_on: f.today, roll_number: 10 }).execute();
    await publishAssessment(database, f);
    const detail = await f.assessments.detail(f.owner, f.schoolId, f.assessment.id);
    expect(detail.results).toHaveLength(1);
    expect(detail.results[0]).toMatchObject({ student_id: f.studentId, roll_number: 1,
      academic_roster_source: { kind: "dated_enrollment", enrollment_id: f.enrollmentId, roll_number: 1, as_of: offset(f.today, -10) } });
    const plan = await scheme(database, f), batch = await release(database, f, plan);
    const report = await f.reports.reportDetail(f.owner, f.schoolId, batch.id);
    expect(report.students).toHaveLength(1); expect(report.students[0]).toMatchObject({ student_id: f.studentId, roll_number: 1 });
    const first = await database.selectFrom("grading_report_students").selectAll().where("batch_id", "=", batch.id).executeTakeFirstOrThrow();
    await publishAssessment(database, f, 18);
    const correction = await release(database, f, plan, "Verified correction after class movement");
    const corrected = await f.reports.reportDetail(f.owner, f.schoolId, correction.id);
    expect(corrected.students).toHaveLength(1); expect(corrected.students[0]).toMatchObject({ student_id: f.studentId, overall_percentage: "90.00", roll_number: 1,
      academic_roster_source: first.academic_roster_source });
    expect(await database.selectFrom("grading_report_students").selectAll().where("id", "=", first.id).executeTakeFirstOrThrow()).toEqual(first);
  }, 90_000);

  it("separates current family access from frozen class/term context on assessment and report printing", async () => {
    const f = await fixture(); await publishAssessment(database, f);
    const plan = await scheme(database, f), batch = await release(database, f, plan);
    await move(database, f, f.classB, 3);
    await database.updateTable("class_sections").set({ section: "Renamed" }).where("id", "=", f.classA).execute();
    await database.updateTable("academic_terms").set({ name: "Renamed term" }).where("id", "=", f.termId).execute();
    const result = await f.assessments.familyResults(f.learner, f.schoolId, f.studentId), report = await f.reports.familyReports(f.learner, f.schoolId, f.studentId);
    expect(result.student).toMatchObject({ class_name: "Class 7B" }); expect(report.student).toMatchObject({ class_name: "Class 7B" });
    expect(result.results[0]).toMatchObject({ class_name: "Class 7A", term_name: "Historical term", academic_context_source: "publication_snapshot" });
    expect(report.reports[0]).toMatchObject({ batch_id: batch.id, class_name: "Class 7A", term_name: "Historical term", academic_context_source: "report_snapshot" });
    expect((await f.reports.reportDetail(f.owner, f.schoolId, batch.id)).batch).toMatchObject({ class_name: "Class 7A", term_name: "Historical term" });
    await database.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.learner.id).execute();
    await expect(f.assessments.familyResults(f.learner, f.schoolId, f.studentId)).rejects.toThrow(/cannot view/i);
    await expect(f.reports.familyReports(f.learner, f.schoolId, f.studentId)).rejects.toThrow(/cannot view/i);
  }, 90_000);

  it("uses the latest mapped publication's exact enrollment roll rather than a current-placement join", async () => {
    const f = await fixture(); await publishAssessment(database, f);
    await move(database, f, f.classB, 4); await move(database, f, f.classA, 9);
    let latest = await f.assessments.createAssessment(f.owner, f.schoolId, { cycle_id: f.assessment.cycle_id, class_section_id: f.classA,
      subject_id: f.subjectId, title: "Later dated programming assignment", assessment_kind: "assignment", maximum_marks: 20,
      scheduled_at: `${f.today}T09:00:00.000Z`, evidence_requirement: "none", examiner_user_id: f.owner.id, moderator_user_id: f.reviewer.id });
    latest = await f.assessments.action(f.owner, f.schoolId, latest.id, "schedule", { expected_revision: latest.revision }) as typeof latest;
    await publishAssessment(database, { ...f, assessment: latest }, 18);
    const plan = await scheme(database, f, [f.assessment.id, latest.id]), batch = await release(database, f, plan);
    const detail = await f.reports.reportDetail(f.owner, f.schoolId, batch.id);
    expect(detail.students).toHaveLength(1);
    expect(detail.students[0]).toMatchObject({ student_id: f.studentId, roll_number: 9, overall_percentage: "85.00",
      academic_roster_source: { kind: "published_assessments", enrollment_source: { kind: "dated_enrollment", roll_number: 9, as_of: f.today } } });
  }, 90_000);

  it("refuses ambiguous dated placement without guessing or partially opening marking", async () => {
    const f = await fixture();
    await sql`INSERT INTO enrollments(student_id,class_section_id,term_id,roll_number,enrolled_on,is_active,inactive_from,exit_kind,exit_reason,ended_at)
      VALUES(${f.studentId}::uuid,${f.classA}::uuid,${f.termId}::uuid,2,${offset(f.today, -15)}::date,false,${offset(f.today, -5)}::date,
        'class_move','Synthetic overlapping historical source',now())`.execute(database);
    await expect(f.assessments.action(f.owner, f.schoolId, f.assessment.id, "open-marking", { expected_revision: f.assessment.revision })).rejects.toThrow(/overlapping learner placements/i);
    expect(await database.selectFrom("assessment_results").select("id").where("assessment_id", "=", f.assessment.id).execute()).toHaveLength(0);
    expect(await database.selectFrom("assessments").select("status").where("id", "=", f.assessment.id).executeTakeFirstOrThrow()).toEqual({ status: "scheduled" });
    expect(await datedAcademicRoster(database, f.schoolId, f.classA, f.termId, offset(f.today, -40))).toEqual([]);
  });

  it.runIf(Boolean(process.env.ACADEMIC_HISTORY_SIMULATION_TEST_TARGET_URL))("uses actual COW People moves and late marking/publication/report commands with unchanged source and sibling", async () => {
    const f = await fixture(), capturedAt = new Date().toISOString();
    const target = requireIsolatedTestDatabaseUrl(process.env.ACADEMIC_HISTORY_SIMULATION_TEST_TARGET_URL);
    const store = new SimulationSnapshotStore(sourceUrl, target, 4), opened: Kysely<Database>[] = [];
    try {
      const captured = await store.capture(f.schoolId, capturedAt);
      const open = async () => {
        const runId = randomUUID(), scenarioId = randomUUID();
        const branch = await createSimulationBranch(store.pool, captured, { run_id: runId, school_id: f.schoolId, scenario_id: scenarioId, namespace_id: `scenario:${scenarioId}:run:${runId}` });
        const driver = new SimulationBranchDriver(store.pool, branch, captured), compiler = new PostgresDialect({ pool: store.pool });
        const db = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
          createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
        opened.push(db);
        const at = <T>(day: string, work: () => Promise<T>) => executionEnvironmentStorage.run(simulationRequestEnvironment({ institution_id: f.schoolId,
          scenario_id: scenarioId, run_id: runId, virtual_now: `${day}T12:00:00.000Z`, source_snapshot_ref: `sha256:${captured.content_hash}`,
          manifest_ref: "academic-history-integrity", checked_at: capturedAt }), work);
        return { db, at };
      };
      const branch = await open(), sibling = await open();
      await branch.at(offset(f.today, 1), () => move(branch.db, f, f.classB, 4, offset(f.today, 1)));
      await branch.at(offset(f.today, 2), async () => {
        await move(branch.db, f, f.classA, 9, offset(f.today, 2));
        await publishAssessment(branch.db, f);
        const branchServices = services(branch.db), plan = await scheme(branch.db, f), batch = await release(branch.db, f, plan);
        expect((await branchServices.assessments.detail(f.owner, f.schoolId, f.assessment.id)).results).toEqual([expect.objectContaining({ student_id: f.studentId, roll_number: 1 })]);
        expect((await branchServices.reports.reportDetail(f.owner, f.schoolId, batch.id)).students).toEqual([expect.objectContaining({ student_id: f.studentId, roll_number: 1 })]);
        expect((await branchServices.reports.familyReports(f.learner, f.schoolId, f.studentId)).reports[0]).toMatchObject({ class_name: "Class 7A", academic_context_source: "report_snapshot" });
        expect((await sql<{ now: Date }>`SELECT now() AS now`.execute(branch.db)).rows[0]!.now.toISOString()).toBe(`${offset(f.today, 2)}T12:00:00.000Z`);
      });
      const unchanged = async (db: DatabaseService) => ({ assessment: await db.selectFrom("assessments").select(["status", "revision"]).where("id", "=", f.assessment.id).executeTakeFirstOrThrow(),
        placements: await db.selectFrom("enrollments").select(["id", "class_section_id", "roll_number", "is_active"]).where("student_id", "=", f.studentId).execute(),
        reports: await db.selectFrom("grading_report_batches").select("id").where("school_id", "=", f.schoolId).execute() });
      const source = await unchanged(database);
      expect(source).toEqual({ assessment: { status: "scheduled", revision: f.assessment.revision },
        placements: [{ id: f.enrollmentId, class_section_id: f.classA, roll_number: 1, is_active: true }], reports: [] });
      expect(await sibling.at(f.today, () => unchanged(sibling.db))).toEqual(source);
    } finally { await Promise.all(opened.map(db => db.destroy())); await store.pool.end(); }
  }, 180_000);
});
