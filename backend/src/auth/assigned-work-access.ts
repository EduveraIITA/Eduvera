import { ForbiddenException, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { AuthUser, RequestWithContext } from '../common/request.js';
import { DatabaseService } from '../database/database.service.js';
import type { Database } from '../database/types.js';

/** Technical app scope only. Each owning domain still checks its exact source. */
export async function assignedWorkOnly(db: Kysely<Database> | Transaction<Database>, schoolId: string, userId: string): Promise<boolean> {
  const row = (await sql<{ limited: boolean }>`SELECT campus_membership_is_work_only(${schoolId}::uuid,${userId}::uuid) AS limited`.execute(db)).rows[0];
  return row?.limited === true;
}

/** Deliberately bounded adapters, not a role portal or a caller-selected scope. */
export function assignedWorkRequestAllowed(method: string, path: string, schoolId: string): boolean {
  const verb = method.toUpperCase();
  const read = verb === 'GET' || verb === 'HEAD';
  if (read && /^\/api\/v1\/(?:workspace|events\/stream|notifications)\/?$/u.test(path)) return true;
  const visit = path.match(/^\/api\/v1\/gate\/schools\/([0-9a-f-]+)\/visit-arrangements\/(.+?)\/?$/iu);
  if (visit) {
    if (visit[1]?.toLowerCase() !== schoolId.toLowerCase()) return false;
    const tail = visit[2]!;
    if (read && /^(?:registered|shared(?:\/discovery)?|[0-9a-f-]+\/participant|[0-9a-f-]+\/shared(?:\/commands\/[0-9a-f-]+)?)$/iu.test(tail)) return true;
    return verb === 'POST' && /^[0-9a-f-]+\/shared\/questions$/iu.test(tail);
  }
  const campus = path.match(/^\/api\/v1\/schools\/([0-9a-f-]+)\/(.+?)\/?$/iu);
  if (!campus || campus[1]?.toLowerCase() !== schoolId.toLowerCase()) return false;
  const tail = campus[2]!;
  if (read && /^invitations\/[0-9a-f-]+\/continuation$/iu.test(tail)) return true;
  if (read && tail === 'facilities/workspace') return true;
  if (read && /^facilities\/repairs\/[0-9a-f-]+(?:\/(?:confirmation|photos\/[0-9a-f-]+))?$/iu.test(tail)) return true;
  return verb === 'POST' && /^facilities\/repairs\/[0-9a-f-]+\/(?:actions|photos|external-access\/[0-9a-f-]+\/activate)$/iu.test(tail);
}

@Injectable()
export class AssignedWorkAccess {
  constructor(private readonly db: DatabaseService) {}

  async only(user: AuthUser, schoolId = user.active_school_id): Promise<boolean> {
    return Boolean(schoolId) && assignedWorkOnly(this.db, schoolId!, user.id);
  }

  /** Called inside the selected-world data-plane scope, never an earlier guard. */
  async assertRequest(request: RequestWithContext): Promise<void> {
    if (!request.authUser?.active_school_id || !await this.only(request.authUser)) return;
    const path = request.url.split('?', 1)[0]!;
    if (!assignedWorkRequestAllowed(request.method, path, request.authUser.active_school_id))
      throw new ForbiddenException('This campus access is limited to items shared with you. Open your Areas or Work to continue.');
  }
}
