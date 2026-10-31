import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import type { AuthUser, UserRole } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { ClassPracticeService } from "../src/school/class-practice.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { SchoolService } from "../src/school/school.service.js";
import { linkFixtureStaffIdentity } from "./fixture-human-identity.test-support.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";

export function classPracticeServices(db: DatabaseService) {
  const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope()), events = new SchoolEventService(db, core);
  const practice = new ClassPracticeService(db, events, core, core, core);
  const school = new SchoolService(db, events, createStaffCoverageReconciliationTestDouble(), undefined, undefined, undefined, undefined, undefined, practice);
  return { core, events, practice, school };
}

/** Synthetic explicit identity/assignment setup, not evidence of invitation onboarding. Never resets or migrates. */
export async function createClassPracticeFixture(db: DatabaseService, options: { passwordHash?: string } = {}) {
  const context = classPracticeServices(db), suffix = randomUUID(), date = new Date().toISOString().slice(0, 10);
  const account = (name: string, role: UserRole) => db.insertInto("users").values({ username: `practice-${name}-${suffix}`,
    email: `practice-${name}-${suffix}@example.test`, password_hash: options.passwordHash ?? "isolated-test-only",
    first_name: name, last_name: "Practice Fixture", role, email_verified_at: new Date() })
    .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
  const founder = await account("Owner", "admin");
  const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(context.core).createForAccount(tx, founder, "UTC"));
  const actor = (value: typeof founder): AuthUser => ({ ...value, active_school_id: schoolId });
  const owner = actor(founder);
  const term = (await sql<{ id: string }>`INSERT INTO academic_terms(school_id,academic_year,name,starts_on,ends_on,attendance_threshold,is_active)
    VALUES(${schoolId}::uuid,'2026-27','Practice term',${date}::date-90,${date}::date+90,85,true) RETURNING id`.execute(db)).rows[0]!;
  const section = await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: "2026-27", grade: "7", section: "A" }).returning("id").executeTakeFirstOrThrow();
  const makeLearner = async (name: string, roll: number) => {
    const value = await account(name, "student");
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: value.id, role: "student" }).execute();
    const person = await db.insertInto("school_people").values({ school_id: schoolId, first_name: name }).returning("id").executeTakeFirstOrThrow();
    const student = await db.insertInto("students").values({ school_id: schoolId, person_id: person.id, user_id: value.id, admission_number: `P-${roll}`,
      date_of_birth: null, blood_group: null, emergency_contact: null }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("enrollments").values({ student_id: student.id, class_section_id: section.id, term_id: term.id, roll_number: roll, enrolled_on: new Date(Date.now()-30*86_400_000).toISOString().slice(0,10) }).execute();
    const endpoint = await db.transaction().execute(tx => context.core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: person.id, user_id: value.id,
      actor_user_id: owner.id, effective_from: new Date(Date.now() - 86_400_000).toISOString(), effective_until: null,
      source_domain: "people", source_record_id: student.id, source_revision: 1, metadata: { fixture: "class_practice" } }));
    return { id: student.id, personId: person.id, actor: actor(value), endpoint };
  };
  const learner = await makeLearner("Sana", 1), secondLearner = await makeLearner("Asha", 2);
  const parentAccount = await account("Guardian", "parent");
  await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: parentAccount.id, role: "guardian" }).execute();
  const parent = await db.insertInto("parents").values({ user_id: parentAccount.id }).returning("id").executeTakeFirstOrThrow();
  const parentPerson = await db.insertInto("school_people").values({ school_id: schoolId, first_name: "Guardian" }).returning("id").executeTakeFirstOrThrow();
  await db.insertInto("guardian_school_profiles").values({ school_id: schoolId, guardian_id: parent.id, person_id: parentPerson.id }).execute();
  await db.insertInto("guardian_relationships").values({ school_id: schoolId, guardian_id: parent.id, student_id: learner.id, relationship: "guardian" }).execute();
  await db.transaction().execute(tx => context.core.linkAccountEndpoint(tx, { school_id: schoolId, person_id: parentPerson.id, user_id: parentAccount.id, actor_user_id: owner.id,
    effective_from: new Date(Date.now() - 86_400_000).toISOString(), effective_until: null, source_domain: "people", source_record_id: parent.id, source_revision: 1, metadata: { fixture: "class_practice" } }));
  const makeTeacher = async (name: string) => {
    const value = await account(name, "staff");
    await db.insertInto("school_memberships").values({ school_id: schoolId, user_id: value.id, role: "staff" }).execute();
    const endpoint = await linkFixtureStaffIdentity(db, { school_id: schoolId, user_id: value.id, owner_user_id: owner.id, teaching: true });
    const profile = await db.selectFrom("staff_profiles").select("id").where("school_id", "=", schoolId).where("user_id", "=", value.id).executeTakeFirstOrThrow();
    return { actor: actor(value), profileId: profile.id, endpoint };
  };
  const teacher = await makeTeacher("Meera"), otherTeacher = await makeTeacher("OtherTeacher");
  const role = await db.insertInto("staff_responsibility_types").values({ school_id: schoolId, code: `practice_${suffix.slice(0, 8)}`, name: "Practice author fixture", category: "academic",
    scope_kind: "class_section", context_kind: "class", workflow_family: "class_practice", source_kind: "institute", cloned_from_type_id: null,
    capability_permissions: ["learning.work.publish", "messages.view", "messages.send"], requires_acceptance: false, updated_by: owner.id }).returning("id").executeTakeFirstOrThrow();
  const assignment = await db.insertInto("staff_responsibility_assignments").values({ school_id: schoolId, responsibility_type_id: role.id, staff_profile_id: teacher.profileId,
    class_section_id: section.id, subject_id: null, event_id: null, starts_on: `${date.slice(0, 4)}-01-01`, ends_on: null, starts_at: null, ends_at: null,
    status: "active", assigned_by: owner.id, revoked_by: null, revoked_at: null, backup_staff_profile_id: null }).returning("id").executeTakeFirstOrThrow();
  const input = (overrides: Record<string, unknown> = {}) => ({ command_id: randomUUID(), practice_id: randomUUID(), class_section_id: section.id, term_id: term.id,
    subject_id: null, date, title: "Programming practice", body: "Write and explain a small sorting program.", due_at: null, ...overrides });
  return { ...context, db, schoolId, date, owner, termId: term.id, classId: section.id, learner, secondLearner, guardian: actor(parentAccount), teacher: teacher.actor,
    teacherEndpoint: teacher.endpoint, otherTeacher: otherTeacher.actor, roleId: role.id, assignmentId: assignment.id, input };
}
