-- Preserve applied 055 checksums. Agent history is accessible only through the
-- authenticated backend, not Supabase's browser Data API roles. Follow the
-- existing application-table ownership model; API guards own user/tenant scope.
DO $$
DECLARE application_owner text; table_name text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO application_owner FROM pg_class WHERE oid='public.students'::regclass;
  FOREACH table_name IN ARRAY ARRAY['agent_threads','agent_runs','agent_tool_steps','agent_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',table_name); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',table_name); END IF;
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I',table_name,application_owner);
  END LOOP;
END $$;
