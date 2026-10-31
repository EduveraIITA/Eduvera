import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { activityPlanDestination } from "../schedule-planning/activity-planning-readiness.js";
import { assignmentContinuationPath } from "../learning/learning-assignment-readiness.js";
import { feesBatchDestination, feesInvoiceDestination } from "../operations/fees-first-readiness.js";

/** Live account onboarding is control-plane state, never an effect of a rehearsal. */
export async function retainOperatingDestination(
  db: Transaction<Database>,
  user: AuthUser,
  schoolId: string,
  capability: "attendance" | "gate" | "resources" | "facilities" | "accommodation" | "dining",
  destination: string,
  options: { onlyPending?: boolean; source?: "accepted_capability_setup" | "accepted_activity_publication" | "accepted_resource_issue" | "accepted_facilities_report" | "accepted_accommodation_arrangement" | "accepted_dining_publication" } = {},
): Promise<void> {
  if (executionEnvironmentStorage.getStore()?.kind === "simulation") return;
  const now = executionNow();
  const updated = (await sql<{ id: string; revision: number }>`UPDATE progressive_onboarding_workspaces workspace SET
      resume_step='operating',resume_goal_key=${capability},resume_path=${destination},
      revision=workspace.revision+1,updated_at=${now}
    FROM progressive_onboarding_goal_selections selection
    WHERE workspace.school_id=${schoolId}::uuid
      AND workspace.owner_user_id=${user.id}::uuid
      AND selection.workspace_id=workspace.id
      AND selection.goal_key=${capability}
      AND (${!options.onlyPending} OR (workspace.resume_step='first_use' AND workspace.resume_goal_key=${capability}))
      AND EXISTS (SELECT 1 FROM school_memberships membership
        WHERE membership.school_id=workspace.school_id AND membership.user_id=${user.id}::uuid
          AND membership.role='admin' AND membership.is_active)
    RETURNING workspace.id,workspace.revision`.execute(db)).rows[0];
  if (!updated) return;
  await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
    VALUES(${updated.id}::uuid,${user.id}::uuid,'resume_updated',${updated.revision},
      ${JSON.stringify({ step: "operating", goal: capability, path: destination,
        source: options.source ?? "accepted_capability_setup" })}::jsonb)`.execute(db);
}

/** Only an accepted owning command advances this exact pending timetable goal. */
export async function retainTimetableContinuation(db: Transaction<Database>, user: AuthUser, schoolId: string,
  source: { id: string; created_by: string; planning_origin: string; state: string; revision: number; starts_on: string }) {
  if (executionEnvironmentStorage.getStore()?.kind === "simulation" || source.created_by !== user.id
    || source.planning_origin !== "activity" || !["draft", "published"].includes(source.state)) return;
  const step = source.state === "draft" ? "first_use" : "operating";
  const destination = activityPlanDestination({ ...source, state: source.state as "draft" | "published" });
  const now = executionNow();
  const changed = (await sql<{ id: string; revision: number }>`UPDATE progressive_onboarding_workspaces workspace SET
    resume_step=${step},resume_path=${destination},revision=workspace.revision+1,updated_at=${now}
    WHERE workspace.school_id=${schoolId}::uuid AND workspace.owner_user_id=${user.id}::uuid
      AND workspace.resume_goal_key='timetable' AND workspace.resume_step='first_use'
      AND EXISTS(SELECT 1 FROM progressive_onboarding_goal_selections selected
        WHERE selected.workspace_id=workspace.id AND selected.goal_key='timetable')
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=workspace.school_id
        AND membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active)
    RETURNING workspace.id,workspace.revision`.execute(db)).rows[0];
  if (changed) await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
    VALUES(${changed.id}::uuid,${user.id}::uuid,'resume_updated',${changed.revision},
      ${JSON.stringify({ step, goal: "timetable", path: destination, source: source.state === "draft" ? "accepted_activity_draft" : "accepted_activity_publication",
        plan_id: source.id, source_revision: source.revision, environment_namespace_id: `live:${schoolId}` })}::jsonb)`.execute(db);
}

/** Accepted native assignment commands retain only this owner's pending goal.
 * The Learning owner has already checked the source, actor and selected world;
 * this conditional control-plane write cannot grant teaching responsibility.
 */
export async function retainAssignmentsContinuation(db: Transaction<Database>, user: AuthUser, schoolId: string,
  source: { id: string; author_id: string; context_kind: "class_term" | "learning_offering"; offering_id: string | null;
    class_section_id: string | null; term_id: string | null; state: string; revision: number }) {
  if (executionEnvironmentStorage.getStore()?.kind === "simulation" || source.author_id !== user.id
    || !["draft", "published"].includes(source.state) || !Number.isSafeInteger(source.revision) || source.revision < 1) return;
  const destination = assignmentContinuationPath(source);
  const step = source.state === "draft" ? "first_use" : "operating";
  const changed = (await sql<{ id: string; revision: number }>`UPDATE progressive_onboarding_workspaces workspace SET
    resume_step=${step},resume_path=${destination},revision=workspace.revision+1,updated_at=${executionNow()}
    WHERE workspace.school_id=${schoolId}::uuid AND workspace.owner_user_id=${user.id}::uuid
      AND workspace.resume_goal_key='assignments' AND workspace.resume_step='first_use'
      AND EXISTS(SELECT 1 FROM progressive_onboarding_goal_selections selected
        WHERE selected.workspace_id=workspace.id AND selected.goal_key='assignments')
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=workspace.school_id
        AND membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active)
    RETURNING workspace.id,workspace.revision`.execute(db)).rows[0];
  if (changed) await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
    VALUES(${changed.id}::uuid,${user.id}::uuid,'resume_updated',${changed.revision},
      ${JSON.stringify({ step, goal: "assignments", path: destination,
        source: source.state === "draft" ? "accepted_assignment_draft" : "accepted_assignment_publication",
        assignment_id: source.id, source_revision: source.revision, environment_namespace_id: `live:${schoolId}` })}::jsonb)`.execute(db);
}

/** Native immutable charge accepted by its owner, not a generic page mount. */
export async function retainFeesContinuation(db: Transaction<Database>, user: AuthUser, schoolId: string,
  source: { id: string; person_id: string | null; created_by: string }) {
  if (executionEnvironmentStorage.getStore()?.kind === "simulation" || source.created_by !== user.id || !source.person_id) return;
  const destination = feesInvoiceDestination({ id: source.id, person_id: source.person_id });
  const changed = (await sql<{ id: string; revision: number }>`UPDATE progressive_onboarding_workspaces workspace SET
    resume_step='operating',resume_path=${destination},revision=workspace.revision+1,updated_at=${executionNow()}
    WHERE workspace.school_id=${schoolId}::uuid AND workspace.owner_user_id=${user.id}::uuid
      AND workspace.resume_goal_key='fees' AND workspace.resume_step='first_use'
      AND EXISTS(SELECT 1 FROM progressive_onboarding_goal_selections selected WHERE selected.workspace_id=workspace.id AND selected.goal_key='fees')
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=workspace.school_id
        AND membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active)
    RETURNING workspace.id,workspace.revision`.execute(db)).rows[0];
  if (changed) await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
    VALUES(${changed.id}::uuid,${user.id}::uuid,'resume_updated',${changed.revision},
      ${JSON.stringify({ step: "operating", goal: "fees", path: destination, source: "accepted_person_charge",
        invoice_id: source.id, source_revision: 1, environment_namespace_id: `live:${schoolId}` })}::jsonb)`.execute(db);
}

/** A collection resumes its exact reviewed batch, never an arbitrary beneficiary. */
export async function retainFeeBatchContinuation(db: Transaction<Database>, user: AuthUser, schoolId: string,
  source: { id: string; created_by: string }) {
  if (executionEnvironmentStorage.getStore()?.kind === "simulation" || source.created_by !== user.id) return;
  const destination = feesBatchDestination(source);
  const changed = (await sql<{ id: string; revision: number }>`UPDATE progressive_onboarding_workspaces workspace SET
    resume_step='operating',resume_path=${destination},revision=workspace.revision+1,updated_at=${executionNow()}
    WHERE workspace.school_id=${schoolId}::uuid AND workspace.owner_user_id=${user.id}::uuid
      AND workspace.resume_goal_key='fees' AND workspace.resume_step='first_use'
      AND EXISTS(SELECT 1 FROM progressive_onboarding_goal_selections selected WHERE selected.workspace_id=workspace.id AND selected.goal_key='fees')
      AND EXISTS(SELECT 1 FROM school_memberships membership WHERE membership.school_id=workspace.school_id
        AND membership.user_id=${user.id}::uuid AND membership.role='admin' AND membership.is_active)
    RETURNING workspace.id,workspace.revision`.execute(db)).rows[0];
  if (changed) await sql`INSERT INTO progressive_onboarding_audits(workspace_id,actor_id,action,revision,metadata)
    VALUES(${changed.id}::uuid,${user.id}::uuid,'resume_updated',${changed.revision},
      ${JSON.stringify({ step: "operating", goal: "fees", path: destination, source: "accepted_fee_charge_batch",
        batch_id: source.id, source_revision: 1, environment_namespace_id: `live:${schoolId}` })}::jsonb)`.execute(db);
}
