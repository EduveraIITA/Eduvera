import { Injectable } from "@nestjs/common";
import { sql, type RawBuilder } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { CampusKpiAvailability, CampusKpiGrain, CampusKpiPage } from "./kpi-contracts.js";

export interface CampusKpiRepositoryQuery {
  school_id: string;
  campus_id: string;
  timezone: string;
  from_at: string;
  to_at: string;
  as_of: string;
  grain: CampusKpiGrain;
}

export interface CampusKpiAggregateRow {
  metric_key: string;
  bucket_start: Date | string;
  bucket_end: Date | string;
  value: number | string | null;
  numerator: number | string | null;
  denominator: number | string | null;
  unknown_count: number | string;
  availability: CampusKpiAvailability;
  source_max_at: Date | string | null;
}

function bucketSeries(query: CampusKpiRepositoryQuery): RawBuilder<unknown> {
  if (query.grain === "day") {
    return sql`SELECT GREATEST(local_day AT TIME ZONE ${query.timezone},${query.from_at}::timestamptz) AS bucket_start,
        LEAST((local_day+interval '1 day') AT TIME ZONE ${query.timezone},${query.to_at}::timestamptz) AS bucket_end
      FROM generate_series(
        (${query.from_at}::timestamptz AT TIME ZONE ${query.timezone})::date,
        ((${query.to_at}::timestamptz-interval '1 microsecond') AT TIME ZONE ${query.timezone})::date,
        interval '1 day'
      ) local_day`;
  }
  const minutes = query.grain === "15_minute" ? 15 : 60;
  return sql`SELECT point AS bucket_start,
      LEAST(point+${minutes}::int*interval '1 minute',${query.to_at}::timestamptz) AS bucket_end
    FROM generate_series(
      ${query.from_at}::timestamptz,
      ${query.to_at}::timestamptz-interval '1 microsecond',
      ${minutes}::int*interval '1 minute'
    ) point`;
}

/**
 * Corrected-history campus schedule as known now. A canonical physical space is
 * never guessed: legacy room text is accepted only when exactly one active
 * selected-campus space declares it as an alias. An otherwise-unmapped session
 * can be attributed to the campus only through the class's effective placement.
 */
function campusOccurrences(query: CampusKpiRepositoryQuery): RawBuilder<unknown> {
  return sql`SELECT occurrence.id,occurrence.starts_at,occurrence.ends_at,
      occurrence.occurrence_date,occurrence.slot_type,responsible_agent.id AS responsible_agent_id,
      CASE
        WHEN period_entity.domain='timetable'
          AND period_entity.domain_id~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN period_entity.domain_id::uuid
        WHEN period_entity.domain='day_plan'
          AND split_part(period_entity.domain_id,':',1)~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN split_part(period_entity.domain_id,':',1)::uuid
      END AS schedule_slot_id,
      class_entity.domain_id::uuid AS class_section_id,
      COALESCE(canonical_space.id,alias_space.id) AS space_id,
      COALESCE(canonical_space.capacity,alias_space.capacity) AS capacity,
      COALESCE(roster.expected_count,0)::int AS expected_count,
      CASE WHEN COALESCE(canonical_space.id,alias_space.id) IS NULL THEN 1 ELSE 0 END::int AS missing_space
    FROM campus_model_schedule_occurrences occurrence
    JOIN campus_model_entities class_entity ON class_entity.id=occurrence.class_entity_id
      AND class_entity.school_id=occurrence.school_id
    JOIN campus_model_entities period_entity ON period_entity.id=occurrence.period_entity_id
      AND period_entity.school_id=occurrence.school_id
    LEFT JOIN campus_model_agents responsible_agent ON responsible_agent.id=occurrence.responsible_agent_id
      AND responsible_agent.school_id=occurrence.school_id
      AND responsible_agent.agent_kind='human' AND responsible_agent.status='active'
    LEFT JOIN campus_model_entities space_entity ON space_entity.id=occurrence.space_entity_id
      AND space_entity.school_id=occurrence.school_id
      AND space_entity.domain='campus_topology' AND space_entity.kind='space'
    LEFT JOIN campus_spaces canonical_space ON canonical_space.id::text=space_entity.domain_id
      AND canonical_space.school_id=occurrence.school_id AND canonical_space.status='active'
      AND canonical_space.campus_id=${query.campus_id}::uuid
    LEFT JOIN LATERAL (
      SELECT candidate.id,candidate.capacity
      FROM campus_spaces candidate
      WHERE canonical_space.id IS NULL AND space_entity.domain_id IS NULL
        AND candidate.school_id=occurrence.school_id
        AND candidate.campus_id=${query.campus_id}::uuid AND candidate.status='active'
        AND NULLIF(trim(occurrence.room_snapshot),'') IS NOT NULL
        AND EXISTS(
          SELECT 1 FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(candidate.attributes->'aliases')='array'
              THEN candidate.attributes->'aliases' ELSE '[]'::jsonb END
          ) alias(value)
          WHERE lower(trim(alias.value))=lower(trim(occurrence.room_snapshot))
        )
        AND 1=(
          SELECT count(*) FROM campus_spaces other
          WHERE other.school_id=occurrence.school_id AND other.campus_id=${query.campus_id}::uuid
            AND other.status='active'
            AND EXISTS(
              SELECT 1 FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(other.attributes->'aliases')='array'
                  THEN other.attributes->'aliases' ELSE '[]'::jsonb END
              ) alias(value)
              WHERE lower(trim(alias.value))=lower(trim(occurrence.room_snapshot))
            )
        )
      ORDER BY candidate.id LIMIT 1
    ) alias_space ON true
    LEFT JOIN LATERAL (
      SELECT placement.campus_id
      FROM class_campus_placements placement
      WHERE placement.school_id=occurrence.school_id
        AND placement.class_section_id=class_entity.domain_id::uuid
        AND placement.campus_id=${query.campus_id}::uuid
        AND placement.effective_from<=occurrence.occurrence_date
        AND (placement.effective_until IS NULL OR placement.effective_until>=occurrence.occurrence_date)
      ORDER BY placement.is_primary DESC,placement.effective_from DESC,placement.id DESC LIMIT 1
    ) class_placement ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS expected_count
      FROM enrollments enrollment
      WHERE enrollment.class_section_id=class_entity.domain_id::uuid
        AND enrollment.enrolled_on<=occurrence.occurrence_date
        AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>occurrence.occurrence_date)
    ) roster ON true
    WHERE occurrence.school_id=${query.school_id}::uuid
      AND occurrence.state='expected' AND occurrence.recorded_until IS NULL
      AND occurrence.slot_type IN ('class','activity')
      AND occurrence.starts_at<${query.to_at}::timestamptz
      AND occurrence.ends_at>${query.from_at}::timestamptz-interval '1 day'
      AND (
        canonical_space.id IS NOT NULL OR alias_space.id IS NOT NULL
        OR (space_entity.domain_id IS NULL AND class_placement.campus_id IS NOT NULL)
      )`;
}

@Injectable()
export class CampusViewKpiRepository {
  constructor(private readonly db: DatabaseService) {}

  series(page: Exclude<CampusKpiPage, "overview">, query: CampusKpiRepositoryQuery) {
    if (page === "teaching") return this.teaching(query);
    if (page === "spaces") return this.spaces(query);
    if (page === "movement") return this.movement(query);
    if (page === "coordination") return this.coordination(query);
    return this.dataHealth(query);
  }

  async overviewSnapshots(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow[]> {
    const occurrences = campusOccurrences(query);
    return (await sql<CampusKpiAggregateRow>`WITH occurrence AS (${occurrences}),
      schedule AS (
        SELECT count(occurrence.id)::numeric AS active_sessions,
          max(occurrence.starts_at) AS source_max_at
        FROM occurrence
        WHERE occurrence.starts_at<=${query.as_of}::timestamptz
          AND occurrence.ends_at>${query.as_of}::timestamptz
      ),
      accepted_gate AS (
        SELECT observation.observed_at,observation.payload->>'direction' AS direction,
          matched.id AS space_id
        FROM campus_model_observations observation
        LEFT JOIN LATERAL (
          SELECT space.id FROM campus_spaces space
          WHERE space.school_id=${query.school_id}::uuid AND space.campus_id=${query.campus_id}::uuid
            AND space.status='active' AND space.kind='gate'
            AND NULLIF(trim(observation.payload->>'gate'),'') IS NOT NULL
            AND (
              lower(trim(space.name))=lower(trim(observation.payload->>'gate'))
              OR lower(trim(space.code))=lower(trim(observation.payload->>'gate'))
              OR EXISTS(
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(space.attributes->'aliases')='array'
                    THEN space.attributes->'aliases' ELSE '[]'::jsonb END
                ) alias(value)
                WHERE lower(trim(alias.value))=lower(trim(observation.payload->>'gate'))
              )
            )
          ORDER BY space.id LIMIT 1
        ) matched ON true
        WHERE observation.school_id=${query.school_id}::uuid
          AND observation.kind='movement.gate_observed' AND observation.state='accepted'
          AND observation.observed_at>${query.as_of}::timestamptz-interval '15 minutes'
          AND observation.observed_at<=${query.as_of}::timestamptz
          AND observation.received_at<=${query.as_of}::timestamptz
      ),
      gate AS (
        SELECT count(space_id) FILTER(WHERE direction='in')::numeric AS entries,
          count(space_id) FILTER(WHERE direction='out')::numeric AS exits,
          count(*) FILTER(WHERE space_id IS NULL)::numeric AS unknown_count,
          max(observed_at) AS source_max_at
        FROM accepted_gate
      )
      SELECT metric.metric_key,
        CASE WHEN metric.metric_key='teaching.sessions_planned' THEN ${query.as_of}::timestamptz
          ELSE ${query.as_of}::timestamptz-interval '15 minutes' END AS bucket_start,
        ${query.as_of}::timestamptz AS bucket_end,metric.value,metric.numerator,
        NULL::numeric AS denominator,metric.unknown_count,
        metric.availability::text AS availability,
        CASE WHEN metric.metric_key='teaching.sessions_planned' THEN schedule.source_max_at ELSE gate.source_max_at END AS source_max_at
      FROM schedule CROSS JOIN gate CROSS JOIN LATERAL (VALUES
        ('teaching.sessions_planned',schedule.active_sessions,schedule.active_sessions,0::numeric,'available'),
        ('access.gate_entries_recorded',gate.entries,gate.entries,gate.unknown_count,CASE WHEN gate.unknown_count>0 THEN 'partial' ELSE 'available' END),
        ('access.gate_exits_recorded',gate.exits,gate.exits,gate.unknown_count,CASE WHEN gate.unknown_count>0 THEN 'partial' ELSE 'available' END)
      ) metric(metric_key,value,numerator,unknown_count,availability)
      ORDER BY metric.metric_key`.execute(this.db)).rows;
  }

  private async teaching(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow[]> {
    const buckets = bucketSeries(query);
    const occurrences = campusOccurrences(query);
    return (await sql<CampusKpiAggregateRow>`WITH buckets AS (${buckets}),
      occurrence AS (${occurrences}),
      schedule AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
          )::numeric AS sessions_started,
          COALESCE(sum(EXTRACT(epoch FROM
            LEAST(occurrence.ends_at,bucket.bucket_end)-GREATEST(occurrence.starts_at,bucket.bucket_start)
          )/60) FILTER(WHERE occurrence.id IS NOT NULL),0)::numeric AS planned_minutes,
          COALESCE(sum(occurrence.expected_count) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
          ),0)::numeric AS learner_places,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.responsible_agent_id IS NOT NULL
          )::numeric AS assigned,
          max(occurrence.starts_at) AS source_max_at
        FROM buckets bucket
        LEFT JOIN occurrence ON occurrence.starts_at<bucket.bucket_end AND occurrence.ends_at>bucket.bucket_start
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      attendance_config AS (
        SELECT rule.attendance_academic_mode,
          rule.attendance_session_close_after_minutes::int AS close_after_minutes,
          COALESCE(rule.attendance_academic_mode='scheduled_session'
            AND rule.attendance_session_close_after_minutes IS NOT NULL,false) AS supported
        FROM schools school
        LEFT JOIN institution_operating_rules rule ON rule.school_id=school.id
        WHERE school.id=${query.school_id}::uuid
      ),
      attendance_days AS (
        SELECT day::date AS school_day
        FROM generate_series(
          ((${query.from_at}::timestamptz-interval '1 day') AT TIME ZONE ${query.timezone})::date,
          ((${query.to_at}::timestamptz-interval '1 microsecond') AT TIME ZONE ${query.timezone})::date,
          interval '1 day'
        ) day
      ),
      expected_session AS (
        SELECT day.school_day,slot.id AS schedule_slot_id,slot.class_section_id,
          ((day.school_day+slot.ends_at) AT TIME ZONE ${query.timezone}
            +(config.close_after_minutes*interval '1 minute')) AS due_at
        FROM attendance_days day CROSS JOIN attendance_config config
        CROSS JOIN LATERAL effective_school_schedule_v4(${query.school_id}::uuid,day.school_day) slot
        LEFT JOIN campus_spaces explicit_space ON explicit_space.id=slot.space_id
          AND explicit_space.school_id=${query.school_id}::uuid
        LEFT JOIN LATERAL (
          SELECT placement.campus_id
          FROM class_campus_placements placement
          WHERE placement.school_id=${query.school_id}::uuid
            AND placement.class_section_id=slot.class_section_id
            AND placement.effective_from<=day.school_day
            AND (placement.effective_until IS NULL OR placement.effective_until>=day.school_day)
          ORDER BY placement.is_primary DESC,placement.effective_from DESC,placement.id DESC LIMIT 1
        ) placement ON true
        WHERE config.supported AND slot.slot_type='class'
          AND slot.subject_id IS NOT NULL AND NOT slot.cancelled
          AND (
            explicit_space.campus_id=${query.campus_id}::uuid
            OR (slot.space_id IS NULL AND placement.campus_id=${query.campus_id}::uuid)
          )
      ),
      due_session AS (
        SELECT expected.schedule_slot_id AS id,expected.due_at,
          COALESCE(roster.expected_count,0)::numeric AS expected_count,
          register.id AS register_id,register.state AS register_state,
          COALESCE(entries.recorded_count,0)::numeric AS recorded_count,
          COALESCE(entries.participating_count,0)::numeric AS participating_count,
          COALESCE(entries.late_count,0)::numeric AS late_count,
          GREATEST(COALESCE(roster.expected_count,0)-COALESCE(entries.recorded_count,0),0)::numeric AS unknown_count,
          GREATEST(register.updated_at,entries.source_max_at) AS source_max_at
        FROM expected_session expected
        LEFT JOIN attendance_session_registers register
          ON register.school_id=${query.school_id}::uuid
          AND register.session_date=expected.school_day
          AND register.schedule_slot_id=expected.schedule_slot_id
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS expected_count
          FROM enrollments enrollment
          WHERE enrollment.class_section_id=expected.class_section_id
            AND enrollment.enrolled_on<=expected.school_day
            AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>expected.school_day)
        ) roster ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS recorded_count,
            count(*) FILTER(WHERE entry.status IN ('present','late'))::int AS participating_count,
            count(*) FILTER(WHERE entry.status='late')::int AS late_count,
            max(entry.updated_at) AS source_max_at
          FROM attendance_session_entries entry WHERE entry.session_id=register.id
        ) entries ON true
        WHERE expected.due_at>=${query.from_at}::timestamptz
          AND expected.due_at<${query.to_at}::timestamptz
          AND expected.due_at<=${query.as_of}::timestamptz
      ),
      attendance AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          config.supported,
          count(session.id)::numeric AS due_registers,
          count(session.register_id) FILTER(WHERE session.register_state IN ('submitted','locked'))::numeric AS completed_registers,
          count(session.id) FILTER(WHERE session.register_id IS NULL)::numeric AS missing_registers,
          COALESCE(sum(session.expected_count),0)::numeric AS expected_count,
          COALESCE(sum(session.recorded_count),0)::numeric AS recorded_count,
          COALESCE(sum(session.participating_count),0)::numeric AS participating_count,
          COALESCE(sum(session.late_count),0)::numeric AS late_count,
          COALESCE(sum(session.unknown_count),0)::numeric AS unknown_count,
          max(session.source_max_at) AS source_max_at
        FROM buckets bucket CROSS JOIN attendance_config config
        LEFT JOIN due_session session
          ON session.due_at>=bucket.bucket_start AND session.due_at<bucket.bucket_end
        GROUP BY bucket.bucket_start,bucket.bucket_end,config.supported
      ),
      expanded AS (
        SELECT schedule.bucket_start,schedule.bucket_end,metric.metric_key,metric.value,
          metric.numerator,metric.denominator,metric.unknown_count,metric.availability,
          CASE WHEN metric.metric_key LIKE 'attendance.%' THEN attendance.source_max_at ELSE schedule.source_max_at END AS source_max_at
        FROM schedule JOIN attendance USING(bucket_start,bucket_end)
        CROSS JOIN LATERAL (VALUES
          ('teaching.sessions_planned',schedule.sessions_started,schedule.sessions_started,NULL::numeric,0::numeric,'available'),
          ('teaching.minutes_planned',schedule.planned_minutes,schedule.planned_minutes,NULL::numeric,0::numeric,'available'),
          ('teaching.learner_places_planned',schedule.learner_places,schedule.learner_places,NULL::numeric,0::numeric,'available'),
          ('teaching.teacher_assignment_rate',CASE WHEN schedule.sessions_started>0 THEN schedule.assigned*100/schedule.sessions_started END,schedule.assigned,schedule.sessions_started,0::numeric,CASE WHEN schedule.sessions_started>0 THEN 'available' ELSE 'unavailable' END),
          ('attendance.register_completion_rate',CASE WHEN attendance.supported AND attendance.due_registers>0 THEN attendance.completed_registers*100/attendance.due_registers END,CASE WHEN attendance.supported THEN attendance.completed_registers END,CASE WHEN attendance.supported THEN attendance.due_registers END,attendance.missing_registers,CASE WHEN NOT attendance.supported OR attendance.due_registers=0 THEN 'unavailable' ELSE 'partial' END),
          ('attendance.recording_coverage',CASE WHEN attendance.supported AND attendance.expected_count>0 THEN attendance.recorded_count*100/attendance.expected_count END,CASE WHEN attendance.supported THEN attendance.recorded_count END,CASE WHEN attendance.supported THEN attendance.expected_count END,attendance.unknown_count,CASE WHEN NOT attendance.supported OR attendance.expected_count=0 THEN 'unavailable' WHEN attendance.missing_registers>0 THEN 'partial' ELSE 'available' END),
          ('attendance.participation_rate',CASE WHEN attendance.supported AND attendance.recorded_count>0 THEN attendance.participating_count*100/attendance.recorded_count END,CASE WHEN attendance.supported THEN attendance.participating_count END,CASE WHEN attendance.supported THEN attendance.recorded_count END,attendance.unknown_count,CASE WHEN attendance.supported AND attendance.recorded_count>0 THEN 'available' ELSE 'unavailable' END),
          ('attendance.late_rate',CASE WHEN attendance.supported AND attendance.recorded_count>0 THEN attendance.late_count*100/attendance.recorded_count END,CASE WHEN attendance.supported THEN attendance.late_count END,CASE WHEN attendance.supported THEN attendance.recorded_count END,attendance.unknown_count,CASE WHEN attendance.supported AND attendance.recorded_count>0 THEN 'available' ELSE 'unavailable' END)
        ) metric(metric_key,value,numerator,denominator,unknown_count,availability)
      )
      SELECT metric_key,bucket_start,bucket_end,value,numerator,denominator,unknown_count,
        availability::text AS availability,source_max_at FROM expanded
      ORDER BY metric_key,bucket_start`.execute(this.db)).rows;
  }

  private async spaces(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow[]> {
    const buckets = bucketSeries(query);
    const occurrences = campusOccurrences(query);
    return (await sql<CampusKpiAggregateRow>`WITH buckets AS (${buckets}),
      occurrence AS (${occurrences}),
      occurrence_with_conflict AS (
        SELECT occurrence.*,
          CASE WHEN occurrence.space_id IS NOT NULL AND (
            occurrence.starts_at<max(occurrence.ends_at) OVER(
              PARTITION BY occurrence.space_id ORDER BY occurrence.starts_at,occurrence.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            )
            OR lead(occurrence.starts_at) OVER(
              PARTITION BY occurrence.space_id ORDER BY occurrence.starts_at,occurrence.id
            )<occurrence.ends_at
          ) THEN 1 ELSE 0 END AS has_space_conflict
        FROM occurrence
      ),
      bookable AS (
        SELECT count(*)::numeric AS space_count
        FROM campus_spaces space
        WHERE space.school_id=${query.school_id}::uuid AND space.campus_id=${query.campus_id}::uuid
          AND space.status='active' AND space.is_bookable AND space.kind<>'virtual'
          AND NOT EXISTS(
            SELECT 1 FROM campus_spaces child
            WHERE child.parent_space_id=space.id AND child.status='active'
          )
      ),
      space_days AS (
        SELECT day::date AS school_day
        FROM generate_series(
          (${query.from_at}::timestamptz AT TIME ZONE ${query.timezone})::date,
          ((${query.to_at}::timestamptz-interval '1 microsecond') AT TIME ZONE ${query.timezone})::date,
          interval '1 day'
        ) day
      ),
      effective_space_session AS (
        SELECT day.school_day,slot.space_id,
          ((day.school_day+slot.starts_at) AT TIME ZONE ${query.timezone}) AS starts_at,
          ((day.school_day+slot.ends_at) AT TIME ZONE ${query.timezone}) AS ends_at
        FROM space_days day
        CROSS JOIN LATERAL effective_school_schedule_v4(${query.school_id}::uuid,day.school_day) slot
        LEFT JOIN campus_spaces explicit_space ON explicit_space.id=slot.space_id
          AND explicit_space.school_id=${query.school_id}::uuid
        LEFT JOIN LATERAL (
          SELECT placement.campus_id
          FROM class_campus_placements placement
          WHERE placement.school_id=${query.school_id}::uuid
            AND placement.class_section_id=slot.class_section_id
            AND placement.effective_from<=day.school_day
            AND (placement.effective_until IS NULL OR placement.effective_until>=day.school_day)
          ORDER BY placement.is_primary DESC,placement.effective_from DESC,placement.id DESC LIMIT 1
        ) placement ON true
        WHERE NOT slot.cancelled AND slot.slot_type IN ('class','activity')
          AND (
            explicit_space.campus_id=${query.campus_id}::uuid
            OR (slot.space_id IS NULL AND placement.campus_id=${query.campus_id}::uuid)
          )
      ),
      instructional_day AS (
        SELECT school_day,min(starts_at) AS starts_at,max(ends_at) AS ends_at
        FROM effective_space_session GROUP BY school_day
      ),
      envelope AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          COALESCE(sum(EXTRACT(epoch FROM
            LEAST(day.ends_at,bucket.bucket_end)-GREATEST(day.starts_at,bucket.bucket_start)
          )/60) FILTER(WHERE day.starts_at IS NOT NULL),0)*bookable.space_count AS available_space_minutes
        FROM buckets bucket CROSS JOIN bookable
        LEFT JOIN instructional_day day
          ON day.starts_at<bucket.bucket_end AND day.ends_at>bucket.bucket_start
        GROUP BY bucket.bucket_start,bucket.bucket_end,bookable.space_count
      ),
      scheduled_interval AS (
        SELECT bucket.bucket_start,bucket.bucket_end,session.space_id,
          GREATEST(session.starts_at,bucket.bucket_start) AS starts_at,
          LEAST(session.ends_at,bucket.bucket_end) AS ends_at
        FROM buckets bucket JOIN occurrence session
          ON session.starts_at<bucket.bucket_end AND session.ends_at>bucket.bucket_start
        JOIN campus_spaces space ON space.id=session.space_id
          AND space.school_id=${query.school_id}::uuid AND space.campus_id=${query.campus_id}::uuid
          AND space.status='active' AND space.is_bookable AND space.kind<>'virtual'
          AND NOT EXISTS(
            SELECT 1 FROM campus_spaces child
            WHERE child.parent_space_id=space.id AND child.status='active'
          )
      ),
      scheduled_edge AS (
        SELECT bucket_start,bucket_end,space_id,starts_at AS point,1::int AS delta FROM scheduled_interval
        UNION ALL
        SELECT bucket_start,bucket_end,space_id,ends_at AS point,-1::int AS delta FROM scheduled_interval
      ),
      scheduled_point AS (
        SELECT bucket_start,bucket_end,space_id,point,sum(delta)::int AS delta
        FROM scheduled_edge GROUP BY bucket_start,bucket_end,space_id,point
      ),
      scheduled_running AS (
        SELECT bucket_start,bucket_end,space_id,point,
          lead(point) OVER(PARTITION BY bucket_start,bucket_end,space_id ORDER BY point) AS next_point,
          sum(delta) OVER(PARTITION BY bucket_start,bucket_end,space_id ORDER BY point ROWS UNBOUNDED PRECEDING) AS concurrent
        FROM scheduled_point
      ),
      scheduled AS (
        SELECT bucket_start,bucket_end,
          COALESCE(sum(EXTRACT(epoch FROM next_point-point)/60) FILTER(WHERE concurrent>0),0)::numeric AS space_minutes
        FROM scheduled_running GROUP BY bucket_start,bucket_end
      ),
      aggregate AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(DISTINCT occurrence.space_id) FILTER(WHERE occurrence.space_id IS NOT NULL)::numeric AS planned_active,
          COALESCE(scheduled.space_minutes,0)::numeric AS scheduled_space_minutes,
          envelope.available_space_minutes::numeric AS available_space_minutes,
          COALESCE(sum(occurrence.expected_count*EXTRACT(epoch FROM
            LEAST(occurrence.ends_at,bucket.bucket_end)-GREATEST(occurrence.starts_at,bucket.bucket_start)
          )/60) FILTER(WHERE occurrence.capacity IS NOT NULL),0)::numeric AS learner_place_minutes,
          COALESCE(sum(occurrence.capacity*EXTRACT(epoch FROM
            LEAST(occurrence.ends_at,bucket.bucket_end)-GREATEST(occurrence.starts_at,bucket.bucket_start)
          )/60) FILTER(WHERE occurrence.capacity IS NOT NULL),0)::numeric AS capacity_minutes,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.capacity IS NOT NULL AND occurrence.expected_count>occurrence.capacity
          )::numeric AS over_capacity,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.has_space_conflict=1
          )::numeric AS conflicts,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.missing_space=1
          )::numeric AS missing_space,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.capacity IS NULL
          )::numeric AS unknown_capacity,
          max(occurrence.starts_at) AS source_max_at
        FROM buckets bucket CROSS JOIN bookable
        JOIN envelope USING(bucket_start,bucket_end)
        LEFT JOIN scheduled USING(bucket_start,bucket_end)
        LEFT JOIN occurrence_with_conflict occurrence
          ON occurrence.starts_at<bucket.bucket_end AND occurrence.ends_at>bucket.bucket_start
        GROUP BY bucket.bucket_start,bucket.bucket_end,bookable.space_count,
          envelope.available_space_minutes,scheduled.space_minutes
      )
      SELECT metric.metric_key,aggregate.bucket_start,aggregate.bucket_end,metric.value,
        metric.numerator,metric.denominator,metric.unknown_count,
        metric.availability::text AS availability,aggregate.source_max_at
      FROM aggregate CROSS JOIN LATERAL (VALUES
        ('spaces.planned_active',aggregate.planned_active,aggregate.planned_active,NULL::numeric,0::numeric,'available'),
        ('spaces.planned_use_rate',CASE WHEN aggregate.available_space_minutes>0 THEN aggregate.scheduled_space_minutes*100/aggregate.available_space_minutes END,aggregate.scheduled_space_minutes,aggregate.available_space_minutes,0::numeric,CASE WHEN aggregate.available_space_minutes>0 THEN 'available' ELSE 'unavailable' END),
        ('spaces.planned_seat_load_rate',CASE WHEN aggregate.capacity_minutes>0 THEN aggregate.learner_place_minutes*100/aggregate.capacity_minutes END,aggregate.learner_place_minutes,aggregate.capacity_minutes,aggregate.unknown_capacity,CASE WHEN aggregate.capacity_minutes>0 THEN 'partial' ELSE 'unavailable' END),
        ('spaces.over_capacity_sessions',aggregate.over_capacity,aggregate.over_capacity,NULL::numeric,aggregate.unknown_capacity,'partial'),
        ('spaces.double_booking_conflicts',aggregate.conflicts,aggregate.conflicts,NULL::numeric,0::numeric,'available'),
        ('spaces.missing_canonical_space',aggregate.missing_space,aggregate.missing_space,NULL::numeric,aggregate.missing_space,'available')
      ) metric(metric_key,value,numerator,denominator,unknown_count,availability)
      ORDER BY metric_key,bucket_start`.execute(this.db)).rows;
  }

  private async movement(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow[]> {
    const buckets = bucketSeries(query);
    const occurrences = campusOccurrences(query);
    return (await sql<CampusKpiAggregateRow>`WITH buckets AS (${buckets}),
      occurrence AS (${occurrences}),
      occurrence_with_teacher_conflict AS (
        SELECT occurrence.*,
          CASE WHEN occurrence.responsible_agent_id IS NOT NULL AND (
            occurrence.starts_at<max(occurrence.ends_at) OVER(
              PARTITION BY occurrence.responsible_agent_id ORDER BY occurrence.starts_at,occurrence.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            )
            OR lead(occurrence.starts_at) OVER(
              PARTITION BY occurrence.responsible_agent_id ORDER BY occurrence.starts_at,occurrence.id
            )<occurrence.ends_at
          ) THEN 1 ELSE 0 END AS has_teacher_conflict
        FROM occurrence
      ),
      accepted_gate AS (
        SELECT observation.subject_entity_id,observation.observed_at,
          observation.payload->>'direction' AS direction,matched.id AS space_id
        FROM campus_model_observations observation
        LEFT JOIN LATERAL (
          SELECT space.id FROM campus_spaces space
          WHERE space.school_id=${query.school_id}::uuid AND space.campus_id=${query.campus_id}::uuid
            AND space.status='active' AND space.kind='gate'
            AND NULLIF(trim(observation.payload->>'gate'),'') IS NOT NULL
            AND (
              lower(trim(space.name))=lower(trim(observation.payload->>'gate'))
              OR lower(trim(space.code))=lower(trim(observation.payload->>'gate'))
              OR EXISTS(
                SELECT 1 FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(space.attributes->'aliases')='array'
                    THEN space.attributes->'aliases' ELSE '[]'::jsonb END
                ) alias(value)
                WHERE lower(trim(alias.value))=lower(trim(observation.payload->>'gate'))
              )
            )
          ORDER BY space.id LIMIT 1
        ) matched ON true
        WHERE observation.school_id=${query.school_id}::uuid
          AND observation.kind='movement.gate_observed' AND observation.state='accepted'
          AND observation.observed_at>=${query.from_at}::timestamptz
          AND observation.observed_at<${query.to_at}::timestamptz
          AND observation.received_at<=${query.as_of}::timestamptz
      ),
      schedule AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(DISTINCT occurrence.responsible_agent_id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.responsible_agent_id IS NOT NULL
          )::numeric AS teachers_expected,
          count(occurrence.id) FILTER(
            WHERE occurrence.starts_at>=bucket.bucket_start AND occurrence.starts_at<bucket.bucket_end
              AND occurrence.has_teacher_conflict=1
          )::numeric AS teacher_conflicts,
          max(occurrence.starts_at) AS source_max_at
        FROM buckets bucket LEFT JOIN occurrence_with_teacher_conflict occurrence
          ON occurrence.starts_at<bucket.bucket_end AND occurrence.ends_at>bucket.bucket_start
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      gate AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(gate.space_id) FILTER(WHERE gate.direction='in')::numeric AS entries,
          count(gate.space_id) FILTER(WHERE gate.direction='out')::numeric AS exits,
          count(DISTINCT gate.subject_entity_id) FILTER(
            WHERE gate.space_id IS NOT NULL AND gate.direction IN ('in','out')
          )::numeric AS people_observed,
          count(gate.observed_at) FILTER(WHERE gate.space_id IS NULL)::numeric AS unknown_count,
          max(gate.observed_at) AS source_max_at
        FROM buckets bucket LEFT JOIN accepted_gate gate
          ON gate.observed_at>=bucket.bucket_start AND gate.observed_at<bucket.bucket_end
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      visitors AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(visitor.id)::numeric AS visitors_inside,
          max(GREATEST(visitor.checked_in_at,visitor.checked_out_at)) AS source_max_at
        FROM buckets bucket LEFT JOIN gate_visitors visitor
          ON visitor.school_id=${query.school_id}::uuid
          AND visitor.checked_in_at<bucket.bucket_end
          AND (visitor.checked_out_at IS NULL OR visitor.checked_out_at>=bucket.bucket_end)
          AND visitor.state IN ('inside','out')
        GROUP BY bucket.bucket_start,bucket.bucket_end
      )
      SELECT metric.metric_key,schedule.bucket_start,schedule.bucket_end,metric.value,
        metric.numerator,metric.denominator,metric.unknown_count,
        metric.availability::text AS availability,
        CASE WHEN metric.metric_key='access.visitors_inside' THEN visitors.source_max_at
          WHEN metric.metric_key LIKE 'access.%' THEN gate.source_max_at ELSE schedule.source_max_at END AS source_max_at
      FROM schedule JOIN gate USING(bucket_start,bucket_end) JOIN visitors USING(bucket_start,bucket_end)
      CROSS JOIN LATERAL (VALUES
        ('people.teachers_expected',schedule.teachers_expected,schedule.teachers_expected,NULL::numeric,0::numeric,'available'),
        ('people.teacher_schedule_conflicts',schedule.teacher_conflicts,schedule.teacher_conflicts,NULL::numeric,0::numeric,'available'),
        ('access.gate_entries_recorded',gate.entries,gate.entries,NULL::numeric,gate.unknown_count,CASE WHEN gate.unknown_count>0 THEN 'partial' ELSE 'available' END),
        ('access.gate_exits_recorded',gate.exits,gate.exits,NULL::numeric,gate.unknown_count,CASE WHEN gate.unknown_count>0 THEN 'partial' ELSE 'available' END),
        ('access.people_observed_distinct',gate.people_observed,gate.people_observed,NULL::numeric,gate.unknown_count,CASE WHEN gate.unknown_count>0 THEN 'partial' ELSE 'available' END),
        ('access.visitors_inside',visitors.visitors_inside,visitors.visitors_inside,NULL::numeric,0::numeric,'available')
      ) metric(metric_key,value,numerator,denominator,unknown_count,availability)
      ORDER BY metric_key,bucket_start`.execute(this.db)).rows;
  }

  private async coordination(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow[]> {
    const buckets = bucketSeries(query);
    return (await sql<CampusKpiAggregateRow>`WITH buckets AS (${buckets}),
      actionable AS (
        SELECT * FROM campus_model_operational_messages message
        WHERE message.school_id=${query.school_id}::uuid
          AND message.message_kind IN ('request','task','offer')
          AND message.queued_at<${query.to_at}::timestamptz
          AND (
            message.queued_at>=${query.from_at}::timestamptz
            OR message.responded_at>=${query.from_at}::timestamptz
            OR message.expired_at>=${query.from_at}::timestamptz
            OR message.cancelled_at>=${query.from_at}::timestamptz
            OR message.dead_lettered_at>=${query.from_at}::timestamptz
            OR (
              message.responded_at IS NULL AND message.expired_at IS NULL
              AND message.cancelled_at IS NULL AND message.dead_lettered_at IS NULL
            )
          )
      ),
      backlog AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(message.id)::numeric AS open_count,
          count(message.id) FILTER(
            WHERE message.response_due_at IS NOT NULL AND message.response_due_at<bucket.bucket_end
          )::numeric AS overdue_count,
          max(message.updated_at) AS source_max_at
        FROM buckets bucket LEFT JOIN actionable message
          ON message.queued_at<bucket.bucket_end
          AND (message.responded_at IS NULL OR message.responded_at>=bucket.bucket_end)
          AND (message.expired_at IS NULL OR message.expired_at>=bucket.bucket_end)
          AND (message.cancelled_at IS NULL OR message.cancelled_at>=bucket.bucket_end)
          AND (message.dead_lettered_at IS NULL OR message.dead_lettered_at>=bucket.bucket_end)
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      response AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(message.id) FILTER(
            WHERE message.response_due_at>=bucket.bucket_start AND message.response_due_at<bucket.bucket_end
          )::numeric AS due_count,
          count(message.id) FILTER(
            WHERE message.response_due_at>=bucket.bucket_start AND message.response_due_at<bucket.bucket_end
              AND message.responded_at IS NOT NULL AND message.responded_at<=message.response_due_at
          )::numeric AS on_time_count,
          percentile_cont(0.5) WITHIN GROUP(
            ORDER BY EXTRACT(epoch FROM message.responded_at-message.queued_at)/60
          ) FILTER(WHERE message.responded_at IS NOT NULL
            AND message.responded_at>=bucket.bucket_start AND message.responded_at<bucket.bucket_end)::numeric AS median_minutes,
          max(GREATEST(message.response_due_at,message.responded_at)) AS source_max_at
        FROM buckets bucket LEFT JOIN actionable message
          ON (
            message.response_due_at>=bucket.bucket_start AND message.response_due_at<bucket.bucket_end
          ) OR (
            message.responded_at>=bucket.bucket_start AND message.responded_at<bucket.bucket_end
          )
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      terminal AS (
        SELECT message.id,
          CASE message.state
            WHEN 'responded' THEN message.responded_at
            WHEN 'expired' THEN message.expired_at
            WHEN 'dead_letter' THEN message.dead_lettered_at
          END AS occurred_at,
          message.state IN ('expired','dead_letter') AS failed
        FROM actionable message WHERE message.state IN ('responded','expired','dead_letter')
      ),
      failures AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(terminal.id)::numeric AS terminal_count,
          count(terminal.id) FILTER(WHERE terminal.failed)::numeric AS failed_count,
          max(terminal.occurred_at) AS source_max_at
        FROM buckets bucket LEFT JOIN terminal
          ON terminal.occurred_at>=bucket.bucket_start AND terminal.occurred_at<bucket.bucket_end
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      exceptions AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(exception.id)::numeric AS open_count,max(exception.created_at) AS source_max_at
        FROM buckets bucket LEFT JOIN campus_model_coordination_exceptions exception
          ON exception.school_id=${query.school_id}::uuid
          AND exception.created_at<bucket.bucket_end
          AND (exception.resolved_at IS NULL OR exception.resolved_at>=bucket.bucket_end)
        GROUP BY bucket.bucket_start,bucket.bucket_end
      )
      SELECT metric.metric_key,backlog.bucket_start,backlog.bucket_end,metric.value,
        metric.numerator,metric.denominator,metric.unknown_count,
        metric.availability::text AS availability,
        CASE WHEN metric.metric_key='coordination.exceptions_open' THEN exceptions.source_max_at
          WHEN metric.metric_key='coordination.failure_rate' THEN failures.source_max_at
          WHEN metric.metric_key IN ('coordination.response_rate','coordination.median_response_minutes') THEN response.source_max_at
          ELSE backlog.source_max_at END AS source_max_at
      FROM backlog JOIN response USING(bucket_start,bucket_end)
        JOIN failures USING(bucket_start,bucket_end) JOIN exceptions USING(bucket_start,bucket_end)
      CROSS JOIN LATERAL (VALUES
        ('coordination.work_open',backlog.open_count,backlog.open_count,NULL::numeric,0::numeric,'available'),
        ('coordination.work_overdue',backlog.overdue_count,backlog.overdue_count,NULL::numeric,0::numeric,'available'),
        ('coordination.response_rate',CASE WHEN response.due_count>0 THEN response.on_time_count*100/response.due_count END,response.on_time_count,response.due_count,0::numeric,CASE WHEN response.due_count>0 THEN 'available' ELSE 'unavailable' END),
        ('coordination.median_response_minutes',response.median_minutes,response.median_minutes,NULL::numeric,0::numeric,CASE WHEN response.median_minutes IS NOT NULL THEN 'available' ELSE 'unavailable' END),
        ('coordination.failure_rate',CASE WHEN failures.terminal_count>0 THEN failures.failed_count*100/failures.terminal_count END,failures.failed_count,failures.terminal_count,0::numeric,CASE WHEN failures.terminal_count>0 THEN 'available' ELSE 'unavailable' END),
        ('coordination.exceptions_open',exceptions.open_count,exceptions.open_count,NULL::numeric,0::numeric,'partial')
      ) metric(metric_key,value,numerator,denominator,unknown_count,availability)
      ORDER BY metric_key,bucket_start`.execute(this.db)).rows;
  }

  private async dataHealth(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow[]> {
    const buckets = bucketSeries(query);
    return (await sql<CampusKpiAggregateRow>`WITH buckets AS (${buckets}),
      observation_flow AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(observation.id) FILTER(WHERE observation.state='accepted')::numeric AS accepted_count,
          max(observation.received_at) AS source_max_at
        FROM buckets bucket LEFT JOIN campus_model_observations observation
          ON observation.school_id=${query.school_id}::uuid
          AND observation.received_at>=bucket.bucket_start AND observation.received_at<bucket.bucket_end
          AND observation.received_at<=${query.as_of}::timestamptz
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      observation_backlog AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(observation.id)::numeric AS waiting_count,
          max(observation.received_at) AS source_max_at
        FROM buckets bucket LEFT JOIN campus_model_observations observation
          ON observation.school_id=${query.school_id}::uuid
          AND observation.received_at<bucket.bucket_end
          AND observation.state IN ('pending','quarantined')
        GROUP BY bucket.bucket_start,bucket.bucket_end
      ),
      ranked_outcome AS (
        SELECT command.school_id,outcome.status,outcome.recorded_at,
          row_number() OVER(PARTITION BY outcome.command_id ORDER BY outcome.sequence DESC) AS rank
        FROM campus_model_command_outcomes outcome
        JOIN campus_model_commands command ON command.id=outcome.command_id
        WHERE command.school_id=${query.school_id}::uuid
          AND outcome.status IN ('accepted','rejected','conflicted','expired','failed','cancelled')
          AND outcome.recorded_at>=${query.from_at}::timestamptz
          AND outcome.recorded_at<${query.to_at}::timestamptz
      ),
      latest_outcome AS (
        SELECT * FROM ranked_outcome WHERE rank=1
      ),
      command_health AS (
        SELECT bucket.bucket_start,bucket.bucket_end,
          count(outcome.status) FILTER(
            WHERE outcome.rank=1 AND outcome.status IN ('accepted','rejected','conflicted','expired','failed','cancelled')
          )::numeric AS terminal_count,
          count(outcome.status) FILTER(
            WHERE outcome.rank=1 AND outcome.status IN ('conflicted','failed')
          )::numeric AS failed_count,
          max(outcome.recorded_at) FILTER(WHERE outcome.rank=1) AS source_max_at
        FROM buckets bucket LEFT JOIN latest_outcome outcome
          ON outcome.recorded_at>=bucket.bucket_start AND outcome.recorded_at<bucket.bucket_end
        GROUP BY bucket.bucket_start,bucket.bucket_end
      )
      SELECT metric.metric_key,observation_flow.bucket_start,observation_flow.bucket_end,
        metric.value,metric.numerator,metric.denominator,metric.unknown_count,
        metric.availability::text AS availability,
        CASE WHEN metric.metric_key='evidence.observations_accepted' THEN observation_flow.source_max_at
          WHEN metric.metric_key='evidence.observations_waiting' THEN observation_backlog.source_max_at
          ELSE command_health.source_max_at END AS source_max_at
      FROM observation_flow JOIN observation_backlog USING(bucket_start,bucket_end)
        JOIN command_health USING(bucket_start,bucket_end)
      CROSS JOIN LATERAL (VALUES
        ('evidence.observations_accepted',observation_flow.accepted_count,observation_flow.accepted_count,NULL::numeric,0::numeric,'available'),
        ('evidence.observations_waiting',observation_backlog.waiting_count,observation_backlog.waiting_count,NULL::numeric,0::numeric,'partial'),
        ('evidence.command_conflict_failure_rate',CASE WHEN command_health.terminal_count>0 THEN command_health.failed_count*100/command_health.terminal_count END,command_health.failed_count,command_health.terminal_count,0::numeric,CASE WHEN command_health.terminal_count>0 THEN 'available' ELSE 'unavailable' END)
      ) metric(metric_key,value,numerator,denominator,unknown_count,availability)
      ORDER BY metric_key,bucket_start`.execute(this.db)).rows;
  }

  async attendanceEvidenceBacklog(query: CampusKpiRepositoryQuery): Promise<CampusKpiAggregateRow | null> {
    const buckets = bucketSeries(query);
    return (await sql<CampusKpiAggregateRow>`WITH buckets AS (${buckets}),last_bucket AS (
        SELECT * FROM buckets ORDER BY bucket_end DESC LIMIT 1
      )
      SELECT 'attendance.evidence_review_backlog'::text AS metric_key,
        bucket.bucket_start,bucket.bucket_end,count(evidence.id)::numeric AS value,
        count(evidence.id)::numeric AS numerator,NULL::numeric AS denominator,0::numeric AS unknown_count,
        'partial'::text AS availability,max(evidence.updated_at) AS source_max_at
      FROM last_bucket bucket LEFT JOIN attendance_session_evidence evidence
        ON evidence.school_id=${query.school_id}::uuid AND evidence.state='pending'
        AND evidence.created_at<${query.as_of}::timestamptz
        AND EXISTS(
          SELECT 1 FROM attendance_session_registers register
          JOIN class_campus_placements placement ON placement.school_id=register.school_id
            AND placement.class_section_id=register.class_section_id
            AND placement.campus_id=${query.campus_id}::uuid
            AND placement.effective_from<=register.session_date
            AND (placement.effective_until IS NULL OR placement.effective_until>=register.session_date)
          WHERE register.id=evidence.session_id
        )
      GROUP BY bucket.bucket_start,bucket.bucket_end`.execute(this.db)).rows[0] ?? null;
  }
}

