import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { AssessmentsService } from "../src/assessments/assessments.service.js";
import { AcademicReportsService } from "../src/academic-reports/academic-reports.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { teachingSessionServices } from "./teaching-sessions.test-support.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createElectiveFixture, electiveServices } from "./learning-elective-change.test-support.js";

export const academicRequest = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() }, ip: "127.0.0.1" }) as unknown as AuthenticatedRequest;
export const academicOfferingPassword = "F0rest!Lamps-And-Rivers2026";

export function academicOfferingServices(db: DatabaseService) {
  const base = electiveServices(db), teaching=teachingSessionServices(db,base.core);
  return { ...base, assessments: new AssessmentsService(db, base.events, undefined, base.core, base.core),
    reports: new AcademicReportsService(db, base.events, base.core, base.core, base.core),
    attendance: new ActivityAttendanceService(db, base.core, base.core, base.core, base.core, base.core),
    teaching: teaching.context, teachingSessions:teaching.sessions };
}

/** Real canonical People invitation and current responsibilities. No compatibility
 * students, class placements or staff profiles are manufactured for the cycle. */
export async function createAcademicOfferingFixture(db: DatabaseService, options: { passwordHash?: string } = {}) {
  const f = await createElectiveFixture(db), services = academicOfferingServices(db);
  // Explicit fixture authority: current staff membership plus a dated approved
  // permission exception. This is not a class/student/staff-profile adapter.
  await db.insertInto("school_memberships").values({ school_id: f.schoolId, user_id: f.instructor.actor.id, role: "staff", is_active: true })
    .onConflict(conflict => conflict.columns(["user_id", "school_id", "role"]).doNothing()).execute();
  for (const permission of ["assessments.view", "assessments.mark"]) await sql`INSERT INTO school_access_exceptions(
    school_id,user_id,permission,reason,source_kind,scope_kind,valid_from,valid_until,review_due_on,created_by)
    VALUES(${f.schoolId}::uuid,${f.instructor.actor.id}::uuid,${permission},'Explicit bounded academic-cycle fixture appointment','manual','institution',
      ${f.date(-1)}::date,${f.date(120)}::date,${f.date(120)}::date,${f.owner.id}::uuid)`.execute(db);
  if (options.passwordHash) await db.updateTable("users").set({ password_hash: options.passwordHash })
    .where("id", "in", [f.owner.id, f.instructor.actor.id, f.learner.actor.id, f.secondLearner.actor.id]).execute();
  const courses = await db.selectFrom("learning_offering_academic_contexts").select(["offering_id as id", "subject_id", "term_id", "course_code", "credits"])
    .where("school_id", "=", f.schoolId).orderBy("offering_id").execute();
  const termId = courses[0]!.term_id;
  const cycle = await services.assessments.createCycle(f.owner, f.schoolId, { term_id: termId, name: "Semester I continuous assessment", code: "SEM1-CA",
    starts_on: f.date(-30), ends_on: f.date(120), result_label: "Course result" });
  const runAt = <T>(at: string, work: () => Promise<T>) => {
    const environment = createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => new Date(at), nowIso: () => at } });
    return executionEnvironmentStorage.run(environment, work);
  };
  const now = new Date().toISOString();
  const coordinator = await db.transaction().execute(tx=>services.core.resolveAccountEndpoint(tx,{school_id:f.schoolId,user_id:f.owner.id,at:now}));
  if(!coordinator.acting)throw new Error("Expected current canonical coordinator endpoint.");
  return { ...f, ...services, courses, termId, cycle, now, coordinator_person_id:coordinator.person_id, runAt, run: <T>(work: () => Promise<T>) => runAt(now, work) };
}

export async function publishAcademicOfferingAssessment(db: DatabaseService, f: Awaited<ReturnType<typeof createAcademicOfferingFixture>>,
  offeringId: string, options: { title?: string; marks?: number; scheduledOn?: string; gradingPolicyId?: string; services?: ReturnType<typeof academicOfferingServices> } = {}) {
  const services = options.services ?? f, input = { context_kind: "learning_offering", offering_id: offeringId, cycle_id: f.cycle.id,
    title: options.title ?? `Course portfolio ${randomUUID().slice(0, 6)}`, assessment_kind: "assignment", maximum_marks: 100,
    scheduled_at: `${options.scheduledOn ?? f.date(2)}T10:00:00.000Z`, evidence_requirement: "none", examiner_user_id: f.instructor.actor.id,
    moderator_user_id: f.owner.id, grading_policy_id: options.gradingPolicyId ?? null, idempotency_key: randomUUID() };
  const created = await services.assessments.createAssessment(f.instructor.actor, f.schoolId, input);
  let state = await services.assessments.action(f.owner, f.schoolId, created.id, "schedule", { expected_revision: created.revision, idempotency_key: randomUUID() });
  state = await services.assessments.action(f.owner, f.schoolId, created.id, "open-marking", { expected_revision: state.revision, idempotency_key: randomUUID() });
  const rows = await db.selectFrom("assessment_results").selectAll().where("school_id", "=", f.schoolId).where("assessment_id", "=", created.id).orderBy("learner_id").execute();
  if (!rows.length) throw new Error("Academic cycle must have a nonempty actual dated course roster.");
  state = await services.assessments.recordResults(f.instructor.actor, f.schoolId, created.id, { expected_assessment_revision: state.revision,
    results: rows.map(row => ({ result_id: row.id, outcome: "scored", marks: options.marks ?? 80, expected_revision: row.revision, reason: "Reviewed course portfolio evidence." })) });
  state = await services.assessments.action(f.instructor.actor, f.schoolId, created.id, "submit", { expected_revision: state.revision, note: "All actual course learners marked.", idempotency_key: randomUUID() });
  state = await services.assessments.action(f.owner, f.schoolId, created.id, "approve", { expected_revision: state.revision, note: "Independent assessment moderation completed.", idempotency_key: randomUUID() });
  const publicationInput = { expected_revision: state.revision, note: "Release this reviewed course result.", idempotency_key: randomUUID() };
  await services.assessments.action(f.owner, f.schoolId, created.id, "publish", publicationInput);
  return { id: created.id, input, publicationInput, rows };
}
