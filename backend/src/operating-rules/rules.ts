import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";

export const rulesSchema = z.object({
  event_entry_hours_before: z.number().int().min(0).max(168),
  event_staff_hours_after: z.number().int().min(0).max(720),
  journey_lead_minutes: z.number().int().min(0).max(240),
  message_edit_minutes: z.number().int().min(0).max(60),
  message_attachment_mb: z.number().int().min(1).max(10),
  attendance_submission_cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
export type OperatingRules = z.infer<typeof rulesSchema> & { revision: number };
export type RulesDb = Kysely<Database> | Transaction<Database>;
export async function operatingRules(db: RulesDb, schoolId: string): Promise<OperatingRules> {
  const result = await sql<OperatingRules>`SELECT
    COALESCE(r.event_entry_hours_before,2)::int event_entry_hours_before,
    COALESCE(r.event_staff_hours_after,24)::int event_staff_hours_after,
    COALESCE(r.journey_lead_minutes,30)::int journey_lead_minutes,
    COALESCE(r.message_edit_minutes,2)::int message_edit_minutes,
    COALESCE(r.message_attachment_mb,10)::int message_attachment_mb,
    to_char(s.attendance_submission_cutoff,'HH24:MI') attendance_submission_cutoff,
    COALESCE(r.revision,0)::int revision
    FROM schools s LEFT JOIN institution_operating_rules r ON r.school_id=s.id WHERE s.id=${schoolId}::uuid`.execute(db);
  if (!result.rows[0]) throw new Error("Institution not found.");
  return result.rows[0];
}
