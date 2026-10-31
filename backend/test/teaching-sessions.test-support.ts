import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { AccessRolesService } from "../src/roles/access-roles.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";
import { DayPlanService } from "../src/day-plans/day-plan.service.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { TeachingSessionContextService } from "../src/teaching-sessions/teaching-session-context.service.js";
import { TeachingSessionModelService } from "../src/teaching-sessions/teaching-session-model.service.js";
import { TeachingSessionArtifactStore, TeachingSessionMaterialsService } from "../src/teaching-sessions/teaching-session-materials.service.js";
import { TeachingSessionsService } from "../src/teaching-sessions/teaching-sessions.service.js";
import { TeachingSessionWorkService } from "../src/teaching-sessions/teaching-session-work.service.js";

export const teachingRequest = (user: AuthUser) => ({ authUser: user, requestId: randomUUID(), headers: {}, ip: "127.0.0.1" }) as AuthenticatedRequest;
export const teachingDay = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function teachingSessionServices(db: DatabaseService, core = new CampusModelCoreService(db, new ExecutionDataPlaneScope())) {
  const events = new SchoolEventService(db, core), planning = new ActivityPlanningService(db, events, core, core, core, new ResponsibilityProjectionService(core));
  const context = new TeachingSessionContextService(db, core, planning), model = new TeachingSessionModelService(core, core, core, core, events);
  const artifacts = new TeachingSessionArtifactStore(), materials = new TeachingSessionMaterialsService(db, context, model, artifacts);
  const work = new TeachingSessionWorkService(db, context, model);
  return { core, events, planning, context, model, artifacts, materials, work,
    sessions: new TeachingSessionsService(db, context, model, materials, undefined, undefined, undefined, work) };
}

/** Fictional identities and academic source only; no implicit teaching permission,
 * external providers, destructive cleanup, migration, or reset is performed. */
export async function createTeachingSessionFixture(db: DatabaseService, options: { passwordHash?: string; date?: string } = {}) {
  const f = await createClassPracticeFixture(db, options), roles = new AccessRolesService(db);
  const teacherProfile = await db.selectFrom("staff_profiles").select(["id", "person_id"])
    .where("school_id", "=", f.schoolId).where("user_id", "=", f.teacher.id).executeTakeFirstOrThrow();
  const otherTeacherProfile = await db.selectFrom("staff_profiles").select(["id", "person_id"])
    .where("school_id", "=", f.schoolId).where("user_id", "=", f.otherTeacher.id).executeTakeFirstOrThrow();
  const date = options.date ?? teachingDay(f.date, 2), weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const slot = await db.insertInto("timetable_slots").values({ class_section_id: f.classId, term_id: f.termId,
    subject_id: null, weekday, period_number: 1, starts_at: "08:00", ends_at: "09:00", slot_type: "class",
    title: "Fictional programming class", room: "Practice room", teacher_user_id: f.teacher.id, space_id: null,
    updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
  const planning = new ActivityPlanningService(db, f.events, f.core, f.core, f.core, new ResponsibilityProjectionService(f.core));
  const dayPlans = new DayPlanService(db, f.events, f.school, createStaffCoverageReconciliationTestDouble(), f.core);
  const allowClass = () => db.updateTable("staff_responsibility_types")
    .set({ capability_permissions: ["learning.sessions.manage"] }).where("id", "=", f.roleId).execute();
  const allowCampus = async (actor = f.teacher) => {
    const profile = actor.id === f.teacher.id ? teacherProfile : otherTeacherProfile;
    const role = await roles.save(f.owner, f.schoolId, { name: `Session instructor ${randomUUID().slice(0, 8)}`,
      context_kind: "institution", permissions: ["learning.sessions.manage"] });
    return roles.assign(f.owner, f.schoolId, { role_id: role.id, staff_profile_id: profile.id, starts_on: f.date });
  };
  const native = async (overrides: Record<string, unknown> = {}) => {
    const draft = await planning.create(teachingRequest(f.owner), f.schoolId, { idempotency_key: randomUUID(),
      title: "Fictional robotics lesson", purpose: "teaching", timezone: "UTC", starts_on: date, recurrence: "once",
      starts_at: "12:00", ends_at: "13:00", attendance_mode: "none", person_ids: [f.learner.personId],
      lead_person_id: teacherProfile.person_id, ...overrides });
    await planning.publish(teachingRequest(f.owner), f.schoolId, draft.id, { idempotency_key: randomUUID(), expected_revision: draft.revision });
    const occurrence = (await planning.ensureOccurrences(f.schoolId, date, date)).find(value => value.plan_version_id === draft.id);
    if (!occurrence) throw new Error("Expected the exact fictional native lesson occurrence.");
    return { draft, occurrence };
  };
  const changeRoom = async () => {
    const draft = await dayPlans.start(teachingRequest(f.owner), { school_id: f.schoolId, idempotency_key: randomUUID(), class_section_id: f.classId, date });
    const saved = await dayPlans.save(teachingRequest(f.owner), draft.id, { school_id: f.schoolId, idempotency_key: randomUUID(), expected_revision: draft.revision,
      notice: "Use the revised fictional teaching room.", reason: "The original fictional room is unavailable.", periods: [{ period_number: 1,
        subject_id: null, starts_at: "08:00", ends_at: "09:00", title: "Fictional programming class", slot_type: "class", room: "Replacement practice room",
        teacher_user_id: f.teacher.id, cancelled: false, materials: [] }] });
    const published = await dayPlans.publish(teachingRequest(f.owner), draft.id, { school_id: f.schoolId, idempotency_key: randomUUID(), expected_revision: saved.revision });
    const period = (await sql<{ id: string; response_revision: number }>`SELECT id,response_revision FROM day_plan_periods
      WHERE plan_id=${draft.id}::uuid AND version=${published.version} AND period_number=1`.execute(db)).rows[0]!;
    await dayPlans.respond(teachingRequest(f.teacher), period.id, { school_id: f.schoolId, idempotency_key: randomUUID(),
      expected_revision: period.response_revision, status: "accepted", note: "I have reviewed the revised fictional room.", source: "app" });
    return draft.id;
  };
  return { ...f, roles, planning, dayPlans, date, slotId: slot.id, teacherProfile, otherTeacherProfile, allowClass, allowCampus, native, changeRoom };
}

/** Explicit accepted Staff-domain evidence for lesson boundary tests, not a claim
 * that these fixtures exercise the separate offer/acceptance workflow. */
export async function createAcceptedTeachingCover(db: DatabaseService, f: Awaited<ReturnType<typeof createTeachingSessionFixture>>) {
  const planned = (await sql<{ id: string; occurrence_key: string; class_section_id: string; subject_id: string | null;
    period_number: number; starts_at: string; ends_at: string; title: string; room: string; source_kind: "daily_plan" | "published_timetable" | "legacy_timetable";
    source_record_id: string; source_revision: number; source_version: number | null }>`SELECT * FROM planned_school_schedule_v2(${f.schoolId}::uuid,${f.date}::date)
      WHERE class_section_id=${f.classId}::uuid AND period_number=1`.execute(db)).rows[0];
  if (!planned) throw new Error("Expected an exact fictional planned lesson for accepted-cover evidence.");
  const policy = await db.insertInto("staff_leave_policies").values({ school_id: f.schoolId, academic_year: "2026-27", code: `TS-${randomUUID().slice(0, 8)}`,
    name: "Fictional teaching cover policy", annual_allowance: "10", requires_document_after_days: null, updated_by: f.owner.id }).returning("id").executeTakeFirstOrThrow();
  const leave = await db.insertInto("staff_leave_requests").values({ school_id: f.schoolId, staff_profile_id: f.teacherProfile.id, policy_id: policy.id,
    starts_on: f.date, ends_on: f.date, requested_days: "1", reason: "Fictional teacher absence", handover_note: "Continue the loop exercise.",
    status: "approved", decided_by: f.owner.id, decided_at: new Date() }).returning("id").executeTakeFirstOrThrow();
  const task = await db.insertInto("staff_coverage_tasks").values({ school_id: f.schoolId, leave_request_id: leave.id,
    absent_staff_profile_id: f.teacherProfile.id, replacement_staff_profile_id: f.otherTeacherProfile.id, responsibility_assignment_id: null,
    source_schedule_id: planned.id, class_section_id: planned.class_section_id, subject_id: planned.subject_id, duty_date: f.date,
    period_number: planned.period_number, starts_at: planned.starts_at, ends_at: planned.ends_at, title: planned.title, location: planned.room,
    status: "accepted", handover_note: "Continue the existing lesson record.", assigned_by: f.owner.id, offered_at: new Date(), responded_at: new Date() })
    .returning(["id", "revision"]).executeTakeFirstOrThrow();
  await db.insertInto("staff_coverage_task_audits").values({ school_id: f.schoolId, task_id: task.id, actor_id: f.otherTeacher.id,
    action: "accepted", from_status: "offered", to_status: "accepted", note: "Explicit fictional accepted-cover evidence." }).execute();
  return db.insertInto("staff_timetable_substitutions").values({ school_id: f.schoolId, coverage_task_id: task.id,
    class_section_id: planned.class_section_id, subject_id: planned.subject_id, duty_date: f.date, period_number: planned.period_number,
    starts_at: planned.starts_at, ends_at: planned.ends_at, source_schedule_id: planned.id, source_occurrence_key: planned.occurrence_key,
    source_kind: planned.source_kind, source_record_id: planned.source_record_id, source_revision: planned.source_revision, source_version: planned.source_version,
    original_teacher_user_id: f.teacher.id, replacement_staff_profile_id: f.otherTeacherProfile.id, replacement_teacher_user_id: f.otherTeacher.id,
    coverage_task_revision: task.revision, accepted_by: f.otherTeacher.id, accepted_at: new Date(), effective_event_id: null, superseded_at: null })
    .returning("id").executeTakeFirstOrThrow();
}
