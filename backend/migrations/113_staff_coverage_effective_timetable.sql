-- Accepted leave cover is an effective timetable decision, not merely a closed
-- staffing task. Keep the staff task as workflow evidence and record the exact
-- schedule occurrence and source revision that the accepted offer supersedes.

ALTER TABLE public.staff_coverage_tasks
  ADD CONSTRAINT staff_coverage_tasks_id_school_unique UNIQUE(id,school_id);

-- A cancelled obligation is retained as evidence, but it must not prevent the
-- Staff domain from creating a new linked obligation for the same planned
-- occurrence after a cover decision is revoked.
DROP INDEX IF EXISTS public.staff_coverage_schedule_key;
CREATE UNIQUE INDEX staff_coverage_schedule_key
  ON public.staff_coverage_tasks(leave_request_id,duty_date,source_schedule_id)
  WHERE source_schedule_id IS NOT NULL AND status<>'cancelled';

CREATE TABLE public.staff_timetable_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  coverage_task_id uuid NOT NULL,
  class_section_id uuid NOT NULL REFERENCES public.class_sections(id) ON DELETE RESTRICT,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE RESTRICT,
  duty_date date NOT NULL,
  period_number smallint NOT NULL CHECK(period_number BETWEEN 1 AND 24),
  starts_at time NOT NULL,
  ends_at time NOT NULL CHECK(ends_at>starts_at),
  source_schedule_id uuid NOT NULL,
  source_occurrence_key char(64) NOT NULL
    CHECK(source_occurrence_key ~ '^[0-9a-f]{64}$'),
  source_kind varchar(24) NOT NULL
    CHECK(source_kind IN ('daily_plan','published_timetable','legacy_timetable')),
  source_record_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK(source_revision>0),
  source_version integer CHECK(source_version IS NULL OR source_version>0),
  original_teacher_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  replacement_staff_profile_id uuid NOT NULL,
  replacement_teacher_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  state varchar(16) NOT NULL DEFAULT 'effective'
    CHECK(state IN ('effective','superseded','cancelled')),
  coverage_task_revision integer NOT NULL CHECK(coverage_task_revision>0),
  accepted_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  accepted_at timestamptz NOT NULL,
  effective_event_id uuid,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,coverage_task_id),
  FOREIGN KEY(coverage_task_id,school_id)
    REFERENCES public.staff_coverage_tasks(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(replacement_staff_profile_id,school_id)
    REFERENCES public.staff_profiles(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(effective_event_id,school_id)
    REFERENCES public.event_outbox(id,school_id) ON DELETE RESTRICT,
  CHECK(
    (state='effective' AND superseded_at IS NULL)
    OR (state<>'effective' AND superseded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX staff_timetable_substitutions_effective_occurrence
  ON public.staff_timetable_substitutions(school_id,duty_date,source_occurrence_key)
  WHERE state='effective';
CREATE INDEX staff_timetable_substitutions_replacement
  ON public.staff_timetable_substitutions(
    school_id,replacement_teacher_user_id,duty_date,starts_at,ends_at
  ) WHERE state='effective';

CREATE TABLE public.staff_coverage_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  command_type varchar(24) NOT NULL CHECK(command_type='respond'),
  decision varchar(16) NOT NULL CHECK(decision IN ('accepted','declined')),
  target_task_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  source_task_revision integer NOT NULL CHECK(source_task_revision>0),
  resulting_task_revision integer NOT NULL CHECK(resulting_task_revision>0),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  outbox_event_id uuid NOT NULL,
  substitution_id uuid,
  authority_receipt jsonb NOT NULL CHECK(jsonb_typeof(authority_receipt)='object'),
  schedule_provenance jsonb NOT NULL CHECK(jsonb_typeof(schedule_provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,school_id),
  UNIQUE(school_id,actor_id,command_id),
  FOREIGN KEY(target_task_id,school_id)
    REFERENCES public.staff_coverage_tasks(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(outbox_event_id,school_id)
    REFERENCES public.event_outbox(id,school_id) ON DELETE RESTRICT,
  FOREIGN KEY(substitution_id,school_id)
    REFERENCES public.staff_timetable_substitutions(id,school_id) ON DELETE RESTRICT,
  CHECK(
    (decision='accepted' AND (
      (substitution_id IS NOT NULL AND schedule_provenance->>'effective_timetable'='true')
      OR (substitution_id IS NULL AND schedule_provenance->>'effective_timetable'='false')
    ))
    OR (decision='declined' AND substitution_id IS NULL)
  )
);
CREATE INDEX staff_coverage_commands_task_idx
  ON public.staff_coverage_commands(school_id,target_task_id,created_at);

CREATE FUNCTION public.validate_staff_timetable_substitution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  task record;
  replacement record;
  absent_user uuid;
  school_today date;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.state<>'effective' THEN
      RAISE EXCEPTION 'Historical timetable substitutions are immutable'
        USING ERRCODE='23514';
    END IF;
    IF OLD.state IS DISTINCT FROM NEW.state THEN
      IF NEW.state NOT IN ('superseded','cancelled') OR NEW.superseded_at IS NULL THEN
        RAISE EXCEPTION 'An effective substitution can only be closed once'
          USING ERRCODE='23514';
      END IF;
      IF (to_jsonb(NEW)-ARRAY['state','superseded_at']::text[])
          IS DISTINCT FROM
         (to_jsonb(OLD)-ARRAY['state','superseded_at']::text[]) THEN
        RAISE EXCEPTION 'Close the substitution without rewriting its evidence'
          USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW)-'effective_event_id')
        IS DISTINCT FROM (to_jsonb(OLD)-'effective_event_id') THEN
      RAISE EXCEPTION 'Effective timetable substitution evidence is immutable'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.state<>'effective' THEN
    RAISE EXCEPTION 'A timetable substitution must begin as effective'
      USING ERRCODE='23514';
  END IF;

  SELECT coverage.*,absent.user_id AS absent_user_id,
    absent.school_id AS absent_school_id
  INTO task
  FROM public.staff_coverage_tasks coverage
  JOIN public.staff_profiles absent ON absent.id=coverage.absent_staff_profile_id
  WHERE coverage.id=NEW.coverage_task_id AND coverage.school_id=NEW.school_id;

  SELECT profile.school_id,profile.user_id,profile.status,
    EXISTS(
      SELECT 1 FROM public.users account
      WHERE account.id=profile.user_id AND account.is_active
    ) AS account_active,
    EXISTS(
      SELECT 1 FROM public.school_memberships membership
      WHERE membership.school_id=profile.school_id
        AND membership.user_id=profile.user_id
        AND membership.role='staff' AND membership.is_active
    ) AS membership_active
  INTO replacement
  FROM public.staff_profiles profile
  WHERE profile.id=NEW.replacement_staff_profile_id;

  SELECT (now() AT TIME ZONE school.timezone)::date INTO school_today
  FROM public.schools school WHERE school.id=NEW.school_id;

  IF task.id IS NULL OR task.status<>'accepted'
    OR task.revision<>NEW.coverage_task_revision
    OR task.class_section_id IS DISTINCT FROM NEW.class_section_id
    OR task.subject_id IS DISTINCT FROM NEW.subject_id
    OR task.duty_date IS DISTINCT FROM NEW.duty_date
    OR task.period_number IS DISTINCT FROM NEW.period_number
    OR task.starts_at IS DISTINCT FROM NEW.starts_at
    OR task.ends_at IS DISTINCT FROM NEW.ends_at
    OR task.source_schedule_id IS DISTINCT FROM NEW.source_schedule_id
    OR task.replacement_staff_profile_id IS DISTINCT FROM NEW.replacement_staff_profile_id THEN
    RAISE EXCEPTION 'Substitution must match the accepted coverage task revision'
      USING ERRCODE='23514';
  END IF;

  absent_user := task.absent_user_id;
  IF task.absent_school_id IS DISTINCT FROM NEW.school_id
    OR absent_user IS NULL
    OR absent_user IS DISTINCT FROM NEW.original_teacher_user_id THEN
    RAISE EXCEPTION 'Substitution must retain the original scheduled teacher'
      USING ERRCODE='23514';
  END IF;
  IF replacement.school_id IS DISTINCT FROM NEW.school_id
    OR replacement.user_id IS NULL
    OR replacement.user_id IS DISTINCT FROM NEW.replacement_teacher_user_id
    OR NEW.accepted_by IS DISTINCT FROM NEW.replacement_teacher_user_id
    OR (
      NEW.duty_date>=school_today
      AND (
        replacement.status IS DISTINCT FROM 'active'
        OR NOT replacement.account_active
        OR NOT replacement.membership_active
      )
    ) THEN
    RAISE EXCEPTION 'Substitute must be the active offered staff account'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER staff_timetable_substitution_scope_guard
  AFTER INSERT OR UPDATE ON public.staff_timetable_substitutions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.validate_staff_timetable_substitution();

CREATE FUNCTION public.reject_staff_timetable_substitution_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  RAISE EXCEPTION 'Timetable substitution history is append-only'
    USING ERRCODE='23514';
END $$;

CREATE TRIGGER staff_timetable_substitution_delete_guard
  BEFORE DELETE ON public.staff_timetable_substitutions
  FOR EACH ROW EXECUTE FUNCTION public.reject_staff_timetable_substitution_delete();

-- Keep planned/source truth separate from operational staffing. Coverage task
-- creation and reconciliation need the originally planned teacher even while
-- the effective timetable intentionally hides an approved-absent teacher.
CREATE FUNCTION public.planned_school_schedule_v2(p_school uuid,p_date date)
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
      ELSE 1
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
$$;

-- Preserve the established recurring schedule / dated-plan precedence, then
-- apply staffing truth. During approved leave, only an active accepted
-- replacement is effective; otherwise the occurrence remains visibly
-- unassigned rather than resurrecting the absent planned teacher.
CREATE OR REPLACE FUNCTION public.effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public
AS $$
  SELECT
    planned.id,planned.class_section_id,planned.term_id,planned.weekday,
    planned.period_number,planned.starts_at,planned.ends_at,planned.title,
    planned.slot_type,planned.room,
    CASE
      WHEN approved_leave.id IS NULL THEN planned.teacher_user_id
      WHEN active_replacement.user_id IS NOT NULL THEN active_replacement.user_id
      ELSE NULL::uuid
    END AS teacher_user_id,
    CASE
      WHEN approved_leave.id IS NULL THEN planned.teacher_designation
      WHEN active_replacement.user_id IS NOT NULL THEN active_replacement.designation::text
      ELSE 'Cover needed'::text
    END AS teacher_designation,
    planned.subject_id,planned.materials,planned.cancelled,planned.day_plan_id,
    planned.plan_version,planned.notice,
    CASE
      WHEN approved_leave.id IS NULL THEN planned.coverage_status
      WHEN active_replacement.user_id IS NOT NULL THEN 'accepted'::text
      ELSE 'unassigned'::text
    END AS coverage_status
  FROM public.planned_school_schedule_v2(p_school,p_date) planned
  LEFT JOIN LATERAL (
    SELECT request.id
    FROM public.staff_profiles absent
    JOIN public.staff_leave_requests request
      ON request.school_id=absent.school_id
      AND request.staff_profile_id=absent.id
      AND request.status='approved'
      AND p_date BETWEEN request.starts_on AND request.ends_on
      AND (
        request.portion='full_day'
        OR (request.portion='first_half' AND planned.starts_at<time '12:00')
        OR (request.portion='second_half' AND planned.starts_at>=time '12:00')
      )
    WHERE absent.school_id=p_school
      AND absent.user_id=planned.teacher_user_id
    ORDER BY request.decided_at DESC NULLS LAST,request.id
    LIMIT 1
  ) approved_leave ON true
  LEFT JOIN public.staff_timetable_substitutions substitution
    ON substitution.school_id=p_school
    AND substitution.duty_date=p_date
    AND substitution.state='effective'
    AND substitution.source_occurrence_key=planned.occurrence_key
    AND substitution.source_schedule_id=planned.id
    AND substitution.source_kind=planned.source_kind
    AND substitution.source_record_id=planned.source_record_id
    AND substitution.source_revision=planned.source_revision
    AND substitution.source_version IS NOT DISTINCT FROM planned.source_version
    AND substitution.class_section_id=planned.class_section_id
    AND substitution.subject_id IS NOT DISTINCT FROM planned.subject_id
    AND substitution.period_number=planned.period_number
    AND substitution.starts_at=planned.starts_at
    AND substitution.ends_at=planned.ends_at
    AND substitution.original_teacher_user_id=planned.teacher_user_id
  LEFT JOIN LATERAL (
    SELECT profile.user_id,profile.designation
    FROM public.staff_profiles profile
    WHERE profile.id=substitution.replacement_staff_profile_id
      AND profile.school_id=substitution.school_id
      AND profile.user_id=substitution.replacement_teacher_user_id
      AND (
        -- A past accepted cover is historical timetable truth. Current
        -- account/profile eligibility must not rewrite what was effective on
        -- an already elapsed school date.
        p_date<(
          SELECT (now() AT TIME ZONE school.timezone)::date
          FROM public.schools school WHERE school.id=p_school
        )
        OR (
          profile.status='active'
          AND EXISTS(
            SELECT 1 FROM public.users account
            WHERE account.id=profile.user_id AND account.is_active
          )
          AND EXISTS(
            SELECT 1 FROM public.school_memberships membership
            WHERE membership.school_id=profile.school_id
              AND membership.user_id=profile.user_id
              AND membership.role='staff' AND membership.is_active
          )
        )
      )
    LIMIT 1
  ) active_replacement ON true
$$;

-- Keep the established provenance-bearing v2 contract while sourcing identity
-- from the planned occurrence and staffing fields from the effective view.
CREATE OR REPLACE FUNCTION public.effective_school_schedule_v2(p_school uuid,p_date date)
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
  SELECT effective.*,planned.occurrence_key,planned.source_kind,
    planned.source_record_id,planned.source_revision,planned.source_version
  FROM public.effective_school_schedule(p_school,p_date) effective
  JOIN public.planned_school_schedule_v2(p_school,p_date) planned
    ON planned.id=effective.id
    AND planned.class_section_id=effective.class_section_id
    AND planned.period_number=effective.period_number
    AND planned.starts_at=effective.starts_at
    AND planned.ends_at=effective.ends_at
$$;

-- Additive provenance-bearing contract for consumers that need to explain why
-- the effective teacher differs from the published or dated source plan.
CREATE FUNCTION public.effective_school_schedule_v3(p_school uuid,p_date date)
RETURNS TABLE(
  id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text,
  occurrence_key text,source_kind text,source_record_id uuid,source_revision integer,
  source_version integer,coverage_record_id uuid,coverage_task_id uuid,
  coverage_task_revision integer,original_teacher_user_id uuid,
  replacement_staff_profile_id uuid,coverage_accepted_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public
AS $$
  SELECT schedule.*,
    substitution.id,substitution.coverage_task_id,
    substitution.coverage_task_revision,substitution.original_teacher_user_id,
    substitution.replacement_staff_profile_id,substitution.accepted_at
  FROM public.effective_school_schedule_v2(p_school,p_date) schedule
  LEFT JOIN public.staff_timetable_substitutions substitution
    ON substitution.school_id=p_school
    AND substitution.duty_date=p_date
    AND substitution.state='effective'
    AND substitution.source_occurrence_key=schedule.occurrence_key
    AND substitution.source_schedule_id=schedule.id
    AND substitution.source_kind=schedule.source_kind
    AND substitution.source_record_id=schedule.source_record_id
    AND substitution.source_revision=schedule.source_revision
    AND substitution.source_version IS NOT DISTINCT FROM schedule.source_version
    AND substitution.class_section_id=schedule.class_section_id
    AND substitution.subject_id IS NOT DISTINCT FROM schedule.subject_id
    AND substitution.period_number=schedule.period_number
    AND substitution.starts_at=schedule.starts_at
    AND substitution.ends_at=schedule.ends_at
    -- v2 already applies current/future eligibility while retaining a past
    -- accepted replacement. Matching its resolved teacher keeps v3's cover
    -- explanation aligned without a second, contradictory eligibility test.
    AND substitution.replacement_teacher_user_id=schedule.teacher_user_id
$$;

-- Return the exact records made historical so the Staff-domain caller can add
-- its own task audit, outbox evidence and next-owner work without re-discovering
-- which accepted decisions were affected.
CREATE FUNCTION public.reconcile_staff_timetable_substitution_details(
  p_school uuid,
  p_from date,
  p_to date,
  p_class_section uuid DEFAULT NULL
)
RETURNS TABLE(substitution_id uuid,coverage_task_id uuid,reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
BEGIN
  IF p_to<p_from THEN
    RAISE EXCEPTION 'Substitution reconciliation end must not precede its start'
      USING ERRCODE='22007';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT substitution.id,substitution.coverage_task_id,
      CASE
        -- A calendar closure is a temporary condition over the occurrence,
        -- not evidence that its accepted staffing decision was rewritten.
        WHEN NOT EXISTS(
          SELECT 1 FROM public.school_calendar_days closure
          WHERE closure.school_id=substitution.school_id
            AND closure.date=substitution.duty_date
            AND NOT closure.is_instructional
        ) AND NOT EXISTS(
          SELECT 1
          FROM public.planned_school_schedule_v2(
            p_school,substitution.duty_date
          ) schedule
          WHERE schedule.occurrence_key=substitution.source_occurrence_key
            AND schedule.id=substitution.source_schedule_id
            AND schedule.source_kind=substitution.source_kind
            AND schedule.source_record_id=substitution.source_record_id
            AND schedule.source_revision=substitution.source_revision
            AND schedule.source_version IS NOT DISTINCT FROM substitution.source_version
            AND schedule.class_section_id=substitution.class_section_id
            AND schedule.subject_id IS NOT DISTINCT FROM substitution.subject_id
            AND schedule.period_number=substitution.period_number
            AND schedule.starts_at=substitution.starts_at
            AND schedule.ends_at=substitution.ends_at
            AND schedule.teacher_user_id=substitution.original_teacher_user_id
            AND NOT schedule.cancelled
        ) THEN 'source_changed'
        WHEN NOT EXISTS(
          SELECT 1
          FROM public.staff_coverage_tasks task
          JOIN public.staff_leave_requests request
            ON request.id=task.leave_request_id
            AND request.school_id=task.school_id
            AND request.status='approved'
          WHERE task.id=substitution.coverage_task_id
            AND task.school_id=substitution.school_id
            AND task.status='accepted'
        ) THEN 'coverage_obligation_changed'
        ELSE 'replacement_unavailable'
      END AS reason
    FROM public.staff_timetable_substitutions substitution
    JOIN public.schools school ON school.id=substitution.school_id
    -- Completion is historical evidence. This prospective reconciler may
    -- close only a decision whose authoritative task is still accepted.
    JOIN public.staff_coverage_tasks current_task
      ON current_task.id=substitution.coverage_task_id
      AND current_task.school_id=substitution.school_id
      AND current_task.status='accepted'
    WHERE substitution.school_id=p_school
      AND substitution.state='effective'
      AND substitution.duty_date BETWEEN p_from AND p_to
      AND (p_class_section IS NULL OR substitution.class_section_id=p_class_section)
      AND (
        (
          NOT EXISTS(
            SELECT 1 FROM public.school_calendar_days closure
            WHERE closure.school_id=substitution.school_id
              AND closure.date=substitution.duty_date
              AND NOT closure.is_instructional
          )
          AND NOT EXISTS(
          SELECT 1
          FROM public.planned_school_schedule_v2(
            p_school,substitution.duty_date
          ) schedule
          WHERE schedule.occurrence_key=substitution.source_occurrence_key
            AND schedule.id=substitution.source_schedule_id
            AND schedule.source_kind=substitution.source_kind
            AND schedule.source_record_id=substitution.source_record_id
            AND schedule.source_revision=substitution.source_revision
            AND schedule.source_version IS NOT DISTINCT FROM substitution.source_version
            AND schedule.class_section_id=substitution.class_section_id
            AND schedule.subject_id IS NOT DISTINCT FROM substitution.subject_id
            AND schedule.period_number=substitution.period_number
            AND schedule.starts_at=substitution.starts_at
            AND schedule.ends_at=substitution.ends_at
            AND schedule.teacher_user_id=substitution.original_teacher_user_id
            AND NOT schedule.cancelled
          )
        )
        OR NOT EXISTS(
          SELECT 1
          FROM public.staff_coverage_tasks task
          JOIN public.staff_leave_requests request
            ON request.id=task.leave_request_id
            AND request.school_id=task.school_id
            AND request.status='approved'
          WHERE task.id=substitution.coverage_task_id
            AND task.school_id=substitution.school_id
            AND task.status='accepted'
        )
        OR (
          -- Eligibility changes are prospective. Republished/cancelled source
          -- truth may still reconcile a past row, but present-day deactivation
          -- alone cannot erase a completed historical cover.
          substitution.duty_date>=(now() AT TIME ZONE school.timezone)::date
          AND NOT EXISTS(
            SELECT 1
            FROM public.staff_profiles active_profile
            JOIN public.users active_account
              ON active_account.id=active_profile.user_id AND active_account.is_active
            JOIN public.school_memberships active_membership
              ON active_membership.school_id=active_profile.school_id
              AND active_membership.user_id=active_profile.user_id
              AND active_membership.role='staff' AND active_membership.is_active
            WHERE active_profile.id=substitution.replacement_staff_profile_id
              AND active_profile.school_id=substitution.school_id
              AND active_profile.status='active'
              AND active_profile.user_id=substitution.replacement_teacher_user_id
          )
        )
      )
  ), stale AS (
    UPDATE public.staff_timetable_substitutions substitution
    SET state='superseded',superseded_at=clock_timestamp()
    FROM candidates
    WHERE substitution.id=candidates.id AND substitution.state='effective'
    RETURNING substitution.id,substitution.coverage_task_id
  )
  SELECT stale.id,stale.coverage_task_id,candidates.reason
  FROM stale JOIN candidates ON candidates.id=stale.id;
END $$;

-- Compatibility wrapper retained for existing callers that only need a count.
CREATE FUNCTION public.reconcile_staff_timetable_substitutions(
  p_school uuid,
  p_from date,
  p_to date,
  p_class_section uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path=public
AS $$
  SELECT count(*)::integer
  FROM public.reconcile_staff_timetable_substitution_details(
    p_school,p_from,p_to,p_class_section
  )
$$;

-- Upgrade retained accepted tasks only when their exact source occurrence and
-- original/replacement identities are still provable. Do not manufacture a
-- command receipt; the historical task audit and outbox event remain the evidence.
WITH accepted_cover AS MATERIALIZED (
  SELECT task.school_id,task.id AS coverage_task_id,task.class_section_id,
    task.subject_id,task.duty_date,task.period_number,task.starts_at,task.ends_at,
    schedule.id AS source_schedule_id,schedule.occurrence_key,
    schedule.source_kind,schedule.source_record_id,schedule.source_revision,
    schedule.source_version,absent.user_id AS original_teacher_user_id,
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
  JOIN LATERAL (
    SELECT audit.actor_id,audit.created_at
    FROM public.staff_coverage_task_audits audit
    WHERE audit.school_id=task.school_id AND audit.task_id=task.id
      AND audit.action='accepted' AND audit.to_status='accepted'
      AND audit.actor_id=replacement.user_id
    ORDER BY audit.created_at DESC,audit.id DESC
    LIMIT 1
  ) accepted ON true
  JOIN LATERAL (
    SELECT source.*
    FROM public.planned_school_schedule_v2(task.school_id,task.duty_date) source
    WHERE source.id=task.source_schedule_id
      AND source.class_section_id=task.class_section_id
      AND source.subject_id IS NOT DISTINCT FROM task.subject_id
      AND source.period_number=task.period_number
      AND source.starts_at=task.starts_at AND source.ends_at=task.ends_at
      AND source.teacher_user_id=absent.user_id AND NOT source.cancelled
    LIMIT 1
  ) schedule ON true
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
    AND (
      task.duty_date<(now() AT TIME ZONE school.timezone)::date
      OR (
        replacement.status='active'
        AND EXISTS(
          SELECT 1 FROM public.users replacement_account
          WHERE replacement_account.id=replacement.user_id
            AND replacement_account.is_active
        )
        AND EXISTS(
          SELECT 1 FROM public.school_memberships replacement_membership
          WHERE replacement_membership.school_id=task.school_id
            AND replacement_membership.user_id=replacement.user_id
            AND replacement_membership.role='staff'
            AND replacement_membership.is_active
        )
      )
    )
    AND task.source_schedule_id IS NOT NULL
    AND task.class_section_id IS NOT NULL
    AND task.period_number IS NOT NULL
    AND task.starts_at IS NOT NULL AND task.ends_at IS NOT NULL
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
FROM accepted_cover
ON CONFLICT(school_id,coverage_task_id) DO NOTHING;

-- Date-scoped class authority follows the effective teacher, including an
-- accepted substitute, rather than resurrecting the superseded base teacher.
CREATE OR REPLACE FUNCTION public.schedule_teacher_assigned(
  tenant uuid,actor uuid,resource uuid,at_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path=public
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.effective_school_schedule(tenant,at_date) schedule
    WHERE schedule.class_section_id=resource
      AND schedule.teacher_user_id=actor
      AND NOT schedule.cancelled
      AND schedule.coverage_status IN ('not_required','accepted')
  )
$$;

ALTER TABLE public.staff_timetable_substitutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_coverage_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_timetable_substitutions,public.staff_coverage_commands FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_staff_timetable_substitution() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_staff_timetable_substitution_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.planned_school_schedule_v2(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_school_schedule_v2(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_school_schedule_v3(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_staff_timetable_substitution_details(uuid,date,date,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_staff_timetable_substitutions(uuid,date,date,uuid) FROM PUBLIC;

DO $$
DECLARE application_owner text; role_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid='public.staff_coverage_tasks'::regclass;

  EXECUTE format('ALTER TABLE public.staff_timetable_substitutions OWNER TO %I',application_owner);
  EXECUTE format('ALTER TABLE public.staff_coverage_commands OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.validate_staff_timetable_substitution() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reject_staff_timetable_substitution_delete() OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.planned_school_schedule_v2(uuid,date) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.effective_school_schedule(uuid,date) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.effective_school_schedule_v2(uuid,date) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.effective_school_schedule_v3(uuid,date) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reconcile_staff_timetable_substitution_details(uuid,date,date,uuid) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.reconcile_staff_timetable_substitutions(uuid,date,date,uuid) OWNER TO %I',application_owner);
  EXECUTE format('ALTER FUNCTION public.schedule_teacher_assigned(uuid,uuid,uuid,date) OWNER TO %I',application_owner);

  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.staff_timetable_substitutions,public.staff_coverage_commands FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.validate_staff_timetable_substitution() FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.reject_staff_timetable_substitution_delete() FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.planned_school_schedule_v2(uuid,date),public.effective_school_schedule_v2(uuid,date) FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.effective_school_schedule_v3(uuid,date) FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.reconcile_staff_timetable_substitution_details(uuid,date,date,uuid) FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.reconcile_staff_timetable_substitutions(uuid,date,date,uuid) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
