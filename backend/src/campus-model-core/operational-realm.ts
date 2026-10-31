import { ConflictException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { ExecutionEnvironment } from "./execution-environment.contracts.js";

const namespaceIdSchema = z.string().trim().refine(
  (value) => /^live:[^:\s]+$/.test(value) || /^scenario:[^:\s]+:run:[^:\s]+$/.test(value),
  "Use a server-issued execution namespace.",
);

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

export type OperationalRealmScope = z.infer<typeof operationalRealmScopeSchema>;
export type ModelAddress = z.infer<typeof modelAddressSchema>;

interface RealmRow {
  realm_id: string;
  legacy_school_id: string;
}

export function compatibilityLiveNamespace(schoolId: string): `live:${string}` {
  return `live:${schoolId}`;
}

export function executionNamespaceForSchool(
  schoolId: string,
  environment: ExecutionEnvironment | undefined,
): string {
  if (!environment) return compatibilityLiveNamespace(schoolId);
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
export async function resolveOperationalRealmScope(
  transaction: Transaction<Database>,
  schoolId: string,
  environment: ExecutionEnvironment | undefined,
): Promise<OperationalRealmScope> {
  const realm = (await sql<RealmRow>`SELECT id AS realm_id,legacy_school_id
    FROM operational_realms
    WHERE legacy_school_id=${schoolId}::uuid AND status IN ('setup','active')
    FOR SHARE`.execute(transaction)).rows[0];
  if (!realm) throw new ConflictException("The institution is not connected to an operational realm.");

  const namespaceId = executionNamespaceForSchool(schoolId, environment);
  if (environment?.kind === "simulation") {
    await sql`INSERT INTO execution_environment_namespaces(
        namespace_id,realm_id,environment_kind,source_namespace_id,status,expires_at
      ) VALUES (
        ${namespaceId},${realm.realm_id}::uuid,'simulation',${environment.source_live_namespace_id},
        'active',${environment.expires_at}::timestamptz
      ) ON CONFLICT(namespace_id) DO NOTHING`.execute(transaction);
  }
  const namespace = (await sql<{ found: boolean }>`SELECT EXISTS(
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
