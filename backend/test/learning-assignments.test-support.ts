import { randomUUID } from "node:crypto";
import type { DatabaseService } from "../src/database/database.service.js";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { LearningAssignmentModelService } from "../src/learning/learning-assignment-model.service.js";
import { LearningAssignmentContextService } from "../src/learning/learning-assignment-context.service.js";
import { LearningAssignmentsService } from "../src/learning/learning-assignments.service.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";

export function learningAssignmentServices(db: DatabaseService) {
  const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope()), events = new SchoolEventService(db, core);
  const model = new LearningAssignmentModelService(core, core, core, core, core, new CoordinationConfigurationService(core), events);
  const context = new LearningAssignmentContextService(model), assignments = new LearningAssignmentsService(db, context, model);
  return { core, events, model, context, assignments };
}

/** Explicit synthetic setup only, not evidence of account invitation/onboarding. Never resets or migrates. */
export async function createLearningAssignmentFixture(db: DatabaseService) {
  const f = await createClassPracticeFixture(db);
  await db.updateTable("staff_responsibility_types").set({ capability_permissions: ["learning.assignments.manage"] }).where("id", "=", f.roleId).execute();
  const services = learningAssignmentServices(db);
  const input = (overrides: Record<string, unknown> = {}) => ({ command_id: randomUUID(), expected_revision: 0,
    assignment_id: randomUUID(), class_section_id: f.classId, term_id: f.termId, subject_id: null, reviewer_id: f.teacher.id,
    title: "Trace a programming loop", instructions: "Submit your program and explain the stopping condition.", due_at: null, cutoff_at: null,
    submission_mode: "either", max_attempts: null, policy_version: 1, resubmission_mode: "on_request", ...overrides });
  const publish = async (overrides: Record<string, unknown> = {}) => {
    const data = input(overrides), saved = await services.assignments.save(f.teacher, data);
    const preview = await services.assignments.detail(f.teacher, data.assignment_id);
    if (preview.context !== "class" || !preview.publication_preview) throw new Error("Expected publication preview");
    await services.assignments.publish(f.teacher, data.assignment_id, { command_id: randomUUID(), expected_revision: saved.revision, audience_hash: preview.publication_preview.audience_hash });
    return data;
  };
  return { ...f, ...services, input, publish };
}
