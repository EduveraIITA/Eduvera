import { ForbiddenException } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import type { AuthUser } from '../common/request.js';
import type { Database } from '../database/types.js';
import { DEFAULT_STAFF_PERMISSIONS } from './permissions.js';
export async function schoolPermission(db: Kysely<Database> | Transaction<Database>, user: AuthUser, schoolId: string, permission: string, lock = false) {
  z.uuid().parse(schoolId);
  const defaultGranted = DEFAULT_STAFF_PERMISSIONS.includes(permission);
  const row = (await sql<{role: string}>`SELECT m.role FROM school_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.school_id=${schoolId}::uuid AND m.user_id=${user.id}::uuid AND m.is_active AND u.is_active
    AND (m.role='admin' OR (m.role='staff' AND (
      (${defaultGranted} AND NOT EXISTS (SELECT 1 FROM school_custom_role_assignments a WHERE a.school_id=m.school_id AND a.user_id=m.user_id)) OR EXISTS (
      SELECT 1 FROM school_custom_role_assignments a JOIN school_custom_roles r ON r.school_id=a.school_id AND r.id=a.role_id
      WHERE a.school_id=m.school_id AND a.user_id=m.user_id AND ${permission}=ANY(r.permissions)
      UNION ALL SELECT 1 FROM school_permission_grants g WHERE g.school_id=m.school_id AND g.user_id=m.user_id AND g.permission=${permission}
      AND NOT EXISTS (SELECT 1 FROM school_custom_role_assignments a WHERE a.school_id=m.school_id AND a.user_id=m.user_id)
    )))) ORDER BY (m.role='admin') DESC LIMIT 1 ${lock ? sql`FOR SHARE OF m,u` : sql``}`.execute(db)).rows[0];
  if (!row) throw new ForbiddenException(`School permission ${permission} is required.`);
  return row;
}
