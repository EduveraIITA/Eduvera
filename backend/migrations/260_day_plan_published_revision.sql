-- Draft preparation and coverage acknowledgements advance the plan aggregate.
-- They must not change the identity of its still-published source or detach an
-- already accepted exact teaching substitution.
ALTER TABLE public.day_plan_versions
  ADD COLUMN published_revision integer CHECK(published_revision>0);

-- Retained publications have exact native publication audits correlated with
-- their accepted temporal event. Never infer a revision from today's aggregate,
-- a timestamp, an ordinal version, a teacher name, or a nearby event.
DO $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM public.day_plan_versions version
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT event.source_revision) AS revisions
      FROM public.audit_events audit
      JOIN public.campus_model_events event ON event.school_id=version.school_id
        AND event.source_domain='day_plan' AND event.source_record_id=version.plan_id::text
        AND event.event_type='timetable.day_plan_published'
        AND event.payload->>'version'=version.version::text
        AND event.correlation_id=audit.request_id
      WHERE audit.school_id=version.school_id AND audit.target_type='day_plan'
        AND audit.target_id=version.plan_id AND audit.action='day_plan.published'
        AND audit.metadata->>'version'=version.version::text
    ) evidence ON true
    WHERE version.state IN ('published','superseded') AND evidence.revisions<>1
  ) THEN
    RAISE EXCEPTION 'Published day-plan revision requires one exact correlated publication audit and event; missing or conflicting provenance must be reconciled.'
      USING ERRCODE='23514';
  END IF;
END $$;

WITH exact_publications AS (
  SELECT version.school_id,version.plan_id,version.version,min(event.source_revision) AS revision
  FROM public.day_plan_versions version
  JOIN public.audit_events audit ON audit.school_id=version.school_id
    AND audit.target_type='day_plan' AND audit.target_id=version.plan_id
    AND audit.action='day_plan.published' AND audit.metadata->>'version'=version.version::text
  JOIN public.campus_model_events event ON event.school_id=version.school_id
    AND event.source_domain='day_plan' AND event.source_record_id=version.plan_id::text
    AND event.event_type='timetable.day_plan_published' AND event.payload->>'version'=version.version::text
    AND event.correlation_id=audit.request_id
  WHERE version.state IN ('published','superseded')
  GROUP BY version.school_id,version.plan_id,version.version
)
UPDATE public.day_plan_versions version SET published_revision=evidence.revision
FROM exact_publications evidence WHERE version.school_id=evidence.school_id
  AND version.plan_id=evidence.plan_id AND version.version=evidence.version;

-- Never reinterpret an old accepted staffing decision whose retained source
-- differs from the exact publication. It needs explicit owning reconciliation.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.staff_timetable_substitutions substitution
    JOIN public.day_plan_versions publication ON publication.school_id=substitution.school_id
      AND publication.plan_id=substitution.source_record_id
      AND publication.version=substitution.source_version
    WHERE substitution.source_kind='daily_plan' AND substitution.state='effective'
      AND substitution.source_revision IS DISTINCT FROM publication.published_revision) THEN
    RAISE EXCEPTION 'Accepted day-plan cover has a different retained source revision; reconcile it before this upgrade.' USING ERRCODE='23514';
  END IF;
END $$;

ALTER TABLE public.day_plan_versions ADD CONSTRAINT day_plan_publication_revision_required
  CHECK(state NOT IN ('published','superseded') OR published_revision IS NOT NULL);

CREATE FUNCTION public.guard_day_plan_publication_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF OLD.published_revision IS NOT NULL AND NEW.published_revision IS DISTINCT FROM OLD.published_revision THEN
    RAISE EXCEPTION 'A published day-plan source revision is immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER day_plan_publication_revision_immutable BEFORE UPDATE ON public.day_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_day_plan_publication_revision();

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
    CASE WHEN planned.day_plan_id IS NOT NULL THEN publication.published_revision WHEN published.id IS NOT NULL THEN published.revision ELSE legacy_slot.revision END AS source_revision,
    CASE WHEN planned.day_plan_id IS NOT NULL THEN planned.plan_version ELSE NULL::integer END AS source_version
  FROM planned LEFT JOIN public.day_plans plan ON plan.school_id=p_school AND plan.id=planned.day_plan_id
  LEFT JOIN public.day_plan_versions publication ON publication.school_id=plan.school_id
    AND publication.plan_id=plan.id AND publication.version=planned.plan_version
  LEFT JOIN LATERAL (
    SELECT chosen.id,chosen.revision FROM chosen JOIN public.schedule_periods period ON period.version_id=chosen.id
    WHERE planned.day_plan_id IS NULL AND chosen.class_section_id=planned.class_section_id AND chosen.term_id=planned.term_id AND period.id=planned.id LIMIT 1
  ) published ON true
  LEFT JOIN public.timetable_slots legacy_slot ON planned.day_plan_id IS NULL AND published.id IS NULL AND legacy_slot.id=planned.id
$$;
