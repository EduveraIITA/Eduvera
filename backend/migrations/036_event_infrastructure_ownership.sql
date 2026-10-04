-- Keep the durable event path on the same direct-database application boundary
-- as the institution data it serves. Earlier event migrations could be applied
-- by a separate migration role, leaving RLS-enabled infrastructure owned by the
-- migrator and therefore inaccessible to the API role.

DO $$
DECLARE
  application_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner)
  INTO application_owner
  FROM pg_class
  WHERE oid = 'public.students'::regclass;

  ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.event_delivery_cursor ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.event_maintenance_leases ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON TABLE public.event_outbox FROM PUBLIC;
  REVOKE ALL ON TABLE public.event_delivery_cursor FROM PUBLIC;
  REVOKE ALL ON TABLE public.event_maintenance_leases FROM PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.event_outbox FROM anon;
    REVOKE ALL ON TABLE public.event_delivery_cursor FROM anon;
    REVOKE ALL ON TABLE public.event_maintenance_leases FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.event_outbox FROM authenticated;
    REVOKE ALL ON TABLE public.event_delivery_cursor FROM authenticated;
    REVOKE ALL ON TABLE public.event_maintenance_leases FROM authenticated;
  END IF;

  EXECUTE format('ALTER TABLE public.event_outbox OWNER TO %I', application_owner);
  EXECUTE format('ALTER TABLE public.event_delivery_cursor OWNER TO %I', application_owner);
  EXECUTE format('ALTER TABLE public.event_maintenance_leases OWNER TO %I', application_owner);

  IF to_regclass('public.event_outbox_sequence_seq') IS NOT NULL THEN
    EXECUTE format('ALTER SEQUENCE public.event_outbox_sequence_seq OWNER TO %I', application_owner);
  END IF;
END $$;
