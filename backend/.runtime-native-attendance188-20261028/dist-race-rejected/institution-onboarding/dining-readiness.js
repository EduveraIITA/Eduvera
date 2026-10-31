import { ForbiddenException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";
import { diningPlanHref } from "../dining/dining.contracts.js";
export const diningPath = "/areas/dining";
export const diningSetupPath = "/more/setup/capabilities?task=dining";
export const diningDestination = (id) => `${diningPath}?session_id=${id}`;
/** One exact native session or weekly version, never an actor, provider or world. */
export function parseDiningContinuation(path) {
    if (path.length > 180 || !path.startsWith("/") || path.startsWith("//"))
        return null;
    const url = new URL(path, "https://thatcampus.invalid");
    if (url.origin !== "https://thatcampus.invalid" || url.pathname !== diningPath || url.hash)
        return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1 || !["session_id", "plan_id"].includes(keys[0]))
        return null;
    const key = keys[0];
    const parsed = z.uuid().safeParse(url.searchParams.get(key));
    return parsed.success ? key === "session_id" ? { session_id: parsed.data } : { plan_id: parsed.data } : null;
}
async function identity(db, identities, user, schoolId) {
    const world = executionEnvironmentStorage.getStore();
    if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId)
        return null;
    const actor = await identities.resolveAccountEndpoint(db, {
        school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
    });
    if (!actor.acting)
        return null;
    let canManage = false;
    try {
        await institutionSchoolPermissionForUser(db, user.id, schoolId, "dining.manage", true);
        canManage = true;
    }
    catch (error) {
        if (!(error instanceof ForbiddenException))
            throw error;
    }
    return { person_id: actor.person_id, can_manage: canManage };
}
/** Current published family responsibility wins before actor filtering; no old-owner fallback. */
function weeklySource(schoolId, personId) {
    const at = executionNow().toISOString();
    const date = sql `(${at}::timestamptz AT TIME ZONE plan.timezone)::date`;
    return sql `SELECT plan.id,plan.revision,plan.coordinator_person_id,plan.published_at,plan.state,
    'plan'::text AS kind,plan.created_at,
    (plan.published_at IS NOT NULL AND plan.starts_on<=${date} AND (plan.ends_on IS NULL OR plan.ends_on>=${date})
      AND (plan.stop_from IS NULL OR plan.stop_from>${date})) AS current_source
    FROM dining_weekly_plans plan
    WHERE plan.school_id=${schoolId}::uuid AND plan.menu_mode='native'
      AND (plan.coordinator_person_id=${personId}::uuid OR plan.published_at IS NOT NULL AND EXISTS(SELECT 1 FROM dining_weekly_days day
        WHERE day.school_id=plan.school_id AND day.plan_id=plan.id AND day.operator_person_id=${personId}::uuid))
      AND (plan.published_at IS NOT NULL OR plan.state='draft')
      AND NOT EXISTS(SELECT 1 FROM dining_weekly_plans newer WHERE newer.school_id=plan.school_id
        AND newer.series_id=plan.series_id AND newer.published_at IS NOT NULL AND newer.version_number>plan.version_number
        AND newer.starts_on<=(${at}::timestamptz AT TIME ZONE newer.timezone)::date)`;
}
export async function resolveDiningContinuation(db, identities, user, schoolId, path) {
    const parsed = parseDiningContinuation(path), actor = await identity(db, identities, user, schoolId);
    if (!parsed || !actor)
        return null;
    // Setup access or another person's published menu never proves this actor's operation.
    if ("plan_id" in parsed) {
        const source = (await sql `SELECT * FROM (${weeklySource(schoolId, actor.person_id)}) source
      WHERE source.id=${parsed.plan_id}::uuid`.execute(db)).rows[0];
        return source ? { source, path: diningPlanHref(source.id) } : null;
    }
    const source = (await sql `SELECT id,revision,coordinator_person_id,published_at,state,'session'::text AS kind,created_at,
    published_at IS NOT NULL AS current_source
    FROM dining_sessions WHERE school_id=${schoolId}::uuid AND id=${parsed.session_id}::uuid
      AND menu_mode='native'
      AND ${actor.person_id}::uuid IN(coordinator_person_id,operator_person_id)
      AND (published_at IS NOT NULL OR state='draft')`.execute(db)).rows[0];
    return source ? { source, path: diningDestination(source.id) } : null;
}
export async function vettedDiningResume(db, identities, user, workspace) {
    const retained = workspace.owner_user_id === user.id
        ? await resolveDiningContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
    return retained ? { step: retained.source.published_at ? "operating" : "first_use", path: retained.path }
        : { step: "first_use", path: diningPath };
}
export async function readDiningReadiness(db, identities, user, schoolId) {
    const base = { actor_user_id: user.id,
        environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
        evaluated_at: executionNow().toISOString(), requires_recheck: true };
    const actor = await identity(db, identities, user, schoolId);
    const source = actor ? (await sql `SELECT * FROM (
    SELECT id,revision,coordinator_person_id,published_at,state,'session'::text AS kind,created_at,
      published_at IS NOT NULL AS current_source
    FROM dining_sessions WHERE school_id=${schoolId}::uuid
      AND menu_mode='native'
      AND ${actor.person_id}::uuid IN(coordinator_person_id,operator_person_id)
      AND (published_at IS NOT NULL OR state='draft')
    UNION ALL ${weeklySource(schoolId, actor.person_id)}) source
    ORDER BY (published_at IS NOT NULL) DESC,current_source DESC,created_at DESC,id DESC LIMIT 1`.execute(db)).rows[0] : undefined;
    const service = actor ? (await sql `SELECT id FROM dining_services
    WHERE school_id=${schoolId}::uuid AND active AND menu_mode='native'
      AND (${actor.can_manage} OR coordinator_person_id=${actor.person_id}::uuid)
    ORDER BY id LIMIT 1`.execute(db)).rows[0] : undefined;
    const canStart = actor && (actor.can_manage || Boolean(service));
    const operation = source
        ? { ...base, action: source.published_at || source.coordinator_person_id !== actor?.person_id ? "view" : "publish",
            state: source.published_at ? "menu_published" : "draft_recorded", scope: { kind: source.kind, id: source.id },
            source_revision: source.revision, destination: source.kind === "plan" ? diningPlanHref(source.id) : diningDestination(source.id) }
        : { ...base, action: canStart ? service ? "publish" : "configure" : "unavailable",
            state: canStart ? service ? "ready_to_plan" : "needs_service" : "unavailable",
            scope: null, source_revision: null, destination: diningPath };
    return { operation };
}
//# sourceMappingURL=dining-readiness.js.map