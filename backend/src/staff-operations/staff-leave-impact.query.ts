import { sql, type RawBuilder } from "kysely";

/** One source selection for preview and approval. These are the existing Staff
 * coverage semantics; this read does not invent a second calendar or duty plan. */
export interface StaffLeaveCoverageWindow {
  school_id: string | RawBuilder<unknown>;
  staff_profile_id: string | RawBuilder<unknown>;
  teacher_user_id: string | null | RawBuilder<unknown>;
  starts_on: string | RawBuilder<unknown>;
  ends_on: string | RawBuilder<unknown>;
  portion: string | RawBuilder<unknown>;
}

export function staffLeaveScheduleSources(input: StaffLeaveCoverageWindow) {
  return sql`SELECT schedule.*,day::date AS duty_date
    FROM generate_series(${input.starts_on}::date,${input.ends_on}::date,interval '1 day') day
    CROSS JOIN LATERAL planned_school_schedule_v2(${input.school_id}::uuid,day::date) schedule
    WHERE schedule.teacher_user_id=${input.teacher_user_id}::uuid
      AND schedule.slot_type='class' AND NOT schedule.cancelled
      AND (${input.portion}='full_day'
        OR (${input.portion}='first_half' AND schedule.starts_at<time '12:00')
        OR (${input.portion}='second_half' AND schedule.starts_at>=time '12:00'))`;
}

export function staffLeaveResponsibilitySources(input: StaffLeaveCoverageWindow) {
  return sql`SELECT assignment.id,assignment.school_id,assignment.staff_profile_id,assignment.class_section_id,assignment.subject_id,
      assignment.starts_on AS duty_date,assignment.starts_at,assignment.ends_at,assignment.location,assignment.revision,
      type.name||CASE WHEN assignment.scope_label='' THEN '' ELSE ' · '||assignment.scope_label END AS title
    FROM staff_responsibility_assignments assignment
    JOIN staff_responsibility_types type ON type.id=assignment.responsibility_type_id
    WHERE assignment.school_id=${input.school_id}::uuid
      AND assignment.staff_profile_id=${input.staff_profile_id}::uuid
      AND assignment.status='active' AND type.scope_kind IN ('event','scheduled_duty')
      AND assignment.starts_on BETWEEN ${input.starts_on}::date AND ${input.ends_on}::date
      AND (${input.portion}='full_day' OR assignment.starts_at IS NULL
        OR (${input.portion}='first_half' AND assignment.starts_at<time '12:00')
        OR (${input.portion}='second_half' AND assignment.starts_at>=time '12:00'))`;
}

export function staffLeaveAffectedCount(input: StaffLeaveCoverageWindow) {
  return sql<{ affected: number }>`SELECT ((SELECT count(*) FROM (${staffLeaveScheduleSources(input)}) schedule)
    + (SELECT count(*) FROM (${staffLeaveResponsibilitySources(input)}) assignment))::int AS affected`;
}

/** Bounded detail for the exact same sources used by counts and approval. The
 * caller owns person/request authorization and the 93-day window limit. */
export function staffLeaveAffectedWork(input: StaffLeaveCoverageWindow) {
  return sql<{ id: string; kind: "class" | "duty"; date: string; starts_at: string | null; ends_at: string | null;
    title: string; location: string; class_label: string | null; source_kind: string; source_id: string; source_revision: number | null;
    source_version: number | null; total: number }>`WITH affected AS (
    SELECT concat('class:',schedule.duty_date::text,':',schedule.id::text) AS id,'class'::text AS kind,
      schedule.duty_date::text AS date,schedule.starts_at::text,schedule.ends_at::text,schedule.title,schedule.room::text AS location,
      CASE WHEN section.id IS NULL THEN NULL ELSE btrim(concat_ws(' ',section.grade,section.section)) END AS class_label,
      schedule.source_kind,schedule.source_record_id::text AS source_id,schedule.source_revision,schedule.source_version
    FROM (${staffLeaveScheduleSources(input)}) schedule
    LEFT JOIN class_sections section ON section.school_id=${input.school_id}::uuid AND section.id=schedule.class_section_id
    UNION ALL
    SELECT concat('duty:',assignment.id::text),'duty'::text,assignment.duty_date::text,assignment.starts_at::text,assignment.ends_at::text,
      assignment.title,assignment.location,NULL::text,'staff_responsibility_assignment'::text,assignment.id::text,assignment.revision,NULL::integer
    FROM (${staffLeaveResponsibilitySources(input)}) assignment
  ) SELECT *,count(*) OVER()::int AS total FROM affected ORDER BY date,starts_at NULLS LAST,title,id LIMIT 100`;
}
