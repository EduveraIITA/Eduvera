import { sql, type Kysely } from "kysely";
import type { Database } from "../database/types.js";

// Call only with class IDs from the date-scoped attendance workspace. Comments
// are private: only the author of the diary item receives its family replies.
export async function classUpdates(db: Kysely<Database>, classIds: string[], userId: string, date: string) {
  if (!classIds.length) return { results: [] };
  const rows = await sql<{
    id: string; class_section_id: string; kind: "note" | "comment" | "change";
    title: string; body: string; occurred_at: string; unread: boolean;
    notification_id: string | null; total: number;
  }>`WITH entries AS (
    SELECT di.id::text, di.class_section_id, 'note' AS kind, di.title, di.body,
      di.published_at AS occurred_at, false AS unread, NULL::uuid AS notification_id
    FROM diary_items di JOIN academic_terms t ON t.id=di.term_id
    WHERE di.class_section_id IN (${sql.join(classIds.map(id => sql`${id}::uuid`))})
      AND ${date}::date BETWEEN t.starts_on AND t.ends_on
      AND di.published_at <= now() AND di.date <= ${date}::date
      AND (di.published_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${date}::date-13 AND ${date}::date
    UNION ALL
    SELECT dn.id::text, di.class_section_id, 'comment', 'Comment on ' || di.title, dn.body,
      dn.created_at, false, NULL::uuid
    FROM diary_notes dn JOIN diary_items di ON di.id=dn.item_id JOIN academic_terms t ON t.id=di.term_id
    WHERE di.class_section_id IN (${sql.join(classIds.map(id => sql`${id}::uuid`))}) AND di.author_id=${userId}::uuid
      AND ${date}::date BETWEEN t.starts_on AND t.ends_on AND di.published_at<=now()
      AND dn.created_at<=now() AND (dn.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${date}::date-13 AND ${date}::date
      AND (di.item_type<>'homework' OR (
        EXISTS(SELECT 1 FROM staff_role_bindings learning WHERE learning.school_id=di.school_id AND learning.user_id=${userId}::uuid
          AND learning.context_kind='class' AND learning.scope_id=di.class_section_id AND learning.role_active AND learning.status='active'
          AND current_date>=learning.starts_on AND (learning.ends_on IS NULL OR current_date<=learning.ends_on) AND 'learning.work.publish'=ANY(learning.permissions)
          AND (learning.subject_id IS NULL OR learning.subject_id=di.subject_id))
        AND EXISTS(SELECT 1 FROM staff_role_bindings messaging WHERE messaging.school_id=di.school_id AND messaging.user_id=${userId}::uuid
          AND messaging.context_kind='class' AND messaging.scope_id=di.class_section_id AND messaging.role_active AND messaging.status='active'
          AND current_date>=messaging.starts_on AND (messaging.ends_on IS NULL OR current_date<=messaging.ends_on) AND 'messages.send'=ANY(messaging.permissions)
          AND (messaging.subject_id IS NULL OR messaging.subject_id=di.subject_id))))
    UNION ALL
    SELECT n.id::text, COALESCE(dp.class_section_id::text,n.metadata->>'class_section_id')::uuid, 'change', n.title, n.body, n.created_at, n.read_at IS NULL, n.id
    FROM notifications n LEFT JOIN day_plans dp ON dp.id::text=n.metadata->>'day_plan_id'
    WHERE n.recipient_id=${userId}::uuid AND COALESCE(dp.class_section_id::text,n.metadata->>'class_section_id') IN (${sql.join(classIds)})
      AND n.created_at<=now() AND (n.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${date}::date-13 AND ${date}::date
  ), ranked AS (
    SELECT *, count(*) OVER(PARTITION BY class_section_id)::int AS total,
      row_number() OVER(PARTITION BY class_section_id ORDER BY occurred_at DESC,id DESC) AS position FROM entries
  ) SELECT id,class_section_id,kind,title,body,occurred_at,unread,notification_id,total
    FROM ranked WHERE position<=50 ORDER BY occurred_at DESC,id DESC`.execute(db);
  return { results: rows.rows };
}
