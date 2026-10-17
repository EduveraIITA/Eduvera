-- Additive provenance-bearing read contract for the effective school schedule.
--
-- The established effective_school_schedule function remains the authoritative
-- precedence resolver. This wrapper adds stable occurrence identity and enough
-- source evidence for domain consumers to correlate the selected row without
-- making them reproduce daily-plan/timetable precedence themselves.

CREATE FUNCTION public.effective_school_schedule_v2(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,
  class_section_id uuid,
  term_id uuid,
  weekday smallint,
  period_number smallint,
  starts_at time,
  ends_at time,
  title text,
  slot_type varchar,
  room varchar,
  teacher_user_id uuid,
  teacher_designation text,
  subject_id uuid,
  materials text[],
  cancelled boolean,
  day_plan_id uuid,
  plan_version integer,
  notice text,
  coverage_status text,
  occurrence_key text,
  source_kind text,
  source_record_id uuid,
  source_revision integer,
  source_version integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public
AS $$
  WITH chosen AS MATERIALIZED (
    SELECT DISTINCT ON(version.class_section_id,version.term_id)
      version.id,
      version.class_section_id,
      version.term_id,
      version.revision
    FROM public.schedule_versions version
    WHERE version.school_id=p_school
      AND version.state='published'
      AND p_date BETWEEN version.starts_on AND version.ends_on
    ORDER BY
      version.class_section_id,
      version.term_id,
      version.baseline ASC,
      version.starts_on DESC
  ),
  effective AS MATERIALIZED (
    SELECT schedule.*
    FROM public.effective_school_schedule(p_school,p_date) schedule
  )
  SELECT
    effective.id,
    effective.class_section_id,
    effective.term_id,
    effective.weekday,
    effective.period_number,
    effective.starts_at,
    effective.ends_at,
    effective.title,
    effective.slot_type,
    effective.room,
    effective.teacher_user_id,
    effective.teacher_designation,
    effective.subject_id,
    effective.materials,
    effective.cancelled,
    effective.day_plan_id,
    effective.plan_version,
    effective.notice,
    effective.coverage_status,
    encode(digest(concat_ws(':',
      p_school::text,
      effective.class_section_id::text,
      p_date::text,
      effective.period_number::text
    ),'sha256'),'hex') AS occurrence_key,
    CASE
      WHEN effective.day_plan_id IS NOT NULL THEN 'daily_plan'
      WHEN published.id IS NOT NULL THEN 'published_timetable'
      ELSE 'legacy_timetable'
    END AS source_kind,
    CASE
      WHEN effective.day_plan_id IS NOT NULL THEN effective.day_plan_id
      WHEN published.id IS NOT NULL THEN published.id
      ELSE effective.id
    END AS source_record_id,
    CASE
      WHEN effective.day_plan_id IS NOT NULL THEN plan.revision
      WHEN published.id IS NOT NULL THEN published.revision
      ELSE 1
    END AS source_revision,
    CASE
      WHEN effective.day_plan_id IS NOT NULL THEN effective.plan_version
      ELSE NULL::integer
    END AS source_version
  FROM effective
  LEFT JOIN public.day_plans plan
    ON plan.school_id=p_school
    AND plan.id=effective.day_plan_id
  LEFT JOIN LATERAL (
    SELECT chosen.id,chosen.revision
    FROM chosen
    JOIN public.schedule_periods period ON period.version_id=chosen.id
    WHERE effective.day_plan_id IS NULL
      AND chosen.class_section_id=effective.class_section_id
      AND chosen.term_id=effective.term_id
      AND period.id=effective.id
    LIMIT 1
  ) published ON true
$$;

REVOKE ALL ON FUNCTION public.effective_school_schedule_v2(uuid,date) FROM PUBLIC;

DO $$
DECLARE
  application_owner text;
  role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.students'::regclass;

  EXECUTE format(
    'ALTER FUNCTION public.effective_school_schedule_v2(uuid,date) OWNER TO %I',
    application_owner
  );

  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.effective_school_schedule_v2(uuid,date) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
