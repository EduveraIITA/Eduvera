import { ConflictException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
const namespaceIdSchema = z.string().trim().refine((value) => /^live:[^:\s]+$/.test(value) || /^scenario:[^:\s]+:run:[^:\s]+$/.test(value), "Use a server-issued execution namespace.");
export const operationalRealmScopeSchema = z.object({
    realm_id: z.string().uuid(),
    environment_namespace_id: namespaceIdSchema,
    legacy_school_id: z.string().uuid(),
}).strict();
export const modelAddressSchema = z.object({
    realm_id: z.string().uuid(),
    environment_namespace_id: namespaceIdSchema,
    model_id: z.string().uuid(),
}).strict();
export function compatibilityLiveNamespace(schoolId) {
    return `live:${schoolId}`;
}
export function executionNamespaceForSchool(schoolId, environment) {
    if (!environment)
        return compatibilityLiveNamespace(schoolId);
    if (environment.institution_id !== schoolId) {
        throw new ConflictException("The execution environment belongs to another operational realm.");
    }
    return environment.namespace_id;
}
/**
 * Resolves the compatibility school key into the new domain-neutral realm and
 * server-selected environment namespace. Simulation namespaces are registered
 * only inside their isolated data plane; this never writes to Live storage.
 */
export async function resolveOperationalRealmScope(transaction, schoolId, environment) {
    const realm = (await sql `SELECT id AS realm_id,legacy_school_id
    FROM operational_realms
    WHERE legacy_school_id=${schoolId}::uuid AND status IN ('setup','active')
    FOR SHARE`.execute(transaction)).rows[0];
    if (!realm)
        throw new ConflictException("The institution is not connected to an operational realm.");
    const namespaceId = executionNamespaceForSchool(schoolId, environment);
    if (environment?.kind === "simulation") {
        await sql `INSERT INTO execution_environment_namespaces(
        namespace_id,realm_id,environment_kind,source_namespace_id,status,expires_at
      ) VALUES (
        ${namespaceId},${realm.realm_id}::uuid,'simulation',${environment.source_live_namespace_id},
        'active',${environment.expires_at}::timestamptz
      ) ON CONFLICT(namespace_id) DO NOTHING`.execute(transaction);
    }
    const namespace = (await sql `SELECT EXISTS(
      SELECT 1 FROM execution_environment_namespaces
      WHERE namespace_id=${namespaceId} AND realm_id=${realm.realm_id}::uuid AND status='active'
    ) AS found`.execute(transaction)).rows[0];
    if (!namespace?.found) {
        throw new ConflictException("The execution namespace is unavailable for this operational realm.");
    }
    return operationalRealmScopeSchema.parse({
        realm_id: realm.realm_id,
        environment_namespace_id: namespaceId,
        legacy_school_id: realm.legacy_school_id,
    });
}
//# sourceMappingURL=operational-realm.js.map