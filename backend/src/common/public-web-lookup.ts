import { sql, type Transaction } from 'kysely';
import type { Database } from '../database/types.js';

export const PUBLIC_WEB_LOOKUP_STEP='assistant_public_web_lookup';
export const FREE_PUBLIC_WEB_DAILY_LIMIT=20;

export function freePublicWebEnabled() {
  return process.env.CAMPUS_FLOOR_PLAN_FREE_SEARCH_ENABLED==='true';
}

/** Call inside the campus import admission lock so both entry points share one allowance. */
export async function publicWebLookupsSince(tx:Transaction<Database>,since:Date) {
  const {count}=(await sql<{count:number}>`SELECT count(*)::int AS count FROM (
    SELECT created_at FROM campus_scene_import_runs WHERE kind='lookup' AND created_at>=${since}
    UNION ALL SELECT created_at FROM agent_tool_steps WHERE capability=${PUBLIC_WEB_LOOKUP_STEP} AND kind='handoff' AND created_at>=${since}
  ) lookups`.execute(tx)).rows[0]!;
  return count;
}
