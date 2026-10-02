-- Term curriculum targets make the timetable measurable. School calendar
-- exceptions remain dated overrides of the repeating weekly baseline.

ALTER TABLE school_calendar_days
  ADD COLUMN IF NOT EXISTS kind varchar(32) NOT NULL DEFAULT 'other_closure',
  ADD COLUMN IF NOT EXISTS reason varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE school_calendar_days
SET kind=CASE WHEN is_instructional THEN 'instructional_override' ELSE 'public_holiday' END
WHERE kind='other_closure';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='school_calendar_days_kind_check'
      AND conrelid='school_calendar_days'::regclass
  ) THEN
    ALTER TABLE school_calendar_days
      ADD CONSTRAINT school_calendar_days_kind_check
      CHECK (kind IN ('public_holiday','local_holiday','emergency_closure','instructional_override'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='school_calendar_days_revision_check'
      AND conrelid='school_calendar_days'::regclass
  ) THEN
    ALTER TABLE school_calendar_days
      ADD CONSTRAINT school_calendar_days_revision_check CHECK (revision > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS school_calendar_closure_idx
  ON school_calendar_days(school_id,date) WHERE NOT is_instructional;

CREATE TABLE IF NOT EXISTS curriculum_subject_targets (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
  class_section_id uuid NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  target_minutes integer NOT NULL CHECK (target_minutes BETWEEN 30 AND 120000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (term_id,class_section_id,subject_id)
);

CREATE INDEX IF NOT EXISTS curriculum_subject_targets_school_term_class_idx
  ON curriculum_subject_targets(school_id,term_id,class_section_id);
CREATE INDEX IF NOT EXISTS curriculum_subject_targets_subject_idx
  ON curriculum_subject_targets(subject_id);

CREATE OR REPLACE FUNCTION validate_curriculum_subject_target_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public
AS $$
DECLARE
  term_school uuid;
  term_year varchar;
  class_school uuid;
  class_year varchar;
  subject_school uuid;
BEGIN
  SELECT school_id,academic_year INTO term_school,term_year
  FROM academic_terms WHERE id=NEW.term_id;
  SELECT school_id,academic_year INTO class_school,class_year
  FROM class_sections WHERE id=NEW.class_section_id;
  SELECT school_id INTO subject_school FROM subjects WHERE id=NEW.subject_id;
  IF term_school IS NULL OR class_school IS NULL OR subject_school IS NULL
    OR NEW.school_id IS DISTINCT FROM term_school
    OR NEW.school_id IS DISTINCT FROM class_school
    OR NEW.school_id IS DISTINCT FROM subject_school
    OR term_year IS DISTINCT FROM class_year THEN
    RAISE EXCEPTION 'Curriculum target references must belong to one school and academic year'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS curriculum_subject_targets_scope_guard ON curriculum_subject_targets;
CREATE CONSTRAINT TRIGGER curriculum_subject_targets_scope_guard
  AFTER INSERT OR UPDATE ON curriculum_subject_targets
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION validate_curriculum_subject_target_scope();

REVOKE ALL ON FUNCTION validate_curriculum_subject_target_scope() FROM PUBLIC;

-- A newly declared closure must suppress both the recurring baseline and any
-- previously published dated plan. The dated plan remains available in its
-- own history workspace and becomes effective again if the closure is removed.
CREATE OR REPLACE FUNCTION effective_school_schedule(p_school uuid,p_date date)
RETURNS TABLE(id uuid,class_section_id uuid,term_id uuid,weekday smallint,period_number smallint,
  starts_at time,ends_at time,title text,slot_type varchar,room varchar,teacher_user_id uuid,
  teacher_designation text,subject_id uuid,materials text[],cancelled boolean,
  day_plan_id uuid,plan_version integer,notice text,coverage_status text)
LANGUAGE sql STABLE AS $$
  SELECT p.id,d.class_section_id,d.term_id,extract(isodow FROM p_date)::smallint,p.period_number,
    p.starts_at,p.ends_at,p.title::text,p.slot_type,p.room,m.user_id,'Teacher'::text,p.subject_id,
    p.materials,p.cancelled,d.id,d.published_version,v.notice::text,p.coverage_status
  FROM day_plans d JOIN day_plan_versions v ON v.plan_id=d.id AND v.version=d.published_version
  JOIN day_plan_periods p ON p.plan_id=v.plan_id AND p.version=v.version
  LEFT JOIN school_memberships m ON m.id=p.teacher_membership_id
  WHERE d.school_id=p_school AND d.date=p_date
    AND NOT EXISTS(SELECT 1 FROM school_calendar_days cal WHERE cal.school_id=p_school AND cal.date=p_date AND NOT cal.is_instructional)
  UNION ALL
  SELECT s.id,s.class_section_id,s.term_id,s.weekday,s.period_number,s.starts_at,s.ends_at,
    COALESCE(subject.name,s.title)::text,s.slot_type,s.room,s.teacher_user_id,s.teacher_designation::text,
    s.subject_id,'{}'::text[],false,NULL::uuid,NULL::integer,''::text,
    CASE WHEN s.teacher_user_id IS NULL AND s.slot_type='class' THEN 'unassigned' ELSE 'not_required' END
  FROM timetable_slots s JOIN class_sections c ON c.id=s.class_section_id
  JOIN academic_terms t ON t.id=s.term_id AND t.school_id=c.school_id
  LEFT JOIN subjects subject ON subject.id=s.subject_id
  WHERE c.school_id=p_school AND s.weekday=extract(isodow FROM p_date)
    AND p_date BETWEEN t.starts_on AND t.ends_on
    AND NOT EXISTS(SELECT 1 FROM day_plans d WHERE d.class_section_id=c.id AND d.date=p_date AND d.published_version IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM school_calendar_days cal WHERE cal.school_id=p_school AND cal.date=p_date AND NOT cal.is_instructional)
$$;

ALTER TABLE curriculum_subject_targets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE curriculum_subject_targets FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE curriculum_subject_targets FROM authenticated;
  END IF;
END $$;
