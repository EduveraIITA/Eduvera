import type { DatabaseService } from "../src/database/database.service.js";
import { LearningAssignmentHandoverService } from "../src/learning/learning-assignment-handover.service.js";
import { createLearningAssignmentFixture } from "./learning-assignments.test-support.js";
export async function assignmentHandoverFixture(database: DatabaseService) {
  const f = await createLearningAssignmentFixture(database);
  const profile = await database.selectFrom("staff_profiles").select("id").where("school_id", "=", f.schoolId).where("user_id", "=", f.otherTeacher.id).executeTakeFirstOrThrow();
  const successor = await database.insertInto("staff_responsibility_assignments").values({ school_id: f.schoolId, responsibility_type_id: f.roleId,
    staff_profile_id: profile.id, class_section_id: f.classId, subject_id: null, event_id: null, starts_on: f.date, ends_on: null, starts_at: null, ends_at: null,
    status: "active", assigned_by: f.owner.id, revoked_by: null, revoked_at: null, backup_staff_profile_id: null }).returning("id").executeTakeFirstOrThrow();
  return { ...f, handovers: new LearningAssignmentHandoverService(database, f.context, f.model), successorAssignmentId: successor.id };
}
