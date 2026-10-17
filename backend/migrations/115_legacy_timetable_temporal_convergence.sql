-- Bring the mutable legacy timetable fallback into the same append-only,
-- provenance-bearing temporal contract as published schedules and day plans.
-- timetable_slots and academic_terms remain authoritative domain truth.

ALTER TABLE public.timetable_slots
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  ADD COLUMN updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION public.bump_legacy_timetable_slot_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER timetable_slots_revision_guard
  BEFORE UPDATE ON public.timetable_slots
  FOR EACH ROW EXECUTE FUNCTION public.bump_legacy_timetable_slot_revision();

ALTER TABLE public.campus_model_schedule_occurrences
  DROP CONSTRAINT campus_model_occurrence_change_kind_check;
ALTER TABLE public.campus_model_schedule_occurrences
  ADD CONSTRAINT campus_model_occurrence_change_kind_check
  CHECK(change_kind IN (
    'published','overridden','closure_cancelled','closure_restored',
    'day_plan_cancelled','substituted','substitution_cancelled',
    'source_changed','source_removed','projection_backfill'
  ));

-- Preserve the existing precedence resolver while exposing the exact mutable
-- legacy-slot revision instead of the former synthetic constant revision one.
CREATE OR REPLACE FUNCTION public.planned_school_schedule_v2(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text,
  occurrence_key text,source_kind text,source_record_id uuid,source_revision integer,
  source_version integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public
AS $$
  WITH chosen AS MATERIALIZED (
    SELECT DISTINCT ON(version.class_section_id,version.term_id)
      version.id,version.class_section_id,version.term_id,version.revision
    FROM public.schedule_versions version
    WHERE version.school_id=p_school
      AND version.state='published'
      AND p_date BETWEEN version.starts_on AND version.ends_on
    ORDER BY
      version.class_section_id,
      version.term_id,
      version.baseline ASC,
      version.starts_on DESC
  ), planned AS MATERIALIZED (
    SELECT schedule.*
    FROM public.legacy_effective_school_schedule(p_school,p_date) schedule
    WHERE schedule.day_plan_id IS NOT NULL
      OR NOT EXISTS(
        SELECT 1 FROM chosen version
        WHERE version.class_section_id=schedule.class_section_id
          AND version.term_id=schedule.term_id
      )
    UNION ALL
    SELECT period.id,version.class_section_id,version.term_id,period.weekday,
      period.period_number,period.starts_at,period.ends_at,period.title::text,
      period.slot_type,period.room,period.teacher_user_id,'Teacher'::text,
      period.subject_id,'{}'::text[],false,NULL::uuid,NULL::integer,''::text,
      CASE
        WHEN period.teacher_user_id IS NULL AND period.slot_type='class' THEN 'unassigned'
        ELSE 'not_required'
      END
    FROM chosen version
    JOIN public.schedule_periods period ON period.version_id=version.id
    WHERE period.weekday=extract(isodow FROM p_date)
      AND NOT EXISTS(
        SELECT 1 FROM public.day_plans plan
        WHERE plan.class_section_id=version.class_section_id
          AND plan.date=p_date
          AND plan.published_version IS NOT NULL
      )
      AND NOT EXISTS(
        SELECT 1 FROM public.school_calendar_days calendar
        WHERE calendar.school_id=p_school
          AND calendar.date=p_date
          AND NOT calendar.is_instructional
      )
  )
  SELECT planned.*,
    encode(digest(concat_ws(':',
      p_school::text,
      planned.class_section_id::text,
      p_date::text,
      planned.period_number::text
    ),'sha256'),'hex') AS occurrence_key,
    CASE
      WHEN planned.day_plan_id IS NOT NULL THEN 'daily_plan'
      WHEN published.id IS NOT NULL THEN 'published_timetable'
      ELSE 'legacy_timetable'
    END AS source_kind,
    CASE
      WHEN planned.day_plan_id IS NOT NULL THEN planned.day_plan_id
      WHEN published.id IS NOT NULL THEN published.id
      ELSE planned.id
    END AS source_record_id,
    CASE
      WHEN planned.day_plan_id IS NOT NULL THEN plan.revision
      WHEN published.id IS NOT NULL THEN published.revision
      ELSE legacy_slot.revision
    END AS source_revision,
    CASE
      WHEN planned.day_plan_id IS NOT NULL THEN planned.plan_version
      ELSE NULL::integer
    END AS source_version
  FROM planned
  LEFT JOIN public.day_plans plan
    ON plan.school_id=p_school AND plan.id=planned.day_plan_id
  LEFT JOIN LATERAL (
    SELECT chosen.id,chosen.revision
    FROM chosen
    JOIN public.schedule_periods period ON period.version_id=chosen.id
    WHERE planned.day_plan_id IS NULL
      AND chosen.class_section_id=planned.class_section_id
      AND chosen.term_id=planned.term_id
      AND period.id=planned.id
    LIMIT 1
  ) published ON true
  LEFT JOIN public.timetable_slots legacy_slot
    ON planned.day_plan_id IS NULL
    AND published.id IS NULL
    AND legacy_slot.id=planned.id
$$;

-- Migration 113 could not discover an already accepted task whose duty date
-- was closed at upgrade time because the effective resolver deliberately hides
-- every source on a non-instructional day. Recover only exact retained source
-- rows from their owning tables. This preserves the accepted domain decision so
-- the pre-mutation bridge can project it before a later closure removal.
WITH retained_closed_cover AS MATERIALIZED (
  SELECT task.school_id,task.id AS coverage_task_id,task.class_section_id,
    task.subject_id,task.duty_date,task.period_number,task.starts_at,task.ends_at,
    task.source_schedule_id,
    encode(digest(concat_ws(':',task.school_id::text,task.class_section_id::text,
      task.duty_date::text,task.period_number::text),'sha256'),'hex') AS occurrence_key,
    source.source_kind,source.source_record_id,source.source_revision,
    source.source_version,absent.user_id AS original_teacher_user_id,
    replacement.id AS replacement_staff_profile_id,
    replacement.user_id AS replacement_teacher_user_id,task.revision,
    accepted.actor_id AS accepted_by,
    COALESCE(task.responded_at,accepted.created_at) AS accepted_at,
    outbox.id AS effective_event_id
  FROM public.staff_coverage_tasks task
  JOIN public.staff_profiles absent
    ON absent.id=task.absent_staff_profile_id AND absent.school_id=task.school_id
  JOIN public.staff_profiles replacement
    ON replacement.id=task.replacement_staff_profile_id
    AND replacement.school_id=task.school_id
  JOIN public.schools school ON school.id=task.school_id
  JOIN public.school_calendar_days closure
    ON closure.school_id=task.school_id AND closure.date=task.duty_date
    AND NOT closure.is_instructional
  JOIN LATERAL (
    SELECT candidate.source_kind,candidate.source_record_id,
      candidate.source_revision,candidate.source_version
    FROM (
      SELECT 'daily_plan'::text AS source_kind,plan.id AS source_record_id,
        plan.revision AS source_revision,period.version AS source_version,1 AS precedence
      FROM public.day_plan_periods period
      JOIN public.day_plans plan
        ON plan.id=period.plan_id AND plan.school_id=period.school_id
        AND plan.published_version=period.version
      LEFT JOIN public.school_memberships teacher
        ON teacher.id=period.teacher_membership_id AND teacher.school_id=period.school_id
      WHERE period.id=task.source_schedule_id
        AND plan.school_id=task.school_id AND plan.class_section_id=task.class_section_id
        AND plan.date=task.duty_date
        AND period.period_number=task.period_number
        AND period.starts_at=task.starts_at AND period.ends_at=task.ends_at
        AND period.subject_id IS NOT DISTINCT FROM task.subject_id
        AND teacher.user_id=absent.user_id AND NOT period.cancelled
      UNION ALL
      SELECT 'published_timetable',version.id,version.revision,NULL::integer,2
      FROM public.schedule_periods period
      JOIN public.schedule_versions version ON version.id=period.version_id
      WHERE period.id=task.source_schedule_id
        AND version.school_id=task.school_id AND version.state='published'
        AND version.class_section_id=task.class_section_id
        AND task.duty_date BETWEEN version.starts_on AND version.ends_on
        AND period.weekday=extract(isodow FROM task.duty_date)
        AND period.period_number=task.period_number
        AND period.starts_at=task.starts_at AND period.ends_at=task.ends_at
        AND period.subject_id IS NOT DISTINCT FROM task.subject_id
        AND period.teacher_user_id=absent.user_id
      UNION ALL
      SELECT 'legacy_timetable',slot.id,slot.revision,NULL::integer,3
      FROM public.timetable_slots slot
      JOIN public.academic_terms term
        ON term.id=slot.term_id AND term.school_id=task.school_id
      WHERE slot.id=task.source_schedule_id
        AND slot.class_section_id=task.class_section_id
        AND task.duty_date BETWEEN term.starts_on AND term.ends_on
        AND slot.weekday=extract(isodow FROM task.duty_date)
        AND slot.period_number=task.period_number
        AND slot.starts_at=task.starts_at AND slot.ends_at=task.ends_at
        AND slot.subject_id IS NOT DISTINCT FROM task.subject_id
        AND slot.teacher_user_id=absent.user_id
    ) candidate
    ORDER BY candidate.precedence
    LIMIT 1
  ) source ON true
  JOIN LATERAL (
    SELECT audit.actor_id,audit.created_at
    FROM public.staff_coverage_task_audits audit
    WHERE audit.school_id=task.school_id AND audit.task_id=task.id
      AND audit.action='accepted' AND audit.to_status='accepted'
      AND audit.actor_id=replacement.user_id
    ORDER BY audit.created_at DESC,audit.id DESC
    LIMIT 1
  ) accepted ON true
  LEFT JOIN LATERAL (
    SELECT event.id
    FROM public.event_outbox event
    WHERE event.school_id=task.school_id
      AND event.aggregate_type='staff_coverage_task'
      AND event.aggregate_id=task.id
      AND event.event_type='staff.coverage.accepted'
      AND event.payload->>'revision'=task.revision::text
    ORDER BY event.created_at DESC,event.id DESC
    LIMIT 1
  ) outbox ON true
  WHERE task.status='accepted'
    AND task.source_schedule_id IS NOT NULL
    AND task.class_section_id IS NOT NULL
    AND task.period_number IS NOT NULL
    AND task.starts_at IS NOT NULL AND task.ends_at IS NOT NULL
    AND (
      task.duty_date<(now() AT TIME ZONE school.timezone)::date
      OR (
        replacement.status='active'
        AND EXISTS(SELECT 1 FROM public.users account
          WHERE account.id=replacement.user_id AND account.is_active)
        AND EXISTS(SELECT 1 FROM public.school_memberships membership
          WHERE membership.school_id=task.school_id
            AND membership.user_id=replacement.user_id
            AND membership.role='staff' AND membership.is_active)
      )
    )
    AND NOT EXISTS(
      SELECT 1 FROM public.staff_timetable_substitutions retained
      WHERE retained.school_id=task.school_id
        AND retained.coverage_task_id=task.id
    )
)
INSERT INTO public.staff_timetable_substitutions(
  school_id,coverage_task_id,class_section_id,subject_id,duty_date,
  period_number,starts_at,ends_at,source_schedule_id,source_occurrence_key,
  source_kind,source_record_id,source_revision,source_version,
  original_teacher_user_id,replacement_staff_profile_id,
  replacement_teacher_user_id,coverage_task_revision,accepted_by,accepted_at,
  effective_event_id
)
SELECT school_id,coverage_task_id,class_section_id,subject_id,duty_date,
  period_number,starts_at,ends_at,source_schedule_id,occurrence_key,
  source_kind,source_record_id,source_revision,source_version,
  original_teacher_user_id,replacement_staff_profile_id,
  replacement_teacher_user_id,revision,accepted_by,accepted_at,effective_event_id
FROM retained_closed_cover
ON CONFLICT(school_id,coverage_task_id) DO NOTHING;

-- Register retained legacy sources without inventing an original edit time.
-- updated_at is the honest import boundary for rows that predate this lineage.
INSERT INTO public.campus_model_entities(
  school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
)
SELECT section.school_id,'schedule','timetable','legacy:'||slot.id::text,
  'Class '||section.grade||section.section||' recurring '||
    COALESCE(subject.name,NULLIF(trim(slot.title),''),'Period'),
  'active',slot.revision,
  jsonb_build_object(
    'term_id',slot.term_id,'starts_on',term.starts_on,'ends_on',term.ends_on,
    'timezone',school.timezone,'source_kind','legacy_timetable'
  )
FROM public.timetable_slots slot
JOIN public.class_sections section ON section.id=slot.class_section_id
JOIN public.academic_terms term ON term.id=slot.term_id AND term.school_id=section.school_id
JOIN public.schools school ON school.id=section.school_id
LEFT JOIN public.subjects subject
  ON subject.id=slot.subject_id AND subject.school_id=section.school_id
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  kind=EXCLUDED.kind,label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
  source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO public.campus_model_entities(
  school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
)
SELECT section.school_id,'schedule_period','timetable',slot.id::text,
  COALESCE(subject.name,NULLIF(trim(slot.title),''),'Period'),'active',slot.revision,
  jsonb_build_object(
    'weekday',slot.weekday,'period_number',slot.period_number,
    'slot_type',slot.slot_type,'source_kind','legacy_timetable'
  )
FROM public.timetable_slots slot
JOIN public.class_sections section ON section.id=slot.class_section_id
LEFT JOIN public.subjects subject
  ON subject.id=slot.subject_id AND subject.school_id=section.school_id
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  kind=EXCLUDED.kind,label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
  source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO public.campus_model_entities(
  school_id,kind,domain,domain_id,label,lifecycle_state,source_revision,metadata
)
SELECT DISTINCT subject.school_id,'subject','academic_structure',subject.id::text,
  subject.name,'active',subject.revision,jsonb_build_object('code',subject.code)
FROM public.subjects subject
JOIN public.timetable_slots slot ON slot.subject_id=subject.id
JOIN public.class_sections section
  ON section.id=slot.class_section_id AND section.school_id=subject.school_id
ON CONFLICT(school_id,domain,domain_id) DO UPDATE SET
  kind=EXCLUDED.kind,label=EXCLUDED.label,lifecycle_state=EXCLUDED.lifecycle_state,
  source_revision=EXCLUDED.source_revision,metadata=EXCLUDED.metadata,updated_at=now();

INSERT INTO public.campus_model_events(
  school_id,event_kind,event_type,subject_entity_id,context_entity_id,actor_agent_id,
  source_domain,source_record_id,source_revision,event_at,effective_from,effective_until,
  correlation_id,provenance,payload,schema_version,idempotency_key,request_hash
)
SELECT section.school_id,'plan','timetable.legacy_slot_imported',schedule.id,class_entity.id,
  actor.id,'timetable',slot.id::text,slot.revision,slot.updated_at,
  term.starts_on::timestamp AT TIME ZONE school.timezone,
  (term.ends_on+1)::timestamp AT TIME ZONE school.timezone,
  gen_random_uuid(),
  jsonb_build_object('source','timetable_slots','captured_by','migration-115'),
  jsonb_build_object(
    'action','imported','term_id',slot.term_id,'class_section_id',slot.class_section_id,
    'slot',jsonb_build_object(
      'weekday',slot.weekday,'period_number',slot.period_number,
      'starts_at',slot.starts_at,'ends_at',slot.ends_at,
      'title',COALESCE(subject.name,NULLIF(trim(slot.title),''),'Period'),
      'slot_type',slot.slot_type,'teacher_user_id',slot.teacher_user_id,
      'subject_id',slot.subject_id,'space_id',slot.space_id,'room_snapshot',slot.room
    )
  ),1,
  'timetable.legacy-slot-imported:'||slot.id::text||':'||slot.revision::text,
  encode(digest(concat_ws(':',section.school_id::text,slot.id::text,
    slot.revision::text,'legacy-slot-imported'),'sha256'),'hex')
FROM public.timetable_slots slot
JOIN public.class_sections section ON section.id=slot.class_section_id
JOIN public.academic_terms term ON term.id=slot.term_id AND term.school_id=section.school_id
JOIN public.schools school ON school.id=section.school_id
JOIN public.campus_model_entities schedule
  ON schedule.school_id=section.school_id AND schedule.domain='timetable'
  AND schedule.domain_id='legacy:'||slot.id::text
JOIN public.campus_model_entities class_entity
  ON class_entity.school_id=section.school_id AND class_entity.domain='academic_structure'
  AND class_entity.domain_id=section.id::text
LEFT JOIN LATERAL (
  SELECT endpoint.agent_id AS id
  FROM public.campus_model_agent_endpoints endpoint
  WHERE endpoint.school_id=section.school_id
    AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
    AND endpoint.user_id=slot.updated_by
  ORDER BY (endpoint.effective_until IS NULL) DESC,endpoint.effective_from DESC,endpoint.id DESC
  LIMIT 1
) actor ON slot.updated_by IS NOT NULL
LEFT JOIN public.subjects subject
  ON subject.id=slot.subject_id AND subject.school_id=section.school_id
ON CONFLICT(school_id,idempotency_key) DO NOTHING;

WITH candidates AS MATERIALIZED (
  SELECT slot.*,section.school_id,school.timezone,day::date AS occurrence_date,
    COALESCE(subject.name,NULLIF(trim(slot.title),''),'Period') AS resolved_title,
    encode(digest(concat_ws(':',section.school_id::text,slot.class_section_id::text,
      day::date::text,slot.period_number::text),'sha256'),'hex') AS occurrence_key,
    EXISTS(
      SELECT 1 FROM public.school_calendar_days closure
      WHERE closure.school_id=section.school_id AND closure.date=day::date
        AND NOT closure.is_instructional
    ) AS closed
  FROM public.timetable_slots slot
  JOIN public.class_sections section ON section.id=slot.class_section_id
  JOIN public.academic_terms term ON term.id=slot.term_id AND term.school_id=section.school_id
  JOIN public.schools school ON school.id=section.school_id
  LEFT JOIN public.subjects subject
    ON subject.id=slot.subject_id AND subject.school_id=section.school_id
  CROSS JOIN LATERAL generate_series(term.starts_on,term.ends_on,'1 day') day
  WHERE extract(isodow FROM day)=slot.weekday
    AND NOT EXISTS(
      SELECT 1 FROM public.day_plans plan
      WHERE plan.school_id=section.school_id
        AND plan.class_section_id=slot.class_section_id
        AND plan.date=day::date AND plan.published_version IS NOT NULL
    )
    AND NOT EXISTS(
      SELECT 1 FROM public.schedule_versions version
      WHERE version.school_id=section.school_id
        AND version.class_section_id=slot.class_section_id
        AND version.term_id=slot.term_id AND version.state='published'
        AND day::date BETWEEN version.starts_on AND version.ends_on
    )
)
INSERT INTO public.campus_model_schedule_occurrences(
  school_id,source_event_id,schedule_entity_id,period_entity_id,class_entity_id,
  subject_entity_id,responsible_agent_id,space_entity_id,occurrence_date,starts_at,ends_at,
  title,slot_type,room_snapshot,state,source_revision,logical_occurrence_key,period_number,
  basis_event_id,change_event_id,condition_event_id,recorded_from,
  supersedes_occurrence_id,change_kind
)
SELECT candidate.school_id,event.id,schedule.id,period.id,class_entity.id,
  subject_entity.id,teacher.id,space.id,candidate.occurrence_date,
  ((candidate.occurrence_date+candidate.starts_at) AT TIME ZONE candidate.timezone),
  ((candidate.occurrence_date+candidate.ends_at) AT TIME ZONE candidate.timezone),
  candidate.resolved_title,candidate.slot_type,candidate.room,
  CASE WHEN candidate.closed THEN 'cancelled' ELSE 'expected' END,
  candidate.revision,candidate.occurrence_key,candidate.period_number,
  event.id,event.id,closure_event.id,event.recorded_at,NULL,
  CASE WHEN candidate.closed THEN 'closure_cancelled' ELSE 'projection_backfill' END
FROM candidates candidate
JOIN public.campus_model_events event
  ON event.school_id=candidate.school_id
  AND event.idempotency_key='timetable.legacy-slot-imported:'||candidate.id::text||':'||candidate.revision::text
JOIN public.campus_model_entities schedule
  ON schedule.school_id=candidate.school_id AND schedule.domain='timetable'
  AND schedule.domain_id='legacy:'||candidate.id::text
JOIN public.campus_model_entities period
  ON period.school_id=candidate.school_id AND period.domain='timetable'
  AND period.domain_id=candidate.id::text
JOIN public.campus_model_entities class_entity
  ON class_entity.school_id=candidate.school_id AND class_entity.domain='academic_structure'
  AND class_entity.domain_id=candidate.class_section_id::text
LEFT JOIN public.campus_model_entities subject_entity
  ON subject_entity.school_id=candidate.school_id AND subject_entity.domain='academic_structure'
  AND subject_entity.domain_id=candidate.subject_id::text
LEFT JOIN LATERAL (
  SELECT endpoint.agent_id AS id
  FROM public.campus_model_agent_endpoints endpoint
  WHERE endpoint.school_id=candidate.school_id
    AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
    AND endpoint.user_id=candidate.teacher_user_id
  ORDER BY (endpoint.effective_until IS NULL) DESC,endpoint.effective_from DESC,endpoint.id DESC
  LIMIT 1
) teacher ON candidate.teacher_user_id IS NOT NULL
LEFT JOIN public.campus_model_entities space
  ON space.school_id=candidate.school_id AND space.domain='campus_topology'
  AND space.domain_id=candidate.space_id::text
LEFT JOIN LATERAL (
  SELECT closure.id
  FROM public.campus_model_events closure
  WHERE closure.school_id=candidate.school_id
    AND closure.event_type='calendar.closure_created'
    AND closure.payload->'dates' ? candidate.occurrence_date::text
  ORDER BY closure.recorded_at DESC,closure.journal_sequence DESC
  LIMIT 1
) closure_event ON candidate.closed
ON CONFLICT DO NOTHING;

REVOKE ALL ON FUNCTION public.bump_legacy_timetable_slot_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.planned_school_schedule_v2(uuid,date) FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.timetable_slots'::regclass;
  EXECUTE format(
    'ALTER FUNCTION public.bump_legacy_timetable_slot_revision() OWNER TO %I',
    application_owner
  );
  EXECUTE format(
    'ALTER FUNCTION public.planned_school_schedule_v2(uuid,date) OWNER TO %I',
    application_owner
  );
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.bump_legacy_timetable_slot_revision() FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.planned_school_schedule_v2(uuid,date) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
