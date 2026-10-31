import { BadRequestException, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { ConfiguredCommandPort } from "../campus-model-core/configured-command.port.js";
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import type { Database } from "../database/types.js";

const prefix = "attendance-activity-v1.";
const tokenSchema = z.object({
  version: z.literal(1), user_id: z.string().uuid(), school_id: z.string().uuid(), register_id: z.string().uuid(),
  namespace_id: z.string().min(1).max(180),
  key: z.string().refine(value => value.startsWith("command:") ? z.string().uuid().safeParse(value.slice(8)).success
    : /^evidence:(?:decision|action):[1-9][0-9]*$/u.test(value)),
}).strict();
export interface AttendanceHistoryScope { user_id: string; school_id: string; register_id: string; namespace_id: string }
export function attendanceHistoryScope(userId: string, schoolId: string, registerId: string): AttendanceHistoryScope {
  return { user_id: userId, school_id: schoolId, register_id: registerId,
    namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}` };
}
export function encodeAttendanceActivity(scope: AttendanceHistoryScope, key: string) {
  return prefix + Buffer.from(JSON.stringify(tokenSchema.parse({ version: 1, ...scope, key }))).toString("base64url");
}
/** A locator only. The caller must authorize this register before decoding. */
export function decodeAttendanceActivity(value: string, scope: AttendanceHistoryScope) {
  try {
    if (value.length > 2048 || !value.startsWith(prefix)) throw new Error("Invalid token");
    const encoded = value.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error("Invalid encoding");
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("Noncanonical encoding");
    const parsed = tokenSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
    for (const key of ["user_id", "school_id", "register_id", "namespace_id"] as const) if (parsed[key] !== scope[key]) throw new Error("Different scope");
    return parsed.key;
  } catch { throw new BadRequestException("This attendance activity belongs to another context. Reopen History and try again."); }
}

interface HistoryRow {
  id: string; action: string; person_id: string | null; name: string | null; previous_status: string | null; status: string | null;
  previous_remarks: string | null; remarks: string | null; reason: string | null; actor_name: string; human_actor_id: string | null;
  software_agent_ids: string[]; recorded_at: string; register_revision: number; request_id: string; capture_channel: string | null;
  observed_at: string | null; imported: boolean; batch_key: string;
}
interface ActivityRow {
  batch_key: string; action: string; actor_name: string; human_actor_id: string | null; software_actor_sets: string[][];
  recorded_at: string; reason: string | null; people_count: number; decision_count: number; correction_count: number; note_count: number;
  status_counts: Record<string, number>; person_name: string | null; previous_status: string | null; status: string | null;
}
const statuses = ["present", "absent", "late", "excused", "half_day", "no_show", "checked_out", "left_early"] as const;

/** Read-only projection over retained commands and evidence, never a new writer. */
export async function readAttendanceActivities(tx: Transaction<Database>, configured: Pick<ConfiguredCommandPort, "listRecordedSoftwareActors">,
  scope: AttendanceHistoryScope, input: { page: number; page_size: number; view?: "activities" | undefined; batch?: string | undefined }, softwareSchema: boolean) {
  const batch = input.batch ? decodeAttendanceActivity(input.batch, scope) : undefined;
  const humanName = sql`COALESCE(NULLIF(trim(concat_ws(' ',actor.first_name,actor.last_name)),''),NULLIF(trim(actor.username),''),'Recorded account')`;
  const source = sql`raw_history AS (
    SELECT 'decision:'||revision.id::text AS id,'decision'::text AS action,revision.person_id,roster.label AS name,
      revision.previous_status,revision.new_status AS status,revision.previous_remarks,revision.new_remarks AS remarks,revision.reason,
      ${humanName} AS actor_name,revision.changed_by AS human_actor_id,
      ${softwareSchema ? sql`ARRAY[revision.changed_by_agent_id::text]` : sql`ARRAY[]::text[]`} AS software_agent_ids,
      revision.created_at AS recorded_at,revision.register_revision,revision.request_id,revision.capture_channel,revision.observed_at,
      revision.capture_channel='legacy_import' AS imported
    FROM activity_attendance_entry_revisions revision JOIN activity_attendance_roster roster
      ON roster.register_id=revision.register_id AND roster.person_id=revision.person_id
    LEFT JOIN users actor ON actor.id=revision.changed_by
    WHERE revision.school_id=${scope.school_id}::uuid AND revision.register_id=${scope.register_id}::uuid
    UNION ALL SELECT 'action:'||audit.id::text,audit.action,NULL,NULL,NULL,NULL,NULL,NULL,audit.reason,
      ${humanName},audit.actor_id,
      ARRAY(SELECT reference->>'actor_agent_id' FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(audit.source_refs)='array' THEN audit.source_refs ELSE '[]'::jsonb END) reference),
      audit.created_at,audit.register_revision,audit.request_id,NULL,NULL,false
    FROM activity_attendance_audits audit LEFT JOIN users actor ON actor.id=audit.actor_id
    WHERE audit.school_id=${scope.school_id}::uuid AND audit.register_id=${scope.register_id}::uuid
  ), commands AS (
    SELECT request_id,register_revision,actor_id,${softwareSchema ? sql`actor_agent_id` : sql`NULL::uuid AS actor_agent_id`},
      min(id::text) AS id,min(operation) AS operation,count(*) AS matches
    FROM activity_attendance_commands WHERE school_id=${scope.school_id}::uuid AND register_id=${scope.register_id}::uuid
    GROUP BY request_id,register_revision,actor_id${softwareSchema ? sql`,actor_agent_id` : sql``}
  ), history AS (
    SELECT evidence.*,CASE WHEN command.matches=1 AND NOT evidence.imported THEN 'command:'||command.id
      ELSE 'evidence:'||evidence.id END AS batch_key
    FROM raw_history evidence LEFT JOIN commands command ON command.request_id=evidence.request_id
      AND command.register_revision=evidence.register_revision
      AND (evidence.action='decision' OR evidence.action=command.operation)
      AND (command.actor_id=evidence.human_actor_id OR (evidence.human_actor_id IS NULL AND command.actor_id IS NULL
        AND cardinality(evidence.software_agent_ids)=1 AND command.actor_agent_id::text=evidence.software_agent_ids[1]))
  )`;
  const page = (total: number) => ({ page: input.page, page_size: input.page_size, total, total_pages: Math.max(1, Math.ceil(total / input.page_size)) });
  const actorNames = async (rows: Array<{ human_actor_id: string | null; software_agent_ids: string[]; actor_name: string }>) => {
    const candidates = [...new Set(rows.filter(row => row.human_actor_id === null).flatMap(row => row.software_agent_ids)
      .filter((value): value is string => z.string().uuid().safeParse(value).success))];
    const software = new Set<string>();
    for (let start = 0; start < candidates.length; start += 2000) for (const actor of await configured.listRecordedSoftwareActors(tx,
      { school_id: scope.school_id, agent_ids: candidates.slice(start, start + 2000) })) software.add(actor.agent_id);
    return rows.map(row => row.human_actor_id !== null ? row.actor_name
      : row.software_agent_ids.some(id => software.has(id)) ? "Configured automatic decision" : "Unknown recorded actor");
  };
  if (batch) {
    const result = (await sql<{ payload: HistoryRow | null; total: number }>`WITH ${source}, selected AS (
        SELECT * FROM history WHERE batch_key=${batch}
      ), visible AS (SELECT * FROM selected ORDER BY recorded_at DESC,id DESC LIMIT ${input.page_size} OFFSET ${(input.page - 1) * input.page_size})
      SELECT to_jsonb(visible) AS payload,(SELECT count(*)::int FROM selected) AS total
      FROM (VALUES(1)) anchor(value) LEFT JOIN visible ON true ORDER BY visible.recorded_at DESC,visible.id DESC`.execute(tx)).rows;
    const total = result[0]?.total ?? 0;
    if (!total) throw new NotFoundException("This attendance activity is no longer available.");
    const rows = result.flatMap(row => row.payload ? [row.payload] : []), names = await actorNames(rows);
    return { ...page(total), activities: [], history: rows.map((row, index) => ({ id: row.id, action: row.action,
      person_id: row.person_id, name: row.name, previous_status: row.previous_status, status: row.status,
      previous_remarks: row.previous_remarks, remarks: row.remarks, reason: row.reason, actor_name: names[index]!,
      recorded_at: new Date(row.recorded_at).toISOString(), recorded_at_exact: row.recorded_at, register_revision: row.register_revision,
      capture_channel: row.capture_channel, observed_at: row.observed_at ? new Date(row.observed_at).toISOString() : null,
      observed_at_exact: row.observed_at })) };
  }
  const result = (await sql<{ payload: ActivityRow | null; total: number }>`WITH ${source}, activities AS (
      SELECT batch_key,max(register_revision) AS sort_revision,COALESCE(min(action) FILTER(WHERE action<>'decision'),'decision') AS action,
        max(actor_name) AS actor_name,max(human_actor_id::text) AS human_actor_id,jsonb_agg(software_agent_ids) AS software_actor_sets,
        max(recorded_at) AS recorded_at,COALESCE(min(reason) FILTER(WHERE action<>'decision'),min(reason)) AS reason,
        count(DISTINCT person_id)::int AS people_count,count(*) FILTER(WHERE person_id IS NOT NULL)::int AS decision_count,
        count(*) FILTER(WHERE person_id IS NOT NULL AND previous_status IS NOT NULL AND previous_status IS DISTINCT FROM status)::int AS correction_count,
        count(*) FILTER(WHERE person_id IS NOT NULL AND previous_status IS NOT DISTINCT FROM status AND previous_remarks IS DISTINCT FROM remarks)::int AS note_count,
        jsonb_build_object(${sql.join(statuses.flatMap(status => [sql`${status}::text`,sql`count(*) FILTER(WHERE person_id IS NOT NULL AND status=${status})::int`]))}) AS status_counts,
        CASE WHEN count(*) FILTER(WHERE person_id IS NOT NULL)=1 THEN min(name) END AS person_name,
        CASE WHEN count(*) FILTER(WHERE person_id IS NOT NULL)=1 THEN min(previous_status) END AS previous_status,
        CASE WHEN count(*) FILTER(WHERE person_id IS NOT NULL)=1 THEN min(status) END AS status
      FROM history GROUP BY batch_key
    ), visible AS (SELECT * FROM activities ORDER BY recorded_at DESC,sort_revision DESC,batch_key DESC LIMIT ${input.page_size} OFFSET ${(input.page - 1) * input.page_size})
    SELECT to_jsonb(visible) AS payload,(SELECT count(*)::int FROM activities) AS total
    FROM (VALUES(1)) anchor(value) LEFT JOIN visible ON true ORDER BY visible.recorded_at DESC,visible.sort_revision DESC,visible.batch_key DESC`.execute(tx)).rows;
  const rows = result.flatMap(row => row.payload ? [row.payload] : []);
  const names = await actorNames(rows.map(row => ({ ...row, software_agent_ids: row.software_actor_sets.flat() })));
  return { ...page(result[0]?.total ?? 0), history: [], activities: rows.map((row, index) => ({
    id: encodeAttendanceActivity(scope, row.batch_key), action: row.action, actor_name: names[index]!, recorded_at: new Date(row.recorded_at).toISOString(),
    reason: row.reason, people_count: row.people_count, decision_count: row.decision_count, correction_count: row.correction_count,
    note_count: row.note_count, status_counts: row.status_counts, person_name: row.person_name, previous_status: row.previous_status, status: row.status,
  })) };
}
