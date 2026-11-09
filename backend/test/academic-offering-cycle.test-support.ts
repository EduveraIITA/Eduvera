import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { AcademicReportsService } from "../src/academic-reports/academic-reports.service.js";
import { ActivityAttendanceService } from "../src/attendance/activity-attendance.service.js";
import { teachingSessionServices } from "./teaching-sessions.test-support.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createElectiveFixture, electiveServices } from "./learning-elective-change.test-support.js";
import { examAmendmentServices } from "./exam-amendments.test-support.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { InvigilationInvitationPolicyService } from "../src/assessments/invigilation-invitation-policy.service.js";

export const academicRequest = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: { "idempotency-key": randomUUID() }, ip: "127.0.0.1" }) as unknown as AuthenticatedRequest;
export const academicOfferingPassword = "F0rest!Lamps-And-Rivers2026";

export function academicOfferingServices(db: DatabaseService) {
  const base = electiveServices(db), teaching=teachingSessionServices(db,base.core), examination=examAmendmentServices(db);
  return { ...base, assessments: examination.assessments,
    exam: examination.operations, examScope: examination.scope,
    reports: new AcademicReportsService(db, base.events, base.core, base.core, base.core),
    attendance: new ActivityAttendanceService(db, base.core, base.core, base.core, base.core, base.core),
    teaching: teaching.context, teachingSessions:teaching.sessions };
}

export async function prepareOfferingExam(db: DatabaseService, fixture: Awaited<ReturnType<typeof createAcademicOfferingFixture>>,
  marking: "manual" | "automatic", kind: "exam" | "practical" | "viva" = "exam", invigilator=fixture.instructor) {
  const {schoolId,owner,instructor,core}=fixture;
  const campus=await db.insertInto("institution_campuses").values({school_id:schoolId,name:"Academic campus",code:"ACADEMIC",campus_type:"main",is_primary:true,
    created_by:owner.id,updated_by:owner.id}).returning("id").executeTakeFirstOrThrow();
  const room=async(name:string,capacity:number)=>db.insertInto("campus_spaces").values({school_id:schoolId,campus_id:campus.id,name,code:name.toUpperCase().replaceAll(" ","-"),kind:"classroom",
    capacity,is_bookable:true,created_by:owner.id,updated_by:owner.id}).returning("id").executeTakeFirstOrThrow();
  const original=await room("Exam Hall",25),replacement=await room("Computing Lab",25),tooSmall=await room("Tutorial Room",1);
  const invitations=new InvigilationInvitationPolicyService(db,core,new CoordinationConfigurationService(core),core,core);
  const eligible=await invitations.workspace(owner,schoolId);
  if (!eligible.eligible_recipients.some(person=>person.user_id===invigilator.actor.id&&person.person_id===invigilator.id)) {
    throw new Error("The course fixture requires a current, canonical invigilator.");
  }
  await invitations.approve(academicRequest(owner),schoolId,{expected_revision:0,enabled:true,recipient_person_ids:[invigilator.id],
    response_due_minutes:10080,expires_after_minutes:43200,approval_note:"Approve the exact isolated fixture invigilator.",idempotency_key:randomUUID()});
  const policy=await fixture.exam.policy(owner,schoolId);
  await fixture.exam.savePolicy(owner,schoolId,{expected_revision:policy.revision,readiness_minutes_before:10080,attendance_close_after_minutes:60,
    minimum_invigilators:1,require_all_candidate_attendance:true,post_completion_marking_mode:marking});
  const input={context_kind:"learning_offering",offering_id:fixture.source.id,cycle_id:fixture.cycle.id,
    title:"Distributed systems physical examination",assessment_kind:kind,maximum_marks:100,
    scheduled_at:`${fixture.date(2)}T09:00:00.000Z`,duration_minutes:60,space_id:original.id,invigilator_user_ids:[invigilator.actor.id],
    evidence_requirement:"none",examiner_user_id:instructor.actor.id,moderator_user_id:owner.id,idempotency_key:randomUUID()};
  return {input,original,replacement,tooSmall};
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
