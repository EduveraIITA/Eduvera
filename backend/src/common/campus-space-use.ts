import { ConflictException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../database/types.js";

type SpaceUseDb = Kysely<Database> | Transaction<Database>;

/** Acquire before a domain's room/plan row locks. No independent booking writer. */
export async function lockCampusSpaceUse(db: SpaceUseDb, schoolId: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`accommodation-capacity:${schoolId}`},0))`.execute(
    db,
  );
}

/** Dedicated residential use is an explicit owning claim, not classroom seating. */
export async function assertSpacesNotResidential(
  db: SpaceUseDb,
  schoolId: string,
  spaceIds: readonly string[],
) {
  const ids = [...new Set(spaceIds)];
  if (!ids.length) return;
  const occupied = (
    await sql<{ name: string }>`SELECT space.name FROM accommodation_rooms room
    JOIN campus_spaces space ON space.school_id=room.school_id AND space.id=room.space_id
    WHERE room.school_id=${schoolId}::uuid AND room.space_id=ANY(${ids}::uuid[])
      AND room.active ORDER BY space.id LIMIT 1`.execute(db)
  ).rows[0];
  if (occupied)
    throw new ConflictException(
      `${occupied.name} is dedicated to accommodation. Choose another place, or explicitly end its residential use before scheduling.`,
    );
}

/**
 * Inspect owning published sources, including effective academic precedence.
 * Never read a materialized month as proof that an unbounded plan has no future.
 */
export async function assertSpaceCanBecomeResidential(
  db: SpaceUseDb,
  schoolId: string,
  spaceId: string,
  at: string,
) {
  const fixed = (
    await sql`SELECT 1 FROM schedule_activity_occurrences occurrence
    WHERE occurrence.school_id=${schoolId}::uuid AND occurrence.space_id=${spaceId}::uuid
      AND occurrence.source IN ('event','examination') AND occurrence.state='expected'
      AND occurrence.ends_at>${at}::timestamptz LIMIT 1`.execute(db)
  ).rows.length;
  if (fixed)
    throw new ConflictException(
      "This place has a current or future published event/examination. Move or cancel that commitment before dedicating it to accommodation.",
    );

  // Each remaining interval of a weekly plan needs at most one complete week.
  // Probe every supersession boundary as well as now and the original start;
  // cancelled or fully superseded historical versions cannot block conversion.
  const activity = (
    await sql`WITH versions AS (
      SELECT version.*,period.weekday,period.starts_at,period.ends_at,period.end_day_offset
      FROM schedule_versions version JOIN schedule_periods period ON period.version_id=version.id
      WHERE version.school_id=${schoolId}::uuid AND version.planning_origin='activity'
        AND version.state IN ('published','cancelled') AND period.space_id=${spaceId}::uuid
        AND (version.ends_on IS NULL OR version.ends_on>=(${at}::timestamptz AT TIME ZONE version.activity_timezone)::date-1)
    ), probes AS (
      SELECT version.*,day::date AS day FROM versions version
      CROSS JOIN LATERAL (
        SELECT GREATEST(version.starts_on,(${at}::timestamptz AT TIME ZONE version.activity_timezone)::date-1) AS boundary
        UNION SELECT (supersession.effective_until AT TIME ZONE version.activity_timezone)::date-1
          FROM schedule_plan_supersessions supersession WHERE supersession.school_id=${schoolId}::uuid
            AND supersession.previous_version_id=version.id AND supersession.effective_until IS NOT NULL
      ) boundary
      CROSS JOIN LATERAL generate_series(GREATEST(boundary.boundary,version.starts_on),
        LEAST(boundary.boundary+8,COALESCE(version.ends_on,boundary.boundary+8)),interval '1 day') day
      WHERE extract(isodow FROM day)=version.weekday AND (version.recurrence_kind='weekly' OR day::date=version.starts_on)
    ) SELECT 1 FROM probes plan
    WHERE ((plan.day+plan.end_day_offset+plan.ends_at) AT TIME ZONE plan.activity_timezone)>${at}::timestamptz
      AND (plan.state<>'cancelled' OR ((plan.day+plan.starts_at) AT TIME ZONE plan.activity_timezone)<plan.cancelled_at)
      AND NOT EXISTS(SELECT 1 FROM schedule_plan_supersessions supersession
        WHERE supersession.school_id=${schoolId}::uuid AND supersession.previous_version_id=plan.id
          AND ((plan.day+plan.starts_at) AT TIME ZONE plan.activity_timezone)>=supersession.effective_from
          AND (supersession.effective_until IS NULL OR ((plan.day+plan.starts_at) AT TIME ZONE plan.activity_timezone)<supersession.effective_until))
    LIMIT 1`.execute(db)
  ).rows.length;
  if (activity)
    throw new ConflictException(
      "This place has a current or future published activity. Change its owning plan before dedicating it to accommodation.",
    );

  // Candidate days come only from sources that reference this exact place.
  // The existing effective reader decides closures, daily overrides and version
  // precedence; this seam does not create a second academic schedule engine.
  const academic = (
    await sql`WITH today AS (
      SELECT (${at}::timestamptz AT TIME ZONE school.timezone)::date AS day,school.timezone
      FROM schools school WHERE school.id=${schoolId}::uuid
    ), candidates AS (
      SELECT expanded.day::date AS day FROM timetable_slots slot JOIN class_sections section ON section.id=slot.class_section_id
      JOIN academic_terms term ON term.school_id=section.school_id AND term.id=slot.term_id CROSS JOIN today
      CROSS JOIN LATERAL generate_series(GREATEST(today.day,term.starts_on),term.ends_on,interval '1 day') expanded(day)
      WHERE section.school_id=${schoolId}::uuid AND slot.space_id=${spaceId}::uuid AND slot.slot_type<>'break'
        AND extract(isodow FROM expanded.day)=slot.weekday
      UNION
      SELECT expanded.day::date FROM schedule_versions version JOIN schedule_periods period ON period.version_id=version.id CROSS JOIN today
      CROSS JOIN LATERAL generate_series(GREATEST(today.day,version.starts_on),version.ends_on,interval '1 day') expanded(day)
      WHERE version.school_id=${schoolId}::uuid AND version.planning_origin='academic' AND version.state='published'
        AND period.space_id=${spaceId}::uuid AND period.slot_type<>'break' AND extract(isodow FROM expanded.day)=period.weekday
      UNION
      SELECT plan.date FROM day_plans plan JOIN day_plan_periods period
        ON period.school_id=plan.school_id AND period.plan_id=plan.id AND period.version=plan.published_version CROSS JOIN today
      WHERE plan.school_id=${schoolId}::uuid AND plan.date>=today.day AND period.space_id=${spaceId}::uuid
    ) SELECT 1 FROM candidates day CROSS JOIN today
    CROSS JOIN LATERAL effective_school_schedule_v4(${schoolId}::uuid,day.day) effective
    WHERE effective.space_id=${spaceId}::uuid AND NOT effective.cancelled AND effective.slot_type<>'break'
      AND ((day.day+effective.ends_at) AT TIME ZONE today.timezone)>${at}::timestamptz
    LIMIT 1`.execute(db)
  ).rows.length;
  if (academic)
    throw new ConflictException(
      "This place has a current or future effective teaching commitment. Change the owning timetable or daily plan before dedicating it to accommodation.",
    );
}
