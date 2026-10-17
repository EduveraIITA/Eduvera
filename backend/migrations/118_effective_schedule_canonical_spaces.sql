-- Canonical-space extension for the authoritative effective timetable.
--
-- The existing v3 contract retains precedence, staffing and provenance.  This
-- additive wrapper resolves the selected occurrence back to the canonical
-- campus space already owned by its source period.  Examination and other
-- resource consumers can therefore evaluate occupancy without comparing room
-- labels or reproducing timetable/day-plan precedence.

CREATE FUNCTION public.effective_school_schedule_v4(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text,
  occurrence_key text,source_kind text,source_record_id uuid,source_revision integer,
  source_version integer,coverage_record_id uuid,coverage_task_id uuid,
  coverage_task_revision integer,original_teacher_user_id uuid,
  replacement_staff_profile_id uuid,coverage_accepted_at timestamptz,
  space_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public
AS $$
  SELECT schedule.*,
    CASE schedule.source_kind
      WHEN 'daily_plan' THEN daily_period.space_id
      WHEN 'published_timetable' THEN published_period.space_id
      WHEN 'legacy_timetable' THEN legacy_slot.space_id
      ELSE NULL::uuid
    END AS space_id
  FROM public.effective_school_schedule_v3(p_school,p_date) schedule
  LEFT JOIN public.day_plan_periods daily_period
    ON schedule.source_kind='daily_plan'
    AND daily_period.id=schedule.id
    AND daily_period.plan_id=schedule.source_record_id
  LEFT JOIN public.schedule_periods published_period
    ON schedule.source_kind='published_timetable'
    AND published_period.id=schedule.id
    AND published_period.version_id=schedule.source_record_id
  LEFT JOIN public.timetable_slots legacy_slot
    ON schedule.source_kind='legacy_timetable'
    AND legacy_slot.id=schedule.source_record_id
$$;

REVOKE ALL ON FUNCTION public.effective_school_schedule_v4(uuid,date) FROM PUBLIC;

DO $$
DECLARE
  application_owner text;
  role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.students'::regclass;

  EXECUTE format(
    'ALTER FUNCTION public.effective_school_schedule_v4(uuid,date) OWNER TO %I',
    application_owner
  );

  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.effective_school_schedule_v4(uuid,date) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
