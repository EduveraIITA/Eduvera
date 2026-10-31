import { ForbiddenException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";

export interface OperationalFeeSource {
  permission: "fees.manage"; source_type: "administrator" | "assignment" | "exception"; source_id: string; source_name: string;
  context_kind: "institution"; scope_id: string; scope_label: string; starts_on: string; ends_on: string | null; revision: number;
  role_id: string | null; role_revision: number | null;
}
export interface OperationalFeeAccess { role: "admin" | "staff"; sources: OperationalFeeSource[] }

/** Technical ledger authority only. It never establishes an institutional decision mandate.
 * A caller must also resolve its current acting identity. Resource-only exceptions
 * cannot expand to an arbitrary canonical-person invoice.
 */
export async function operationalFeeAccess(db: Kysely<Database> | Transaction<Database>, userId: string, schoolId: string, lock = false): Promise<OperationalFeeAccess> {
  const member = (await sql<{ role: string }>`SELECT membership.role FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${userId}::uuid AND membership.is_active
    ORDER BY(membership.role='admin') DESC,(membership.role='staff') DESC LIMIT 1 ${lock ? sql`FOR SHARE OF membership,account` : sql``}`.execute(db)).rows[0];
  if (member?.role === "admin") return { role: "admin", sources: [{ permission: "fees.manage", source_type: "administrator", source_id: schoolId,
    source_name: "Protected campus administration", context_kind: "institution", scope_id: schoolId, scope_label: "Institution", starts_on: "", ends_on: null, revision: 1, role_id: null, role_revision: null }] };
  if (member?.role !== "staff") throw new ForbiddenException("Current institution-scoped Finance recording access is required.");
  const sources = (await sql<OperationalFeeSource>`WITH campus AS (
      SELECT (${executionNow()}::timestamptz AT TIME ZONE timezone)::date AS today FROM schools WHERE id=${schoolId}::uuid
    ) SELECT 'fees.manage'::text AS permission,'assignment'::text AS source_type,binding.source_id,binding.role_name AS source_name,
      'institution'::text AS context_kind,binding.scope_id,'Institution'::text AS scope_label,binding.starts_on::text,binding.ends_on::text,binding.revision,binding.role_id,role.revision AS role_revision
    FROM staff_role_bindings binding JOIN staff_responsibility_types role ON role.school_id=binding.school_id AND role.id=binding.role_id CROSS JOIN campus WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${userId}::uuid
      AND binding.context_kind='institution' AND binding.scope_id=${schoolId}::uuid AND binding.role_active AND binding.status='active'
      AND 'fees.manage'=ANY(binding.permissions) AND campus.today BETWEEN binding.starts_on AND coalesce(binding.ends_on,'infinity'::date)
    UNION ALL SELECT 'fees.manage','exception',exception.id,'Approved institution Finance access','institution',exception.school_id,'Institution',
      exception.valid_from::text,exception.valid_until::text,exception.revision,NULL::uuid,NULL::integer FROM school_access_exceptions exception CROSS JOIN campus
      WHERE exception.school_id=${schoolId}::uuid AND exception.user_id=${userId}::uuid AND exception.permission='fees.manage'
        AND exception.scope_kind='institution' AND exception.status='active' AND campus.today BETWEEN exception.valid_from AND exception.valid_until
    ORDER BY source_type,source_id`.execute(db)).rows;
  if (!sources.length) throw new ForbiddenException("Current institution-scoped Finance recording access is required.");
  if (lock) {
    const assignments = sources.filter(source => source.source_type === "assignment").map(source => source.source_id), roles = sources.flatMap(source => source.role_id ? [source.role_id] : []);
    const exceptions = sources.filter(source => source.source_type === "exception").map(source => source.source_id);
    if (roles.length) await sql`SELECT id FROM staff_responsibility_types WHERE school_id=${schoolId}::uuid AND id=ANY(${roles}::uuid[]) ORDER BY id FOR SHARE`.execute(db);
    if (assignments.length) await sql`SELECT id FROM staff_responsibility_assignments WHERE school_id=${schoolId}::uuid AND id=ANY(${assignments}::uuid[]) ORDER BY id FOR SHARE`.execute(db);
    if (exceptions.length) await sql`SELECT id FROM school_access_exceptions WHERE school_id=${schoolId}::uuid AND id=ANY(${exceptions}::uuid[]) ORDER BY id FOR SHARE`.execute(db);
    const current = await operationalFeeAccess(db, userId, schoolId);
    if (JSON.stringify(current.sources) !== JSON.stringify(sources)) throw new ForbiddenException("Your Finance responsibility changed. Refresh before continuing.");
  }
  return { role: "staff", sources };
}
