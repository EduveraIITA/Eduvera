-- Match the established direct-database application boundary used by students,
-- timetable_slots and school_calendar_days. Migration 027 could leave this
-- RLS-enabled table owned by a separate migrator, breaking the weekly editor.
-- Do not disable RLS or grant browser roles access to institution records.
DO $$
DECLARE
  application_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner
  FROM pg_class WHERE oid = 'public.students'::regclass;

  ALTER TABLE public.curriculum_subject_targets ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.curriculum_subject_targets FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.curriculum_subject_targets FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.curriculum_subject_targets FROM authenticated;
  END IF;

  EXECUTE format('ALTER TABLE public.curriculum_subject_targets OWNER TO %I', application_owner);
  EXECUTE format('ALTER FUNCTION public.validate_curriculum_subject_target_scope() OWNER TO %I', application_owner);
END $$;
