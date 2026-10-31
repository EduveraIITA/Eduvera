import { sql } from "kysely";
import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";
export const resourceLoansPath = "/areas/resources";
export const resourceLoansSetupPath = "/more/setup/capabilities?task=resources";
export const resourceLoanDestination = (id) => `${resourceLoansPath}?loan_id=${id}`;
export function parseResourceLoanContinuation(path) {
    if (path.length > 160 || !path.startsWith("/") || path.startsWith("//"))
        return null;
    const url = new URL(path, "https://thatcampus.invalid");
    if (url.origin !== "https://thatcampus.invalid" || url.pathname !== resourceLoansPath || url.hash
        || [...url.searchParams.keys()].some(key => key !== "loan_id") || url.searchParams.getAll("loan_id").length !== 1)
        return null;
    const result = z.uuid().safeParse(url.searchParams.get("loan_id"));
    return result.success ? { loan_id: result.data } : null;
}
async function identity(db, identities, user, schoolId) {
    const world = executionEnvironmentStorage.getStore();
    if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId)
        return null;
    const person = await identities.resolveAccountEndpoint(db, {
        school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
    });
    if (!person.acting)
        return null;
    let canIssue = false;
    try {
        await institutionSchoolPermissionForUser(db, user.id, schoolId, "resources.manage");
        canIssue = true;
    }
    catch (error) {
        if (!(error instanceof ForbiddenException))
            throw error;
    }
    return { person_id: person.person_id, can_issue: canIssue };
}
export async function resolveResourceLoanContinuation(db, identities, user, schoolId, path) {
    const parsed = parseResourceLoanContinuation(path), actor = await identity(db, identities, user, schoolId);
    if (!parsed || !actor)
        return null;
    const source = (await sql `SELECT id,revision,custodian_person_id,borrower_person_id FROM resource_loans
    WHERE school_id=${schoolId}::uuid AND id=${parsed.loan_id}::uuid
      AND (borrower_person_id=${actor.person_id}::uuid OR (${actor.can_issue} AND custodian_person_id=${actor.person_id}::uuid))`.execute(db)).rows[0];
    return source ? { source, path: resourceLoanDestination(source.id) } : null;
}
export async function vettedResourceLoansResume(db, identities, user, workspace) {
    const accepted = workspace.owner_user_id === user.id
        ? await resolveResourceLoanContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
    return accepted ? { step: "operating", path: accepted.path }
        : { step: "first_use", path: resourceLoansPath };
}
export async function readResourceLoansReadiness(db, identities, user, schoolId) {
    const base = { actor_user_id: user.id,
        environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
        evaluated_at: executionNow().toISOString(), requires_recheck: true };
    const actor = await identity(db, identities, user, schoolId);
    let source;
    if (actor)
        source = (await sql `SELECT id,revision,custodian_person_id,borrower_person_id FROM resource_loans
    WHERE school_id=${schoolId}::uuid AND revision>0
      AND (borrower_person_id=${actor.person_id}::uuid OR (${actor.can_issue} AND custodian_person_id=${actor.person_id}::uuid))
    ORDER BY issued_at DESC,id DESC LIMIT 1`.execute(db)).rows[0];
    const operation = source ? { ...base, action: "view",
        state: source.custodian_person_id === actor.person_id && actor.can_issue ? "loan_recorded" : "borrower_view",
        scope: { kind: "loan", id: source.id }, source_revision: source.revision, destination: resourceLoanDestination(source.id) }
        : { ...base, action: actor?.can_issue ? "issue" : "unavailable", state: actor?.can_issue ? "ready_to_issue" : "unavailable",
            scope: null, source_revision: null, destination: resourceLoansPath };
    return { operation };
}
//# sourceMappingURL=resource-loan-readiness.js.map