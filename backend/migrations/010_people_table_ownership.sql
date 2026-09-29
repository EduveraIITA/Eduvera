-- Preserve the established owner when a separate administrator runs migrations.
-- Do not grant new tables to PUBLIC or browser roles; runtime-role RLS is a
-- separate rollout gate shared with the pre-existing school tables.
DO $$ DECLARE school_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO school_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['school_people','guardian_school_profiles','people_intakes'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,school_owner);
  END LOOP;
END $$;
