import { ForbiddenException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";
export const accommodationPath = "/areas/accommodation";
export const accommodationSetupPath = "/more/setup/capabilities?task=accommodation";
export const accommodationDestination = (id) => `${accommodationPath}?stay_id=${id}`;
/** Presentation state can select one source, never a resident, actor or world. */
export function parseAccommodationContinuation(path) {
    if (path.length > 180 || !path.startsWith("/") || path.startsWith("//"))
        return null;
    const url = new URL(path, "https://thatcampus.invalid");
    if (url.origin !== "https://thatcampus.invalid" || url.pathname !== accommodationPath || url.hash
        || [...url.searchParams.keys()].some(key => key !== "stay_id") || url.searchParams.getAll("stay_id").length !== 1)
        return null;
    const parsed = z.uuid().safeParse(url.searchParams.get("stay_id"));
    return parsed.success ? { stay_id: parsed.data } : null;
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
    let canOffer = false;
    try {
        await institutionSchoolPermissionForUser(db, user.id, schoolId, "accommodation.manage", true);
        canOffer = true;
    }
    catch (error) {
        if (!(error instanceof ForbiddenException))
            throw error;
    }
    return { person_id: actor.person_id, can_offer: canOffer };
}
export async function resolveAccommodationContinuation(db, identities, user, schoolId, path) {
    const parsed = parseAccommodationContinuation(path), actor = await identity(db, identities, user, schoolId);
    if (!parsed || !actor)
        return null;
    // Setup authority never makes an unrelated manager a resident-data participant.
    const source = (await sql `SELECT id,revision,resident_person_id,coordinator_person_id,recorder_person_id,accepted_at,state
    FROM accommodation_stays WHERE school_id=${schoolId}::uuid AND id=${parsed.stay_id}::uuid
      AND ${actor.person_id}::uuid IN(resident_person_id,coordinator_person_id,recorder_person_id)`.execute(db)).rows[0];
    return source ? { source, path: accommodationDestination(source.id) } : null;
}
export async function vettedAccommodationResume(db, identities, user, workspace) {
    const retained = workspace.owner_user_id === user.id
        ? await resolveAccommodationContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
    return retained ? { step: retained.source.accepted_at ? "operating" : "first_use", path: retained.path }
        : { step: "first_use", path: accommodationPath };
}
export async function readAccommodationReadiness(db, identities, user, schoolId) {
    const base = { actor_user_id: user.id, environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
        evaluated_at: executionNow().toISOString(), requires_recheck: true };
    const actor = await identity(db, identities, user, schoolId);
    const source = actor ? (await sql `SELECT id,revision,resident_person_id,coordinator_person_id,recorder_person_id,accepted_at,state
    FROM accommodation_stays WHERE school_id=${schoolId}::uuid
      AND ${actor.person_id}::uuid IN(resident_person_id,coordinator_person_id,recorder_person_id)
      AND (accepted_at IS NOT NULL OR state='offered')
    ORDER BY (accepted_at IS NOT NULL) DESC,created_at DESC,id DESC LIMIT 1`.execute(db)).rows[0] : undefined;
    const hasRooms = actor?.can_offer ? Boolean((await sql `SELECT id FROM accommodation_rooms
    WHERE school_id=${schoolId}::uuid AND active LIMIT 1`.execute(db)).rows[0]) : false;
    const operation = source
        ? { ...base, action: "view", state: source.accepted_at ? "arrangement_recorded" : "offer_recorded",
            scope: { kind: "stay", id: source.id }, source_revision: source.revision, destination: accommodationDestination(source.id) }
        : { ...base, action: actor?.can_offer ? hasRooms ? "offer" : "configure" : "unavailable",
            state: actor?.can_offer ? hasRooms ? "ready_to_offer" : "needs_rooms" : "unavailable",
            scope: null, source_revision: null, destination: accommodationPath };
    return { operation };
}
//# sourceMappingURL=accommodation-readiness.js.map