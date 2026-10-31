import { sql, type Kysely, type RawBuilder } from "kysely";
import type { Database } from "../database/types.js";

export interface AssignedAnalyticsScope {
  school: string;
  user: string;
  today: string;
  assignedAdministrator: boolean;
}
type SqlValue = string | RawBuilder<unknown>;

/** The neutral assigned-work audience can also belong to an administrator.
 * Do not turn that transport choice into the administrator's institution grant:
 * use the SAME current, dated binding as the requested resource instead.
 * Ordinary staff keep their owning SQL resolvers, including their established
 * timetable compatibility and ended-binding precedence. */
function explicitAdministratorBinding(scope: AssignedAnalyticsScope, permission: string, atDate: SqlValue) {
  return sql<boolean>`binding.school_id=${scope.school}::uuid AND binding.user_id=${scope.user}::uuid
    AND binding.role_active AND binding.status='active' AND ${permission}=ANY(binding.permissions)
    AND ${scope.today}::date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
    AND ${atDate}::date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
    AND EXISTS(SELECT 1 FROM school_memberships member JOIN users account ON account.id=member.user_id AND account.is_active
      WHERE member.school_id=binding.school_id AND member.user_id=binding.user_id AND member.role='admin' AND member.is_active)`;
}

export function assignedAnalyticsClassPermission(scope: AssignedAnalyticsScope, resource: SqlValue, atDate: SqlValue) {
  if (!scope.assignedAdministrator) return sql<boolean>`staff_has_class_permission(${scope.school}::uuid,${scope.user}::uuid,'attendance.view',${resource}::uuid,${atDate}::date)`;
  return sql<boolean>`EXISTS(SELECT 1 FROM staff_role_bindings binding
    WHERE ${explicitAdministratorBinding(scope, "attendance.view", atDate)}
      AND ((binding.context_kind='class' AND binding.scope_id=${resource}::uuid)
        OR (binding.context_kind='institution' AND binding.scope_id=${scope.school}::uuid)))`;
}

export function assignedAnalyticsAssessmentPermission(scope: AssignedAnalyticsScope, resource: SqlValue) {
  if (!scope.assignedAdministrator) return sql<boolean>`staff_has_resource_permission(${scope.school}::uuid,${scope.user}::uuid,'assessments.view','assessment',${resource}::uuid,${scope.today}::date)`;
  return sql<boolean>`EXISTS(SELECT 1 FROM staff_role_bindings binding
    WHERE ${explicitAdministratorBinding(scope, "assessments.view", scope.today)}
      AND binding.context_kind='assessment' AND binding.scope_id=${resource}::uuid)`;
}

/** Administrator-wide effectiveSchoolAccess is deliberately not used here.
 * Section discovery may expose only current explicit analytical assignments;
 * each subsequent data query still checks its exact binding/resource/date. */
export async function assignedAdministratorAnalyticsPermissions(db: Kysely<Database>, scope: AssignedAnalyticsScope): Promise<Set<string>> {
  const result = await sql<{ permission: string }>`SELECT DISTINCT capability.permission
    FROM staff_role_bindings binding CROSS JOIN LATERAL unnest(binding.permissions) capability(permission)
    WHERE binding.school_id=${scope.school}::uuid AND binding.user_id=${scope.user}::uuid
      AND binding.role_active AND binding.status='active'
      AND ${scope.today}::date BETWEEN binding.starts_on AND COALESCE(binding.ends_on,'infinity'::date)
      AND capability.permission IN ('attendance.view','assessments.view')
      AND EXISTS(SELECT 1 FROM school_memberships member JOIN users account ON account.id=member.user_id AND account.is_active
        WHERE member.school_id=binding.school_id AND member.user_id=binding.user_id AND member.role='admin' AND member.is_active)`.execute(db);
  return new Set(result.rows.map(row => row.permission));
}
