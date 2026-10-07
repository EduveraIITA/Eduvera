import { ForbiddenException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import { PERMISSIONS } from "./permissions.js";

type Db = Kysely<Database> | Transaction<Database>;

export interface AccessSource {
  permission: string;
  source_type: "administrator" | "assignment" | "responsibility" | "class_assignment" | "event_assignment" | "assessment_assignment" | "transport_trip" | "coverage" | "safeguarding_role" | "exception";
  source_id: string;
  source_name: string;
  scope_label: string;
  starts_on: string;
  ends_on: string | null;
}

async function activeMembership(db: Db, userId: string, schoolId: string, lock = false) {
  return (await sql<{ role: string }>`SELECT membership.role
    FROM school_memberships membership
    JOIN users account ON account.id=membership.user_id
    WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${userId}::uuid
      AND membership.is_active AND account.is_active
    ORDER BY (membership.role='admin') DESC,(membership.role='staff') DESC
    LIMIT 1 ${lock ? sql`FOR SHARE OF membership,account` : sql``}`.execute(db)).rows[0]?.role;
}

export async function effectiveSchoolAccess(
  db: Db,
  userId: string,
  schoolId: string,
  permission?: string,
  lock = false,
): Promise<{ role: string; sources: AccessSource[] }> {
  z.uuid().parse(userId);
  z.uuid().parse(schoolId);
  if (permission && !PERMISSIONS.some((item) => item.code === permission)) {
    throw new ForbiddenException(`Unknown school permission ${permission}.`);
  }
  const role = await activeMembership(db, userId, schoolId, lock);
  if (!role) throw new ForbiddenException("An active membership in this institution is required.");
  if (role === "admin") {
    const requested = permission ? PERMISSIONS.filter((item) => item.code === permission) : PERMISSIONS;
    return {
      role,
      sources: requested.map((item) => ({
        permission: item.code,
        source_type: "administrator" as const,
        source_id: schoolId,
        source_name: "Administrator authority",
        scope_label: "Institution",
        starts_on: "",
        ends_on: null,
      })),
    };
  }
  if (role !== "staff") return { role, sources: [] };

  const sources = await sql<AccessSource>`WITH access_sources AS (
      SELECT capability.permission,binding.source_kind AS source_type,binding.source_id,
        binding.role_name AS source_name,binding.scope_label,binding.starts_on,binding.ends_on
      FROM staff_role_bindings binding
      CROSS JOIN LATERAL unnest(binding.permissions) AS capability(permission)
      WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${userId}::uuid
        AND (binding.status='active' OR (binding.status='completed' AND capability.permission IN ('events.view','departure.collect'))) AND binding.role_active
        AND binding.starts_on<=current_date AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)

      UNION ALL
      SELECT capability.permission,'coverage',task.id,type.name,task.title,
        task.duty_date,task.duty_date
      FROM staff_coverage_tasks task
      JOIN staff_profiles profile ON profile.id=task.replacement_staff_profile_id AND profile.user_id=${userId}::uuid
      JOIN staff_responsibility_types type ON type.school_id=task.school_id AND type.code='subject_teacher'
      CROSS JOIN LATERAL unnest(CASE WHEN task.status='accepted' AND task.duty_date=current_date
        THEN type.capability_permissions || ARRAY['dayplans.respond'] ELSE ARRAY['dayplans.respond'] END) AS capability(permission)
      WHERE task.school_id=${schoolId}::uuid AND task.status IN ('offered','accepted')
        AND task.duty_date>=current_date

      UNION ALL
      SELECT capability.permission,'coverage',period.id,'Lesson cover','Class '||section.grade||section.section,plan.date,plan.date
      FROM day_plans plan JOIN day_plan_periods period ON period.plan_id=plan.id AND period.version=plan.published_version
      JOIN class_sections section ON section.id=plan.class_section_id
      JOIN school_memberships member ON member.id=period.teacher_membership_id AND member.user_id=${userId}::uuid AND member.is_active
      CROSS JOIN LATERAL unnest(CASE WHEN period.coverage_status='accepted' AND plan.date=current_date
        THEN ARRAY['dayplans.respond','timetable.view','attendance.view','attendance.record','photo.use']
        ELSE ARRAY['dayplans.respond','timetable.view'] END) AS capability(permission)
      WHERE plan.school_id=${schoolId}::uuid AND plan.date>=current_date AND NOT period.cancelled AND period.coverage_status IN ('pending','accepted')

      UNION ALL
      SELECT capability.permission,'safeguarding_role',assignment.id,type.name,
        replace(assignment.role_kind,'_',' '),assignment.valid_from,assignment.valid_until
      FROM restricted_care_role_assignments assignment
      JOIN staff_responsibility_types type ON type.school_id=assignment.school_id AND type.code='safety_officer'
      CROSS JOIN LATERAL unnest(type.capability_permissions) AS capability(permission)
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.user_id=${userId}::uuid
        AND assignment.status='active' AND assignment.valid_from<=current_date
        AND (assignment.valid_until IS NULL OR assignment.valid_until>=current_date)

      UNION ALL
      SELECT exception.permission,'exception',exception.id,
        CASE exception.source_kind WHEN 'manual' THEN 'Approved access exception' ELSE 'Migration access exception' END,
        CASE exception.scope_kind WHEN 'assigned_resources' THEN 'Assigned resources only' ELSE 'Institution' END,
        exception.valid_from,exception.valid_until
      FROM school_access_exceptions exception
      WHERE exception.school_id=${schoolId}::uuid AND exception.user_id=${userId}::uuid
        AND exception.status='active' AND current_date BETWEEN exception.valid_from AND exception.valid_until
    )
    SELECT DISTINCT permission,source_type,source_id,source_name,scope_label,
      starts_on::text,ends_on::text
    FROM access_sources
    WHERE (${permission ?? null}::text IS NULL OR permission=${permission ?? null})
    ORDER BY permission,source_type,source_name,source_id`.execute(db);
  return { role, sources: sources.rows };
}

/** Check the action on the SAME binding as the resource. Never combine the
 * permission from class A with a read-only relationship to class B. */
export async function hasScopedSchoolPermission(
  db: Db, userId: string, schoolId: string, permission: string,
  context: string, resourceId: string, subjectId?: string | null,
) {
  const member = await activeMembership(db, userId, schoolId);
  if (member === "admin") return true;
  if (member !== "staff") return false;
  return Boolean((await sql<{ allowed: boolean }>`SELECT EXISTS(
    SELECT 1 FROM staff_role_bindings binding
    WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${userId}::uuid
      AND binding.context_kind=${context} AND binding.scope_id=${resourceId}::uuid
      AND binding.status='active' AND binding.role_active
      AND binding.starts_on<=current_date AND (binding.ends_on IS NULL OR binding.ends_on>=current_date)
      AND ${permission}=ANY(binding.permissions)
      AND (${subjectId ?? null}::uuid IS NULL OR binding.subject_id IS NULL OR binding.subject_id=${subjectId ?? null}::uuid)
  ) AS allowed`.execute(db)).rows[0]?.allowed);
}

export async function schoolPermissionForUser(
  db: Db,
  userId: string,
  schoolId: string,
  permission: string,
  lock = false,
) {
  const access = await effectiveSchoolAccess(db, userId, schoolId, permission, lock);
  if (access.role !== "admin" && !access.sources.length) {
    throw new ForbiddenException(`School permission ${permission} is required.`);
  }
  return access;
}

export async function schoolPermission(db: Db, user: AuthUser, schoolId: string, permission: string, lock = false) {
  return schoolPermissionForUser(db, user.id, schoolId, permission, lock);
}

export async function assertActiveSchoolStaffMember(db: Db, userId: string, schoolId: string, workLabel: string) {
  const result = await sql<{ role: string; eligible: boolean }>`SELECT membership.role,true AS eligible
    FROM school_memberships membership JOIN users account ON account.id=membership.user_id AND account.is_active
    WHERE membership.school_id=${schoolId}::uuid AND membership.user_id=${userId}::uuid
      AND membership.role IN ('admin','staff') AND membership.is_active
    ORDER BY (membership.role='admin') DESC LIMIT 1`.execute(db);
  if (!result.rows[0]?.eligible) {
    throw new ForbiddenException(`Choose an active staff member before assigning ${workLabel.replaceAll("_", " ")}.`);
  }
  return result.rows[0];
}
