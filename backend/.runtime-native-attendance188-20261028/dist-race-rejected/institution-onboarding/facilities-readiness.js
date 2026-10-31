import { ForbiddenException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";
export const facilitiesPath = "/areas/facilities";
export const facilitiesSetupPath = "/more/setup/capabilities?task=facilities";
export const facilitiesDestination = (id) => `${facilitiesPath}?repair_id=${id}`;
export function parseFacilitiesContinuation(path) {
    if (path.length > 180 || !path.startsWith("/") || path.startsWith("//"))
        return null;
    const url = new URL(path, "https://thatcampus.invalid");
    if (url.origin !== "https://thatcampus.invalid" || url.pathname !== facilitiesPath || url.hash
        || [...url.searchParams.keys()].some(key => key !== "repair_id") || url.searchParams.getAll("repair_id").length !== 1)
        return null;
    const parsed = z.uuid().safeParse(url.searchParams.get("repair_id"));
    return parsed.success ? { repair_id: parsed.data } : null;
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
        await institutionSchoolPermissionForUser(db, user.id, schoolId, "facilities.manage", true);
        canManage = true;
    }
    catch (error) {
        if (!(error instanceof ForbiddenException))
            throw error;
    }
    return { person_id: actor.person_id, can_manage: canManage };
}
export async function resolveFacilitiesContinuation(db, identities, user, schoolId, path) {
    const parsed = parseFacilitiesContinuation(path), actor = await identity(db, identities, user, schoolId);
    if (!parsed || !actor)
        return null;
    // A technical manager is not automatically a participant in every private repair.
    const source = (await sql `SELECT id,revision,reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id
    FROM facilities_repairs WHERE school_id=${schoolId}::uuid AND id=${parsed.repair_id}::uuid
      AND ${actor.person_id}::uuid IN(reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id)`.execute(db)).rows[0];
    return source ? { source, path: facilitiesDestination(source.id) } : null;
}
export async function vettedFacilitiesResume(db, identities, user, workspace) {
    const accepted = workspace.owner_user_id === user.id
        ? await resolveFacilitiesContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
    return accepted ? { step: "operating", path: accepted.path }
        : { step: "first_use", path: facilitiesPath };
}
export async function readFacilitiesReadiness(db, identities, user, schoolId) {
    const base = { actor_user_id: user.id, environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
        evaluated_at: executionNow().toISOString(), requires_recheck: true };
    const actor = await identity(db, identities, user, schoolId);
    const source = actor ? (await sql `SELECT id,revision,reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id
    FROM facilities_repairs WHERE school_id=${schoolId}::uuid
      AND ${actor.person_id}::uuid IN(reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id)
    ORDER BY created_at DESC,id DESC LIMIT 1`.execute(db)).rows[0] : undefined;
    let routeReady = false;
    if (actor && identities) {
        const rule = (await sql `
      SELECT handler_person_id,verifier_mode,verifier_person_id FROM facilities_intake_rules
      WHERE school_id=${schoolId}::uuid ORDER BY revision DESC LIMIT 1`.execute(db)).rows[0];
        if (rule) {
            const handler = await identities.resolvePersonAgent(db, {
                school_id: schoolId, person_id: rule.handler_person_id, at: base.evaluated_at,
            });
            // An accepted intake rule names the exact handling responsibility. Its
            // active recipient need not manage all repair settings or other people.
            routeReady = handler.acting;
            if (routeReady && rule.verifier_mode === "named") {
                routeReady = Boolean(rule.verifier_person_id && (await identities.resolvePersonAgent(db, {
                    school_id: schoolId, person_id: rule.verifier_person_id, at: base.evaluated_at,
                })).acting);
            }
        }
    }
    const operation = source
        ? { ...base, action: "view", state: "repair_recorded", scope: { kind: "repair", id: source.id }, source_revision: source.revision, destination: facilitiesDestination(source.id) }
        : { ...base, action: routeReady ? "report" : actor?.can_manage ? "configure" : "unavailable",
            state: routeReady ? "ready_to_report" : actor?.can_manage ? "needs_intake" : "unavailable",
            scope: null, source_revision: null, destination: facilitiesPath };
    return { operation };
}
//# sourceMappingURL=facilities-readiness.js.map