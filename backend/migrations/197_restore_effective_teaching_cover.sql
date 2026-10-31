-- Migration 154 retained unified academic/date-plan precedence but replaced the
-- effective staffing layer added by 113. Restore that owning layer, not a
-- Teaching-only substitution or a second schedule. Planned truth stays separate.
-- Teaching's immutable original_teacher_id is already present in migration 195.
CREATE OR REPLACE FUNCTION public.planned_school_schedule_v2(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text,
  occurrence_key text,source_kind text,source_record_id uuid,source_revision integer,source_version integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH chosen AS MATERIALIZED (
    SELECT DISTINCT ON(version.class_section_id,version.term_id)
      version.id,version.class_section_id,version.term_id,version.revision
    FROM public.schedule_versions version
    WHERE version.school_id=p_school AND version.state='published' AND version.class_section_id IS NOT NULL
      AND p_date>=version.starts_on AND(version.ends_on IS NULL OR p_date<=version.ends_on)
    ORDER BY version.class_section_id,version.term_id,version.baseline ASC,version.starts_on DESC
  ), planned AS MATERIALIZED (
    SELECT schedule.* FROM public.legacy_effective_school_schedule(p_school,p_date) schedule
    WHERE schedule.day_plan_id IS NOT NULL OR NOT EXISTS(
      SELECT 1 FROM chosen version WHERE version.class_section_id=schedule.class_section_id AND version.term_id=schedule.term_id)
    UNION ALL
    SELECT period.id,version.class_section_id,version.term_id,period.weekday,period.period_number,period.starts_at,period.ends_at,
      period.title::text,period.slot_type,period.room,period.teacher_user_id,'Teacher'::text,period.subject_id,'{}'::text[],false,NULL::uuid,NULL::integer,''::text,
      CASE WHEN period.teacher_user_id IS NULL AND period.slot_type='class' THEN 'unassigned' ELSE 'not_required' END
    FROM chosen version JOIN public.schedule_periods period ON period.version_id=version.id
    WHERE period.weekday=extract(isodow FROM p_date)
      AND NOT EXISTS(SELECT 1 FROM public.day_plans plan WHERE plan.class_section_id=version.class_section_id
        AND plan.date=p_date AND plan.published_version IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM public.school_calendar_days calendar WHERE calendar.school_id=p_school
        AND calendar.date=p_date AND NOT calendar.is_instructional)
  )
  SELECT planned.*,
    encode(digest(concat_ws(':',p_school::text,planned.class_section_id::text,p_date::text,planned.period_number::text),'sha256'),'hex') AS occurrence_key,
    CASE WHEN planned.day_plan_id IS NOT NULL THEN 'daily_plan' WHEN published.id IS NOT NULL THEN 'published_timetable' ELSE 'legacy_timetable' END AS source_kind,
    CASE WHEN planned.day_plan_id IS NOT NULL THEN planned.day_plan_id WHEN published.id IS NOT NULL THEN published.id ELSE planned.id END AS source_record_id,
    CASE WHEN planned.day_plan_id IS NOT NULL THEN plan.revision WHEN published.id IS NOT NULL THEN published.revision ELSE legacy_slot.revision END AS source_revision,
    CASE WHEN planned.day_plan_id IS NOT NULL THEN planned.plan_version ELSE NULL::integer END AS source_version
  FROM planned LEFT JOIN public.day_plans plan ON plan.school_id=p_school AND plan.id=planned.day_plan_id
  LEFT JOIN LATERAL (
    SELECT chosen.id,chosen.revision FROM chosen JOIN public.schedule_periods period ON period.version_id=chosen.id
    WHERE planned.day_plan_id IS NULL AND chosen.class_section_id=planned.class_section_id AND chosen.term_id=planned.term_id AND period.id=planned.id LIMIT 1
  ) published ON true
  LEFT JOIN public.timetable_slots legacy_slot ON planned.day_plan_id IS NULL AND published.id IS NULL AND legacy_slot.id=planned.id
$$;

CREATE OR REPLACE FUNCTION public.effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT planned.id,planned.class_section_id,planned.term_id,planned.weekday,planned.period_number,
    planned.starts_at,planned.ends_at,planned.title,planned.slot_type,planned.room,
    CASE WHEN approved_leave.id IS NULL THEN planned.teacher_user_id
      WHEN active_replacement.user_id IS NOT NULL THEN active_replacement.user_id ELSE NULL::uuid END AS teacher_user_id,
    CASE WHEN approved_leave.id IS NULL THEN planned.teacher_designation
      WHEN active_replacement.user_id IS NOT NULL THEN active_replacement.designation::text ELSE 'Cover needed'::text END AS teacher_designation,
    planned.subject_id,planned.materials,planned.cancelled,planned.day_plan_id,planned.plan_version,planned.notice,
    CASE WHEN approved_leave.id IS NULL THEN planned.coverage_status
      WHEN active_replacement.user_id IS NOT NULL THEN 'accepted'::text ELSE 'unassigned'::text END AS coverage_status
  FROM public.planned_school_schedule_v2(p_school,p_date) planned
  LEFT JOIN LATERAL (
    SELECT request.id FROM public.staff_profiles absent JOIN public.staff_leave_requests request
      ON request.school_id=absent.school_id AND request.staff_profile_id=absent.id AND request.status='approved'
      AND p_date BETWEEN request.starts_on AND request.ends_on
      AND(request.portion='full_day' OR request.portion='first_half' AND planned.starts_at<time '12:00'
        OR request.portion='second_half' AND planned.starts_at>=time '12:00')
    WHERE absent.school_id=p_school AND absent.user_id=planned.teacher_user_id
    ORDER BY request.decided_at DESC NULLS LAST,request.id LIMIT 1
  ) approved_leave ON true
  LEFT JOIN public.staff_timetable_substitutions substitution
    ON substitution.school_id=p_school AND substitution.duty_date=p_date AND substitution.state='effective'
    AND substitution.source_occurrence_key=planned.occurrence_key AND substitution.source_schedule_id=planned.id
    AND substitution.source_kind=planned.source_kind AND substitution.source_record_id=planned.source_record_id
    AND substitution.source_revision=planned.source_revision AND substitution.source_version IS NOT DISTINCT FROM planned.source_version
    AND substitution.class_section_id=planned.class_section_id AND substitution.subject_id IS NOT DISTINCT FROM planned.subject_id
    AND substitution.period_number=planned.period_number AND substitution.starts_at=planned.starts_at AND substitution.ends_at=planned.ends_at
    AND substitution.original_teacher_user_id=planned.teacher_user_id
  LEFT JOIN LATERAL (
    SELECT profile.user_id,profile.designation FROM public.staff_profiles profile
    WHERE profile.id=substitution.replacement_staff_profile_id AND profile.school_id=substitution.school_id
      AND profile.user_id=substitution.replacement_teacher_user_id
      AND(
        -- Completed-date accepted cover is historical staffing truth. Present
        -- eligibility never rewrites who was effective on an elapsed date.
        p_date<(SELECT(now() AT TIME ZONE school.timezone)::date FROM public.schools school WHERE school.id=p_school)
        OR(profile.status='active'
          AND EXISTS(SELECT 1 FROM public.users account WHERE account.id=profile.user_id AND account.is_active)
          AND EXISTS(SELECT 1 FROM public.school_memberships membership WHERE membership.school_id=profile.school_id
            AND membership.user_id=profile.user_id AND membership.role='staff' AND membership.is_active))
      ) LIMIT 1
  ) active_replacement ON true
$$;
REVOKE ALL ON FUNCTION public.planned_school_schedule_v2(uuid,date),public.effective_school_schedule(uuid,date) FROM PUBLIC;
DO $$ DECLARE owner_name text;role_name text; BEGIN
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='public.schedule_versions'::regclass;
  EXECUTE format('ALTER FUNCTION public.planned_school_schedule_v2(uuid,date) OWNER TO %I',owner_name);
  EXECUTE format('ALTER FUNCTION public.effective_school_schedule(uuid,date) OWNER TO %I',owner_name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.planned_school_schedule_v2(uuid,date),public.effective_school_schedule(uuid,date) FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
