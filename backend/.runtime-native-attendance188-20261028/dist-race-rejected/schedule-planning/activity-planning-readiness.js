import { sql } from "kysely";
import { z } from "zod";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
export const timetableSetupPath = "/more/setup/capabilities?task=timetable";
/** The exact same current management gate used by the owning command service. */
export async function canManageActivityPlanning(db, user, schoolId, at = executionNow().toISOString()) {
    return Boolean((await sql `SELECT EXISTS(
    SELECT 1 FROM school_memberships membership JOIN users account ON account.id=membership.user_id
    JOIN schools institution ON institution.id=membership.school_id
    WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${user.id}::uuid
      AND membership.is_active AND account.is_active
      AND (membership.role='admin' OR staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,
        'schedule.manage','institution',${schoolId}::uuid,(${at}::timestamptz AT TIME ZONE institution.timezone)::date))
  ) AS allowed`.execute(db)).rows[0]?.allowed);
}
export function activityPlanDestination(source, manager = true, expectedRevision = source.revision) {
    const query = new URLSearchParams({ plan: source.id, plan_revision: String(expectedRevision), date: source.starts_on });
    if (source.state === "draft")
        query.set("section", "drafts");
    return `/areas/timetable/${manager ? "planning" : "schedule"}?${query.toString()}`;
}
/** URLs carry read context, never permission. No free-form redirect is accepted. */
export function parseActivityPlanContinuation(path) {
    if (!path.startsWith("/") || path.startsWith("//"))
        return null;
    const url = new URL(path, "https://thatcampus.invalid");
    if (url.origin !== "https://thatcampus.invalid" || !["/areas/timetable/planning", "/areas/timetable/schedule"].includes(url.pathname)
        || url.hash || [...url.searchParams.keys()].some(key => !["plan", "plan_revision", "date", "section"].includes(key))
        || ["plan", "plan_revision", "date", "section"].some(key => url.searchParams.getAll(key).length > 1)
        || !/^\d{4}-\d{2}-\d{2}$/u.test(url.searchParams.get("date") ?? "")
        || (url.searchParams.has("section") && url.searchParams.get("section") !== "drafts"))
        return null;
    const id = z.uuid().safeParse(url.searchParams.get("plan"));
    const revision = z.coerce.number().int().positive().safeParse(url.searchParams.get("plan_revision"));
    if (!id.success || !revision.success || !/^\d+$/u.test(url.searchParams.get("plan_revision") ?? ""))
        return null;
    return { id: id.data, expected_revision: revision.data };
}
async function sourceById(db, schoolId, id, at) {
    return (await sql `SELECT plan.id,plan.created_by,plan.state,plan.revision,plan.starts_on::text,plan.ends_on::text,
    plan.activity_timezone,plan.planning_origin,
    EXISTS(SELECT 1 FROM schedule_plan_supersessions replacement WHERE replacement.school_id=plan.school_id
      AND replacement.previous_version_id=plan.id AND replacement.effective_from<=${at}::timestamptz
      AND (replacement.effective_until IS NULL OR replacement.effective_until>${at}::timestamptz)) AS superseded,
    COALESCE((SELECT max(((COALESCE(plan.ends_on,CASE WHEN plan.recurrence_kind='once' THEN plan.starts_on END)
        - CASE WHEN plan.recurrence_kind='once' THEN 0
          ELSE (extract(isodow FROM plan.ends_on)::int-period.weekday+7)%7 END
        + period.end_day_offset)+period.ends_at) AT TIME ZONE plan.activity_timezone)
      FROM schedule_periods period WHERE period.version_id=plan.id)<=${at}::timestamptz,false) AS historical
    FROM schedule_versions plan WHERE plan.school_id=${schoolId}::uuid AND plan.id=${id}::uuid`.execute(db)).rows[0];
}
async function canReadPublishedSource(db, schoolId, source, personId, manager) {
    if (manager)
        return true;
    if (source.state === "draft")
        return false;
    return Boolean((await sql `SELECT EXISTS(SELECT 1 FROM schedule_activity_occurrences occurrence
    WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.plan_version_id=${source.id}::uuid
      AND (EXISTS(SELECT 1 FROM schedule_activity_occurrence_people participant
        WHERE participant.school_id=occurrence.school_id AND participant.occurrence_id=occurrence.id AND participant.person_id=${personId}::uuid)
        OR EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders appointment
          WHERE appointment.school_id=occurrence.school_id AND appointment.occurrence_id=occurrence.id AND appointment.person_id=${personId}::uuid))) AS allowed`.execute(db)).rows[0]?.allowed);
}
/** Revalidate an actor-owned source while preserving stale revision as read context. */
export async function resolveActivityPlanContinuation(db, identities, user, schoolId, path) {
    const parsed = parseActivityPlanContinuation(path);
    const environment = executionEnvironmentStorage.getStore();
    if (!parsed || !identities || (user.active_school_id && user.active_school_id !== schoolId)
        || (environment?.institution_id && environment.institution_id !== schoolId))
        return null;
    const at = executionNow().toISOString();
    const identity = await identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at });
    if (!identity.acting)
        return null;
    const source = await sourceById(db, schoolId, parsed.id, at);
    // The manager may inspect another person's draft through normal planning;
    // that is not permission to adopt their private first-use continuation.
    if (!source || source.created_by !== user.id || source.planning_origin !== "activity" || source.state === "discarded")
        return null;
    const manager = await canManageActivityPlanning(db, user, schoolId, at);
    if (!await canReadPublishedSource(db, schoolId, source, identity.person_id, manager))
        return null;
    return { source, manager, path: activityPlanDestination(source, manager, parsed.expected_revision),
        ...(source.revision !== parsed.expected_revision ? { recovery: "source_changed" } : {}) };
}
/** A campus preference must never become another administrator's draft landing. */
export async function vettedTimetableResume(db, identities, user, workspace) {
    const source = workspace.owner_user_id === user.id
        ? await resolveActivityPlanContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
    if (!source)
        return { step: "first_use", path: timetableSetupPath };
    const step = source.source.state === "draft" ? "first_use" : "operating";
    return { step, path: source.path, ...(source.recovery ? { recovery: source.recovery } : {}),
        ...(step === "first_use" ? { continuation: { kind: "activity_plan", actor_user_id: user.id, school_id: workspace.school_id,
                source_id: source.source.id, source_revision: source.source.revision, requires_recheck: true } } : {}) };
}
export async function readTimetablePlanningReadiness(db, identities, user, schoolId) {
    const at = executionNow().toISOString(), environment = executionEnvironmentStorage.getStore();
    const base = { actor_user_id: user.id, environment_namespace_id: environment?.namespace_id ?? `live:${schoolId}`,
        evaluated_at: at, requires_recheck: true };
    const unavailable = { destination: "/areas/timetable", operation: { ...base, action: "unavailable", state: "unavailable",
            scope: null, source_revision: null, recovery: "authority_changed" } };
    if ((user.active_school_id && user.active_school_id !== schoolId) || (environment?.institution_id && environment.institution_id !== schoolId))
        return unavailable;
    const identity = await identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at });
    if (!identity.acting)
        return unavailable;
    const manager = await canManageActivityPlanning(db, user, schoolId, at);
    const retained = (await sql `SELECT resume_path FROM progressive_onboarding_workspaces
    WHERE school_id=${schoolId}::uuid AND owner_user_id=${user.id}::uuid AND resume_goal_key='timetable'
      AND resume_step IN ('first_use','operating')`.execute(db)).rows[0];
    const preferred = retained ? await resolveActivityPlanContinuation(db, identities, user, schoolId, retained.resume_path) : null;
    const candidate = preferred?.source ?? (await sql `SELECT plan.id FROM schedule_versions plan
    WHERE plan.school_id=${schoolId}::uuid AND plan.created_by=${user.id}::uuid AND plan.planning_origin='activity'
      AND plan.state IN ('draft','published') ${manager ? sql `` : sql `AND plan.state='published'
        AND EXISTS(SELECT 1 FROM schedule_activity_occurrences occurrence WHERE occurrence.school_id=plan.school_id AND occurrence.plan_version_id=plan.id
          AND (EXISTS(SELECT 1 FROM schedule_activity_occurrence_people participant WHERE participant.school_id=occurrence.school_id
            AND participant.occurrence_id=occurrence.id AND participant.person_id=${identity.person_id}::uuid)
            OR EXISTS(SELECT 1 FROM schedule_activity_occurrence_recorders appointment WHERE appointment.school_id=occurrence.school_id
              AND appointment.occurrence_id=occurrence.id AND appointment.person_id=${identity.person_id}::uuid)))`}
    ORDER BY (plan.state='draft') DESC,(plan.ends_on IS NULL OR plan.ends_on>=(${at}::timestamptz AT TIME ZONE plan.activity_timezone)::date) DESC,
      plan.created_at DESC,plan.id LIMIT 1`.execute(db)).rows[0];
    const source = preferred?.source ?? (candidate ? await sourceById(db, schoolId, candidate.id, at) : null);
    if (source && await canReadPublishedSource(db, schoolId, source, identity.person_id, manager)) {
        const state = source.state === "cancelled" ? "cancelled" : source.superseded ? "superseded"
            : source.state === "draft" ? "draft" : source.historical ? "historical" : "published";
        return { destination: preferred?.path ?? activityPlanDestination(source, manager), operation: { ...base,
                action: source.state === "draft" && manager ? "continue" : "view", state,
                scope: { kind: "plan", id: source.id, date: source.starts_on }, source_revision: source.revision,
                ...(preferred?.recovery ? { recovery: preferred.recovery } : retained && parseActivityPlanContinuation(retained.resume_path) && !preferred ? { recovery: "source_unavailable" } : {}) } };
    }
    return manager ? { destination: "/areas/timetable/planning?create=activity", operation: { ...base, action: "create",
            state: "ready_to_create", scope: null, source_revision: null,
            ...(retained && parseActivityPlanContinuation(retained.resume_path) ? { recovery: "source_unavailable" } : {}) } } : unavailable;
}
//# sourceMappingURL=activity-planning-readiness.js.map